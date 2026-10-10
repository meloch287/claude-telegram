import { isAdmin } from "../admin.js";
import { getModeData } from "../db.js";
import type { Mode } from "../mode-data.js";
import { checkAchievements } from "../achievements.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handleModesApi } from "./modes-api.js";
import { engineFor } from "../engine.js";
import { claudePreferences, claudeModels } from "../claude-settings.js";
import { config } from "../config.js";
import { verifyInitData } from "../crypto.js";
import {
  getOrCreateUser,
  isGptUserAllowed,
  getUsageToday,
  getUnverifiedTokens,
  listAchievements,
  listRateLimits,
  quotaLeft,
  usageByDay,
  usageSince,
  recordWorldScore,
  topWorlds,
  worldRank,
  listWorldSaves,
  putWorldSave,
  deleteWorldSave,
  WORLD_SAVE_MAX_BYTES,
  claimWorld,
  sendToWorld,
  WORLD_SEND_KINDS,
  type WorldSendKind,
} from "../db.js";
import { ACHIEVEMENTS, CAT_LEVELS, catForTokens, catProgress, nextCat, catForMode } from "../cats.js";
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
    return typeof user.id === "number" && isGptUserAllowed(user.id) ? user.id : null;
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
              subscription: subscriptionUsage(ms, userId),
              bot: getModeData("claude").since(userId, ms),
            },
      /**
       * Потолок окна и доля от него. Именно это показывается как «X из 100%»,
       * когда Anthropic своего процента не даёт. Знаменатель задаёт владелец —
       * иначе процент был бы выдуман молча.
       */
      ceiling: ms === null ? 0 : ceilingFor(type),
      ownPercent:
        ms === null ? null : percentOf(subscriptionUsage(ms, userId).tokens, ceilingFor(type)),
    };
  };

  const rows = WINDOWS.map((w) => describe(w.type, w.ms));
  // Всё прочее, что успело прийти (по моделям, перерасход), — следом.
  for (const type of known.keys()) rows.push(describe(type, null));
  return rows;
}

/** Число в 31 бит из id: мир одного человека всегда один и тот же. */
function worldSeed(userId: number, engine: Mode = "gpt"): number {
  const digest = createHash("sha1").update(engine === "gpt" ? `world:${userId}` : `world:claude:${userId}`).digest();
  return digest.readUInt32BE(0) & 0x7fffffff;
}

