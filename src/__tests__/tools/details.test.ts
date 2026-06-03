import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../database.js", () => ({
  dbManager: {
    getComponent: vi.fn(),
  },
}));
vi.mock("../../live-client.js", () => ({
  fetchComponentDetail: vi.fn(),
  // Real normalization behaviour (no network) so handlers canonicalize input.
  normalizeLcsc: (s: string) => {
    const u = s.trim().toUpperCase();
    return u.startsWith("C") ? u : `C${u}`;
  },
}));

import { dbManager } from "../../database.js";
import { fetchComponentDetail } from "../../live-client.js";
import { detailTools } from "../../tools/details.js";

const mockGet = vi.mocked(dbManager.getComponent);
const mockFetch = vi.mocked(fetchComponentDetail);

const detailsTool = detailTools.find((t) => t.name === "jlcpcb_get_component_details")!;
const stockTool = detailTools.find((t) => t.name === "jlcpcb_get_component_stock")!;
const pricingTool = detailTools.find((t) => t.name === "jlcpcb_get_component_pricing")!;
const datasheetTool = detailTools.find((t) => t.name === "jlcpcb_get_datasheet_url")!;

function catalogRow(overrides: Partial<any> = {}) {
  return {
    lcsc: "C17976",
    mfr_part: "STM32",
    category: "ICs",
    subcategory: "MCU",
    description: "ARM MCU",
    stock: 100,
    datasheet: "http://catalog/ds.pdf",
    image: null,
    basic: 0,
    manufacturer: "ST",
    package: "LQFP-48",
    attributes: null,
    ...overrides,
  };
}

describe("detailTools", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockFetch.mockReset();
  });

  it("exports four tools with unique names", () => {
    expect(detailTools).toHaveLength(4);
    expect(new Set(detailTools.map((t) => t.name)).size).toBe(4);
  });

  describe("get_component_details", () => {
    it("merges catalog metadata with live stock, pricing, specs, datasheet, images", async () => {
      mockGet.mockResolvedValue(catalogRow());
      mockFetch.mockResolvedValue({
        stockNumber: 9999,
        productPriceList: [{ ladder: 1, usdPrice: 1.23 }],
        paramVOList: [{ paramNameEn: "Core", paramValueEn: "Cortex-M4" }],
        pdfUrl: "https://live/ds.pdf",
        productImages: ["https://img/1.png"],
      });

      const result: any = await detailsTool.handler({ lcsc: "17976" });

      expect(result.found).toBe(true);
      expect(result.lcsc).toBe("C17976");
      expect(result.current_stock).toBe(9999);
      expect(result.pricing).toEqual([{ qty: 1, price: 1.23 }]);
      expect(result.specifications).toEqual([{ name: "Core", value: "Cortex-M4" }]);
      expect(result.datasheet).toBe("https://live/ds.pdf");
      expect(result.images).toEqual(["https://img/1.png"]);
      expect(result.live_data_available).toBe(true);
    });

    it("reports not found when neither catalog nor live has the part", async () => {
      mockGet.mockResolvedValue(null);
      mockFetch.mockResolvedValue(null);
      const result: any = await detailsTool.handler({ lcsc: "C0" });
      expect(result.found).toBe(false);
    });
  });

  describe("get_component_stock", () => {
    it("prefers live stock", async () => {
      mockFetch.mockResolvedValue({ stockNumber: 555 });
      const result: any = await stockTool.handler({ lcsc: "C1" });
      expect(result).toMatchObject({ stock: 555, source: "live" });
      expect(mockGet).not.toHaveBeenCalled();
    });

    it("falls back to catalog stock when live is unavailable", async () => {
      mockFetch.mockResolvedValue(null);
      mockGet.mockResolvedValue(catalogRow({ stock: 77 }));
      const result: any = await stockTool.handler({ lcsc: "C1" });
      expect(result).toMatchObject({ stock: 77, source: "catalog" });
    });
  });

  describe("get_component_pricing", () => {
    it("maps live price tiers", async () => {
      mockFetch.mockResolvedValue({
        productPriceList: [
          { ladder: 1, usdPrice: 0.1 },
          { ladder: 100, usdPrice: 0.05 },
        ],
      });
      const result: any = await pricingTool.handler({ lcsc: "C1" });
      expect(result.available).toBe(true);
      expect(result.tiers).toEqual([
        { qty: 1, price: 0.1 },
        { qty: 100, price: 0.05 },
      ]);
    });

    it("reports unavailable pricing", async () => {
      mockFetch.mockResolvedValue(null);
      const result: any = await pricingTool.handler({ lcsc: "C1" });
      expect(result.available).toBe(false);
      expect(result.tiers).toEqual([]);
    });
  });

  describe("get_datasheet_url", () => {
    it("prefers the live datasheet URL", async () => {
      mockFetch.mockResolvedValue({ pdfUrl: "https://live/ds.pdf" });
      const result: any = await datasheetTool.handler({ lcsc: "C1" });
      expect(result).toMatchObject({ datasheet_url: "https://live/ds.pdf", source: "live" });
    });

    it("falls back to the catalog datasheet", async () => {
      mockFetch.mockResolvedValue(null);
      mockGet.mockResolvedValue(catalogRow({ datasheet: "http://catalog/ds.pdf" }));
      const result: any = await datasheetTool.handler({ lcsc: "C1" });
      expect(result).toMatchObject({
        datasheet_url: "http://catalog/ds.pdf",
        source: "catalog",
      });
    });
  });
});
