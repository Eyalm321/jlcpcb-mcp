import { z } from "zod";
import type { ToolDef } from "../tool.js";
import { officialRequest, hasOfficialCredentials } from "../official-client.js";

const CREDS_MESSAGE =
  "Official JLCPCB API credentials are not configured. Set JLCPCB_APP_ID, " +
  "JLCPCB_ACCESS_KEY, and JLCPCB_SECRET_KEY (apply for access at https://api.jlcpcb.com). " +
  "The catalog/live tools work without credentials.";

interface DetailArgs {
  codes: string[];
}
interface PageArgs {
  page?: number;
  page_size?: number;
}
interface FeedArgs {
  last_key?: string;
}

const pageSchema = z.object({
  page: z
    .number()
    .int()
    .min(1)
    .optional()
    .default(1)
    .describe("Page number (1-based)"),
  page_size: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(30)
    .describe("Results per page (max 100)"),
});

export const officialTools: ToolDef[] = [
  {
    name: "jlcpcb_official_get_component_detail",
    description:
      "Official JLCPCB Parts API (authenticated): authoritative details — specs, " +
      "stock, pricing, and attributes — for one or more LCSC part codes. More " +
      "complete than the public live endpoint. Requires API credentials.",
    inputSchema: z.object({
      codes: z
        .array(z.string())
        .min(1)
        .max(50)
        .describe("LCSC part codes, e.g. ['C17976', 'C1337']"),
    }),
    handler: async (args: DetailArgs) => {
      if (!hasOfficialCredentials()) {
        return { configured: false, message: CREDS_MESSAGE };
      }
      const data = await officialRequest(
        "/overseas/openapi/component/getComponentDetailByCode",
        { method: "POST", body: { componentCodes: args.codes } }
      );
      return { configured: true, codes: args.codes, data };
    },
  },
  {
    name: "jlcpcb_official_component_library",
    description:
      "Official JLCPCB Parts API (authenticated): browse the full assembly " +
      "component library, paginated. Requires API credentials.",
    inputSchema: pageSchema,
    handler: async (args: PageArgs) => {
      if (!hasOfficialCredentials()) {
        return { configured: false, message: CREDS_MESSAGE };
      }
      const data = await officialRequest(
        "/overseas/openapi/component/getComponentLibraryList",
        {
          method: "POST",
          body: { currentPage: args.page ?? 1, pageSize: args.page_size ?? 30 },
        }
      );
      return { configured: true, page: args.page ?? 1, data };
    },
  },
  {
    name: "jlcpcb_official_private_library",
    description:
      "Official JLCPCB Parts API (authenticated): list YOUR account's private / " +
      "consigned component library (parts you hold at JLCPCB), paginated. " +
      "Only available with API credentials.",
    inputSchema: pageSchema,
    handler: async (args: PageArgs) => {
      if (!hasOfficialCredentials()) {
        return { configured: false, message: CREDS_MESSAGE };
      }
      const data = await officialRequest(
        "/overseas/openapi/component/getPrivateComponentLibrary",
        {
          method: "POST",
          body: { currentPage: args.page ?? 1, pageSize: args.page_size ?? 30 },
        }
      );
      return { configured: true, page: args.page ?? 1, data };
    },
  },
  {
    name: "jlcpcb_official_component_feed",
    description:
      "Official JLCPCB Parts API (authenticated): cursor-paginated bulk feed of the " +
      "component catalog. Pass the `lastKey` returned by a previous call to page " +
      "through the entire library. Requires API credentials.",
    inputSchema: z.object({
      last_key: z
        .string()
        .optional()
        .describe("Pagination cursor from a previous call; omit for the first page"),
    }),
    handler: async (args: FeedArgs) => {
      if (!hasOfficialCredentials()) {
        return { configured: false, message: CREDS_MESSAGE };
      }
      const body: Record<string, unknown> = {};
      if (args.last_key) body.lastKey = args.last_key;
      const data = await officialRequest(
        "/overseas/openapi/component/getComponentInfos",
        { method: "POST", body }
      );
      return { configured: true, data };
    },
  },
];
