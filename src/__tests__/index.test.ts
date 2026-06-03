import { describe, it, expect } from "vitest";
import { searchTools } from "../tools/search.js";
import { detailTools } from "../tools/details.js";
import { catalogTools } from "../tools/catalog.js";
import { maintenanceTools } from "../tools/maintenance.js";
import { officialTools } from "../tools/official.js";
import { pcbTools } from "../tools/pcb.js";
import { tdpTools } from "../tools/tdp.js";

const allTools = [
  ...searchTools,
  ...detailTools,
  ...catalogTools,
  ...maintenanceTools,
  ...officialTools,
  ...pcbTools,
  ...tdpTools,
];

describe("tool registry", () => {
  it("aggregates the full 28-tool set", () => {
    expect(allTools).toHaveLength(28);
  });

  it("has the expected per-group counts", () => {
    expect(searchTools).toHaveLength(1);
    expect(detailTools).toHaveLength(4);
    expect(catalogTools).toHaveLength(1);
    expect(maintenanceTools).toHaveLength(2);
    expect(officialTools).toHaveLength(4);
    expect(pcbTools).toHaveLength(9);
    expect(tdpTools).toHaveLength(7);
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
});
