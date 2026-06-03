#!/usr/bin/env node
import dns from "node:dns";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { searchTools } from "./tools/search.js";
import { detailTools } from "./tools/details.js";
import { catalogTools } from "./tools/catalog.js";
import { maintenanceTools } from "./tools/maintenance.js";
import { officialTools } from "./tools/official.js";
import { pcbTools } from "./tools/pcb.js";
import { tdpTools } from "./tools/tdp.js";

// The official JLCPCB API uses IP allowlisting. On dual-stack hosts, Node's
// fetch otherwise tends to egress over IPv6 — typically a rotating privacy
// address that can't be reliably whitelisted. Prefer IPv4 so requests use a
// stable, allowlistable source address. (IPv6 still works as a fallback.)
dns.setDefaultResultOrder("ipv4first");

export const allTools = [
  ...searchTools,
  ...detailTools,
  ...catalogTools,
  ...maintenanceTools,
  ...officialTools,
  ...pcbTools,
  ...tdpTools,
];

export function createServer(): McpServer {
  const server = new McpServer({
    name: "jlcpcb-mcp",
    version: "0.3.3",
  });

  for (const tool of allTools) {
    server.tool(
      tool.name,
      tool.description,
      tool.inputSchema.shape as any,
      async (args: any) => {
        try {
          const result = await tool.handler(args as any);
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result, null, 2) },
            ],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text" as const, text: `Error: ${message}` }],
            isError: true,
          };
        }
      }
    );
  }

  return server;
}

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("JLCPCB MCP server running");
}

// Only start the server when executed directly (not when imported by tests).
if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
