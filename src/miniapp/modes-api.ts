import {claudeUsage} from "../claude-usage.js";
import {getModeData} from "../db.js";
import { isAdmin } from "../admin.js";
import {telegramAvatar} from "./avatar.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "../config.js";
import { verifyInitData } from "../crypto.js";
import { getChat, getOrCreateUser, isGptUserAllowed, saveChat } from "../db.js";
import { engineFor, setEngine, gptApi } from "../engine.js";
import { claudeState, refreshClaudeModels, saveClaudePreferences } from "../claude-settings.js";
import { getSession, reloadClaudeSettings } from "../bot/session.js";
import { activeProxyUrl } from "../proxy.js";

function reply(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(data));
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!String(req.headers["content-type"] || "").startsWith("application/json")) throw Error("Ожидается JSON");
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > 4096) throw Error("Слишком большой запрос"); }
  const value: unknown = JSON.parse(raw || "{}");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Некорректные настройки");
  return value as Record<string, unknown>;
}
async function gptState(initData: string): Promise<Record<string, unknown>> {
  const response = await gptApi("/api/gpt/preferences", initData);
  if (response.status !== 200) throw Error("GPT временно недоступен");
  return JSON.parse(response.body) as Record<string, unknown>;
}
export async function handleModesApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const isModes = url.pathname.startsWith("/api/miniapp/");
  const isGpt = url.pathname.startsWith("/api/gpt/");
  if (!isModes && !isGpt) return false;
  const initData = req.headers["x-telegram-init-data"];
  if (typeof initData !== "string" || initData.length > 16384) { reply(res, 401, { error: "Открой миниапку из Telegram-бота" }); return true; }
  const verified = verifyInitData(initData, config.botToken);
  let uid: number;
  try { uid = Number(JSON.parse(verified?.user ?? "{}").id); } catch { uid = 0; }
  if (!verified || !isGptUserAllowed(uid)) { reply(res, 401, { error: "Открой миниапку из Telegram-бота" }); return true; }
  let crossOrigin = req.headers["sec-fetch-site"] === "cross-site";
  try { if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) crossOrigin = true; } catch { crossOrigin = true; }
  if (crossOrigin) { reply(res, 403, { error: "Недопустимый источник запроса" }); return true; }
  if (!["GET", "POST"].includes(req.method ?? "")) { reply(res, 405, { error: "Метод недоступен" }); return true; }
  try {
    if(url.pathname==="/api/miniapp/avatar" && req.method==="GET"){
      const avatar=await telegramAvatar(uid);
      if(!isGptUserAllowed(uid)){reply(res,403,{error:"Доступ отозван"});return true;}
      res.writeHead(avatar?200:204,{"content-type":avatar?.type||"image/jpeg","cache-control":"no-store","x-content-type-options":"nosniff"});res.end(avatar?.bytes);return true;
    }
    if(url.pathname==="/api/miniapp/claude-admin" && req.method==="GET"){
      if(!isAdmin(uid)){reply(res,403,{error:"Только для администратора"});return true;}
      const base=JSON.parse((await gptApi("/api/gpt/admin/users",initData)).body);
      if(!Array.isArray(base.users))throw Error("Список пользователей недоступен");
      const mode=getModeData("claude"),midnight=Date.parse(new Date().toISOString().slice(0,10));
      const users=base.users.map((u:{id:number;name:string;allowed:boolean;owner:boolean})=>({id:u.id,name:u.name,allowed:u.allowed,owner:u.owner,today:mode.since(u.id,Date.now()-midnight).tokens,week:mode.since(u.id,7*86400000).tokens,total:mode.stats(u.id).total_tokens,messages:mode.stats(u.id).total_messages}));
      const usage=await claudeUsage(uid);
      if(!isAdmin(uid)||!isGptUserAllowed(uid)){reply(res,403,{error:"Доступ отозван"});return true;}
      reply(res,200,{users,usage});return true;
    }
    if (isGpt) {
      const raw = req.method === "POST" ? JSON.stringify(await body(req)) : undefined;
      const response = await gptApi(url.pathname + url.search, initData, req.method === "POST" ? "POST" : "GET", raw);
      res.writeHead(response.status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(response.body); return true;
    }
    if (url.pathname === "/api/miniapp/state" && req.method === "GET") {
      const user = getOrCreateUser(uid);
      const [gpt, catalog] = await Promise.allSettled([gptState(initData), refreshClaudeModels(uid)]);
      if (!isGptUserAllowed(uid)) { reply(res, 403, { error: "Доступ отозван" }); return true; }
      reply(res, 200, {
        engine: engineFor(uid),
        profile: { id: uid, name: user.display_name?.replace(/[\u200B-\u200D\uFEFF\u3164]/g, "").trim() || JSON.parse(verified.user ?? "{}").first_name || "Мой профиль", admin: isAdmin(uid) },
        network: { proxyRequired: true, ready: !!activeProxyUrl() },
        gpt: gpt.status === "fulfilled" ? gpt.value : { available: false, error: "GPT временно недоступен" },
        claude: { ...claudeState(uid), permissionMode: getChat(uid)?.permission_mode ?? config.defaultPermissionMode, catalogCurrent: catalog.status === "fulfilled" },
      }); return true;
    }
    if (req.method !== "POST") { reply(res, 404, { error: "Не найдено" }); return true; }
    const patch = await body(req);
    if (!isGptUserAllowed(uid)) { reply(res, 403, { error: "Доступ отозван" }); return true; }
    if (url.pathname === "/api/miniapp/engine") {
      if (Object.keys(patch).some(k => k !== "engine") || !["gpt", "claude"].includes(String(patch.engine))) throw Error("Выбери GPT или Claude");
      const engine = patch.engine as "gpt" | "claude";
      if (engine === "gpt" && !(await gptState(initData)).available) { reply(res, 409, { error: "GPT пока не подключён" }); return true; }
      if (engine === "claude" && !claudeState(uid).available) { reply(res, 409, { error: "Claude пока не подключён к твоему профилю" }); return true; }
      setEngine(uid, engine); reply(res, 200, { engine }); return true;
    }
    if (url.pathname === "/api/miniapp/claude") {
      if (!claudeState(uid).available) { reply(res, 409, { error: "Claude пока не подключён" }); return true; }
      if (getSession(uid)?.conversation.busy) { reply(res, 409, { error: "Дождись завершения задачи или нажми /stop в боте" }); return true; }
      const { permissionMode, ...preferences } = patch;
      if (permissionMode !== undefined && !["default", "acceptEdits", "plan", "bypassPermissions", "auto"].includes(String(permissionMode))) throw Error("Неизвестный режим работы");
      const current = claudeState(uid);
      const selected = current.models.find(m => m.value === (preferences.model ?? current.model) || m.resolvedModel === preferences.model);
      if ((permissionMode ?? getChat(uid)?.permission_mode) === "auto" && !selected?.supportsAutoMode) throw Error("Эта модель не поддерживает автоматическую проверку. Сначала выбери другой режим работы.");
      const value = saveClaudePreferences(uid, preferences);
      if (permissionMode !== undefined) {
        const chat = getChat(uid);
        saveChat({ chatId: uid, userId: uid, project: chat?.project ?? "default", sessionId: chat?.session_id ?? null, title: chat?.title ?? null, permissionMode: String(permissionMode) });
      }
      await reloadClaudeSettings(uid);
      reply(res, 200, { ...value, permissionMode: getChat(uid)?.permission_mode ?? config.defaultPermissionMode }); return true;
    }
    reply(res, 404, { error: "Не найдено" });
  } catch (error) {
    reply(res, 400, { error: error instanceof SyntaxError ? "Некорректный запрос" : error instanceof Error ? error.message.slice(0, 180) : "Не удалось сохранить настройки" });
  }
  return true;
}
