import type { ZodObject } from "zod";

/**
 * Shared shape for a registered MCP tool. Each tool module exports a
 * `ToolDef[]`; `index.ts` registers them uniformly. Typing the arrays as
 * `ToolDef[]` keeps per-handler argument types module-private (they don't leak
 * into emitted declaration files).
 */
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: ZodObject<any>;
  handler: (args: any) => Promise<unknown>;
}
