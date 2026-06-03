import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../official-client.js", () => ({
  officialRequest: vi.fn(),
  officialUpload: vi.fn(),
  hasOfficialCredentials: vi.fn(),
  ordersEnabled: vi.fn(),
  CREDENTIALS_MESSAGE: "creds missing",
}));

import {
  officialRequest,
  officialUpload,
  hasOfficialCredentials,
  ordersEnabled,
} from "../../official-client.js";
import { pcbTools } from "../../tools/pcb.js";

const mockReq = vi.mocked(officialRequest);
const mockUpload = vi.mocked(officialUpload);
const mockHas = vi.mocked(hasOfficialCredentials);
const mockOrders = vi.mocked(ordersEnabled);

const tool = (name: string) => pcbTools.find((t) => t.name === name)!;

describe("pcbTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReq.mockResolvedValue({ ok: true });
    mockUpload.mockResolvedValue({ fileKey: "FK1" });
    mockHas.mockReturnValue(true);
    mockOrders.mockReturnValue(false);
  });

  it("exports nine tools under jlcpcb_pcb_", () => {
    expect(pcbTools).toHaveLength(9);
    expect(new Set(pcbTools.map((t) => t.name)).size).toBe(9);
    expect(pcbTools.every((t) => t.name.startsWith("jlcpcb_pcb_"))).toBe(true);
  });

  it("returns not-configured (and calls nothing) when credentials are missing", async () => {
    mockHas.mockReturnValue(false);
    const args = { file_path: "x", batch_num: "b", order_uuid: "u", key: "k", params: {} };
    for (const t of pcbTools) {
      const result: any = await t.handler(args);
      expect(result.configured).toBe(false);
    }
    expect(mockReq).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("upload_gerber uploads the file", async () => {
    await tool("jlcpcb_pcb_upload_gerber").handler({ file_path: "/tmp/g.zip", file_name: "g.zip" });
    expect(mockUpload).toHaveBeenCalledWith("/overseas/openapi/pcb/uploadGerber", {
      filePath: "/tmp/g.zip",
      fileName: "g.zip",
    });
  });

  it("calculate_price posts the params body", async () => {
    await tool("jlcpcb_pcb_calculate_price").handler({ params: { orderType: 1, fileKey: "FK1" } });
    expect(mockReq).toHaveBeenCalledWith("/overseas/openapi/pcb/calculate", {
      method: "POST",
      body: { orderType: 1, fileKey: "FK1" },
    });
  });

  it("get_order_detail maps batch_num -> batchNum", async () => {
    await tool("jlcpcb_pcb_get_order_detail").handler({ batch_num: "B123" });
    expect(mockReq).toHaveBeenCalledWith("/overseas/openapi/pcb/order/detail", {
      method: "POST",
      body: { batchNum: "B123" },
    });
  });

  it("wip uses orderUUID and stencil config is a GET", async () => {
    await tool("jlcpcb_pcb_get_wip_process").handler({ order_uuid: "U1" });
    expect(mockReq).toHaveBeenCalledWith("/overseas/openapi/pcb/wip/get", {
      method: "POST",
      body: { orderUUID: "U1" },
    });

    await tool("jlcpcb_pcb_stencil_price_config").handler({});
    expect(mockReq).toHaveBeenCalledWith("/overseas/openapi/pcb/getSteelPriceConfig", {
      method: "GET",
    });
  });

  describe("create_order gating", () => {
    it("is blocked unless JLCPCB_ENABLE_ORDERS is enabled", async () => {
      mockOrders.mockReturnValue(false);
      const result: any = await tool("jlcpcb_pcb_create_order").handler({ params: { fileKey: "FK1" } });
      expect(result.enabled).toBe(false);
      expect(mockReq).not.toHaveBeenCalled();
    });

    it("places the order when enabled", async () => {
      mockOrders.mockReturnValue(true);
      const result: any = await tool("jlcpcb_pcb_create_order").handler({ params: { fileKey: "FK1" } });
      expect(mockReq).toHaveBeenCalledWith("/overseas/openapi/pcb/create", {
        method: "POST",
        body: { fileKey: "FK1" },
      });
      expect(result.ordered).toBe(true);
    });
  });
});
