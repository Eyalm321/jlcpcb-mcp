# Changelog

## 0.4.1 (2026-11-16)

### Security
- `hono` 4.13.14 → 4.13.16 and `@hono/node-server` 1.19.17 → 2.1.6. Both come in through `@modelcontextprotocol/sdk`, whose declared range for `@hono/node-server` (`^1.19.9 || ^2.0.5`) includes 2.x, so the 1.19.17 override is removed. This clears the remaining moderate advisories in the SDK's HTTP transport (which this stdio server never loads anyway). `npm audit --omit=dev` now reports 0 vulnerabilities. Dev-only findings in the older vitest remain, fixed by the vitest 5 follow-up.

## 0.4.0 (2026-11-15)

### Breaking
- **Requires Node.js 22 or later** (`engines: >=22`, was `>=20`). Node 20 reached end of life in April 2026. CI tests Node 22 and 24 (#13).

### Security and dependencies
- `@modelcontextprotocol/sdk` 1.29.0 → 1.32.2, `zod` → 4.6.7.
- `npm audit --omit=dev`: 0 critical, 0 high (3 moderate, not reachable: they are in the SDK's HTTP transport, which this stdio server never loads). Dev-only findings in vitest 2.x remain, fixed by the vitest 5 follow-up.
- Every dependency version is at least 14 days old (#1).

### Maintenance
- Dependabot with a 14-day cooldown (#1).
- npm publishing uses trusted publishing (OIDC). Workflow actions are pinned to commit SHAs (#12).

## Earlier versions

See the [GitHub releases](https://github.com/Eyalm321/jlcpcb-mcp/releases).
