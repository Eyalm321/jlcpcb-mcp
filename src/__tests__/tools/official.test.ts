import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../official-client.js", () => ({
  officialRequest: vi.fn(),
  hasOfficialCredentials: vi.fn(),
}));

import { officialRequest, hasOfficialCredentials } from "../../official-client.js";
import { officialTools } from "../../tools/official.js";

const mockReq = vi.mocked(officialRequest);
const mockHas = vi.mocked(hasOfficialCredentials);

const detailTool = officialTools.find((t) => t.name === "jlcpcb_official_get_component_detail")!;
const libraryTool = officialTools.find((t) => t.name === "jlcpcb_official_component_library")!;
const privateTool = officialTools.find((t) => t.name === "jlcpcb_official_private_library")!;
const feedTool = officialTools.find((t) => t.name === "jlcpcb_official_component_feed")!;

describe("officialTools", () => {
  beforeEach(() => {
    mockReq.mockReset();
    mockHas.mockReset();
    mockReq.mockResolvedValue({ ok: true });
  });

  it("exports four tools with unique jlcpcb_official_ names", () => {
    expect(officialTools).toHaveLength(4);
    const names = officialTools.map((t) => t.name);
    expect(new Set(names).size).toBe(4);
    expect(names.every((n) => n.startsWith("jlcpcb_official_"))).toBe(true);
  });

  it("returns a not-configured message (and skips the API) when credentials are missing", async () => {
    mockHas.mockReturnValue(false);
    for (const tool of officialTools) {
      const result: any = await tool.handler({ codes: ["C1"], page: 1 });
      expect(result.configured).toBe(false);
      expect(result.message).toMatch(/credentials/i);
    }
    expect(mockReq).not.toHaveBeenCalled();
  });

  it("get_component_detail posts the LCSC codes", async () => {
    mockHas.mockReturnValue(true);
    await detailTool.handler({ codes: ["C17976", "C1337"] });
    expect(mockReq).toHaveBeenCalledWith(
      "/overseas/openapi/component/getComponentDetailByCode",
      { method: "POST", body: { componentCodes: ["C17976", "C1337"] } }
    );
  });

  it("component_library posts pagination params", async () => {
    mockHas.mockReturnValue(true);
    await libraryTool.handler({ page: 2, page_size: 50 });
    expect(mockReq).toHaveBeenCalledWith(
      "/overseas/openapi/component/getComponentLibraryList",
      { method: "POST", body: { currentPage: 2, pageSize: 50 } }
    );
  });

  it("private_library hits the private endpoint", async () => {
    mockHas.mockReturnValue(true);
    await privateTool.handler({ page: 1, page_size: 30 });
    expect(mockReq).toHaveBeenCalledWith(
      "/overseas/openapi/component/getPrivateComponentLibrary",
      { method: "POST", body: { currentPage: 1, pageSize: 30 } }
    );
  });

  it("component_feed passes lastKey only when provided", async () => {
    mockHas.mockReturnValue(true);

    await feedTool.handler({});
    expect(mockReq).toHaveBeenLastCalledWith(
      "/overseas/openapi/component/getComponentInfos",
      { method: "POST", body: {} }
    );

    await feedTool.handler({ last_key: "CURSOR123" });
    expect(mockReq).toHaveBeenLastCalledWith(
      "/overseas/openapi/component/getComponentInfos",
      { method: "POST", body: { lastKey: "CURSOR123" } }
    );
  });
});
