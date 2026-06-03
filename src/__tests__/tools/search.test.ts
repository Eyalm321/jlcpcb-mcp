import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../database.js", () => ({
  dbManager: {
    searchComponents: vi.fn(),
  },
}));
vi.mock("../../live-client.js", () => ({
  fetchComponentDetail: vi.fn(),
}));

import { dbManager } from "../../database.js";
import { fetchComponentDetail } from "../../live-client.js";
import { searchTools } from "../../tools/search.js";

const mockSearch = vi.mocked(dbManager.searchComponents);
const mockFetch = vi.mocked(fetchComponentDetail);
const tool = searchTools[0];

function row(overrides: Partial<any> = {}) {
  return {
    lcsc: "C100",
    mfr_part: "RES10K",
    category: "Resistors",
    subcategory: "Chip Resistor",
    description: "10k 0805",
    stock: 5000,
    datasheet: "http://ds",
    image: null,
    basic: 1,
    manufacturer: "UNI-ROYAL",
    package: "0805",
    attributes: JSON.stringify({
      Resistance: { values: { resistance: [10000, "10kΩ"] } },
    }),
    ...overrides,
  };
}

describe("searchTools", () => {
  beforeEach(() => {
    mockSearch.mockReset();
    mockFetch.mockReset();
  });

  it("exports exactly one tool", () => {
    expect(searchTools).toHaveLength(1);
    expect(tool.name).toBe("jlcpcb_search_components");
  });

  it("returns an empty result set when the catalog has no matches", async () => {
    mockSearch.mockResolvedValue([]);
    const result: any = await tool.handler({ query: "nonexistent" });
    expect(result.count).toBe(0);
    expect(result.results).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("enriches catalog hits with live stock and pricing", async () => {
    mockSearch.mockResolvedValue([row()]);
    mockFetch.mockResolvedValue({
      stockNumber: 123456,
      productPriceList: [
        { ladder: 1, usdPrice: 0.01 },
        { ladder: 100, usdPrice: 0.005 },
        { ladder: 1000, usdPrice: 0.002 },
        { ladder: 5000, usdPrice: 0.001 },
      ],
      pdfUrl: "https://live/ds.pdf",
    });

    const result: any = await tool.handler({ query: "10k resistor", max_results: 5 });

    expect(result.count).toBe(1);
    const r = result.results[0];
    expect(r.lcsc).toBe("C100");
    expect(r.basic).toBe(true);
    expect(r.current_stock).toBe(123456);
    expect(r.pricing).toHaveLength(3); // capped at first 3 tiers
    expect(r.datasheet).toBe("https://live/ds.pdf");
    expect(r.jlcpcb_url).toBe("https://jlcpcb.com/partdetail/C100");
    expect(r).not.toHaveProperty("_score");
  });

  it("parses parametric string inputs into numeric filters", async () => {
    mockSearch.mockResolvedValue([]);
    await tool.handler({
      query: "resistor",
      resistance: "10k",
      capacitance: "100nF",
      voltage_rating: "50V",
      max_results: 3,
    });

    expect(mockSearch).toHaveBeenCalledTimes(1);
    const filters = mockSearch.mock.calls[0][0];
    expect(filters.resistanceOhms).toBe(10000);
    expect(filters.capacitanceF).toBeCloseTo(1e-7, 12);
    expect(filters.voltageRatingV).toBe(50);
    expect(filters.limit).toBe(9); // max_results * 3
  });

  it("falls back to catalog values when live data is unavailable", async () => {
    mockSearch.mockResolvedValue([row({ lcsc: "C200", basic: 0 })]);
    mockFetch.mockResolvedValue(null);

    const result: any = await tool.handler({ query: "10k", max_results: 5 });
    const r = result.results[0];
    expect(r.current_stock).toBe(5000); // catalog stock
    expect(r.pricing).toEqual([]);
    expect(r.datasheet).toBe("http://ds");
    expect(r.basic).toBe(false);
  });
});
