// Предсжатие ассетов рабочей зоны bb: для всех JS/CSS, достижимых из index.html,
// создаёт .br (brotli 11) и .gz (gzip 9), если их нет. web-assets.mjs отдаёт их сам.
// node precompress.mjs <frontend-dir>
import { readFileSync, writeFileSync, existsSync, readdirSync, renameSync } from "node:fs";
import { brotliCompressSync, gzipSync, constants } from "node:zlib";
const root = process.argv[2], A = root + "/assets/";
const names = new Set(readdirSync(A));
const pattern = /[a-zA-Z0-9_.-]+\.(?:js|css)/g;
const refs = text => new Set([...text.matchAll(pattern)].map(m => m[0]).filter(n => names.has(n)));
let reach = refs(readFileSync(root + "/index.html", "utf8"));
for (;;) { const next = new Set(reach); for (const n of reach) if (n.endsWith(".js")) for (const r of refs(readFileSync(A + n, "utf8"))) next.add(r); if (next.size === reach.size) break; reach = next; }
let made = 0, raw = 0, br = 0, gz = 0;
for (const n of reach) {
  const body = readFileSync(A + n); raw += body.length;
  for (const [ext, fn] of [[".br", b => brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: b.length } })], [".gz", b => gzipSync(b, { level: 9 })]]) {
    const out = A + n + ext;
    if (!existsSync(out)) { const data = fn(body); writeFileSync(out + ".tmp", data, { mode: 0o644 }); renameSync(out + ".tmp", out); made++; }
    if (ext === ".br") br += readFileSync(out).length; else gz += readFileSync(out).length;
  }
}
console.log(`reachable ${reach.size} files, raw ${(raw / 1048576).toFixed(1)} MB → br ${(br / 1048576).toFixed(2)} MB, gz ${(gz / 1048576).toFixed(2)} MB; created ${made} compressed files`);
