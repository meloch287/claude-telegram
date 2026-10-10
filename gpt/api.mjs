import { subscriptionMonitor } from "./subscription.mjs";
let inviteBotUsername = "";
export function setInviteBotUsername(name) {
  inviteBotUsername = name;
}
import { ownerConnected } from "./owner-auth.mjs";
let webLink = async () => { throw Error("Рабочая зона ещё запускается"); };
export function setWebLinkHandler(handler) { if (typeof handler === "function") webLink = handler; }
import { effortId, effortsFor } from "./reasoning.mjs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "../dist/config.js";
import { verifyInitData } from "../dist/crypto.js";
import { claudeQuota, getOrCreateUser, setModel, isGptUserAllowed } from "../dist/db.js";
import * as store from "./store.mjs";
import { startUserDeletion } from "./user-deletion.mjs";
import { engineAccess, setEngineAccess } from "../dist/engine-access.js";
let revokeAccess = async () => {};
export function setRevokeHandler(handler) {
  revokeAccess = handler;
}
import { MODELS, modelId, projectName } from "./policy.mjs";

function reply(res, status, value) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(value));
}
export function authenticate(initData) {
  if (typeof initData !== "string" || initData.length > 16384) return null;
  const verified = verifyInitData(initData, config.botToken);
  if (!verified) return null;
  try {
    const uid = JSON.parse(verified.user).id;
    return Number.isSafeInteger(uid) && uid > 0 && isGptUserAllowed(uid) ? uid : null;
  } catch {
    return null;
  }
}
export async function extraApi(req, res) {
  const url = new URL(req.url, "http://localhost");
  if (!url.pathname.startsWith("/api/gpt/")) return false;
  const uid = authenticate(req.headers["x-telegram-init-data"]);
  if (!uid) {
    reply(res, 401, { error: "Открой мини-апп из Telegram-бота." });
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/gpt/quota") {
    reply(res, 200, store.quotaUsage(uid));
    return true;
  }
  if (url.pathname === "/api/gpt/preferences" && ["GET", "POST"].includes(req.method)) {
    try {
      const user = getOrCreateUser(uid);
      let model = MODELS.some(([id]) => id === user.model) ? user.model : "gpt-6-sol";
      if (req.method === "POST") {
        let raw = "";
        for await (const chunk of req) { raw += chunk; if (raw.length > 4096) throw Error("Слишком большой запрос"); }
        const body = JSON.parse(raw || "{}");
        if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(k => !["model", "effort", "mode"].includes(k))) throw Error("Неизвестная настройка GPT");
        if (body.model !== undefined) model = modelId(body.model);
        const effort = body.effort === undefined ? store.effortFor(uid, model) : effortId(body.effort, model);
        if (body.mode !== undefined && !["auto", "read"].includes(body.mode)) throw Error("Выбери режим работы");
        setModel(uid, model);
        store.setEffort(uid, effort, model);
        if (body.mode !== undefined) store.setMode(uid, body.mode);
      }
      reply(res, 200, { available: await ownerConnected(), model, models: MODELS, effort: store.effortFor(uid, model), efforts: effortsFor(model), mode: store.modeFor(uid) });
    } catch (error) { reply(res, 400, { error: error.message }); }
    return true;
  }
  if (url.pathname === "/api/gpt/web-link" && req.method === "POST") {
    try { reply(res, 200, { url: await webLink(uid) }); }
    catch { reply(res, 503, { error: "Рабочая зона временно недоступна. Повтори позже." }); }
    return true;
  }
  if (uid !== store.ADMIN_ID) {
    reply(res, 403, { code: "MINIAPP_CATS_ONLY", error: "В миниапке доступны Кот и Мой мир." });
    return true;
  }
  try {
    if (req.method === "POST" && existsSync(join(config.dataDir, "maintenance"))) {
      reply(res, 409, { error: "Обновляю хранилище диалогов. Повтори чуть позже." });
      return true;
    }
    if (url.pathname.startsWith("/api/gpt/admin") && uid !== store.ADMIN_ID) {
      reply(res, 403, { error: "Админка доступна только владельцу" });
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/gpt/admin/accounting") {
      const subscription = await subscriptionMonitor.get();
      store.syncQuotaReset(subscription);
      reply(res, 200, { ...store.accountingOverview(), subscription });
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/gpt/admin/engines") {
      reply(res, 200, engineAccess());
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/gpt/admin/users") {
      const ids = [
        ...new Set([...config.allowedUserIds, ...store.managedUserIds(), store.ADMIN_ID]),
      ];
      reply(res, 200, {
        users: ids
          .filter((id) => store.userDeletion(id)?.state !== "complete")
          .map((id) => {
            const deletion = store.userDeletion(id);
            const user = deletion ? {} : getOrCreateUser(id),
              policy = store.userPolicy(id);
            return {
              id,
              username: user.telegram_username || null,
              name:
                policy.note.trim() ||
                user.display_name?.trim() ||
                (id === store.ADMIN_ID ? "Владелец" : String(id)),
              allowed: isGptUserAllowed(id),
              claude: claudeQuota.get(id),
              percentLimit: id === store.ADMIN_ID ? null : policy.percent_limit,
              storage: store.storageLedger.get(id),
              tokenLimit: policy.token_limit,
              weeklyLimit: policy.weekly_limit,
              quotaMode: policy.quota_mode,
              quota: store.quotaUsage(id),
              dialogLimit: policy.dialog_limit,
              tokensToday: store.tokensToday(id),
              tokensUnverified: store.unverifiedTokens(id),
              dialogs: store.threadCount(id),
              owner: id === store.ADMIN_ID,
              deletionState: deletion?.state || null,
            };
          }),
      });
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/gpt/admin/user-delete") {
      const id = Number(url.searchParams.get("id"));
      const deletion = store.userDeletion(id);
      reply(res, 200, { state: deletion?.state || "none" });
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/gpt/projects") {
      const names = [];
      const active = store.peekActiveThread(uid);
      reply(res, 200, {
        active: active?.project || "default",
        projects: [...new Set([...names, ...store.allThreads(uid).map((t) => t.project)])]
          .sort()
          .map((name) => ({ name, dialogs: store.projectThreads(uid, name).length })),
      });
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/gpt/chats") {
      const user = getOrCreateUser(uid);
      const active = store.peekActiveThread(uid);
      reply(res, 200, {
        chats: store.allThreads(uid),
        active: active?.id || null,
        maintenance: existsSync(join(config.dataDir, "maintenance")),
        admin: uid === store.ADMIN_ID,
        quota: {
          tokenLimit: store.userPolicy(uid).token_limit,
          tokensToday: store.tokensToday(uid),
          dialogLimit: store.userPolicy(uid).dialog_limit,
        },
        model: user.model || "gpt-6-sol",
        models: MODELS,
        effort: store.effortFor(uid, user.model || "gpt-6-sol"),
        efforts: effortsFor(user.model || "gpt-6-sol"),
        mode: store.modeFor(uid),
      });
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/gpt/chat") {
      const row = store.getThread(uid, url.searchParams.get("id") || "");
      if (!row) {
        reply(res, 404, { error: "Диалог не найден" });
        return true;
      }
      reply(res, 200, {
        id: row.id,
        title: row.title,
        project: row.project,
        summary: row.summary,
        pending: !!row.legacy_id && !row.summary,
      });
      return true;
    }
    if (req.method !== "POST") {
      reply(res, 405, { error: "Method not allowed" });
      return true;
    }
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 4096) {
        reply(res, 413, { error: "Запрос слишком большой" });
        return true;
      }
    }
    const body = JSON.parse(raw || "{}");
    if (!isGptUserAllowed(uid)) {
      reply(res, 401, { error: "Доступ отключён" });
      return true;
    }
    if (url.pathname === "/api/gpt/admin/engines") {
      if (!["gpt", "claude"].includes(body.engine) || typeof body.enabled !== "boolean")
        throw new Error("Нужно: engine gpt|claude и enabled true|false");
      reply(res, 200, setEngineAccess(body.engine, body.enabled));
      return true;
    }
    if (url.pathname === "/api/gpt/admin/invite") {
      if (!/^[A-Za-z0-9_]+$/.test(inviteBotUsername))
        throw new Error("Бот ещё запускается. Повтори через несколько секунд.");
      const invite = store.createInvite(uid);
      reply(res, 200, {
        url: `https://t.me/${inviteBotUsername}?start=invite_${invite.token}`,
        expiresAt: invite.expiresAt,
      });
      return true;
    }
    if (url.pathname === "/api/gpt/admin/user-delete") {
      const deletion = startUserDeletion(uid, body.id, body.confirmation);
      reply(res, 202, { ok: true, state: deletion.state });
      return true;
    }
    if (url.pathname === "/api/gpt/admin/user") {
      const id = body.id;
      if(body.claude!==undefined)claudeQuota.validate(body.claude);
      store.setUserPolicy(uid, id, body);
      if(body.claude!==undefined)claudeQuota.set(uid,id,body.claude);
      getOrCreateUser(id);
      if (body.allowed === false) await revokeAccess(id);
      reply(res, 200, { ok: true });
      return true;
    }
    if (url.pathname === "/api/gpt/project") {
      const name = body.name;
      if (typeof name !== "string" || !name.trim() || name.length > 80)
        throw new Error("Введи название проекта: до 80 символов");
      const canonical = projectName(name);
      let row = store.projectThreads(uid, canonical)[0];
      if (!row) store.assertDialogBudget(uid);

      if (!row) row = store.createThread(uid, canonical);
      else store.selectThread(uid, row.id);
      reply(res, 200, { ok: true, project: canonical, id: row.id });
      return true;
    }
    if (url.pathname === "/api/gpt/select") {
      const row = store.getThread(uid, body.id);
      if (!row) {
        reply(res, 404, { error: "Диалог не найден" });
        return true;
      }
      if (row.legacy_id && !row.summary) {
        reply(res, 409, { error: "Суммаризация готовится. Название и история сохранены." });
        return true;
      }
      store.selectThread(uid, row.id);
      reply(res, 200, { ok: true, title: row.title });
      return true;
    }
    if (url.pathname === "/api/gpt/new") {
      const row = store.createThread(
        uid,
        body.project || store.peekActiveThread(uid)?.project || "default",
      );
      reply(res, 200, { ok: true, id: row.id });
      return true;
    }
    if (url.pathname === "/api/gpt/model") {
      setModel(uid, modelId(body.model));
      reply(res, 200, { ok: true });
      return true;
    }
    if (url.pathname === "/api/gpt/effort") {
      store.setEffort(uid, body.effort, getOrCreateUser(uid).model || "gpt-6-sol");
      reply(res, 200, { ok: true });
      return true;
    }
    if (url.pathname === "/api/gpt/mode") {
      store.setMode(uid, body.mode);
      reply(res, 200, { ok: true });
      return true;
    }
    reply(res, 404, { error: "Not found" });
  } catch (error) {
    reply(res, 400, { error: String(error.message).slice(0, 200) });
  }
  return true;
}
