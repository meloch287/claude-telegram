import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { verifyInitData } from "../crypto.js";
import { getOrCreateUser, getUsageToday, listAchievements, listRateLimits } from "../db.js";
import { ACHIEVEMENTS, CAT_LEVELS, catForTokens, catProgress, nextCat } from "../cats.js";
import { MODELS } from "../bot/keyboards.js";

const PUBLIC_DIR = resolve(fileURLToPath(new URL("./public", import.meta.url)));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

/**
 * Мини-апп отдаёт статистику только тому, кто предъявил валидные initData.
 * Без проверки подписи любой мог бы запросить чужой профиль, подставив user_id.
 */
function authenticate(initData: string | null): number | null {
  if (!initData) return null;
  const params = verifyInitData(initData, config.botToken);
  if (!params) return null;
  try {
    const user = JSON.parse(params.user ?? "{}") as { id?: number };
    return typeof user.id === "number" ? user.id : null;
  } catch {
    return null;
  }
}

function profilePayload(userId: number) {
  const user = getOrCreateUser(userId);
  const cat = catForTokens(user.total_tokens);
  const next = nextCat(user.total_tokens);
  const unlocked = new Set(listAchievements(userId).map((row) => row.achievement));
  const today = getUsageToday(userId);

  return {
    model: {
      id: user.model ?? "",
      // Ярлык берём из того же списка, что показывает бот в /model, — чтобы
      // мини-апп и чат не разошлись в названиях.
      label: MODELS.find(([id]) => id === (user.model ?? ""))?.[1] ?? user.model ?? "По умолчанию",
    },
    totals: {
      tokens: user.total_tokens,
      costUsd: Number(user.total_cost_usd.toFixed(4)),
      messages: user.total_messages,
      sessions: user.total_sessions,
      toolsAllowed: user.tools_allowed,
      toolsDenied: user.tools_denied,
      streakDays: user.streak_days,
    },
    today: { tokens: today.tokens },
    /**
     * Расход бота отдельно от импортированной истории: деньги известны только
     * за то, что бот сделал сам, и рядом с токенами за всю жизнь выглядели бы
     * ошибкой. Кот по-прежнему считается по сумме — она в totals.
     */
    bot: {
      tokens: user.total_tokens - user.history_tokens,
      messages: user.total_messages - user.history_messages,
      costUsd: Number(user.total_cost_usd.toFixed(4)),
    },
    history: {
      tokens: user.history_tokens,
      messages: user.history_messages,
    },
    cat: {
      level: cat.level,
      id: cat.id,
      name: cat.name,
      title: cat.title,
      quote: cat.quote,
      // palette и id нужны фронту для отрисовки SVG — без них герой не рисуется.
      palette: cat.palette,
      accessory: cat.accessory,
      progress: catProgress(user.total_tokens),
      nextThreshold: next?.threshold ?? null,
      nextName: next?.name ?? null,
    },
    cats: CAT_LEVELS.map((c) => ({
      level: c.level,
      id: c.id,
      name: c.name,
      title: c.title,
      threshold: c.threshold,
      palette: c.palette,
      accessory: c.accessory,
      quote: c.quote,
      unlocked: user.total_tokens >= c.threshold,
    })),
    achievements: ACHIEVEMENTS.map((a) => ({ ...a, unlocked: unlocked.has(a.id) })),
    limits: listRateLimits(userId).map((row) => ({
      type: row.limit_type,
      status: row.status,
      utilization: row.utilization,
      resetsAt: row.resets_at === null ? null : toMillis(row.resets_at),
      seenAt: row.seen_at,
    })),
  };
}

/**
 * resetsAt приходит от SDK без указания единиц. Значения до 1e12 — это секунды
 * (2001 год в миллисекундах), выше — уже миллисекунды. Ошибка в тысячу раз
 * превратила бы «через два часа» в «через сто лет», поэтому определяем явно.
 */
function toMillis(value: number): number {
  return value < 1e12 ? value * 1000 : value;
}

async function serveStatic(pathname: string): Promise<{ body: Buffer; type: string } | null> {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  // normalize + префиксная проверка: без них `../../etc/passwd` уехал бы наружу.
  const target = resolve(PUBLIC_DIR, normalize(relative));
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + "/")) return null;
  try {
    const body = await readFile(target);
    return { body, type: MIME[extname(target)] ?? "application/octet-stream" };
  } catch {
    return null;
  }
}

export function startMiniAppServer(): void {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    /**
     * Проба для docker healthcheck. Без неё restart: unless-stopped спасает
     * только от упавшего процесса, но не от зависшего: контейнер числится
     * живым, пока жив pid, даже если бот давно ничего не обслуживает.
     */
    if (url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ ok: true, uptimeSec: Math.round(process.uptime()) }));
      return;
    }

    if (url.pathname === "/api/profile") {
      const initData = req.headers["x-telegram-init-data"];
      const userId = authenticate(typeof initData === "string" ? initData : null);
      if (userId === null) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid init data" }));
        return;
      }
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(profilePayload(userId)));
      return;
    }

    const asset = await serveStatic(url.pathname);
    if (!asset) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Не найдено");
      return;
    }
    res.writeHead(200, {
      "content-type": asset.type,
      "cache-control": "public, max-age=300",
      // Мини-апп встраивается только в Telegram; чужие фреймы не нужны.
      "content-security-policy":
        "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors https://web.telegram.org https://telegram.org",
      "x-content-type-options": "nosniff",
    });
    res.end(asset.body);
  });

  server.listen(config.miniappPort, () => {
    console.log(`🐱 Mini App слушает http://localhost:${config.miniappPort}`);
    if (!config.miniappUrl) {
      console.log("   MINIAPP_URL не задан — кнопка мини-аппа в боте скрыта.");
    }
  });
}

export { profilePayload };
