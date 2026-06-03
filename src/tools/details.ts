import { z } from "zod";
import type { ToolDef } from "../tool.js";
import { dbManager } from "../database.js";
import { fetchComponentDetail, normalizeLcsc } from "../live-client.js";

interface LcscArgs {
  lcsc: string;
}

const lcscSchema = z.object({
  lcsc: z
    .string()
    .describe("JLCPCB/LCSC part number, e.g. 'C17976', 'C1337' (the 'C' is optional)"),
});

export const detailTools: ToolDef[] = [
  {
    name: "jlcpcb_get_component_details",
    description:
      "Get full details for a specific JLCPCB part: catalog metadata (manufacturer, " +
      "package, category) plus live stock, full pricing tiers, parametric specifications, " +
      "datasheet, and product images.",
    inputSchema: lcscSchema,
    handler: async (args: LcscArgs) => {
      const lcsc = normalizeLcsc(args.lcsc);
      const [row, live] = await Promise.all([
        dbManager.getComponent(lcsc),
        fetchComponentDetail(lcsc),
      ]);

      if (!row && !live) {
        return { lcsc, found: false, message: `Component ${lcsc} not found` };
      }

      const pricing =
        live?.productPriceList?.map((t) => ({
          qty: t.ladder ?? 0,
          price: t.usdPrice ?? 0,
        })) ?? [];

      const specifications =
        live?.paramVOList
          ?.filter((p) => p.paramNameEn && p.paramValueEn)
          .map((p) => ({ name: p.paramNameEn, value: p.paramValueEn })) ?? [];

      return {
        lcsc,
        found: true,
        mfr_part: row?.mfr_part ?? live?.productModel ?? null,
        manufacturer: row?.manufacturer ?? null,
        package: row?.package ?? null,
        category: row?.category ?? null,
        subcategory: row?.subcategory ?? null,
        description: row?.description ?? null,
        basic: row ? row.basic === 1 : null,
        catalog_stock: row?.stock ?? null,
        current_stock: live?.stockNumber ?? row?.stock ?? null,
        pricing,
        specifications,
        datasheet: live?.pdfUrl ?? row?.datasheet ?? null,
        images: live?.productImages ?? [],
        live_data_available: live !== null,
        jlcpcb_url: `https://jlcpcb.com/partdetail/${lcsc}`,
      };
    },
  },
  {
    name: "jlcpcb_get_component_stock",
    description:
      "Get the live, real-time stock quantity for a specific JLCPCB part. Falls back to " +
      "the catalog snapshot value if the live API is unavailable.",
    inputSchema: lcscSchema,
    handler: async (args: LcscArgs) => {
      const lcsc = normalizeLcsc(args.lcsc);
      const live = await fetchComponentDetail(lcsc);
      if (live && typeof live.stockNumber === "number") {
        return { lcsc, stock: live.stockNumber, source: "live" as const };
      }
      const row = await dbManager.getComponent(lcsc);
      if (row) {
        return { lcsc, stock: row.stock, source: "catalog" as const };
      }
      return { lcsc, stock: null, source: "none" as const, message: `Component ${lcsc} not found` };
    },
  },
  {
    name: "jlcpcb_get_component_pricing",
    description:
      "Get live quantity-break pricing tiers (USD unit price per quantity ladder) for a " +
      "specific JLCPCB part.",
    inputSchema: lcscSchema,
    handler: async (args: LcscArgs) => {
      const lcsc = normalizeLcsc(args.lcsc);
      const live = await fetchComponentDetail(lcsc);
      const tiers =
        live?.productPriceList?.map((t) => ({
          qty: t.ladder ?? 0,
          price: t.usdPrice ?? 0,
        })) ?? [];
      return {
        lcsc,
        currency: "USD",
        tiers,
        available: tiers.length > 0,
        ...(tiers.length === 0
          ? { message: "No live pricing available for this part" }
          : {}),
      };
    },
  },
  {
    name: "jlcpcb_get_datasheet_url",
    description:
      "Get the datasheet PDF URL for a specific JLCPCB part. Prefers the live API value " +
      "and falls back to the catalog snapshot.",
    inputSchema: lcscSchema,
    handler: async (args: LcscArgs) => {
      const lcsc = normalizeLcsc(args.lcsc);
      const live = await fetchComponentDetail(lcsc);
      if (live?.pdfUrl) {
        return { lcsc, datasheet_url: live.pdfUrl, source: "live" as const };
      }
      const row = await dbManager.getComponent(lcsc);
      if (row?.datasheet) {
        return { lcsc, datasheet_url: row.datasheet, source: "catalog" as const };
      }
      return {
        lcsc,
        datasheet_url: null,
        source: "none" as const,
        message: `No datasheet found for ${lcsc}`,
      };
    },
  },
];
