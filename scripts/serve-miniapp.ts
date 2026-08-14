/**
 * Статик-сервер только для мини-аппа — чтобы смотреть вёрстку в браузере
 * без запуска бота и без токенов Telegram. Открывать с ?demo=1.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// От файла скрипта, а не от cwd: сервер запускают и из корня проекта, и снаружи.
const PUBLIC_DIR = resolve(fileURLToPath(new URL("../src/miniapp/public", import.meta.url)));
const DOCS_DIR = resolve(fileURLToPath(new URL("../docs", import.meta.url)));
const PORT = Number(process.env.PORT ?? 8788);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  // /docs/ отдаёт картинки для README — чтобы смотреть их в браузере,
  // не заливая репозиторий ради проверки.
  const fromDocs = url.pathname.startsWith("/docs/");
  const root = fromDocs ? DOCS_DIR : PUBLIC_DIR;
  const relative = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+(docs\/)?/, "");
  const target = resolve(root, normalize(relative));
  if (target !== root && !target.startsWith(root + "/")) {
    res.writeHead(403).end("нельзя");
    return;
  }
  try {
    const body = await readFile(target);
    res.writeHead(200, {
      "content-type": MIME[extname(target)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("не найдено");
  }
}).listen(PORT, () => {
  console.log(`Мини-апп: http://localhost:${PORT}/?demo=1`);
});