function profilePayload(userId: number, engine: Mode = "gpt") {
  const mode = getModeData(engine);
  const user = {...getOrCreateUser(userId),...mode.stats(userId)};
  checkAchievements(userId,{type:"usage"},engine);
  const cat = catForMode(catForTokens(user.total_tokens),engine);
  const nextRaw = nextCat(user.total_tokens);
  const next = nextRaw ? catForMode(nextRaw,engine) : null;
  const unlocked = new Set(mode.achievements(userId).map((row) => row.achievement));
  const today = mode.daily(userId,1)[0]!;

  return {
    engine,
    capabilities: { management: isAdmin(userId) },
    model: {
      id: engine === "claude" ? claudePreferences(userId).model : user.model ?? "",
      // Ярлык берём из того же списка, что показывает бот в /model, — чтобы
      // мини-апп и чат не разошлись в названиях.
      label: engine === "claude" ? (claudeModels(userId).find(m => m.value === claudePreferences(userId).model)?.displayName ?? "Claude Code") : user.model ?? "GPT",
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
    today: { tokens: today.tokens, unverifiedTokens: engine === "gpt" ? getUnverifiedTokens(userId) : 0 },
    // Две недели — столько столбиков читается на телефоне без сжатия в кашу.
    // Ряд приходит сплошным, с нулями за дни простоя.
    usageByDay: mode.daily(userId, 14),
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
    cats: CAT_LEVELS.map(c=>catForMode(c,engine)).map((c) => ({
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
    /**
     * Сид острова для вкладки «Мой город». Не сам user_id: он бы утёк в
     * localStorage и в адрес картинки, а перемешанный — просто число.
     */
    world: { seed: worldSeed(userId, engine) },
    // Своя квота: null — ограничения нет, и это умолчание.
    quota: quotaLeft(userId),
    limits: engine === "claude" ? buildLimits(userId) : [],
    /**
     * Кооп: кто работает на одной подписке. Показываем только своих —
     * плательщика и позванных им. Чужие подписки друг друга не видят.
     *
     * Кот у каждого свой: он считается от собственного расхода, а не от общего.
     * Поэтому таблица честная — видно, кто сколько потратил, а не кто чей гость.
     */
    coop: [user].map((member) => {
      const cat = catForMode(catForTokens(member.total_tokens),engine);
      return {
        id: member.user_id,
        name: member.display_name,
        isYou: member.user_id === userId,
        isPayer: true,
        tokens: member.total_tokens,
        // Через бота — без импортированной истории: сравнивать людей по чужому
        // импорту бессмысленно, у кого-то его просто нет.
        tokensInBot: member.total_tokens - member.history_tokens,
        // Квота соседа видна всем в компании: это не тайна, а общая договорённость
        // о том, кто сколько берёт.
        quota: quotaLeft(member.user_id),
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

/**
 * Тело запроса целиком, но не больше limit байт. Превысило — null: дочитывать
 * гигабайт от чужого клиента ради отказа незачем.
 */
async function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) return null;
    parts.push(chunk as Buffer);
  }
  return Buffer.concat(parts).toString("utf8");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

/**
 * Облачная копия мира: GET — все снимки человека, PUT — записать один,
 * DELETE — стереть («вырастить мир заново» должно стирать и копию, иначе
 * старый остров вернулся бы при следующем открытии).
 */
async function handleWorldSave(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  userId: number,
  engine: Mode,
): Promise<void> {
  if (req.method === "GET") {
    sendJson(res, 200, { items: getModeData(engine).listWorldSaves(userId) });
    return;
  }
  if (req.method === "DELETE") {
    getModeData(engine).deleteWorldSave(userId, url.searchParams.get("key") ?? "");
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method !== "PUT") {
    sendJson(res, 405, { error: "method" });
    return;
  }
  // Запас сверху на JSON-обёртку и экранирование кавычек внутри снимка.
  const raw = await readBody(req, WORLD_SAVE_MAX_BYTES * 2);
  if (!isGptUserAllowed(userId)) {
    sendJson(res, 401, { error: "access revoked" });
    return;
  }
  if (raw === null) {
    sendJson(res, 413, { error: "size" });
    return;
  }
  let body: { key?: unknown; data?: unknown };
  try {
    body = JSON.parse(raw) as { key?: unknown; data?: unknown };
  } catch {
    sendJson(res, 400, { error: "bad json" });
    return;
  }
  if (typeof body.key !== "string" || typeof body.data !== "string") {
    sendJson(res, 400, { error: "key and data must be strings" });
    return;
  }
  const result = getModeData(engine).putWorldSave(userId, body.key, body.data);
  if ("error" in result) {
    sendJson(res, result.error === "size" ? 413 : result.error === "limit" ? 409 : 400, result);
    return;
  }
  sendJson(res, 200, { ok: true, updatedAt: result.updatedAt });
}

/**
 * Остров в рейтинге узнаётся по непрозрачному id, а не по user_id: иначе из
 * мини-аппа утекали бы Telegram-id всех игроков.
 */
function islandId(userId: number, engine: Mode): string {
  return createHmac("sha256", config.botToken)
    .update(engine === "gpt" ? `island:${userId}` : `island:claude:${userId}`)
    .digest("base64url")
    .slice(0, 12);
}

function islandOwner(id: string, engine: Mode): { user_id: number; display_name: string | null } | null {
  return getModeData(engine).topWorlds(1000).find((r) => islandId(r.user_id, engine) === id) ?? null;
}

function islandName(userId: number, displayName: string | null, engine: Mode): string {
  return displayName || `Остров №${worldSeed(userId, engine) % 10000}`;
}

/** Снимок острова целиком из облачной копии: карта, на которой человек сейчас. */
function islandSnapshot(userId: number, engine: Mode): { seed: number; map: string; data: string } | null {
  const seed = worldSeed(userId, engine);
  const saves = getModeData(engine).listWorldSaves(userId);
  const map = saves.find((s) => s.key === `world:map:${seed}`)?.data || "island";
  // Версия формата — клиентская; берём самую свежую из тех, что есть.
  const pattern = new RegExp(`^world:v(\\d+):${seed}:${map}$`);
  const snapshot = saves
    .map((s) => ({ s, v: Number(pattern.exec(s.key)?.[1] ?? -1) }))
    .filter((x) => x.v >= 0)
    .sort((a, b) => b.v - a.v)[0];
  return snapshot ? { seed, map, data: snapshot.s.data } : null;
}

/**
 * Бот пишет хозяину, когда на его остров приплыли подарок или пираты:
 * повод открыть мир. Подключается из index.ts — здесь нет доступа к боту.
 */
let worldNotifier: ((userId: number, text: string) => Promise<void>) | null = null;

export function setWorldNotifier(fn: (userId: number, text: string) => Promise<void>): void {
  worldNotifier = fn;
}

async function handleWorldSend(
  req: IncomingMessage,
  res: ServerResponse,
  userId: number,
  engine: Mode,
): Promise<void> {
  const raw = await readBody(req, 4096);
  if (!isGptUserAllowed(userId)) {
    sendJson(res, 401, { error: "access revoked" });
    return;
  }
  let body: { id?: unknown; kind?: unknown; amount?: unknown };
  try {
    body = JSON.parse(raw ?? "") as typeof body;
  } catch {
    sendJson(res, 400, { error: "bad json" });
    return;
  }
  const kind = body.kind as WorldSendKind;
  const owner = typeof body.id === "string" ? islandOwner(body.id, engine) : null;
  if (!WORLD_SEND_KINDS.includes(kind) || !owner) {
    sendJson(res, 400, { error: "unknown island or kind" });
    return;
  }
  const amount = Math.max(1, Math.min(kind === "gift" ? 5 : 3, Number(body.amount) || 1));
  const result = getModeData(engine).sendToWorld(userId, owner.user_id, kind, amount);
  if ("error" in result) {
    sendJson(res, result.error === "self" ? 400 : 429, result);
    return;
  }
  const me = getOrCreateUser(userId);
  const from = islandName(userId, me.display_name, engine);
  const text = `${engine === "gpt" ? "GPT" : "Claude"} · ` + (
    kind === "gift"
      ? `🎁 С острова «${from}» к тебе плывут коты: ${amount}. Открой «Мой мир», чтобы встретить их.`
      : `🏴‍☠️ Остров «${from}» отправил к тебе пиратов! Открой «Мой мир» — они уже у берегов.`);
  void worldNotifier?.(owner.user_id, text).catch(() => undefined);
  sendJson(res, 200, { ok: true, amount });
}

async function serveStatic(
  pathname: string,
): Promise<{ body: Buffer; type: string; etag: string } | null> {
  const relative = pathname === "/" ? "modes.html" : pathname.replace(/^\/+/, "");
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

let extraApiHandler: ((req: IncomingMessage, res: ServerResponse) => Promise<boolean>) | null =
  null;
export function setExtraApiHandler(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>,
): void {
  extraApiHandler = handler;
}

export function startMiniAppServer(): ReturnType<typeof createServer> {
  const server = createServer(async (req, res) => {
    const scope = req.headers["x-bot-engine"];
    if(scope !== undefined && scope !== "gpt" && scope !== "claude"){sendJson(res,400,{error:"Неизвестный режим"});return;}
    const requestEngine = (_uid:number):Mode => scope as Mode ?? "gpt";
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (extraApiHandler && (await extraApiHandler(req, res))) return;
    if (await handleModesApi(req, res)) return;

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

    if (url.pathname === "/api/world-score" && req.method === "POST") {
      const initData = req.headers["x-telegram-init-data"];
      const userId = authenticate(typeof initData === "string" ? initData : null);
      if (userId === null) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid init data" }));
        return;
      }
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 4096) break;
      }
      if (!isGptUserAllowed(userId)) {
        sendJson(res, 401, { error: "access revoked" });
        return;
      }
      try {
        const body = JSON.parse(raw || "{}") as {
          score?: number;
          pop?: number;
          day?: number;
          era?: number;
          seed?: number;
        };
        getModeData(requestEngine(userId)).recordWorldScore(userId, {
          score: Number(body.score) || 0,
          pop: Number(body.pop) || 0,
          day: Number(body.day) || 1,
          era: Number(body.era) || 0,
          seed: Number(body.seed) || 0,
        });
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad json" }));
      }
      return;
    }

    if (url.pathname === "/api/world-top") {
      const initData = req.headers["x-telegram-init-data"];
      const userId = authenticate(typeof initData === "string" ? initData : null);
      if (userId === null) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid init data" }));
        return;
      }
      const engine = requestEngine(userId);
      const top = getModeData(engine).topWorlds(10).map((r, i) => ({
        rank: i + 1,
        id: islandId(r.user_id, engine),
        visitable: islandSnapshot(r.user_id, engine) !== null,
        name: r.display_name || `Остров №${r.seed}`,
        score: r.score,
        pop: r.pop,
        day: r.day,
        era: r.era,
        me: r.user_id === userId,
      }));
      const rank = getModeData(engine).worldRank(userId);
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify({ top, me: rank ? { rank } : null }));
      return;
    }

    if (url.pathname.startsWith("/api/world-") && url.pathname !== "/api/world-save") {
      const initData = req.headers["x-telegram-init-data"];
      const userId = authenticate(typeof initData === "string" ? initData : null);
      if (url.pathname === "/api/world-claim" && req.method === "POST" && userId !== null) {
        const engine = requestEngine(userId);
        const claim = getModeData(engine).claimWorld(userId);
        sendJson(res, 200, {
          work: claim.work,
          inbox: claim.inbox.map((i) => ({
            kind: i.kind,
            amount: i.amount,
            at: i.at,
            fromName: islandName(i.fromUser, i.fromName, engine),
          })),
        });
        return;
      }
      if (url.pathname === "/api/world-visit" && userId !== null) {
        const engine = requestEngine(userId);
        const owner = islandOwner(url.searchParams.get("id") ?? "", engine);
        const snapshot = owner ? islandSnapshot(owner.user_id, engine) : null;
        if (!owner || !snapshot) {
          sendJson(res, 404, { error: "island not synced" });
          return;
        }
        sendJson(res, 200, {
          name: islandName(owner.user_id, owner.display_name, engine),
          seed: snapshot.seed,
          map: snapshot.map,
          data: snapshot.data,
          mine: owner.user_id === userId,
        });
        return;
      }
      if (url.pathname === "/api/world-send" && req.method === "POST" && userId !== null) {
        try {
          await handleWorldSend(req, res, userId, requestEngine(userId));
        } catch (error) {
          console.error("world-send:", error);
          if (!res.headersSent) sendJson(res, 500, { error: "internal" });
        }
        return;
      }
      if (
        userId === null &&
        url.pathname !== "/api/world-score" &&
        url.pathname !== "/api/world-top"
      ) {
        sendJson(res, 401, { error: "invalid init data" });
        return;
      }
    }

    if (url.pathname === "/api/world-save") {
      const initData = req.headers["x-telegram-init-data"];
      const userId = authenticate(typeof initData === "string" ? initData : null);
      if (userId === null) {
        sendJson(res, 401, { error: "invalid init data" });
        return;
      }
      try {
        await handleWorldSave(req, res, url, userId, requestEngine(userId));
      } catch (error) {
        console.error("world-save:", error);
        if (!res.headersSent) sendJson(res, 500, { error: "internal" });
      }
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
      res.end(JSON.stringify(profilePayload(userId, requestEngine(userId))));
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
      res.writeHead(304, { etag: asset.etag, "cache-control": "no-store" });
      res.end();
      return;
    }

    res.writeHead(200, {
      "content-type": asset.type,
      // no-store, а не no-cache: WebView Telegram даже «спроси перед
      // использованием» умудрялся игнорировать, и после выкатки человек
      // видел старую панель и писал «ничего не поменялось». Файлов мало и они
      // маленькие — перекачать при каждом открытии дешевле, чем объяснять.
      "cache-control": "no-store",
      etag: asset.etag,
      // Мини-апп встраивается только в Telegram; чужие фреймы не нужны.
      "content-security-policy":
        "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-ancestors https://web.telegram.org https://telegram.org",
      "x-content-type-options": "nosniff",
    });
    res.end(asset.body);
  });

  server.listen(config.miniappPort, "127.0.0.1", () => {
    console.log(`🐱 Mini App слушает http://localhost:${config.miniappPort}`);
    if (!config.miniappUrl) {
      console.log("   MINIAPP_URL не задан — кнопка мини-аппа в боте скрыта.");
    }
  });
  return server;
}

export { profilePayload };
