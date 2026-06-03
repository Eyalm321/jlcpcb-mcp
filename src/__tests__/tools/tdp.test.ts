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
import { tdpTools } from "../../tools/tdp.js";

const mockReq = vi.mocked(officialRequest);
const mockUpload = vi.mocked(officialUpload);
const mockHas = vi.mocked(hasOfficialCredentials);
const mockOrders = vi.mocked(ordersEnabled);

const tool = (name: string) => tdpTools.find((t) => t.name === name)!;

describe("tdpTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReq.mockResolvedValue({ ok: true });
    mockUpload.mockResolvedValue({ fileAccessId: "FA1" });
    mockHas.mockReturnValue(true);
    mockOrders.mockReturnValue(false);
  });

  it("exports seven tools under jlcpcb_tdp_", () => {
    expect(tdpTools).toHaveLength(7);
    expect(new Set(tdpTools.map((t) => t.name)).size).toBe(7);
    expect(tdpTools.every((t) => t.name.startsWith("jlcpcb_tdp_"))).toBe(true);
  });

  it("upload_model uploads the file", async () => {
    await tool("jlcpcb_tdp_upload_model").handler({ file_path: "/tmp/m.stl" });
    expect(mockUpload).toHaveBeenCalledWith("/overseas/openapi/tdp/api/upload", {
      filePath: "/tmp/m.stl",
      fileName: undefined,
    });
  });

  it("file_analysis_result maps file_access_id -> fileAccessId", async () => {
    await tool("jlcpcb_tdp_file_analysis_result").handler({ file_access_id: "FA1" });
    expect(mockReq).toHaveBeenCalledWith("/overseas/openapi/tdp/api/file/result", {
      method: "POST",
      body: { fileAccessId: "FA1" },
    });
  });

  it("order_list defaults to an empty body", async () => {
    await tool("jlcpcb_tdp_order_list").handler({});
    expect(mockReq).toHaveBeenCalledWith("/overseas/openapi/tdp/api/order/list", {
      method: "POST",
      body: {},
    });
  });

  it("order_process maps order_no -> orderNo", async () => {
    await tool("jlcpcb_tdp_order_process").handler({ order_no: "O1" });
    expect(mockReq).toHaveBeenCalledWith("/overseas/openapi/tdp/api/order/process", {
      method: "POST",
      body: { orderNo: "O1" },
    });
  });

  it("create_order is gated by JLCPCB_ENABLE_ORDERS", async () => {
    mockOrders.mockReturnValue(false);
    const blocked: any = await tool("jlcpcb_tdp_create_order").handler({ params: { itemCount: 1 } });
    expect(blocked.enabled).toBe(false);
    expect(mockReq).not.toHaveBeenCalled();

    mockOrders.mockReturnValue(true);
    const ok: any = await tool("jlcpcb_tdp_create_order").handler({ params: { itemCount: 1 } });
    expect(mockReq).toHaveBeenCalledWith("/overseas/openapi/tdp/api/order/create", {
      method: "POST",
      body: { itemCount: 1 },
    });
    expect(ok.ordered).toBe(true);
  });

  it("returns not-configured when credentials are missing", async () => {
    mockHas.mockReturnValue(false);
    const result: any = await tool("jlcpcb_tdp_calculate_price").handler({ params: {} });
    expect(result.configured).toBe(false);
    expect(mockReq).not.toHaveBeenCalled();
  });
});
