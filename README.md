# jlcpcb-mcp

[![CI](https://github.com/Eyalm321/jlcpcb-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Eyalm321/jlcpcb-mcp/actions/workflows/ci.yml)

An [MCP](https://modelcontextprotocol.io) server for **JLCPCB / LCSC** components. Search
the parts catalog and pull **live** stock, pricing tiers, datasheets, specifications, and
images — straight into Claude, Cursor, or any MCP client.

It uses a **hybrid** data model:

| Data | Source | Freshness |
|---|---|---|
| Component catalog (descriptions, packages, attributes, categories) | Local SQLite, built from [yaqwsx/jlcparts](https://github.com/yaqwsx/jlcparts) | Snapshot from your last refresh |
| **JLCPCB assembly stock** (the figure that matters for PCBA) | Catalog snapshot (or the official Parts API, when authorized) | Snapshot / real-time |
| LCSC **retail** stock | Live LCSC API (`wmsc.lcsc.com`) | Real-time, per query |
| Pricing tiers | Live LCSC API (`wmsc.lcsc.com`) | Real-time, per query |
| Datasheet URL | Live LCSC API (`wmsc.lcsc.com`) | Real-time, per query |

> **Two stock pools, don't confuse them.** `wmsc.lcsc.com` reports **LCSC retail** stock,
> which is a *different inventory* from **JLCPCB assembly** stock. A part can read `0` on LCSC
> retail while having millions available for JLC assembly (common for Basic parts). Tools expose
> both as `lcsc_retail_stock` and `jlc_assembly_stock`; **treat assembly stock as authoritative
> for board production.** The official Parts API (`getComponentDetailByCode`) gives real-time
> assembly stock once your API access is approved.

The catalog is downloaded and built into a local SQLite database on first use (a one-time
download of ~50 MB that expands to a larger on-disk database). Stock, pricing, and
datasheet links are always fetched live, so they're current regardless of catalog age.
No API key or account is required.

## Tools

### Catalog + live data (no credentials needed)

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

### Official JLCPCB Open API (requires credentials)

These call the authenticated [JLCPCB Open API](https://api.jlcpcb.com) (`open.jlcpcb.com`,
HMAC-SHA256 signed). They return a "not configured" message until you set the credentials
below. Apply for access at https://api.jlcpcb.com (approval is based on your order history).

| Tool | Description |
|---|---|
| `jlcpcb_official_get_component_detail` | Authoritative details (specs/stock/price/attributes) for one or more LCSC codes. |
| `jlcpcb_official_component_library` | Browse the full assembly component library, paginated. |
| `jlcpcb_official_private_library` | List **your account's** private/consigned component library. |
| `jlcpcb_official_component_feed` | Cursor-paginated bulk feed of the whole catalog (`lastKey`). |

### PCB / SMT-stencil ordering (requires credentials)

| Tool | Description |
|---|---|
| `jlcpcb_pcb_upload_gerber` | Upload a Gerber archive; returns a `fileKey`. |
| `jlcpcb_pcb_upload_blind_via_hole_img` | Upload a blind/buried-via stackup image. |
| `jlcpcb_pcb_impedance_template_list` | List impedance template settings for a stackup. |
| `jlcpcb_pcb_stencil_price_config` | Get the SMT stencil (steel) price configuration. |
| `jlcpcb_pcb_calculate_price` | Quote price + lead time for a PCB / stencil order (no order placed). |
| `jlcpcb_pcb_get_order_detail` | Order details by batch number. |
| `jlcpcb_pcb_get_audit_info` | Engineering audit (review) info for an uploaded design. |
| `jlcpcb_pcb_get_wip_process` | Work-in-progress production status for an order. |
| `jlcpcb_pcb_create_order` ⚠️ | **Place a real, paid PCB order.** Gated by `JLCPCB_ENABLE_ORDERS`. |

### 3D printing (TDP) (requires credentials)

| Tool | Description |
|---|---|
| `jlcpcb_tdp_upload_model` | Upload a 3D model (STL/STEP); returns a `fileAccessId`. |
| `jlcpcb_tdp_file_analysis_result` | Analysis result (dimensions/printability) for an uploaded model. |
| `jlcpcb_tdp_calculate_price` | Quote price for a 3D-printing job (no order placed). |
| `jlcpcb_tdp_order_list` | List your 3D-printing orders (paginated/filterable). |
| `jlcpcb_tdp_order_detail` | 3D-printing order details by batch number. |
| `jlcpcb_tdp_order_process` | Production progress for a 3D-printing order. |
| `jlcpcb_tdp_create_order` ⚠️ | **Place a real, paid 3D-printing order.** Gated by `JLCPCB_ENABLE_ORDERS`. |

> **Order safety:** the two `*_create_order` tools place real, paid orders and are **disabled by
> default**. They only work when `JLCPCB_ENABLE_ORDERS=true` *and* credentials are set. Uploads
> and price quotes are free and need only credentials.

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
| `JLCPCB_APP_ID` / `JLCPCB_ACCESS_KEY` / `JLCPCB_SECRET_KEY` | Official Open API credentials — enable the `jlcpcb_official_*` tools. |
| `JLCPCB_ENDPOINT` | Override the official API base (default `https://open.jlcpcb.com`). |
| `JLCPCB_ENABLE_ORDERS` | Set to `true`/`1` to allow the `*_create_order` tools to place real paid orders (off by default). |

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
  official-client.ts# open.jlcpcb.com authenticated API (HMAC-SHA256 signing)
  database.ts       # DatabaseManager: build/verify/query the catalog (better-sqlite3)
  paths.ts          # platform data-dir resolution
  value-parser.ts   # resistance/capacitance/voltage/current/power parsers
  tools/
    search.ts       # jlcpcb_search_components
    details.ts      # get_component_details / _stock / _pricing / _datasheet
    catalog.ts      # jlcpcb_list_categories
    maintenance.ts  # jlcpcb_database_status / jlcpcb_refresh_database
    official.ts     # jlcpcb_official_* (authenticated Parts API)
    pcb.ts          # jlcpcb_pcb_* (PCB/SMT-stencil quote, upload, order)
    tdp.ts          # jlcpcb_tdp_* (3D-printing quote, upload, order)
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
