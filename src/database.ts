/**
 * Local catalog database management for JLCPCB components.
 *
 * The component catalog (descriptions, packages, attributes, categories) is
 * built into a local SQLite database from the community-maintained
 * yaqwsx/jlcparts dataset. Live stock/pricing/datasheet data is fetched
 * separately at query time (see `live-client.ts`).
 *
 * Ported from peterb154/jlcpcb-search-mcp `database.py`, using better-sqlite3
 * (synchronous) for the storage layer.
 */

import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import Database from "better-sqlite3";

import { getDataDir } from "./paths.js";

/**
 * Schema shared by the production builder and tests so they cannot silently
 * drift apart. Uses `CREATE ... IF NOT EXISTS` so it is safe to run against an
 * existing database.
 */
export const COMPONENTS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS components (
    lcsc TEXT PRIMARY KEY,
    mfr_part TEXT,
    category TEXT,
    subcategory TEXT,
    description TEXT,
    stock INTEGER,
    datasheet TEXT,
    image TEXT,
    basic INTEGER,
    manufacturer TEXT,
    package TEXT,
    attributes TEXT
);
CREATE INDEX IF NOT EXISTS idx_category ON components(category);
CREATE INDEX IF NOT EXISTS idx_subcategory ON components(subcategory);
CREATE INDEX IF NOT EXISTS idx_mfr_part ON components(mfr_part);
CREATE INDEX IF NOT EXISTS idx_manufacturer ON components(manufacturer);
CREATE INDEX IF NOT EXISTS idx_basic ON components(basic);
CREATE TABLE IF NOT EXISTS prices (
    lcsc TEXT,
    qty_from INTEGER,
    qty_to INTEGER,
    price REAL,
    FOREIGN KEY (lcsc) REFERENCES components(lcsc)
);
CREATE INDEX IF NOT EXISTS idx_prices_lcsc ON prices(lcsc);
`;

/** A catalog row as stored in the `components` table. */
export interface ComponentRow {
  lcsc: string;
  mfr_part: string | null;
  category: string | null;
  subcategory: string | null;
  description: string | null;
  stock: number | null;
  datasheet: string | null;
  image: string | null;
  basic: number;
  manufacturer: string | null;
  package: string | null;
  attributes: string | null;
}

/** A grouped category/subcategory count row. */
export interface CategoryRow {
  category: string | null;
  subcategory: string | null;
  count: number;
}

/** Numeric, already-parsed search filters (string parsing happens in tools). */
export interface SearchFilters {
  query?: string;
  category?: string;
  package?: string;
  basicOnly?: boolean;
  minStock?: number;
  resistanceOhms?: number;
  capacitanceF?: number;
  voltageRatingV?: number;
  powerRatingW?: number;
  outputVoltageV?: number;
  outputCurrentA?: number;
  inputVoltageMinV?: number;
  /** Candidate row limit (the tool re-ranks/enriches and truncates further). */
  limit: number;
}

/** Database status snapshot for the `database_status` tool. */
export interface DatabaseStatus {
  exists: boolean;
  path: string;
  sizeBytes: number | null;
  componentCount: number | null;
  metadata: Record<string, string>;
}

const DB_BASE_URL = "https://yaqwsx.github.io/jlcparts/data";
const DB_FILENAME = "components.sqlite";
const MANIFEST_FILENAME = "manifest.json";
const ATTR_LUT_FILENAME = "attributes-lut.json.gz";
const MANIFEST_VERSION = 2;

const HTTP_RETRY_ATTEMPTS = 3;
const HTTP_BACKOFF_BASE_MS = 500;
const HTTP_BACKOFF_MAX_MS = 4000;

/**
 * Rated-voltage attribute paths, OR'd together so categories that store rated
 * voltage under different attribute names all match. `CAST(... AS REAL)` forces
 * a numeric comparison so a stringly-typed "25V" can't satisfy every threshold.
 */
const VOLTAGE_RATING_ATTRIBUTE_PATHS: ReadonlyArray<readonly [string, string]> = [
  ["Voltage Rated", "voltage rated"],
  ["Voltage Rating", "voltage rating"],
  ["Allowable voltage", "voltage"], // capacitors
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DatabaseManager {
  readonly dbPath: string;
  readonly dataDir: string;
  readonly versionFile: string;

  constructor() {
    const explicit = process.env.JLCPCB_DATABASE_PATH;
    if (explicit) {
      let p = path.isAbsolute(explicit)
        ? explicit
        : path.resolve(process.cwd(), explicit);
      this.dbPath = path.resolve(p);
      this.dataDir = path.dirname(this.dbPath);
    } else if (process.env.JLCPCB_DEV_MODE) {
      this.dataDir = path.resolve(process.cwd(), "data");
      this.dbPath = path.join(this.dataDir, DB_FILENAME);
    } else {
      this.dataDir = getDataDir("jlcpcb-mcp");
      this.dbPath = path.join(this.dataDir, DB_FILENAME);
    }
    this.versionFile = path.join(this.dataDir, "version.txt");
  }

  private log(message: string): void {
    // MCP stdio servers reserve stdout for protocol traffic; logs go to stderr.
    process.stderr.write(message + "\n");
  }

  /** Ensure the database exists and is valid, downloading/building if needed. */
  async ensureDatabase(): Promise<string> {
    if (!fs.existsSync(this.dbPath)) {
      await this.downloadDatabase();
    }
    if (!this.verifyDatabase()) {
      this.log("⚠️  Database missing/corrupted, rebuilding...");
      await this.downloadDatabase();
    }
    return this.dbPath;
  }

  /** Force a fresh rebuild of the database from upstream. */
  async updateDatabase(): Promise<void> {
    if (fs.existsSync(this.dbPath)) fs.unlinkSync(this.dbPath);
    if (fs.existsSync(this.versionFile)) fs.unlinkSync(this.versionFile);
    await this.downloadDatabase();
  }

  /**
   * GET `url` with exponential backoff + jitter on transient failures.
   * Retries network errors, timeouts, and 5xx; fails fast on 4xx.
   */
  private async httpGetWithRetry(
    url: string,
    timeoutMs = 30_000
  ): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 0; attempt < HTTP_RETRY_ATTEMPTS; attempt++) {
      let res: Response | undefined;
      try {
        res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      } catch (err) {
        lastError = err; // network error / timeout → retry
      }

      if (res) {
        if (res.status < 500) {
          if (!res.ok) {
            // 4xx is not transient — fail fast (thrown outside the try/catch).
            throw new Error(`HTTP ${res.status} for ${url}`);
          }
          return res; // 2xx / 3xx
        }
        lastError = new Error(`HTTP ${res.status} for ${url}`); // 5xx → retry
      }

      if (attempt + 1 < HTTP_RETRY_ATTEMPTS) {
        let backoff = Math.min(
          HTTP_BACKOFF_BASE_MS * 2 ** attempt,
          HTTP_BACKOFF_MAX_MS
        );
        backoff *= 0.5 + Math.random(); // ±50% jitter
        this.log(
          `  ⚠️  Request failed (${String(lastError)}); retrying in ` +
            `${(backoff / 1000).toFixed(1)}s (attempt ${attempt + 2}/${HTTP_RETRY_ATTEMPTS})...`
        );
        await sleep(backoff);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("retry loop exited without an exception");
  }

  /** Download the upstream manifest + shards and build the local database. */
  async downloadDatabase(): Promise<void> {
    fs.mkdirSync(this.dataDir, { recursive: true });

    // Build into a temporary path; rename to the final location only on success
    // so a crash mid-build never leaves a partial DB at the real path.
    const tmpPath = this.dbPath + ".tmp";
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);

    this.log("=".repeat(70));
    this.log("🔧 Building JLCPCB component catalog database");
    this.log(`Location: ${this.dataDir}`);
    this.log("This one-time setup downloads ~50MB and takes a few minutes.");
    this.log("=".repeat(70));

    let db: Database.Database | null = null;
    try {
      this.log("📥 [1/4] Downloading manifest...");
      const manifestRes = await this.httpGetWithRetry(
        `${DB_BASE_URL}/${MANIFEST_FILENAME}`,
        30_000
      );
      const manifest = (await manifestRes.json()) as {
        version?: number;
        categories: Array<{
          category: string;
          subcategory: string;
          shards?: string[];
        }>;
        attributesLut?: string;
        totalComponents?: number;
      };
      if (manifest.version !== MANIFEST_VERSION) {
        this.log(
          `⚠️  Manifest version ${manifest.version} differs from expected ` +
            `${MANIFEST_VERSION}; attempting to proceed.`
        );
      }
      const categories = manifest.categories ?? [];
      this.log(
        `✓ Manifest: ${categories.length} subcategories, ` +
          `${manifest.totalComponents ?? "?"} components`
      );

      this.log("📥 [2/4] Downloading attributes lookup table...");
      const lutFilename = manifest.attributesLut ?? ATTR_LUT_FILENAME;
      const lutRes = await this.httpGetWithRetry(
        `${DB_BASE_URL}/${lutFilename}`,
        60_000
      );
      const lut = JSON.parse(
        gunzipSync(Buffer.from(await lutRes.arrayBuffer())).toString("utf-8")
      ) as unknown[];
      this.log(`✓ LUT: ${lut.length} entries`);

      this.log("🔨 [3/4] Creating schema...");
      db = new Database(tmpPath);
      db.exec(COMPONENTS_SCHEMA_SQL);

      const insertComponent = db.prepare(
        `INSERT OR REPLACE INTO components
         (lcsc, mfr_part, category, subcategory, description, stock,
          datasheet, image, basic, manufacturer, package, attributes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const insertPrice = db.prepare(
        `INSERT INTO prices (lcsc, qty_from, qty_to, price) VALUES (?, ?, ?, ?)`
      );

      this.log(
        `📦 [4/4] Downloading & processing ${categories.length} subcategories...`
      );
      let processed = 0;
      for (const subcat of categories) {
        processed++;
        const shards = subcat.shards ?? [];
        if (processed % 25 === 0 || processed === categories.length) {
          const pct = ((processed / categories.length) * 100).toFixed(0);
          this.log(`  [${processed}/${categories.length}] (${pct}%) ...`);
        }
        try {
          for (const shardFilename of shards) {
            const { rows, schema } = await this.fetchShard(shardFilename);
            const tx = db.transaction(() =>
              DatabaseManager.insertComponents(
                insertComponent,
                insertPrice,
                rows,
                schema,
                lut,
                subcat.category,
                subcat.subcategory
              )
            );
            tx();
          }
        } catch (err) {
          this.log(`  ⚠️  Skipped ${subcat.subcategory}: ${String(err)}`);
          continue;
        }
      }

      db.close();
      db = null;

      // Atomically swap the freshly built DB into place.
      fs.renameSync(tmpPath, this.dbPath);

      const sizeMb = fs.statSync(this.dbPath).size / 1024 ** 2;
      this.log("=".repeat(70));
      this.log(`✅ Database build complete (~${sizeMb.toFixed(0)} MB)`);
      this.log(`📍 ${this.dbPath}`);
      this.log("=".repeat(70));

      fs.writeFileSync(
        this.versionFile,
        [
          `Downloaded: ${new Date().toISOString()}`,
          `Source: ${DB_BASE_URL}`,
          `Manifest version: ${manifest.version}`,
          `Subcategories: ${categories.length}`,
          `Total components: ${manifest.totalComponents ?? "unknown"}`,
          "",
        ].join("\n")
      );
    } catch (err) {
      this.log(`❌ Error building database: ${String(err)}`);
      if (db) db.close();
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      throw err;
    }
  }

  /** Download and parse a single gzipped component shard. */
  private async fetchShard(
    shardFilename: string
  ): Promise<{ rows: unknown[][]; schema: Record<string, number> }> {
    const res = await this.httpGetWithRetry(
      `${DB_BASE_URL}/${shardFilename}`,
      60_000
    );
    const text = gunzipSync(Buffer.from(await res.arrayBuffer())).toString(
      "utf-8"
    );
    const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
    if (lines.length === 0) return { rows: [], schema: {} };

    const schema = JSON.parse(lines[0]) as Record<string, number>;
    const rows = lines.slice(1).map((line) => JSON.parse(line) as unknown[]);
    return { rows, schema };
  }

  /** Insert shard rows into the components + prices tables (synchronous). */
  private static insertComponents(
    insertComponent: Database.Statement,
    insertPrice: Database.Statement,
    rows: unknown[][],
    schema: Record<string, number>,
    lut: unknown[],
    mainCat: string,
    subCat: string
  ): void {
    const idxLcsc = schema["lcsc"];
    const idxMfr = schema["mfr"];
    if (idxLcsc === undefined || idxMfr === undefined) {
      throw new Error("shard schema missing required 'lcsc'/'mfr' fields");
    }
    const idxDescription = schema["description"];
    const idxDatasheet = schema["datasheet"];
    const idxPrice = schema["price"];
    const idxImg = schema["img"];
    const idxAttributes = schema["attributes"];
    const idxStock = schema["stock"];

    const at = (row: unknown[], idx: number | undefined): unknown =>
      idx === undefined ? undefined : row[idx];

    for (const row of rows) {
      try {
        const lcsc = at(row, idxLcsc) as string;
        const mfrPart = at(row, idxMfr) as string;
        const description = (at(row, idxDescription) as string) ?? null;
        const stock = (at(row, idxStock) as number) ?? null;
        const datasheet = (at(row, idxDatasheet) as string) ?? null;
        const priceTiers = (at(row, idxPrice) as unknown[]) ?? [];
        const image = (at(row, idxImg) as string) ?? null;
        const attrIds = (at(row, idxAttributes) as unknown[]) ?? [];

        const attributes = DatabaseManager.resolveAttributes(attrIds, lut);

        const basic =
          DatabaseManager.attrPrimaryValue(attributes, "Basic/Extended") ===
          "Basic"
            ? 1
            : 0;
        const manufacturer =
          DatabaseManager.attrPrimaryValue(attributes, "Manufacturer") ?? null;
        const pkg =
          DatabaseManager.attrPrimaryValue(attributes, "Package") ?? null;

        insertComponent.run(
          lcsc,
          mfrPart,
          mainCat,
          subCat,
          description,
          stock,
          datasheet,
          image,
          basic,
          manufacturer,
          pkg,
          Object.keys(attributes).length > 0 ? JSON.stringify(attributes) : null
        );

        if (Array.isArray(priceTiers)) {
          for (const tier of priceTiers) {
            if (tier && typeof tier === "object") {
              const t = tier as {
                qFrom?: number;
                qTo?: number;
                price?: number;
              };
              insertPrice.run(
                lcsc,
                t.qFrom ?? null,
                t.qTo ?? null,
                t.price ?? null
              );
            }
          }
        }
      } catch {
        // Skip malformed components.
        continue;
      }
    }
  }

  /** Resolve a list of LUT integer IDs into the legacy attributes dict shape. */
  static resolveAttributes(
    attrIds: unknown,
    lut: unknown[]
  ): Record<string, unknown> {
    const attributes: Record<string, unknown> = {};
    if (!Array.isArray(attrIds)) return attributes;
    for (const aid of attrIds) {
      if (typeof aid !== "number" || aid < 0 || aid >= lut.length) continue;
      const entry = lut[aid];
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const [name, value] = entry;
      if (typeof name === "string") attributes[name] = value;
    }
    return attributes;
  }

  /**
   * Read an attribute's canonical first value. jlcparts stores the value under
   * the key named by the attribute's own `primary` field — `"identifier"` for
   * Package/Manufacturer, `"default"` for Basic/Extended, etc. (manifest v4).
   * We honor `primary` first, then fall back to common keys / any value, so the
   * builder is robust across catalog format revisions.
   */
  static attrPrimaryValue(
    attributes: Record<string, unknown>,
    name: string
  ): string | undefined {
    const attr = attributes[name];
    if (!attr || typeof attr !== "object") return undefined;
    const obj = attr as {
      primary?: string;
      values?: Record<string, unknown[]>;
    };
    const values = obj.values;
    if (!values) return undefined;
    const keys = [obj.primary, "default", "identifier", ...Object.keys(values)];
    for (const key of keys) {
      if (!key) continue;
      const arr = values[key];
      if (Array.isArray(arr) && arr.length > 0 && arr[0] != null) {
        return String(arr[0]);
      }
    }
    return undefined;
  }

  /** Verify the database opens and has the expected `components` table. */
  private verifyDatabase(): boolean {
    try {
      const db = new Database(this.dbPath, { readonly: true });
      try {
        const row = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='components'"
          )
          .get();
        return row !== undefined;
      } finally {
        db.close();
      }
    } catch {
      return false;
    }
  }

  /** Open a read-only connection after ensuring the database exists. */
  private async openReadonly(): Promise<Database.Database> {
    await this.ensureDatabase();
    return new Database(this.dbPath, { readonly: true, fileMustExist: true });
  }

  /**
   * Search the catalog with optional keyword + filters. Returns up to
   * `filters.limit` candidate rows ordered by Basic-first then stock; the
   * caller applies finer scoring, live enrichment, and final truncation.
   */
  async searchComponents(filters: SearchFilters): Promise<ComponentRow[]> {
    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (filters.query) {
      const terms = filters.query.split(/\s+/).filter(Boolean);
      const termClauses: string[] = [];
      for (const term of terms) {
        const like = `%${term}%`;
        termClauses.push(
          "(mfr_part LIKE ? OR category LIKE ? OR subcategory LIKE ? OR manufacturer LIKE ? OR description LIKE ?)"
        );
        params.push(like, like, like, like, like);
      }
      if (termClauses.length > 0) {
        conditions.push("(" + termClauses.join(" AND ") + ")");
      }
    }

    if (filters.category) {
      conditions.push("(category LIKE ? OR subcategory LIKE ?)");
      const c = `%${filters.category}%`;
      params.push(c, c);
    }
    if (filters.package) {
      conditions.push("package LIKE ?");
      params.push(`%${filters.package}%`);
    }
    if (filters.basicOnly) {
      conditions.push("basic = 1");
    }
    if (filters.minStock !== undefined) {
      conditions.push("stock >= ?");
      params.push(filters.minStock);
    }

    if (filters.resistanceOhms !== undefined) {
      const r = filters.resistanceOhms;
      conditions.push(
        "json_extract(attributes, '$.Resistance.values.resistance[0]') BETWEEN ? AND ?"
      );
      params.push(r * 0.95, r * 1.05);
    }
    if (filters.capacitanceF !== undefined) {
      const c = filters.capacitanceF;
      conditions.push(
        "json_extract(attributes, '$.Capacitance.values.capacitance[0]') BETWEEN ? AND ?"
      );
      params.push(c * 0.9, c * 1.1);
    }
    if (filters.voltageRatingV !== undefined) {
      const clause = VOLTAGE_RATING_ATTRIBUTE_PATHS.map(
        ([name, key]) =>
          `CAST(json_extract(attributes, '$."${name}".values."${key}"[0]') AS REAL) >= ?`
      ).join(" OR ");
      conditions.push("(" + clause + ")");
      for (const _ of VOLTAGE_RATING_ATTRIBUTE_PATHS) {
        params.push(filters.voltageRatingV);
      }
    }
    if (filters.powerRatingW !== undefined) {
      conditions.push(
        "json_extract(attributes, '$.Power.values.power[0]') >= ?"
      );
      params.push(filters.powerRatingW);
    }
    if (filters.inputVoltageMinV !== undefined) {
      conditions.push(
        `attributes LIKE ? AND json_extract(attributes, '$."Input voltage".values.default[0]') LIKE ?`
      );
      params.push("%Input voltage%", `%${filters.inputVoltageMinV}V%`);
    }
    if (filters.outputVoltageV !== undefined) {
      const v = filters.outputVoltageV;
      conditions.push(
        `json_extract(attributes, '$."Output voltage".values.voltage[0]') BETWEEN ? AND ?`
      );
      params.push(v * 0.9, v * 1.1);
    }
    if (filters.outputCurrentA !== undefined) {
      conditions.push(
        `(json_extract(attributes, '$."Output current (max)".values.current[0]') >= ? OR ` +
          `json_extract(attributes, '$."Output current (max)".values.current2[0]') >= ?)`
      );
      params.push(filters.outputCurrentA, filters.outputCurrentA);
    }

    const where = conditions.length > 0 ? conditions.join(" AND ") : "1=1";
    const sql = `
      SELECT lcsc, mfr_part, category, subcategory, description, stock,
             datasheet, image, basic, manufacturer, package, attributes
      FROM components
      WHERE ${where}
      ORDER BY basic DESC, stock DESC
      LIMIT ?
    `;
    params.push(filters.limit);

    const db = await this.openReadonly();
    try {
      return db.prepare(sql).all(...params) as ComponentRow[];
    } finally {
      db.close();
    }
  }

  /** Fetch a single component by (normalized) LCSC number. */
  async getComponent(lcsc: string): Promise<ComponentRow | null> {
    const db = await this.openReadonly();
    try {
      const row = db
        .prepare(
          `SELECT lcsc, mfr_part, category, subcategory, description, stock,
                  datasheet, image, basic, manufacturer, package, attributes
           FROM components WHERE lcsc = ?`
        )
        .get(lcsc) as ComponentRow | undefined;
      return row ?? null;
    } finally {
      db.close();
    }
  }

  /** List category / subcategory groupings with component counts. */
  async listCategories(): Promise<CategoryRow[]> {
    const db = await this.openReadonly();
    try {
      return db
        .prepare(
          `SELECT category, subcategory, COUNT(*) AS count
           FROM components
           GROUP BY category, subcategory
           ORDER BY category, subcategory`
        )
        .all() as CategoryRow[];
    } finally {
      db.close();
    }
  }

  /** Report database location, size, component count, and build metadata. */
  status(): DatabaseStatus {
    const exists = fs.existsSync(this.dbPath);
    if (!exists) {
      return {
        exists: false,
        path: this.dbPath,
        sizeBytes: null,
        componentCount: null,
        metadata: {},
      };
    }

    const sizeBytes = fs.statSync(this.dbPath).size;

    let componentCount: number | null = null;
    try {
      const db = new Database(this.dbPath, { readonly: true });
      try {
        const row = db
          .prepare("SELECT COUNT(*) AS c FROM components")
          .get() as { c: number };
        componentCount = row.c;
      } finally {
        db.close();
      }
    } catch {
      componentCount = null;
    }

    const metadata: Record<string, string> = {};
    if (fs.existsSync(this.versionFile)) {
      const content = fs.readFileSync(this.versionFile, "utf-8");
      for (const line of content.split(/\r?\n/)) {
        const idx = line.indexOf(":");
        if (idx > 0) {
          metadata[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        }
      }
    }

    return { exists, path: this.dbPath, sizeBytes, componentCount, metadata };
  }
}

/** Shared singleton used by the tools. */
export const dbManager = new DatabaseManager();
