import { readFileSync } from "node:fs";

/** The tunnel can rotate its hostname while both bot processes keep running. */
export function currentMiniappUrl(fallback: string, file: string): string {
  if (!file) return fallback;
  try {
    const url = new URL(readFileSync(file, "utf8").trim());
    if (url.protocol !== "https:" || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash) return fallback;
    return url.origin;
  } catch {
    return fallback;
  }
}
