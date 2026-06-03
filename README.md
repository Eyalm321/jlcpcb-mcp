# jlcpcb-mcp

[![CI](https://github.com/Eyalm321/jlcpcb-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Eyalm321/jlcpcb-mcp/actions/workflows/ci.yml)

An [MCP](https://modelcontextprotocol.io) server for **JLCPCB / LCSC** components. Search
the parts catalog and pull **live** stock, pricing tiers, datasheets, specifications, and
images — straight into Claude, Cursor, or any MCP client.

It uses a **hybrid** data model:

| Data | Source | Freshness |
|---|---|---|
| Component catalog (descriptions, packages, attributes, categories) | Local SQLite, built from [yaqwsx/jlcparts](https://github.com/yaqwsx/jlcparts) | Snapshot from your last refresh |
| Stock levels | Live JLCPCB API (`wmsc.lcsc.com`) | Real-time, per query |
| Pricing tiers | Live JLCPCB API | Real-time, per query |
| Datasheet URL | Live JLCPCB API | Real-time, per query |

The catalog is downloaded and built into a local SQLite database on first use (a one-time
download of ~50 MB that expands to a larger on-disk database). Stock, pricing, and
datasheet links are always fetched live, so they're current regardless of catalog age.
No API key or account is required.

## Tools

| Tool | Description |
|---|---|
| `jlcpcb_search_components` | Search the catalog by keyword + filters (category, package, basic-only, min stock) and parametric values (resistance, capacitance, voltage rating, power, output voltage/current, input voltage). Results are enriched with live stock/pricing and ranked Basic-first, then by stock, then by price. |
| `jlcpcb_get_component_details` | Full details for one part: catalog metadata + live stock, full pricing tiers, specifications, datasheet, and images. |
| `jlcpcb_get_component_stock` | Live, real-time stock quantity for a part (falls back to the catalog snapshot). |
| `jlcpcb_get_component_pricing` | Live quantity-break pricing tiers (USD) for a part. |
| `jlcpcb_get_datasheet_url` | Datasheet PDF URL for a part (live, with catalog fallback). |
| `jlcpcb_list_categories` | List catalog categories/subcategories with component counts. |
| `jlcpcb_database_status` | Report the local catalog DB location, size, component count, and last build time. |
| `jlcpcb_refresh_database` | Rebuild the local catalog from the latest yaqwsx/jlcparts snapshot. |

## Installation

The server runs over stdio and is launched by your MCP client.

### Claude Desktop / generic MCP config

```json
{
  "mcpServers": {
    "jlcpcb": {
      "command": "npx",
      "args": ["-y", "jlcpcb-mcp"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add jlcpcb -- npx -y jlcpcb-mcp
```

### Install globally

```bash
npm install -g jlcpcb-mcp
jlcpcb-mcp   # runs the stdio server
```

> First run builds the local catalog database (one-time, a few minutes). Subsequent
> queries are instant. Use the `jlcpcb_refresh_database` tool to update the catalog later.

## Configuration

All configuration is optional — the live API needs no credentials.

| Env var | Purpose |
|---|---|
| `JLCPCB_DATABASE_PATH` | Override where the catalog SQLite file is stored. |
| `JLCPCB_DEV_MODE` | Store the database in `./data` within the project (for development). |

Default database locations:

- **Windows:** `%LOCALAPPDATA%\jlcpcb-mcp\components.sqlite`
- **macOS:** `~/Library/Application Support/jlcpcb-mcp/components.sqlite`
- **Linux:** `~/.local/share/jlcpcb-mcp/components.sqlite`

## Development

```bash
npm install
npm run build      # tsc -> dist/
npm test           # vitest (mocks network + DB; no large download)
npm run test:watch
npm run dev        # ts-node src/index.ts
```

The test suite mocks the live API and the catalog download, so it runs fast and offline.

## Architecture

```
src/
  index.ts          # registers all tools on the MCP server (stdio)
  tool.ts           # shared ToolDef type
  live-client.ts    # wmsc.lcsc.com live product API client
  database.ts       # DatabaseManager: build/verify/query the catalog (better-sqlite3)
  paths.ts          # platform data-dir resolution
  value-parser.ts   # resistance/capacitance/voltage/current/power parsers
  tools/
    search.ts       # jlcpcb_search_components
    details.ts      # get_component_details / _stock / _pricing / _datasheet
    catalog.ts      # jlcpcb_list_categories
    maintenance.ts  # jlcpcb_database_status / jlcpcb_refresh_database
```

## Releasing

CI runs the build + tests on every push and PR to `main` (Node 20 & 22). Publishing is
triggered by creating a **GitHub Release**, which publishes to **both** registries:

- **npm** as the unscoped package `jlcpcb-mcp`
- **GitHub Packages** as `@eyalm321/jlcpcb-mcp`

### One-time repo setup

1. Push this repo to `https://github.com/Eyalm321/jlcpcb-mcp`.
2. Add an `NPM_TOKEN` repository secret (an npm **automation** token). `GITHUB_TOKEN` is
   provided automatically for GitHub Packages.
3. To release: bump the version in `package.json`, commit, then create a GitHub Release
   (tag e.g. `v0.1.0`). The `publish` workflow builds, tests, and publishes to both
   registries.

## Credits

- Catalog data: [yaqwsx/jlcparts](https://github.com/yaqwsx/jlcparts)
- Architecture inspired by [peterb154/jlcpcb-search-mcp](https://github.com/peterb154/jlcpcb-search-mcp)
- Catalog facts originate from JLCPCB / LCSC and are subject to their terms.

## License

MIT © Eyalm321
