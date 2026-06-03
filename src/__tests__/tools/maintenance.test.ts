import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../database.js", () => ({
  dbManager: {
    status: vi.fn(),
    updateDatabase: vi.fn(),
  },
}));

import { dbManager } from "../../database.js";
import { maintenanceTools } from "../../tools/maintenance.js";

const mockStatus = vi.mocked(dbManager.status);
const mockUpdate = vi.mocked(dbManager.updateDatabase);

const statusTool = maintenanceTools.find((t) => t.name === "jlcpcb_database_status")!;
const refreshTool = maintenanceTools.find((t) => t.name === "jlcpcb_refresh_database")!;

describe("maintenanceTools", () => {
  beforeEach(() => {
    mockStatus.mockReset();
    mockUpdate.mockReset();
  });

  it("exports two tools with unique names", () => {
    expect(maintenanceTools).toHaveLength(2);
    const names = maintenanceTools.map((t) => t.name);
    expect(new Set(names).size).toBe(2);
  });

  it("database_status reports a ready DB with a human-readable size", async () => {
    mockStatus.mockReturnValue({
      exists: true,
      path: "/data/components.sqlite",
      sizeBytes: 1.5 * 1024 ** 3,
      componentCount: 123456,
      metadata: { Downloaded: "2026-06-01T00:00:00.000Z" },
    });

    const result: any = await statusTool.handler({});

    expect(result.ready).toBe(true);
    expect(result.size).toBe("1.50 GB");
    expect(result.component_count).toBe(123456);
    expect(result.metadata.Downloaded).toBe("2026-06-01T00:00:00.000Z");
  });

  it("database_status notes when the DB is absent", async () => {
    mockStatus.mockReturnValue({
      exists: false,
      path: "/data/components.sqlite",
      sizeBytes: null,
      componentCount: null,
      metadata: {},
    });

    const result: any = await statusTool.handler({});

    expect(result.ready).toBe(false);
    expect(result.note).toContain("not found");
  });

  it("refresh_database triggers an update then reports new status", async () => {
    mockUpdate.mockResolvedValue(undefined);
    mockStatus.mockReturnValue({
      exists: true,
      path: "/data/components.sqlite",
      sizeBytes: 1024 ** 2 * 10,
      componentCount: 999,
      metadata: {},
    });

    const result: any = await refreshTool.handler({});

    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    expect(result.component_count).toBe(999);
    expect(result.size).toBe("10.0 MB");
  });
});
