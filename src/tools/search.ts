import { z } from "zod";
import type { ToolDef } from "../tool.js";
import { dbManager, type ComponentRow, type SearchFilters } from "../database.js";
import { fetchComponentDetail } from "../live-client.js";
import {
  parseResistance,
  parseCapacitance,
  parseVoltage,
  parseCurrent,
  parsePower,
} from "../value-parser.js";

interface SearchArgs {
  query: string;
  category?: string;
  package?: string;
  basic_only?: boolean;
  min_stock?: number;
  max_results?: number;
  resistance?: string;
  capacitance?: string;
  voltage_rating?: string;
  power_rating?: string;
  output_voltage?: string;
  output_current?: string;
  input_voltage_min?: string;
}

/** Read the first numeric value at `attributes[name].values[key][0]`. */
function attrNumber(
  parsed: Record<string, unknown> | null,
  name: string,
  key: string
): number | null {
  if (!parsed) return null;
  const attr = parsed[name];
  if (attr && typeof attr === "object") {
    const values = (attr as { values?: Record<string, unknown[]> }).values?.[key];
    if (Array.isArray(values) && typeof values[0] === "number") {
      return values[0] as number;
    }
  }
  return null;
}

function parseAttributes(row: ComponentRow): Record<string, unknown> | null {
  if (!row.attributes) return null;
  try {
    return JSON.parse(row.attributes) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Rank a candidate row: Basic parts first (+10), stock on a log scale (≤5),
 * and an exact parametric-value match bonus (+5). Mirrors the upstream scoring.
 */
function scoreRow(
  row: ComponentRow,
  resistanceOhms: number | null,
  capacitanceF: number | null
): number {
  let score = 0;
  if (row.basic) score += 10;
  if (row.stock && row.stock > 0) score += Math.min(5, Math.log10(row.stock + 1));

  if (resistanceOhms != null) {
    const v = attrNumber(parseAttributes(row), "Resistance", "resistance");
    if (v != null && Math.abs(v - resistanceOhms) < resistanceOhms * 0.01) score += 5;
  }
  if (capacitanceF != null) {
    const v = attrNumber(parseAttributes(row), "Capacitance", "capacitance");
    if (v != null && Math.abs(v - capacitanceF) < capacitanceF * 0.01) score += 5;
  }
  return score;
}

export const searchTools: ToolDef[] = [
  {
    name: "jlcpcb_search_components",
    description:
      "Search the JLCPCB component catalog by keyword and/or parametric filters, enriched " +
      "with live pricing. The catalog (descriptions, packages, attributes, categories) comes " +
      "from a local SQLite snapshot. Each result reports `jlc_assembly_stock` (catalog — the " +
      "figure that matters for PCBA) and `lcsc_retail_stock` (live LCSC retail, a different pool; " +
      "a 0 here is NOT an assembly shortage). Ranked Basic-first, then by assembly stock, then " +
      "unit price. Examples: '10k resistor 0805', 'STM32F4', 'ceramic capacitor'.",
    inputSchema: z.object({
      query: z
        .string()
        .describe("Search keywords, e.g. '10k resistor 0805', 'STM32F4', 'LDO 3.3V'"),
      category: z
        .string()
        .optional()
        .describe("Filter by category/subcategory, e.g. 'Resistors', 'Capacitors'"),
      package: z
        .string()
        .optional()
        .describe("Filter by package, e.g. '0805', 'SOT-23', 'QFN-32'"),
      basic_only: z
        .boolean()
        .optional()
        .default(false)
        .describe("Only Basic parts (no extended-part assembly fee)"),
      min_stock: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Minimum in-stock quantity required"),
      max_results: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .default(10)
        .describe("Maximum number of results to return (1-50)"),
      resistance: z
        .string()
        .optional()
        .describe("Resistance value, e.g. '10k', '4.7K', '100ohm' (matched ±5%)"),
      capacitance: z
        .string()
        .optional()
        .describe("Capacitance value, e.g. '10uF', '100nF', '22pF' (matched ±10%)"),
      voltage_rating: z
        .string()
        .optional()
        .describe("Minimum rated voltage, e.g. '50V', '16V'"),
      power_rating: z
        .string()
        .optional()
        .describe("Minimum power rating for resistors, e.g. '250mW', '1W'"),
      output_voltage: z
        .string()
        .optional()
        .describe("Output voltage for converters/regulators, e.g. '3.3V', '5V' (±10%)"),
      output_current: z
        .string()
        .optional()
        .describe("Minimum output current, e.g. '2A', '500mA'"),
      input_voltage_min: z
        .string()
        .optional()
        .describe("Minimum input voltage for power ICs, e.g. '5V', '12V'"),
    }),
    handler: async (args: SearchArgs) => {
      const maxResults = args.max_results ?? 10;

      const resistanceOhms = args.resistance ? parseResistance(args.resistance) : null;
      const capacitanceF = args.capacitance ? parseCapacitance(args.capacitance) : null;

      const filters: SearchFilters = {
        query: args.query,
        category: args.category,
        package: args.package,
        basicOnly: args.basic_only,
        minStock: args.min_stock,
        resistanceOhms: resistanceOhms ?? undefined,
        capacitanceF: capacitanceF ?? undefined,
        voltageRatingV: args.voltage_rating
          ? parseVoltage(args.voltage_rating) ?? undefined
          : undefined,
        powerRatingW: args.power_rating
          ? parsePower(args.power_rating) ?? undefined
          : undefined,
        outputVoltageV: args.output_voltage
          ? parseVoltage(args.output_voltage) ?? undefined
          : undefined,
        outputCurrentA: args.output_current
          ? parseCurrent(args.output_current) ?? undefined
          : undefined,
        inputVoltageMinV: args.input_voltage_min
          ? parseVoltage(args.input_voltage_min) ?? undefined
          : undefined,
        // Over-fetch a candidate pool so JS scoring + live price sort has room.
        limit: maxResults * 3,
      };

      const candidates = await dbManager.searchComponents(filters);
      if (candidates.length === 0) {
        return { query: args.query, count: 0, results: [] };
      }

      // Rank candidates, keep the strongest 2× for (relatively costly) live enrichment.
      const ranked = candidates
        .map((row) => ({ row, score: scoreRow(row, resistanceOhms, capacitanceF) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults * 2);

      const enriched = await Promise.all(
        ranked.map(async ({ row, score }) => {
          const live = await fetchComponentDetail(row.lcsc);
          const pricing =
            live?.productPriceList?.slice(0, 3).map((t) => ({
              qty: t.ladder ?? 0,
              price: t.usdPrice ?? 0,
            })) ?? [];
          return {
            lcsc: row.lcsc,
            mfr_part: row.mfr_part,
            manufacturer: row.manufacturer,
            package: row.package,
            category: row.category,
            subcategory: row.subcategory,
            basic: row.basic === 1,
            // Assembly availability (catalog) vs LCSC retail (live) — different pools.
            jlc_assembly_stock: row.stock,
            lcsc_retail_stock: live?.stockNumber ?? null,
            pricing,
            datasheet: live?.pdfUrl ?? row.datasheet ?? null,
            jlcpcb_url: `https://jlcpcb.com/partdetail/${row.lcsc}`,
            _score: score,
          };
        })
      );

      // Final ordering: parts with pricing first, then cheapest unit price, then score.
      enriched.sort((a, b) => {
        const aHas = a.pricing.length > 0 ? 0 : 1;
        const bHas = b.pricing.length > 0 ? 0 : 1;
        if (aHas !== bHas) return aHas - bHas;
        const ap = a.pricing[0]?.price ?? Number.POSITIVE_INFINITY;
        const bp = b.pricing[0]?.price ?? Number.POSITIVE_INFINITY;
        if (ap !== bp) return ap - bp;
        return b._score - a._score;
      });

      const results = enriched.slice(0, maxResults).map(({ _score, ...rest }) => rest);
      return { query: args.query, count: results.length, results };
    },
  },
];
