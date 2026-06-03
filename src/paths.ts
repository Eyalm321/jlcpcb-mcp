import os from "node:os";
import path from "node:path";

/**
 * Resolve a per-user data directory for storing the catalog database,
 * following platform conventions. Implemented locally to avoid an ESM-only
 * dependency (env-paths) that would clash with this project's CommonJS output.
 *
 *  - Windows: %LOCALAPPDATA%\<name>
 *  - macOS:   ~/Library/Application Support/<name>
 *  - Linux:   $XDG_DATA_HOME/<name>  (falls back to ~/.local/share/<name>)
 */
export function getDataDir(name = "jlcpcb-mcp"): string {
  const home = os.homedir();

  if (process.platform === "win32") {
    const base =
      process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    return path.join(base, name);
  }

  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", name);
  }

  const base = process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
  return path.join(base, name);
}
