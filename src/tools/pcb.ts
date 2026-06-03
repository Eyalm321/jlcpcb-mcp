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
    "Order creation is disabled. This places a real, paid JLCPCB order. " +
    "Set JLCPCB_ENABLE_ORDERS=true to enable this tool.",
});

const uploadSchema = z.object({
  file_path: z.string().describe("Absolute path to the file to upload (read locally by the server)"),
  file_name: z.string().optional().describe("Override the uploaded file name (defaults to the basename)"),
});

const paramsSchema = (required: boolean, hint: string) =>
  (required
    ? z.object({ params: z.record(z.string(), z.any()).describe(hint) })
    : z.object({ params: z.record(z.string(), z.any()).optional().describe(hint) }));

export const pcbTools: ToolDef[] = [
  {
    name: "jlcpcb_pcb_upload_gerber",
    description:
      "Official PCB API: upload a Gerber archive (zip) for quoting/ordering. Returns a " +
      "fileKey to pass to jlcpcb_pcb_calculate_price / jlcpcb_pcb_create_order. Requires API credentials.",
    inputSchema: uploadSchema,
    handler: async (args: UploadArgs) => {
      if (!hasOfficialCredentials()) return notConfigured();
      const data = await officialUpload("/overseas/openapi/pcb/uploadGerber", {
        filePath: args.file_path,
        fileName: args.file_name,
      });
      return { configured: true, data };
    },
  },
  {
    name: "jlcpcb_pcb_upload_blind_via_hole_img",
    description:
      "Official PCB API: upload a blind/buried-via stackup image for boards that need one. " +
      "Requires API credentials.",
    inputSchema: uploadSchema,
    handler: async (args: UploadArgs) => {
      if (!hasOfficialCredentials()) return notConfigured();
      const data = await officialUpload("/overseas/openapi/pcb/uploadBlindViaHoleImg", {
        filePath: args.file_path,
        fileName: args.file_name,
      });
      return { configured: true, data };
    },
  },
  {
    name: "jlcpcb_pcb_impedance_template_list",
    description:
      "Official PCB API: list impedance template settings for given stackup parameters " +
      "(stencilLayer, cuprumThickness, plateType, etc.). Requires API credentials.",
    inputSchema: paramsSchema(false, "Optional filter params, e.g. { stencilLayer, cuprumThickness, plateType }"),
    handler: async (args: ParamsArgs) => {
      if (!hasOfficialCredentials()) return notConfigured();
      const data = await officialRequest(
        "/overseas/openapi/pcb/getImpedanceTemplateSettingList",
        { method: "POST", body: args.params ?? {} }
      );
      return { configured: true, data };
    },
  },
  {
    name: "jlcpcb_pcb_stencil_price_config",
    description:
      "Official PCB API: get the SMT stencil (steel) price configuration. Requires API credentials.",
    inputSchema: z.object({}),
    handler: async () => {
      if (!hasOfficialCredentials()) return notConfigured();
      const data = await officialRequest("/overseas/openapi/pcb/getSteelPriceConfig", {
        method: "GET",
      });
      return { configured: true, data };
    },
  },
  {
    name: "jlcpcb_pcb_calculate_price",
    description:
      "Official PCB API: calculate price and lead time for a PCB / SMT-stencil order (a quote, " +
      "no order is placed). Pass a `params` object with keys such as orderType, fileKey, pcbParam " +
      "(layers, dimensions, quantity, ...), smtStencilParam, country, postCode, city, shippingMethod. " +
      "Requires API credentials.",
    inputSchema: paramsSchema(true, "Calculate-price body: { orderType, fileKey, pcbParam, smtStencilParam, country, postCode, city, shippingMethod, achieveDate }"),
    handler: async (args: RequiredParamsArgs) => {
      if (!hasOfficialCredentials()) return notConfigured();
      const data = await officialRequest("/overseas/openapi/pcb/calculate", {
        method: "POST",
        body: args.params,
      });
      return { configured: true, data };
    },
  },
  {
    name: "jlcpcb_pcb_get_order_detail",
    description:
      "Official PCB API: get order details by batch number. Requires API credentials.",
    inputSchema: z.object({
      batch_num: z.string().describe("Order batch number"),
    }),
    handler: async (args: { batch_num: string }) => {
      if (!hasOfficialCredentials()) return notConfigured();
      const data = await officialRequest("/overseas/openapi/pcb/order/detail", {
        method: "POST",
        body: { batchNum: args.batch_num },
      });
      return { configured: true, data };
    },
  },
  {
    name: "jlcpcb_pcb_get_audit_info",
    description:
      "Official PCB API: get engineering audit (review) info for an uploaded design by key. " +
      "Requires API credentials.",
    inputSchema: z.object({
      key: z.string().describe("Audit key (e.g. the fileKey/order key)"),
      language: z.number().int().optional().describe("Language code, if supported"),
    }),
    handler: async (args: { key: string; language?: number }) => {
      if (!hasOfficialCredentials()) return notConfigured();
      const body: Record<string, unknown> = { key: args.key };
      if (args.language !== undefined) body.language = args.language;
      const data = await officialRequest("/overseas/openapi/pcb/audit/get", {
        method: "POST",
        body,
      });
      return { configured: true, data };
    },
  },
  {
    name: "jlcpcb_pcb_get_wip_process",
    description:
      "Official PCB API: get the work-in-progress production status for an order. Requires API credentials.",
    inputSchema: z.object({
      order_uuid: z.string().describe("Order UUID"),
    }),
    handler: async (args: { order_uuid: string }) => {
      if (!hasOfficialCredentials()) return notConfigured();
      const data = await officialRequest("/overseas/openapi/pcb/wip/get", {
        method: "POST",
        body: { orderUUID: args.order_uuid },
      });
      return { configured: true, data };
    },
  },
  {
    name: "jlcpcb_pcb_create_order",
    description:
      "Official PCB API: CREATE A REAL, PAID PCB / SMT-stencil order. Disabled unless " +
      "JLCPCB_ENABLE_ORDERS=true. Pass a `params` object (typically built from a prior " +
      "jlcpcb_pcb_calculate_price quote) with keys such as fileKey, batchNum, orderType, " +
      "pcbParam, shippingAddress, billingAddress, shippingMethod. Requires API credentials.",
    inputSchema: paramsSchema(true, "Create-order body: { fileKey, batchNum, orderType, pcbParam, smtStencilParam, shippingAddress, billingAddress, shippingMethod, achieveDate }"),
    handler: async (args: RequiredParamsArgs) => {
      if (!hasOfficialCredentials()) return notConfigured();
      if (!ordersEnabled()) return ordersDisabled();
      const data = await officialRequest("/overseas/openapi/pcb/create", {
        method: "POST",
        body: args.params,
      });
      return { configured: true, ordered: true, data };
    },
  },
];
