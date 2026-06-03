import { describe, it, expect } from "vitest";
import { searchTools } from "../tools/search.js";
import { detailTools } from "../tools/details.js";
import { catalogTools } from "../tools/catalog.js";
import { maintenanceTools } from "../tools/maintenance.js";

const allTools = [
  ...searchTools,
  ...detailTools,
  ...catalogTools,
  ...maintenanceTools,
];

describe("tool registry", () => {
  it("aggregates the full 8-tool set", () => {
    expect(allTools).toHaveLength(8);
  });

  it("has no duplicate tool names", () => {
    const names = allTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("namespaces every tool under jlcpcb_", () => {
    for (const tool of allTools) {
      expect(tool.name).toMatch(/^jlcpcb_/);
    }
  });

  it("gives every tool a description, zod object schema, and handler", () => {
    for (const tool of allTools) {
      expect(typeof tool.name).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema.shape).toBeDefined();
      expect(typeof tool.handler).toBe("function");
    }
  });

  it("exposes the expected tool names", () => {
    expect(allTools.map((t) => t.name).sort()).toEqual(
      [
        "jlcpcb_database_status",
        "jlcpcb_get_component_details",
        "jlcpcb_get_component_pricing",
        "jlcpcb_get_component_stock",
        "jlcpcb_get_datasheet_url",
        "jlcpcb_list_categories",
        "jlcpcb_refresh_database",
        "jlcpcb_search_components",
      ].sort()
    );
  });
});
