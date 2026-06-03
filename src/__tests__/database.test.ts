import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import Database from "better-sqlite3";
import { DatabaseManager, COMPONENTS_SCHEMA_SQL } from "../database.js";

let dbPath: string;

function uniqueTempPath(): string {
  return path.join(
    os.tmpdir(),
    `jlcpcb-test-${process.pid}-${Math.random().toString(36).slice(2)}.sqlite`
  );
}

function cleanup(p: string): void {
  for (const f of [p, `${p}.tmp`, path.join(path.dirname(p), "version.txt")]) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
}

function seed(p: string): void {
  const db = new Database(p);
  db.exec(COMPONENTS_SCHEMA_SQL);
  const ins = db.prepare(
    `INSERT INTO components
     (lcsc, mfr_part, category, subcategory, description, stock, datasheet,
      image, basic, manufacturer, package, attributes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  ins.run(
    "C100", "RES10K", "Resistors", "Chip Resistor", "10k 0805", 5000,
    "http://ds1", null, 1, "UNI-ROYAL", "0805",
    JSON.stringify({ Resistance: { values: { resistance: [10000, "10kΩ"] } } })
  );
  ins.run(
    "C200", "CAP100N", "Capacitors", "MLCC", "100nF 0603", 200,
    null, null, 0, "Samsung", "0603",
    JSON.stringify({ Capacitance: { values: { capacitance: [1e-7, "100nF"] } } })
  );
  db.close();
}

beforeEach(() => {
  dbPath = uniqueTempPath();
  process.env.JLCPCB_DATABASE_PATH = dbPath;
});

afterEach(() => {
  delete process.env.JLCPCB_DATABASE_PATH;
  vi.unstubAllGlobals();
  cleanup(dbPath);
});

describe("DatabaseManager.resolveAttributes", () => {
  const lut = [
    ["Manufacturer", { values: { default: ["ACME"] } }],
    ["Package", { values: { default: ["0402"] } }],
  ];

  it("resolves LUT integer ids into the attributes dict", () => {
    expect(DatabaseManager.resolveAttributes([0, 1], lut)).toEqual({
      Manufacturer: { values: { default: ["ACME"] } },
      Package: { values: { default: ["0402"] } },
    });
  });

  it("skips out-of-range and non-numeric ids", () => {
    expect(DatabaseManager.resolveAttributes([0, 99, -1, "x"], lut)).toEqual({
      Manufacturer: { values: { default: ["ACME"] } },
    });
  });

  it("returns an empty object for non-array input", () => {
    expect(DatabaseManager.resolveAttributes("nope", lut)).toEqual({});
  });
});

describe("DatabaseManager.attrPrimaryValue", () => {
  it("reads the value under the attribute's `primary` key (v4 identifier)", () => {
    const attrs = {
      Package: { primary: "identifier", values: { identifier: ["0805", "x"] } },
      Manufacturer: { primary: "identifier", values: { identifier: ["UNI-ROYAL"] } },
    };
    expect(DatabaseManager.attrPrimaryValue(attrs, "Package")).toBe("0805");
    expect(DatabaseManager.attrPrimaryValue(attrs, "Manufacturer")).toBe("UNI-ROYAL");
  });

  it("falls back to the `default` key for older/other shapes", () => {
    const attrs = { "Basic/Extended": { values: { default: ["Basic", "string"] } } };
    expect(DatabaseManager.attrPrimaryValue(attrs, "Basic/Extended")).toBe("Basic");
  });

  it("returns undefined for a missing attribute", () => {
    expect(DatabaseManager.attrPrimaryValue({}, "Package")).toBeUndefined();
  });
});

describe("DatabaseManager path resolution", () => {
  it("honours JLCPCB_DATABASE_PATH", () => {
    const m = new DatabaseManager();
    expect(m.dbPath).toBe(path.resolve(dbPath));
  });
});

describe("DatabaseManager query helpers (seeded DB, no network)", () => {
  beforeEach(() => {
    seed(dbPath);
    // Any network call here would be a regression — make it fail loudly.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("unexpected network call");
      })
    );
  });

  it("getComponent returns a row or null", async () => {
    const m = new DatabaseManager();
    const got = await m.getComponent("C100");
    expect(got?.mfr_part).toBe("RES10K");
    expect(got?.basic).toBe(1);
    expect(await m.getComponent("C999")).toBeNull();
  });

  it("listCategories groups with counts", async () => {
    const m = new DatabaseManager();
    const cats = await m.listCategories();
    expect(cats).toHaveLength(2);
    expect(cats.map((c) => c.category).sort()).toEqual(["Capacitors", "Resistors"]);
  });

  it("searchComponents matches by keyword, package, basic flag, and resistance", async () => {
    const m = new DatabaseManager();

    const byQuery = await m.searchComponents({ query: "Samsung", limit: 10 });
    expect(byQuery.map((r) => r.lcsc)).toContain("C200");

    const byPkg = await m.searchComponents({ package: "0805", limit: 10 });
    expect(byPkg.map((r) => r.lcsc)).toEqual(["C100"]);

    const basicOnly = await m.searchComponents({ basicOnly: true, limit: 10 });
    expect(basicOnly.every((r) => r.basic === 1)).toBe(true);

    const byRes = await m.searchComponents({ resistanceOhms: 10000, limit: 10 });
    expect(byRes.map((r) => r.lcsc)).toContain("C100");

    const byMinStock = await m.searchComponents({ minStock: 1000, limit: 10 });
    expect(byMinStock.map((r) => r.lcsc)).toEqual(["C100"]);
  });

  it("status reports an existing DB with a component count", () => {
    const m = new DatabaseManager();
    const st = m.status();
    expect(st.exists).toBe(true);
    expect(st.componentCount).toBe(2);
    expect(st.sizeBytes).toBeGreaterThan(0);
  });
});

describe("DatabaseManager.status (missing DB)", () => {
  it("reports a non-existent database", () => {
    const m = new DatabaseManager();
    const st = m.status();
    expect(st.exists).toBe(false);
    expect(st.componentCount).toBeNull();
    expect(st.sizeBytes).toBeNull();
  });
});

describe("DatabaseManager.downloadDatabase (mocked upstream)", () => {
  const MANIFEST = {
    version: 2,
    totalComponents: 1,
    attributesLut: "attributes-lut.json.gz",
    categories: [
      { category: "Resistors", subcategory: "Chip Resistor", shards: ["r0.json.gz"] },
    ],
  };
  // Mirrors the manifest-v4 LUT shape: Package/Manufacturer store their value
  // under the `identifier` key (named by `primary`), Basic/Extended under `default`.
  const LUT = [
    ["Basic/Extended", { primary: "default", values: { default: ["Basic", "string"] } }],
    ["Manufacturer", { primary: "identifier", values: { identifier: ["UNI-ROYAL", "identifier"] } }],
    ["Package", { primary: "identifier", values: { identifier: ["0805", "identifier"] } }],
    ["Resistance", { primary: "resistance", values: { resistance: [10000, "10kΩ"] } }],
  ];
  const SHARD_HEADER = {
    lcsc: 0, mfr: 1, description: 2, stock: 3, datasheet: 4, price: 5, img: 6, attributes: 7,
  };
  const SHARD_ROW = [
    "C17414", "0805W8F1002T5E", "10kΩ ±1% 0805", 100000, "https://ex/ds.pdf",
    [{ qFrom: 1, qTo: 10, price: 0.0123 }], "img.png", [0, 1, 2, 3],
  ];
  const SHARD_TEXT = `${JSON.stringify(SHARD_HEADER)}\n${JSON.stringify(SHARD_ROW)}\n`;

  function gzBuf(s: string): ArrayBuffer {
    const b = gzipSync(Buffer.from(s, "utf-8"));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  }

  function fixtureFetch(input: unknown) {
    const url = String(input);
    if (url.endsWith("manifest.json")) {
      return { ok: true, status: 200, json: async () => MANIFEST };
    }
    if (url.endsWith("attributes-lut.json.gz")) {
      return { ok: true, status: 200, arrayBuffer: async () => gzBuf(JSON.stringify(LUT)) };
    }
    if (url.endsWith("r0.json.gz")) {
      return { ok: true, status: 200, arrayBuffer: async () => gzBuf(SHARD_TEXT) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }

  it("builds the catalog DB from manifest + LUT + shards", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => fixtureFetch(input) as Response));

    const m = new DatabaseManager();
    await m.downloadDatabase();

    expect(fs.existsSync(dbPath)).toBe(true);
    expect(fs.existsSync(`${dbPath}.tmp`)).toBe(false); // atomic rename cleaned up

    const got = await m.getComponent("C17414");
    expect(got).not.toBeNull();
    expect(got?.basic).toBe(1);
    expect(got?.manufacturer).toBe("UNI-ROYAL");
    expect(got?.package).toBe("0805");
    expect(got?.stock).toBe(100000);

    // Resistance attribute survived the LUT resolution.
    const attrs = JSON.parse(got!.attributes!);
    expect(attrs.Resistance.values.resistance[0]).toBe(10000);

    // Price tier was inserted.
    const db = new Database(dbPath, { readonly: true });
    const price = db.prepare("SELECT * FROM prices WHERE lcsc = ?").get("C17414") as any;
    db.close();
    expect(price.price).toBeCloseTo(0.0123, 6);
    expect(price.qty_from).toBe(1);

    // version.txt metadata written.
    expect(fs.existsSync(path.join(path.dirname(dbPath), "version.txt"))).toBe(true);
  });

  it("fails fast and cleans up the temp file on a 404 manifest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response)
    );

    const m = new DatabaseManager();
    await expect(m.downloadDatabase()).rejects.toThrow(/HTTP 404/);
    expect(fs.existsSync(`${dbPath}.tmp`)).toBe(false);
    expect(fs.existsSync(dbPath)).toBe(false);
  });
});
