import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { verifyInitData } from "../crypto.js";
import {
  getOrCreateUser,
  getUsageToday,
  listAchievements,
  listRateLimits,
  coopMembers,
  payerFor,
  usageByDay,
  usageSince,
} from "../db.js";
import { ACHIEVEMENTS, CAT_LEVELS, catForTokens, catProgress, nextCat } from "../cats.js";
import { MODELS } from "../bot/keyboards.js";
import { limitTitle, percentOf, toMillis, WINDOWS } from "../limits.js";
import { subscriptionUsage } from "../subscription-usage.js";

const PUBLIC_DIR = resolve(fileURLToPath(new URL("./public", import.meta.url)));

/**
 * Имя бота для ссылки «поделиться». Узнаётся один раз на старте: в мини-аппе
 * его взять неоткуда, а без него ссылка ведёт в пустоту.
 */
let botUsername = "";

export function setBotUsername(name: string): void {
  botUsername = name;
}

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

/**
 * Окна подписки, которые показываем всегда: пятичасовое и недельное.
 *
 * Держим список фиксированным, а не строим по тому, что успело прийти в базу:
 * недельное окно присылает событие только на подходе к пределу, и до тех пор
 * шкала просто отсутствовала — выглядело как поломка.
 */
/** Потолок окна из настроек. Ноль — не задан, процент не считаем. */
function ceilingFor(type: string): number {
  if (type === "five_hour") return config.limitFiveHourTokens;
  if (type === "seven_day") return config.limitSevenDayTokens;
  return 0;
}

function buildLimits(userId: number) {
  const known = new Map(listRateLimits(userId).map((row) => [row.limit_type, row]));

  const describe = (type: string, ms: number | null) => {
    const row = known.get(type);
    known.delete(type);
    return {
      type,
      // Название отдаём отсюда, а не держим второй словарь во фронте: разойтись
      // им проще, чем кажется.
      title: limitTitle(type),
      status: row?.status ?? null,
      utilization: row?.utilization ?? null,
      resetsAt: row?.resets_at == null ? null : toMillis(row.resets_at),
      seenAt: row?.seen_at ?? null,
      /**
       * Собственный замер за то же окно. Процент подписки приходит не всегда:
       * событие его не несёт, а usage-эндпоинт плана отвечает отказом, если у
       * токена нет области профиля. Тогда шкала показывает хотя бы наш счёт.
       *
       * Считаем по транскриптам, а не по своей таблице: подписка тратится на
       * всё, что запускает Claude Code в этом контейнере, включая субагентов,
       * и считает ещё и кэш. Своя таблица знает только то, что прошло через
       * бота, и только input/output — рядом с подпиской это другая величина.
       * Обе и показываем: сколько ушло всего и сколько из этого через бота.
       */
      own:
        ms === null
          ? null
          : {
              subscription: subscriptionUsage(ms),
              bot: usageSince(userId, ms),
            },
      /**
       * Потолок окна и доля от него. Именно это показывается как «X из 100%»,
       * когда Anthropic своего процента не даёт. Знаменатель задаёт владелец —
       * иначе процент был бы выдуман молча.
       */
      ceiling: ms === null ? 0 : ceilingFor(type),
      ownPercent: ms === null ? null : percentOf(subscriptionUsage(ms).tokens, ceilingFor(type)),
    };
  };

  const rows = WINDOWS.map((w) => describe(w.type, w.ms));
  // Всё прочее, что успело прийти (по моделям, перерасход), — следом.
  for (const type of known.keys()) rows.push(describe(type, null));
  return rows;
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
    // Две недели — столько столбиков читается на телефоне без сжатия в кашу.
    // Ряд приходит сплошным, с нулями за дни простоя.
    usageByDay: usageByDay(userId, 14),
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
    botUsername,
    limits: buildLimits(userId),
    /**
     * Кооп: кто работает на одной подписке. Показываем только своих —
     * плательщика и позванных им. Чужие подписки друг друга не видят.
     *
     * Кот у каждого свой: он считается от собственного расхода, а не от общего.
     * Поэтому таблица честная — видно, кто сколько потратил, а не кто чей гость.
     */
    coop: coopMembers(userId).map((member) => {
      const cat = catForTokens(member.total_tokens);
      return {
        id: member.user_id,
        name: member.display_name,
        isYou: member.user_id === userId,
        isPayer: member.user_id === payerFor(userId),
        tokens: member.total_tokens,
        // Через бота — без импортированной истории: сравнивать людей по чужому
        // импорту бессмысленно, у кого-то его просто нет.
        tokensInBot: member.total_tokens - member.history_tokens,
        messages: member.total_messages - member.history_messages,
        cat: {
          level: cat.level,
          id: cat.id,
          name: cat.name,
          palette: cat.palette,
          accessory: cat.accessory,
        },
      };
    }),
  };
}

async function serveStatic(
  pathname: string,
): Promise<{ body: Buffer; type: string; etag: string } | null> {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  // normalize + префиксная проверка: без них `../../etc/passwd` уехал бы наружу.
  const target = resolve(PUBLIC_DIR, normalize(relative));
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + "/")) return null;
  try {
    const body = await readFile(target);
    // Метка по содержимому, а не по времени файла: пересборка образа меняет
    // время у всего сразу, и браузер зря перекачивал бы неизменившееся.
    const etag = `"${createHash("sha1").update(body).digest("base64url").slice(0, 16)}"`;
    return { body, type: MIME[extname(target)] ?? "application/octet-stream", etag };
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
    // Совпала метка — значит файл тот же, отдаём 304 без тела.
    if (req.headers["if-none-match"] === asset.etag) {
      res.writeHead(304, { etag: asset.etag, "cache-control": "no-cache" });
      res.end();
      return;
    }

    res.writeHead(200, {
      "content-type": asset.type,
      // no-cache — это не «не кешируй», а «спроси перед использованием».
      // Прежние пять минут в WebView Telegram превращались в часы: правка
      // доезжала до сервера, а пользователь видел старую картинку и считал,
      // что ничего не изменилось. Перепроверка стоит один 304 на файл.
      "cache-control": "no-cache",
      etag: asset.etag,
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
