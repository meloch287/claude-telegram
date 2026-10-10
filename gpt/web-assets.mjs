import { readFileSync, existsSync, createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve, extname } from "node:path";

const root = resolve(process.env.BB_RU_DIST || "/opt/ai-bot/bb-ru-dist");
const types = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".mp3": "audio/mpeg", ".wasm": "application/wasm" };
let index;
export function russianIndex(path = "/") {
  path = new URL(path, "http://localhost").pathname;
  if (!/^\/(?:$|(?:settings|projects|threads|plugins|skills|extensions|tools|automations|archived|auth)(?:\/|$|\?))/.test(path)) return null;
  if (index === undefined) index = existsSync(root + "/index.html") ? readFileSync(root + "/index.html") : null;
  return index;
}
export async function serveRussianAsset(path, req, res) {
  if (!["GET", "HEAD"].includes(req.method)) return false;
  const pathname = new URL(path, "http://localhost").pathname;
  if (!/^\/(assets\/|[a-zA-Z0-9_-]+\.(?:png|ico|svg|webmanifest|js)$)/.test(pathname)) return false;
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return false; }
  const file = resolve(root, "." + decoded);
  if (!file.startsWith(root + "/")) return false;
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return false;
  let served = file, encoding;
  const accepts = String(req.headers["accept-encoding"] || "").split(",").map(v => v.trim()).filter(v => !/;\s*q=0(?:\.0*)?$/.test(v));
  for (const [name, suffix] of [["br", ".br"], ["gzip", ".gz"]]) {
    if (accepts.some(v => v.split(";")[0] === name) && (await stat(file + suffix).catch(() => null))?.isFile()) { served = file + suffix; encoding = name; break; }
  }
  const servedInfo = served === file ? info : await stat(served);
  res.writeHead(200, { ...(encoding ? { "content-encoding": encoding } : {}), "vary": "Accept-Encoding", "content-type": types[extname(file)] || "application/octet-stream", "content-length": servedInfo.size, "service-worker-allowed": "/", "cache-control": pathname === "/bb-sw.js" ? "no-store" : pathname.endsWith(".webmanifest") ? "public, max-age=60" : publicAppAsset(pathname) ? "public, max-age=86400" : pathname.startsWith("/assets/") ? "private, max-age=31536000, immutable" : "private, max-age=3600" });
  if (req.method === "HEAD") res.end();
  else createReadStream(served).on("error", () => res.destroy()).pipe(res);
  return true;
}

export function publicAppAsset(path){return /^\/(?:manifest(?:-(?:red|orange|yellow|green|teal|blue|purple|pink))?\.webmanifest|(?:icon-[a-z0-9-]+|favicon-[a-z0-9-]+|apple-touch-icon(?:-[a-z]+)?)\.png)$/.test(path)}
