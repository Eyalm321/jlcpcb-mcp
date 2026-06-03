import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../database.js", () => ({
  dbManager: {
    listCategories: vi.fn(),
  },
}));

import { dbManager } from "../../database.js";
import { catalogTools } from "../../tools/catalog.js";

const mockList = vi.mocked(dbManager.listCategories);
const tool = catalogTools[0];

describe("catalogTools", () => {
  beforeEach(() => {
    mockList.mockReset();
  });

  it("exports exactly one tool", () => {
    expect(catalogTools).toHaveLength(1);
    expect(tool.name).toBe("jlcpcb_list_categories");
  });

  it("groups subcategories under their category with counts", async () => {
    mockList.mockResolvedValue([
      { category: "Resistors", subcategory: "Chip Resistor", count: 100 },
      { category: "Resistors", subcategory: "Resistor Networks", count: 20 },
      { category: "Capacitors", subcategory: "MLCC", count: 50 },
    ]);

    const result: any = await tool.handler({});

    expect(result.category_count).toBe(2);
    expect(result.total_components).toBe(170);
    const resistors = result.categories.find((c: any) => c.category === "Resistors");
    expect(resistors.total).toBe(120);
    expect(resistors.subcategories).toHaveLength(2);
  });

  it("filters to a single category (case-insensitive contains)", async () => {
    mockList.mockResolvedValue([
      { category: "Resistors", subcategory: "Chip Resistor", count: 100 },
      { category: "Capacitors", subcategory: "MLCC", count: 50 },
    ]);

    const result: any = await tool.handler({ category: "capac" });

    expect(result.category_count).toBe(1);
    expect(result.categories[0].category).toBe("Capacitors");
    expect(result.total_components).toBe(50);
  });
});
