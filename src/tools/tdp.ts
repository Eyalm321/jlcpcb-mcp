import { z } from "zod";
import type { ToolDef } from "../tool.js";
import {
  officialRequest,
  officialUpload,
  hasOfficialCredentials,
  ordersEnabled,
  CREDENTIALS_MESSAGE,
} from "../official-client.js";

interface UploadArgs {
  file_path: string;
  file_name?: string;
}
interface ParamsArgs {
  params?: Record<string, unknown>;
}
interface RequiredParamsArgs {
  params: Record<string, unknown>;
}

const notConfigured = () => ({ configured: false, message: CREDENTIALS_MESSAGE });

const ordersDisabled = () => ({
  enabled: false,
  message:
    "Order creation is disabled. This places a real, paid JLCPCB 3D-printing order. " +
    "Set JLCPCB_ENABLE_ORDERS=true to enable this tool.",
});

export const tdpTools: ToolDef[] = [
  {
    name: "jlcpcb_tdp_upload_model",
    description:
      "Official 3D-printing (TDP) API: upload a 3D model file (e.g. STL/STEP) for analysis and " +
      "quoting. Returns a fileAccessId used by the other TDP tools. Requires API credentials.",
    inputSchema: z.object({
      file_path: z.string().describe("Absolute path to the 3D model file (read locally by the server)"),
      file_name: z.string().optional().describe("Override the uploaded file name"),
    }),
    handler: async (args: UploadArgs) => {
      if (!hasOfficialCredentials()) return notConfigured();
      const data = await officialUpload("/overseas/openapi/tdp/api/upload", {
        filePath: args.file_path,
        fileName: args.file_name,
      });
      return { configured: true, data };
    },
  },
  {
    name: "jlcpcb_tdp_file_analysis_result",
    description:
      "Official 3D-printing API: fetch the analysis result (dimensions/volume/printability) for an " +
      "uploaded model by its fileAccessId. Requires API credentials.",
    inputSchema: z.object({
      file_access_id: z.string().describe("fileAccessId returned by jlcpcb_tdp_upload_model"),
    }),
    handler: async (args: { file_access_id: string }) => {
      if (!hasOfficialCredentials()) return notConfigured();
      const data = await officialRequest("/overseas/openapi/tdp/api/file/result", {
        method: "POST",
        body: { fileAccessId: args.file_access_id },
      });
      return { configured: true, data };
    },
  },
  {
    name: "jlcpcb_tdp_calculate_price",
    description:
      "Official 3D-printing API: calculate price for a 3D-printing job (a quote, no order is placed). " +
      "Pass a `params` object with keys such as fileAccessId, materialAccessId, materialColorAccessId, " +
      "itemCount, surfaceTreatmentProcess, shippingAddress, freightMode. Requires API credentials.",
    inputSchema: z.object({
      params: z
        .record(z.string(), z.any())
        .describe("Calculate body: { fileAccessId, materialAccessId, materialColorAccessId, itemCount, surfaceTreatmentProcess, shippingAddress, freightMode, ... }"),
    }),
    handler: async (args: RequiredParamsArgs) => {
      if (!hasOfficialCredentials()) return notConfigured();
      const data = await officialRequest("/overseas/openapi/tdp/api/calculate", {
        method: "POST",
        body: args.params,
      });
      return { configured: true, data };
    },
  },
  {
    name: "jlcpcb_tdp_order_list",
    description:
      "Official 3D-printing API: list your 3D-printing orders, paginated/filterable. Pass an optional " +
      "`params` object (currentPage, pageRows, orderStatus, searchKey, ...). Requires API credentials.",
    inputSchema: z.object({
      params: z
        .record(z.string(), z.any())
        .optional()
        .describe("Optional query: { currentPage, pageRows, orderStatus, searchKey, businessType, ... }"),
    }),
    handler: async (args: ParamsArgs) => {
      if (!hasOfficialCredentials()) return notConfigured();
      const data = await officialRequest("/overseas/openapi/tdp/api/order/list", {
        method: "POST",
        body: args.params ?? {},
      });
      return { configured: true, data };
    },
  },
  {
    name: "jlcpcb_tdp_order_detail",
    description:
      "Official 3D-printing API: get a 3D-printing order's details by batch number. Requires API credentials.",
    inputSchema: z.object({
      batch_num: z.string().describe("Order batch number"),
    }),
    handler: async (args: { batch_num: string }) => {
      if (!hasOfficialCredentials()) return notConfigured();
      const data = await officialRequest("/overseas/openapi/tdp/api/order/detail", {
        method: "POST",
        body: { batchNum: args.batch_num },
      });
      return { configured: true, data };
    },
  },
  {
    name: "jlcpcb_tdp_order_process",
    description:
      "Official 3D-printing API: get production progress for a 3D-printing order by order number. " +
      "Requires API credentials.",
    inputSchema: z.object({
      order_no: z.string().describe("Order number"),
    }),
    handler: async (args: { order_no: string }) => {
      if (!hasOfficialCredentials()) return notConfigured();
      const data = await officialRequest("/overseas/openapi/tdp/api/order/process", {
        method: "POST",
        body: { orderNo: args.order_no },
      });
      return { configured: true, data };
    },
  },
  {
    name: "jlcpcb_tdp_create_order",
    description:
      "Official 3D-printing API: CREATE A REAL, PAID 3D-printing order. Disabled unless " +
      "JLCPCB_ENABLE_ORDERS=true. Pass a `params` object (typically from a prior " +
      "jlcpcb_tdp_calculate_price quote) with keys such as fileAccessId, materialAccessId, itemCount, " +
      "shippingAddress, billingAddress, freightMode. Requires API credentials.",
    inputSchema: z.object({
      params: z
        .record(z.string(), z.any())
        .describe("Create-order body: { fileAccessId, materialAccessId, materialColorAccessId, itemCount, shippingAddress, billingAddress, freightMode, typeOfTrade, batchNum, ... }"),
    }),
    handler: async (args: RequiredParamsArgs) => {
      if (!hasOfficialCredentials()) return notConfigured();
      if (!ordersEnabled()) return ordersDisabled();
      const data = await officialRequest("/overseas/openapi/tdp/api/order/create", {
        method: "POST",
        body: args.params,
      });
      return { configured: true, ordered: true, data };
    },
  },
];
