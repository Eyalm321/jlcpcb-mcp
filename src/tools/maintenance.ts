import { z } from "zod";
import type { ToolDef } from "../tool.js";
import { dbManager } from "../database.js";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export const maintenanceTools: ToolDef[] = [
  {
    name: "jlcpcb_database_status",
    description:
      "Report the status of the local component catalog database: whether it exists, its " +
      "file path, size, component count, and when it was last built/refreshed.",
    inputSchema: z.object({}),
    handler: async () => {
      const status = dbManager.status();
      return {
        ready: status.exists,
        path: status.path,
        size: status.sizeBytes !== null ? formatBytes(status.sizeBytes) : null,
        size_bytes: status.sizeBytes,
        component_count: status.componentCount,
        metadata: status.metadata,
        ...(status.exists
          ? {}
          : {
              note: "Database not found. It will be built automatically on first search, or run jlcpcb_refresh_database.",
            }),
      };
    },
  },
  {
    name: "jlcpcb_refresh_database",
    description:
      "Download and rebuild the local component catalog from the latest yaqwsx/jlcparts " +
      "snapshot. Downloads ~50MB and may take several minutes. Use occasionally to pick up " +
      "newly added components (live stock/pricing is always current regardless).",
    inputSchema: z.object({}),
    handler: async () => {
      await dbManager.updateDatabase();
      const status = dbManager.status();
      return {
        success: true,
        message: "Database refreshed from the latest yaqwsx/jlcparts snapshot.",
        path: status.path,
        size: status.sizeBytes !== null ? formatBytes(status.sizeBytes) : null,
        component_count: status.componentCount,
      };
    },
  },
];
