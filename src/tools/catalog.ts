import { z } from "zod";
import type { ToolDef } from "../tool.js";
import { dbManager } from "../database.js";

interface ListCategoriesArgs {
  category?: string;
}

export const catalogTools: ToolDef[] = [
  {
    name: "jlcpcb_list_categories",
    description:
      "List the component categories and subcategories available in the local catalog, " +
      "each with a component count. Optionally filter to a single top-level category. " +
      "Useful for discovering valid `category` filter values for searches.",
    inputSchema: z.object({
      category: z
        .string()
        .optional()
        .describe("Optionally restrict to one top-level category (case-insensitive contains match)"),
    }),
    handler: async (args: ListCategoriesArgs) => {
      const rows = await dbManager.listCategories();

      const filter = args.category?.toLowerCase();
      const grouped = new Map<
        string,
        { category: string; total: number; subcategories: { name: string; count: number }[] }
      >();

      let totalComponents = 0;
      for (const row of rows) {
        const category = row.category ?? "(uncategorized)";
        if (filter && !category.toLowerCase().includes(filter)) continue;

        totalComponents += row.count;
        let entry = grouped.get(category);
        if (!entry) {
          entry = { category, total: 0, subcategories: [] };
          grouped.set(category, entry);
        }
        entry.total += row.count;
        entry.subcategories.push({
          name: row.subcategory ?? "(none)",
          count: row.count,
        });
      }

      const categories = Array.from(grouped.values()).sort((a, b) =>
        a.category.localeCompare(b.category)
      );

      return {
        category_count: categories.length,
        total_components: totalComponents,
        categories,
      };
    },
  },
];
