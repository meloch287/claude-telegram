import {claudeUsage} from "../dist/claude-usage.js";
import {subscriptionMonitor} from "./subscription.mjs";
import {createWebUsage} from "./web-usage.mjs";
import {telegramAvatar} from "../dist/miniapp/avatar.js";
import {createClaudeWebQuota} from "./claude-web-quota.mjs";
import { createDialogSync } from "./bb-sync.mjs";
import { createClaudeMirror } from "./claude-bb.mjs";
import { createEngineWeb } from "./engine-web.mjs";
import { workerFor } from "../dist/agent/isolation.js";
import { config as botConfig } from "../dist/config.js";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
import { createWebAuth } from "./web-auth.mjs";
import { createWebRuntime } from "./web-runtime.mjs";
import { createWebGateway, publicWebError } from "./web-gateway.mjs";

export function setupWeb({
  bot,
  config,
  allowed,
  store,
  legacy,
  storageGuard,
  percentController,
  teamSpace,
  runningTelegram = () => false,
}) {
  const enabled = !!process.env.BB_WEB_DOMAIN;
  if (!enabled)
    return {
      revoke: async () => {},
      sync: async () => {},
      prepareTelegram: async () => {},
      beforeDelete: async () => {},
      begin: async () => {
        throw Error("Web disabled");
      },
      finish: async () => {},
    };
  const webAllowed = (uid) =>
    allowed(uid) && !store.userDeletion(uid) && !store.storageLedger.get(uid)?.blocked;
  const auth = createWebAuth({
    file: join(config.dataDir, "web-access.json"),
    domain: process.env.BB_WEB_DOMAIN,
    allowed: webAllowed,
  });
  const runtime = createWebRuntime({
    auth,
    allowed: webAllowed,
    settings: (uid) => legacy.getOrCreateUser(uid),
    credential: (uid) => legacy.credentialFor(uid),
    onReady: (uid) => {
      // Claude-диалоги из Telegram — во вкладку Claude; не задерживает открытие bb.
      claudeMirror.sync(uid).catch((error) => console.error("[claude-bb]", uid, error.message));
      engineWeb.apply(uid).catch((error) => console.error("[engine-access]", uid, error.message));
      return dialogs.sync(uid);
    },
    prepareTeam: uid=>teamSpace?.prepare(uid),
  });
  const engineWeb = createEngineWeb({ endpoint: (uid) => runtime.endpoint(uid) });
  const claudeMirror = createClaudeMirror({ workerFor, workspaceRoot: botConfig.workspaceRoot, endpoint: (uid) => runtime.endpoint(uid) });
  // Диалоги из bb попадают в бота и без открытия bb: раз в 10 минут сверяем тех,
  // у кого контейнер и так запущен (спящие не будим).
  const backgroundSync = setInterval(async () => {
    let names = [];
    try {
      names = (await execFileAsync("docker", ["ps", "--filter", "label=ai-bot.managed=v1", "--format", "{{.Names}}"], { timeout: 20_000 })).stdout.split(/\s+/);
    } catch { return; }
    for (const name of names) {
      const uid = Number(/^ai-user-(\d+)$/.exec(name)?.[1]);
      if (!uid || !webAllowed(uid)) continue;
      await claudeMirror.sync(uid).catch((error) => console.error("[claude-bb]", uid, error.message));
      await dialogs.sync(uid).catch((error) => console.error("[bb-sync]", uid, error.message));
    }
  }, 10 * 60_000);
  backgroundSync.unref();
  const dialogs = createDialogSync({
    snapshot: store.webSnapshot,
    apply: store.applyWebSync,
    settings: (uid) => legacy.getOrCreateUser(uid),
    runningTelegram,
    endpoint: runtime.endpoint,
    // GPT-диалоги из bb забираем в бота, пока не упираемся в лимит диалогов.
    adoptBudget: (uid) => {
      const limit = store.userPolicy(uid).dialog_limit;
      return Math.max(0, Math.min(20, limit === null ? 20 : limit - store.threadCount(uid)));
    },
  });
  async function checkDialogs(uid, creating = false) {
    const limit = store.userPolicy(uid).dialog_limit;
    if (limit === null) return;
    await dialogs.sync(uid, { force: true });
    const total = store.threadCount(uid) + (dialogs.nativeCount(uid) ?? (await runtime.count(uid)));
    if (total + (creating ? 1 : 0) > limit)
      throw Error(`Лимит ${limit} диалогов. Удали лишние в bb или через /delete в боте.`);
  }
  const claudeQuota=createClaudeWebQuota(legacy.claudeQuota);
  const gateway = createWebGateway({
    usage: createWebUsage({ subscription: subscriptionMonitor, claudeUsage: uid => claudeUsage(uid, {httpOnly:true}), credential: legacy.credentialFor, payer: legacy.payerFor, quota: store.quotaUsage, claudeQuota: legacy.claudeQuota.get }),
    avatar:telegramAvatar,
    auth,
    runtime,
    allowed: webAllowed,
    beforeMutation: async (uid, method, path) => {
      if (method === "POST" && ["/api/v1/threads", "/api/v1/threads/fork"].includes(path)) {
        await storageGuard.admit(uid);
        await checkDialogs(uid, true);
      }
      if (method === "POST" && /^\/api\/v1\/threads(?:\/fork|\/[^/]+\/(?:send|retry|compact|edit-message))?$/.test(path)) {
        const turn = /\/(?:send|retry|compact|edit-message)$/.test(path);
        const claude = turn ? await claudeQuota.isClaude(uid, path) : null;
        engineWeb.apply(uid).catch(() => {});
        engineWeb.assertTurn(uid, claude);
        if (claude) { await claudeQuota.sync(uid); legacy.claudeQuota.assert(uid); }
      }
      if (method === "POST") return dialogs.beforeWeb(uid, path);
    },
  });
  gateway.server.listen(8792, "127.0.0.1");
  async function open(ctx) {
    const uid = ctx.from.id;
    if (ctx.chat?.type !== "private") return ctx.reply("Открой /web в личном чате с ботом.");
    const pending = await ctx.reply("🌐 Открываю твою рабочую зону…");
    try {
      await storageGuard.admit(uid);
      auth.ensure(uid);
      await runtime.ensure(uid);
      if (!webAllowed(uid)) throw Error("Нет доступа");
      const login = auth.issue(uid);
      const profile = login.replace("/__web/login#", "/__web/login?next=profile#");
      await ctx.api.editMessageText(
        uid,
        pending.message_id,
        "🌐 Твой bb\nGPT, Claude, проекты и файлы — в твоём личном профиле.\nВ разделе «Мой профиль» можно добавить свой браузер и установить bb на главный экран.\nСсылка для входа действует 10 минут.",
        { reply_markup: { inline_keyboard: [[{ text: "Открыть bb ↗", url: login }], [{ text: "Мой профиль · На главный экран", url: profile }]] } },
      );
    } catch (error) {
      await ctx.api.editMessageText(uid, pending.message_id, publicWebError(error));
    }
  }
  bot.command("web", open);
  bot.command("webapp", open);
  bot.hears(/^web$/i, open);
  return {
    async link(uid) {
      if (!webAllowed(uid)) throw Error("Нет доступа");
      auth.ensure(uid);
      return auth.issue(uid);
    },
    sync: dialogs.sync,
    syncClaudeUsage:claudeQuota.sync,
    prepareTelegram: dialogs.prepareTelegram,
    beforeDelete: dialogs.beforeDelete,
    async revoke(uid) {
      gateway.closeUser(uid);
      await runtime.revoke(uid);
    },
    async begin(uid, jobId) {
      await storageGuard.admit(uid);
      await checkDialogs(uid);
      await percentController.begin(uid, jobId);
    },
    finish: (jobId) => percentController.finish(jobId),
  };
}
