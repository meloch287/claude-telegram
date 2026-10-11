import { engineFor } from "../dist/engine.js";
import { createLibrary } from "./library.mjs";
import { taskState } from "../dist/bot/task-state.js";
import { synthesize, speechConfigured } from "../dist/bot/speak.js";
import { stopClaudeStorageWorker } from "./claude-storage-worker.mjs";
import {createTeamSpace,teamContext} from './team-space.mjs';
import {createTeamService} from './team-service.mjs';
import {configureTeam,configureClaudeBridge} from './inference-gateway.mjs';
import {createClaudeBridgeHandler} from './claude-bb-bridge.mjs';
import {engineAllowed,engineClosedText} from '../dist/engine-access.js';
import {gptModels} from './gpt-models.mjs';
import {outgoingFiles,FILE_DELIVERY_PROMPT} from "../dist/bot/delivery.js";
import {telegramMedia} from "./telegram-media.mjs";
import {videoPreview} from "../dist/bot/media.js";
import { sendHelp } from "../dist/bot/help.js";
import { imageType } from "./attachment-input.mjs";
import { checkAchievements } from "../dist/achievements.js";
import { GITHUB_CONTEXT, registerGitHub } from "./github.mjs";
import { attachLiveInput, steerJob } from "./live-turn.mjs";
import { createTaskProgress } from "./task-progress.mjs";
import { setupWeb } from "./web.mjs";
import { registerChatActions } from "./chat-actions.mjs";
import { createUserScheduler } from "./user-scheduler.mjs";
import { createStorageGuard, storageAction, CLEAN_ACTIONS } from "./storage.mjs";
import { registerStorageMenu } from "./storage-menu.mjs";
import { LEARNING_STYLE } from "./learning-style.mjs";
import { createPercentController } from "./percent-quota.mjs";
import { subscriptionMonitor } from "./subscription.mjs";
import { redeemInvitation } from "./invites.mjs";
import { notifyRestarted } from "./restart-notices.mjs";
import { usageDelta, normalizeUsage } from "./token-usage.mjs";
import { createAttachmentBatches } from "./attachment-batches.mjs";
import { TaskJournal, finishTaskMessage } from "./task-journal.mjs";
import { miniappUrl } from "./miniapp-url.mjs";
import { createControlMessages } from "./control-messages.mjs";
import { sharedAccountEnabled } from "./owner-auth.mjs";
import {
  configureInference,
  startInferenceGateway,
  revokeInference,
} from "./inference-gateway.mjs";
import { Bot, InlineKeyboard, InputFile, HttpError, GrammyError } from "grammy";
import { createInterface } from "node:readline";
import { stripVTControlCharacters } from "node:util";
import { basename, join } from "node:path";
import { existsSync, rmSync, chmodSync } from "node:fs";
import { createServer } from "node:http";
import { configureUserDeletion, resumeUserDeletions } from "./user-deletion.mjs";
import { registerSettingsMenu } from "./settings-menu.mjs";
import { sendFormatted } from "./rich-output.mjs";
import { registerDeleteMenu } from "./delete-menu.mjs";
import { configureDeletion, isDeleting, retryDeletions, deleteDialogs } from "./deletion.mjs";
import { config } from "../dist/config.js";
import * as legacy from "../dist/db.js";
import { setBotUsername, startMiniAppServer, setExtraApiHandler } from "../dist/miniapp/server.js";
import { scheduleDailyBackups } from "../dist/backup.js";
import { transcribe, transcriptionConfigured } from "../dist/bot/voice.js";
import { MODELS, modelId, projectName } from "./policy.mjs";
import * as workers from "./worker.mjs";
import * as store from "./store.mjs";
import { createLimitWarnings } from "./limit-warnings.mjs";
import { extraApi, setRevokeHandler, setInviteBotUsername, setWebLinkHandler } from "./api.mjs";

// Controller credentials and database never enter the user containers.
for (const key of [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
])
  delete process.env[key];
const percentController = createPercentController(
  store.percentLedger,
  subscriptionMonitor,
  store.syncQuotaReset,
);

taskState.recover("gpt");
const dispatchMode = !!process.env.GPT_DISPATCH_SOCKET;
const owner = store.ADMIN_ID;
if (!owner) throw new Error("ALLOWED_USER_IDS must contain the owner");
const bot = new Bot(config.botToken);
bot.api.config.use(async (previous, method, payload, signal) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await previous(method, payload, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      const limited = error instanceof GrammyError && error.error_code === 429;
      if (attempt >= 3 || (!(error instanceof HttpError) && !limited)) throw error;
      const delay = limited
        ? Math.min(30_000, (error.parameters?.retry_after || 2) * 1000)
        : [1000, 3000, 7000][attempt];
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
});
const allowed = legacy.isGptUserAllowed;
const teamSpace=createTeamSpace({dataDir:config.dataDir,store,allowed});
const team=createTeamService({space:teamSpace,allowed,models:uid=>modelId(legacy.getOrCreateUser(uid).model||'gpt-6-sol'),
 before:async(uid,engine,id)=>{
  if(isDeleting(uid)||store.userDeletion(uid))throw Error('Профиль недоступен');
  if(!engineAllowed(engine==='claude'?'claude':'gpt',uid))throw Object.assign(Error(engineClosedText(engine==='claude'?'claude':'gpt')),{status:403});
  await storageGuard.admit(uid);
  if(engine==='claude'){legacy.claudeQuota.assert(uid);return {}}
  store.assertTokenBudget(uid);
  const current=store.percentLedger.activeJobs().find(j=>j.user_id===uid);
  if(current){await percentController.before(uid,current.job_id);return {jobId:current.job_id,own:false}}
  const jobId='team-'+id;await percentController.begin(uid,jobId);return {jobId,own:true};
 },after:async(uid,budget)=>{if(budget.own)await percentController.finish(budget.jobId)},
 charge:(uid,engine,usage,jobId,id)=>{if(engine==='gpt')store.recordMeteredUsage(uid,usage,modelId(legacy.getOrCreateUser(uid).model||'gpt-6-sol'),'team:'+id,Date.now(),jobId);else legacy.recordUsage(uid,usage.tokens,usage.costUsd,'claude')}
});
configureTeam(team.handler);
// Каталог моделей GPT из Codex: новые модели появляются без правок кода.
gptModels.refresh();
setInterval(()=>{try{if(gptModels.refresh())console.log('[gpt-models] каталог обновлён')}catch(e){console.error('[gpt-models]',e.message)}},10*60_000).unref();
configureClaudeBridge(createClaudeBridgeHandler({identify:teamSpace.identify}));
const inFlightUpdates = new Map();
const busy = new Map(),
  logins = new Map(),
  queue = [];
let shuttingDown = false;
const scheduler = createUserScheduler({
  queue,
  run: async (job) => {
    try {
      if (allowed(job.uid)) await turn(job);
    } finally {
      const saved = job.checkpoint && taskState.get(job.uid, job.checkpoint);
      if (saved && saved.state !== "interrupted") taskState.state(job.checkpoint, job.cancelled && !shuttingDown ? "cancelled" : "interrupted");
      job.liveInput?.resolve(null);
    }
  },
  canRun: (uid) => !isDeleting(uid),
  stopping: () => shuttingDown,
  onError: (job, error) =>
    shuttingDown || job.cancelled
      ? undefined
      : text(job.uid, `Не удалось выполнить задачу: ${String(error.message).slice(0, 700)}`),
});
const text = async (uid, body, extra = {}) => {
  for (let i = 0; i < body.length; i += 3900)
    await bot.api.sendMessage(uid, body.slice(i, i + 3900), extra);
};
const controls = createControlMessages(bot.api);
const library = createLibrary({ store, workers, teamSpace, busy: uid => scheduler.has(uid) || attachments.has?.(uid) || false,
  submit: async (uid, thread, prompt, images) => {
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 200000) throw Error("Некорректный текст");
    if (!Array.isArray(images) || images.some(x => typeof x !== "string")) throw Error("Некорректные вложения");
    let rejected = "";
    const ctx = { from: { id: uid }, chat: { id: uid, type: "private" }, api: bot.api,
      reply: async text => { rejected = text; }, react: async () => {} };
    await enqueue(ctx, prompt, thread, undefined, images);
    if (rejected) throw Error(rejected);
  },
});
const appUrl = (uid) => miniappUrl(uid, owner, config.miniappUrl, process.env.MINIAPP_OWNER_URL);
const homeKeyboard = (uid) => {
  const kb = new InlineKeyboard()
    .text("🤖 GPT", "engine:gpt")
    .text("🧠 Claude", "engine:claude")
    .row();
  return kb
    .text("⚙️ Настройки", "menu:settings")
    .text("💬 Диалоги", "menu:chats")
    .row()
    .text("💾 Место на диске", "disk:show")
    .row()
    .text("➕ Новый диалог", "new")
    .text("⏹ Стоп", "stop");
};
const attachments = createAttachmentBatches({
  api: bot.api,
  prepare: prepareAttachment,
  submit: enqueue,
  allowed: (uid, id) =>
    allowed(uid) && !shuttingDown && !isDeleting(uid) && !!store.getThread(uid, id),
  track: (uid, task) => {
    const tasks = inFlightUpdates.get(uid) || new Set();
    tasks.add(task);
    inFlightUpdates.set(uid, tasks);
    void task.finally(() => {
      tasks.delete(task);
      if (!tasks.size && inFlightUpdates.get(uid) === tasks) inFlightUpdates.delete(uid);
    });
  },
});
const WELCOME = "GPT бот\n\nНапиши задачу или отправь фото. Команды — /help.";
bot.use(redeemInvitation);
bot.use(async (ctx, next) => {
  const uid = ctx.from?.id;
  if (!uid || !allowed(uid)) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery("Нет доступа");
    return;
  }
  if (ctx.chat?.type !== "private") {
    if (ctx.message) await ctx.reply("Работа с файлами и ChatGPT доступна в личном чате с ботом.");
    return;
  }
  // Админ может временно закрыть GPT для всех, кроме себя. Команды бота работают.
  if (!engineAllowed("gpt", uid) && (ctx.callbackQuery || (ctx.message && !ctx.message.text?.startsWith("/")))) {
    if (ctx.callbackQuery) return ctx.answerCallbackQuery(engineClosedText("gpt"));
    return ctx.reply(engineClosedText("gpt"));
  }
  if (existsSync(join(config.dataDir, "maintenance"))) {
    if (ctx.callbackQuery)
      return ctx.answerCallbackQuery("Обновляю хранилище. Повтори чуть позже.");
    return ctx.reply(
      "Обновляю отдельные папки диалогов. Переписки сохранены; выполнение задач скоро возобновится.",
    );
  }
  legacy.getOrCreateUser(uid);
  legacy.setTelegramIdentity(
    uid,
    [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" "),
    ctx.from.username || null,
  );
  let finish;
  const task = new Promise((resolve) => {
    finish = resolve;
  });
  const updates = inFlightUpdates.get(uid) || new Set();
  updates.add(task);
  inFlightUpdates.set(uid, updates);
  try {
    return await next();
  } finally {
    updates.delete(task);
    if (!updates.size) inFlightUpdates.delete(uid);
    finish();
  }
});
const storageGuard = createStorageGuard({
  ledger: store.storageLedger,
  scan: async (uid) => {
    if (store.userDeletion(uid)) throw Error("User data deletion in progress");
    const report = await storageAction(uid);
    if (store.userDeletion(uid)) throw Error("User data deletion in progress");
    return report;
  },
  stop: async (uid) => {
    revokeInference(uid);
    await web.revoke(uid);
    const running = busy.get(uid);
    await stop(uid);
    if (running) await running.done;
    await workers.stopStorageWorker(uid);
    await stopClaudeStorageWorker(uid);
  },
  notify: async (uid, report) => {
    if (!allowed(uid)) return;
    await bot.api.sendMessage(uid, storageMenu.report(uid, report), {
      parse_mode: "HTML",
      reply_markup: storageMenu.keyboard,
    });
  },
});
const web = setupWeb({
  bot,
  config,
  allowed,
  store,
  legacy,
  storageGuard,
  percentController,
  deleteDialogs,
  teamSpace,
  runningTelegram: (uid, id) => scheduler.job(uid)?.threadId === id,
});
registerGitHub(bot, {
  show: controls.show,
  admit: async (uid) => {
    if (shuttingDown || isDeleting(uid) || store.userDeletion(uid) || !allowed(uid))
      throw Error("Дождись завершения текущего обслуживания и повтори /github.");
    await storageGuard.admit(uid);
  },
});
const deleteMenu = registerDeleteMenu(bot, {
  deleteDialogs,
  retryDeletions,
  after: (uid) => storageGuard.refresh(uid),
});
const storageMenu = registerStorageMenu(bot, {
  guard: storageGuard,
  threads: store.allThreads,
  openDelete: deleteMenu.open,
  preview: (uid) => storageAction(uid, "preview"),
});
registerSettingsMenu(bot, {
  homeText:
    "GPT бот\n\nНапиши задачу или выбери раздел. Модель ИИ и режим разрешений — в настройках.",
  homeKeyboard,
  display: controls.show,
});
configureDeletion(
  async (uid, ids) => {
    await web.beforeDelete(uid, ids);
    const running = busy.get(uid);
    const admitted = scheduler.job(uid);
    if (
      (running && !ids.includes(running.threadId)) ||
      (admitted && !ids.includes(admitted.threadId))
    )
      throw new Error("Сейчас работает другой диалог. Дождись завершения или нажми /stop.");
    for (let i = queue.length - 1; i >= 0; i--)
      if (queue[i].uid === uid && ids.includes(queue[i].threadId)) queue.splice(i, 1);
    team.cancel(uid);
  scheduler.cancel(uid);
    if (running) running.cancelled = true;
    await attachments.cancel(uid, ids);
    await workers.stopWorkerTasks(uid);
    if (running) await running.done;
    await scheduler.wait(uid);
  },
  () => scheduler.wake(),
);
async function showChats(ctx, offset = 0) {
  // Диалоги, начатые в bb, — сразу в списке: сверка с bb, но не дольше 4 секунд.
  if (offset === 0) await Promise.race([web.sync(ctx.from.id).catch(() => {}), new Promise((r) => setTimeout(r, 4000).unref())]);
  const rows = store.listThreads(ctx.from.id, offset),
    kb = new InlineKeyboard();
  for (const row of rows.slice(0, 10))
    kb.text(
      `${row.show_imported ? "↻ " : ""}${row.title.slice(0, 38)} · ${row.project}`,
      `chat:${row.id}`,
    ).row();
  if (offset > 0) kb.text("← Назад", `chats-page:${Math.max(0, offset - 10)}`);
  if (rows.length > 10) kb.text("Дальше →", `chats-page:${offset + 10}`);
  await controls.show(ctx, rows.length ? "Твои диалоги." : "Диалогов пока нет.", kb);
}
setRevokeHandler(async (uid) => {
  team.cancel(uid);
  await teamSpace.revoke(uid);
  revokeInference(uid);
  await web.revoke(uid);
  await stop(uid);
  const login = logins.get(uid);
  if (login) {
    await workers.stopWorkerTasks(uid);
    logins.delete(uid);
  }
});
configureUserDeletion({
  prepare: async (uid) => {
    team.cancel(uid);
    await teamSpace.revoke(uid);
    revokeInference(uid);
    await web.revoke(uid);
    const running = busy.get(uid);
    await stop(uid);
    if (running) await running.done;
    // Let any already-authorized upload or command finish before removing its files.
    await Promise.allSettled([...(inFlightUpdates.get(uid) || [])]);
    const late = busy.get(uid);
    await stop(uid);
    if (late) await late.done;
    await scheduler.wait(uid);
    if (logins.has(uid)) {
      await workers.stopWorkerTasks(uid);
      logins.delete(uid);
    }
  },
});
async function stop(uid) {
  team.cancel(uid);
  scheduler.cancel(uid);
  const attachmentStop = attachments.cancel(uid);
  for (let i = queue.length - 1; i >= 0; i--) if (queue[i].uid === uid) {taskState.state(queue[i].checkpoint, "cancelled");queue.splice(i, 1);}
  const running = busy.get(uid);
  if (running) {
    running.cancelled = true;
    await workers.stopWorkerTasks(uid);
  }
  await attachmentStop;
}
bot.command("start", (ctx) =>
  controls.show(
    ctx,
    ctx.inviteGranted
      ? "GPT бот\n\nДоступ открыт. Напиши задачу или отправь вложение."
      : WELCOME,
    homeKeyboard(ctx.from.id),
  ),
);
bot.command("help", async ctx => {
  await controls.clear(ctx.from.id);
  const message=await sendHelp(ctx,"gpt",homeKeyboard(ctx.from.id));
  store.setControlMessage(ctx.from.id,message.message_id);
});
bot.command(["chats", "resume"], (ctx) => showChats(ctx));
bot.command("new", async (ctx) => {
  const row = store.createThread(
    ctx.from.id,
    store.peekActiveThread(ctx.from.id)?.project || "default",
  );
  await controls.show(ctx, `💬 Новый диалог · ${row.project}`);
});
bot.command("project", async (ctx) => {
  const uid = ctx.from.id;
  if (!ctx.match.trim())
    return ctx.reply(`Проект: ${store.activeThread(uid).project}\nСменить: /project имя`);
  const name = projectName(ctx.match);
  store.assertDialogBudget(uid);
  store.createThread(uid, name);
  await ctx.reply(`Проект: ${name}. Начат новый диалог.`);
});
bot.command("projects", async (ctx) => {
  const names = [...new Set(store.allThreads(ctx.from.id).map((row) => row.project))].sort();
  await ctx.reply(names.join("\n").slice(0, 3900) || "Проектов нет.");
});
bot.command("files", async (ctx) =>
  ctx.reply(
    (
      await workers.listFiles(
        ctx.from.id,
        store.activeThread(ctx.from.id).project,
        store.activeThread(ctx.from.id).id,
      )
    )
      .join("\n")
      .slice(0, 3900) || "Папка пуста.",
  ),
);
bot.command("file", async (ctx) => {
  const file = ctx.match.trim();
  const data = await workers.readFile(
    ctx.from.id,
    store.activeThread(ctx.from.id).project,
    file,
    store.activeThread(ctx.from.id).id,
  );
  await ctx.replyWithDocument(new InputFile(data, basename(file)));
});
bot.command("stop", async (ctx) => {
  await stop(ctx.from.id);
  await ctx.reply("Задача остановлена, очередь очищена.");
});
bot.command(["usage","status"], async (ctx) => {
  const uid = ctx.from.id,
    row = store.peekActiveThread(uid),
    user = legacy.getOrCreateUser(uid);
  const logged = await workers.authStatus(uid);
  const quota = store.quotaUsage(uid);
  const unit = quota.mode === "weighted" ? "ед." : "токенов";
  const line = (w) =>
    `${w.used.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} / ${w.limit === null ? "∞" : w.limit.toLocaleString("ru-RU")} ${unit}`;
  let limits = `\nКвота сегодня: ${line(quota.daily)}\nКвота недели: ${line(quota.weekly)}\nСброс суток: 00:00 UTC. Недельный: ${new Date(quota.weekly.resetsAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК.`;
  const disk = store.storageLedger.get(uid);
  const personal = quota.subscription;
  limits =
    `\nРасчётный расход Pro: ≈${personal.used.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}% / ${personal.limit === null ? "без личного ограничения" : personal.limit + "%"}.\nСброс: ${personal.resetsAt ? new Date(personal.resetsAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }) + " МСК" : "уточняется у OpenAI"}.\nОбщий расход OpenAI распределяется между работающими пользователями; личный процент — оценка.` +
    (quota.daily.limit !== null || quota.weekly.limit !== null ? limits : "");
  limits += `\n💾 Диск: ${disk ? (disk.bytes / 1e9).toFixed(2) + " ГБ" + (disk.blocked ? " · блокировка до очистки до 10 ГБ" : "") : "ещё не измерен"}. Таблица и очистка: /storage.`;
  if (uid === owner) {
    const sub = await subscriptionMonitor.get();
    store.syncQuotaReset(sub);
    const bucket = sub.buckets.find((b) => b.id === "codex");
    limits += bucket?.primary
      ? `\nPro: использовано ${bucket.primary.usedPercent}%${sub.stale ? " · данные устарели" : ""}\nСброс OpenAI: ${bucket.primary.resetsAt ? new Date(bucket.primary.resetsAt).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "не указан"}`
      : "\nЛимит Pro: данные временно недоступны";
  }
  await ctx.reply(
    `ChatGPT: ${logged ? "вход выполнен" : "не подключён"}\nМодель: ${user.model || "gpt-6-sol"}\nПроект: ${row?.project || "—"}\nЗадача: ${scheduler.has(uid) ? "работает" : "нет"}\nВ очереди: ${queue.filter((t) => t.uid === uid).length}\nТокены за сегодня (UTC, включая кеш): ${legacy.getUsageToday(uid).tokens.toLocaleString("ru-RU")}${store.unverifiedTokens(uid) ? " (старые неподтверждённые записи исключены)" : ""}\nEffort: ${store.effortFor(uid, user.model || "gpt-6-sol")}\nРазрешения: ${store.modeFor(uid)}\nСвой контейнер: ai-user-${uid}${limits}`,
  );
});
bot.command("summary", (ctx) =>
  sendFormatted(
    bot.api,
    ctx.from.id,
    store.activeThread(ctx.from.id).summary || "В этом диалоге нет импортированной суммаризации.",
  ),
);
bot.command("export", async (ctx) => {
  const row = store.activeThread(ctx.from.id);
  const body = [
    `# ${row.title}`,
    row.summary || "",
    ...store.messages(ctx.from.id, row.id).map((m) => `\n## ${m.role}\n${m.body}`),
  ].join("\n");
  await ctx.replyWithDocument(new InputFile(Buffer.from(body), "conversation.md"));
});
registerChatActions(bot, { store, show: controls.show });
bot.command("app", (ctx) =>
  config.miniappUrl
    ? ctx.reply("Твой профиль и мир", {
        reply_markup: new InlineKeyboard().webApp("Открыть", appUrl(ctx.from.id)),
      })
    : ctx.reply("Веб-приложение пока не настроено."),
);
bot.command("tasks", (ctx) =>
  ctx.reply(
    `Сейчас: ${scheduler.has(ctx.from.id) ? "задача выполняется" : "нет активной задачи"}\nВ очереди: ${
      queue
        .filter((j) => j.uid === ctx.from.id)
        .map((j) => j.prompt.slice(0, 80))
        .join("\n") || "пусто"
    }`,
  ),
);
for (const [command, prompt] of [
  ["git", "Покажи состояние git в текущем проекте."],
  ["diff", "Покажи и кратко объясни текущий git diff."],
  ["commit", "Проверь изменения и создай подходящий git commit."],
  ["push", "Отправь текущие коммиты в настроенный git remote."],
])
  bot.command(command, (ctx) => enqueue(ctx, `${prompt}\n${ctx.match || ""}`));
bot.command("clone", (ctx) =>
  ctx.match.trim()
    ? enqueue(ctx, `Клонируй репозиторий в текущий проект: ${ctx.match.trim()}`)
    : ctx.reply("/clone URL репозитория"),
);
bot.command("logout", async (ctx) => {
  if (sharedAccountEnabled() && ctx.from.id !== owner)
    return ctx.reply("Общий аккаунт подключает и отключает только владелец бота.");
  await stop(ctx.from.id);
  await workers.runInWorker(ctx.from.id, ["codex", "logout"]);
  await ctx.reply("Вышел из ChatGPT. Файлы и диалоги сохранены.");
});
async function beginLogin(ctx) {
  const uid = ctx.from.id;
  if (sharedAccountEnabled() && uid !== owner)
    return controls.show(
      ctx,
      "Работа идёт через подписку владельца. Свой ChatGPT подключать не нужно. Присылай задачу.",
    );
  if (logins.has(uid)) return ctx.reply("Вход уже ожидает подтверждения по выданному коду.");
  if (await workers.authStatus(uid))
    return ctx.reply("ChatGPT уже подключён. Можно писать задачи.");
  const child = await workers.startLogin(uid);
  logins.set(uid, child);
  let output = "",
    sent = false;
  const parse = async (chunk) => {
    output += stripVTControlCharacters(chunk.toString());
    const match = output.match(/\b([A-Z0-9]{4}-[A-Z0-9]{5})\b/);
    if (match && !sent) {
      sent = true;
      await text(
        uid,
        `Вход в твой ChatGPT:\nhttps://auth.openai.com/codex/device\n\nКод: ${match[1]}\nДействует 15 минут. Вводи его только если сам начал подключение в боте.`,
        { protect_content: true },
      );
    }
  };
  child.stdout.on("data", (c) => void parse(c).catch(() => {}));
  child.stderr.on("data", (c) => void parse(c).catch(() => {}));
  const timer = setTimeout(() => child.kill("SIGTERM"), 16 * 60_000);
  timer.unref();
  child.on("error", () => {
    logins.delete(uid);
    clearTimeout(timer);
    void text(uid, "Не удалось начать вход. Повтори подключение в боте.");
  });
  child.on("close", (code) => {
    logins.delete(uid);
    clearTimeout(timer);
    void text(
      uid,
      code === 0
        ? "ChatGPT подключён. Присылай задачу."
        : "Вход не завершён. Повтори подключение в боте.",
    ).catch(() => {});
  });
}
bot.command("login", beginLogin);
bot.callbackQuery("connect-account", async (ctx) => {
  await ctx.answerCallbackQuery();
  await beginLogin(ctx);
});
bot.command("admin", async (ctx) => {
  if (ctx.from.id !== owner) return ctx.reply("Команда доступна владельцу.");
  const [verb, raw] = ctx.match.trim().split(/\s+/),
    uid = Number(raw);
  if (verb === "list")
    return text(
      ctx.from.id,
      [...new Set([...config.allowedUserIds, ...store.managedUserIds()])]
        .map((id) => `${allowed(id) ? "✓" : "⏸"} ${id} ${store.userPolicy(id).note || ""}`)
        .join("\n") || "Список пуст",
    );
  if (!Number.isSafeInteger(uid) || uid <= 0)
    return ctx.reply("/admin list\n/admin add ID\n/admin delete ID");
  if (verb === "add") {
    store.setUserPolicy(owner, uid, { allowed: true });
    await ctx.reply(
      `✅ Доступ выдан ${uid}. Пользователь работает через твою подписку; его файлы и диалоги изолированы.`,
    );
  } else if (["remove", "delete"].includes(verb)) {
    store.setUserPolicy(owner, uid, { allowed: false });
    revokeInference(uid);
    await web.revoke(uid);
    await stop(uid);
    await ctx.reply("Доступ отозван. Диалоги и файлы сохранены.");
  }
});
bot.callbackQuery("menu:chats", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showChats(ctx);
});
bot.callbackQuery(/^chats-page:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showChats(ctx, Number(ctx.match[1]));
});
bot.callbackQuery("new", async (ctx) => {
  store.createThread(ctx.from.id, store.peekActiveThread(ctx.from.id)?.project || "default");
  await ctx.answerCallbackQuery("Создан новый диалог");
  await controls.show(ctx, "💬 Новый диалог. Присылай задачу.");
});
bot.callbackQuery("stop", async (ctx) => {
  await ctx.answerCallbackQuery();
  await stop(ctx.from.id);
  await ctx.reply("Остановлено.");
});

async function enqueue(ctx, prompt, threadId, signal, images=[]) {
  const uid = ctx.from.id;
  if (isDeleting(uid))
    return ctx.reply("Заверши удаление через /delete перед продолжением работы.");
  try {
    store.assertDialogCount(uid);
    store.assertTokenBudget(uid);
    await storageGuard.admit(uid);
  } catch (error) {
    return ctx.reply(error.message);
  }
  if (shuttingDown) return ctx.reply("Бот перезапускается. Повтори сообщение через минуту.");
  if (!(await workers.authStatus(uid)))
    return controls.show(
      ctx,
      sharedAccountEnabled() && uid !== owner
        ? "Подписка владельца пока не подключена. Сообщи администратору."
        : "Для работы подключи ChatGPT.",
      uid === owner
        ? new InlineKeyboard().text("Подключить ChatGPT", "connect-account")
        : undefined,
    );
  if (signal?.aborted || !allowed(uid)) return;
  const row = threadId ? store.getThread(uid, threadId) : store.activeThread(uid);
  if (!row) return ctx.reply("Диалог уже удалён. Создай новый через /new.");
  if (row.legacy_id && !row.summary)
    return ctx.reply(
      "Суммаризация этого диалога ещё готовится. Название и исходная история сохранены. Можно пока начать /new.",
    );
  if (row.title === "Новый диалог") store.renameThread(uid, row.id, prompt.slice(0, 70));
  const active = scheduler.job(uid);
  const wasCancelled = active?.cancelled;
  if (active?.threadId !== row.id && queue.filter((t) => t.uid === uid).length >= 8)
    return ctx.reply("В очереди уже 8 сообщений. Дождись ответа или нажми /stop.");
  store.addMessage(uid, row.id, "user", prompt);
  legacy.recordMessage(uid,"gpt");
  checkAchievements(uid,{type:"message",hour:new Date().getHours()},"gpt");
  await controls.clear(uid);
  if (signal?.aborted || !allowed(uid)) return;
  try {
    if (await steerJob(active, uid, row.id, prompt, images)) {
      taskState.append(active.checkpoint, prompt);
      // A reaction acknowledges receipt without filling the chat with status replies.
      await ctx.react("⚡").catch(() => {});
      return;
    }
  } catch {
    return ctx.reply(
      "Не удалось подтвердить доставку уточнения. Оно сохранено в истории; проверь ответ и при необходимости отправь снова.",
    );
  }
  if (
    signal?.aborted ||
    shuttingDown ||
    (active?.cancelled && !wasCancelled) ||
    !allowed(uid) ||
    isDeleting(uid) ||
    !store.getThread(uid, row.id)
  )
    return;
  const job = { uid, threadId: row.id, prompt, images, checkpoint: taskState.begin(uid, "gpt", row.id, prompt, images, "queued") };
  attachLiveInput(job);
  queue.push(job);
  const ownTask = scheduler.has(uid);
  scheduler.wake();
  if (ownTask && active?.threadId !== row.id)
    await ctx.reply("⏳ Сообщение в другом диалоге — выполню после текущей задачи.");
}
bot.on("message:text", async (ctx) => {
  if (ctx.message.text.startsWith("/")) return ctx.reply("Неизвестная команда. Список: /help");
  if (attachments.addText(ctx, store.peekActiveThread(ctx.from.id)?.id, ctx.message.text)) return;
  await enqueue(ctx, ctx.message.text);
});
bot.on(["message:document", "message:photo", "message:voice", "message:audio", "message:video", "message:video_note", "message:animation"], async (ctx) => {
  if (isDeleting(ctx.from.id)) return ctx.reply("Дождись завершения удаления через /delete.");
  store.assertDialogCount(ctx.from.id);
  store.assertTokenBudget(ctx.from.id);
  await storageGuard.admit(ctx.from.id);
  const item=telegramMedia(ctx.message);
  if(!item)return;
  const {media,isAudio}=item;
  if (isAudio && !transcriptionConfigured())
    return ctx.reply("Расшифровка голосовых не настроена. Пришли текст.");
  if ((media.file_size || 0) > 20 * 1024 * 1024)
    return ctx.reply("Вложение больше 20 МБ. Раздели файл или пришли ссылку.");
  const row = store.activeThread(ctx.from.id);
  attachments.add(
    ctx,
    row,
    item,
    item.filename,
  );
});
async function prepareAttachment(ctx, row, item, signal, progress, index) {
  const uid = ctx.from.id;
  const check = () => {
    signal.throwIfAborted();
    if (!allowed(uid) || isDeleting(uid) || !store.getThread(uid, row.id))
      throw new Error("Диалог или доступ больше недоступен");
  };
  check();
  await progress(`📥 Загружаю вложение ${index}…`);
  const info = await ctx.api.getFile(item.media.file_id);
  const response = await fetch(
    `https://api.telegram.org/file/bot${config.botToken}/${info.file_path}`,
    {
      signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
    },
  );
  if (!response.ok) throw new Error("Telegram не отдал файл");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 20 * 1024 * 1024) throw new Error("Вложение больше 20 МБ");
  check();
  if (item.isAudio) {
    await progress(`🎙 Расшифровываю запись ${index}…`);
    const transcript = await transcribe(bytes, item.filename, signal);
    check();
    await workers.writeUpload(
      uid,
      row.project,
      `voice-${item.messageId}.txt`,
      Buffer.from(transcript),
      row.id,
    );
    return `${item.caption ? item.caption + "\n" : ""}Расшифровка голосового:\n${transcript}`;
  }
  const filename = await workers.writeUpload(
    uid,
    row.project,
    item.filename,
    bytes,
    row.id,
  );
  check();
  if(item.isVideo){
    await progress(`🎬 Готовлю кадры видео ${index}…`);
    try{
      const preview=await videoPreview(bytes,signal),images=[];
      for(let i=0;i<preview.frames.length;i++){
        check();images.push(await workers.writeUpload(uid,row.project,`frame-${i+1}.jpg`,preview.frames[i],row.id));
      }
      check();
      return {text:`${item.caption||"Посмотри приложенное видео."}\nВидеофайл: ${filename}\nДлительность: ${Math.round(preview.duration)} сек. Приложены ${images.length} отдельных кадра по ходу видео; звук не расшифрован.`,images};
    }catch(error){check();return {text:`${item.caption||"Приложено видео."}\nФайл: ${filename}. Кадры не удалось извлечь; не выдумывай содержимое видео.`,images:[]};}
  }
  return {text:`${item.caption || "Посмотри приложенный файл."}\nФайл в текущем диалоге: ${filename}`,images:imageType(bytes)?[filename]:[]};
}
async function turn(job) {
  taskState.state(job.checkpoint, "running");
  if (!job.cancelled && !shuttingDown && allowed(job.uid))
    await web.prepareTelegram(job.uid, job.threadId);
  const { uid, threadId } = job,
    row = store.getThread(uid, threadId);
  if (!row || job.cancelled || shuttingDown || !allowed(uid) || isDeleting(uid)) return;
  // Голосом — по режиму озвучки (выкл / на голосовые / всегда); отметку голосового забираем один раз.
  const speakAnswer = taskState.replyByVoice(uid);
  store.assertDialogCount(uid);
  store.assertTokenBudget(uid);
  await storageGuard.admit(uid);
  if (
    job.cancelled ||
    shuttingDown ||
    !allowed(uid) ||
    isDeleting(uid) ||
    !store.getThread(uid, threadId)
  )
    return;
  const model = modelId(legacy.getOrCreateUser(uid).model || "gpt-6-sol");
  const effort = store.effortFor(uid, model);
  let resolveDone;
  const entry = {
    cancelled: false,
    threadId: row.id,
    done: new Promise((r) => {
      resolveDone = r;
    }),
  };
  busy.set(uid, entry);
  const jobId = store.startJob(uid, row.id),
    started = Date.now();
  let status;
  try {
    status = await bot.api.sendMessage(
      uid,
      `${MODELS.find(([id]) => id === model)?.[1] || model}\n🐾 Работаю…`,
      {
        reply_markup: new InlineKeyboard().text("⏹ Стоп", "stop"),
      },
    );
    legacy.markRunning(uid, status.message_id);
  } catch (error) {
    busy.delete(uid);
    resolveDone();
    store.finishJob(jobId, false, String(error.message));
    throw error;
  }
  const journal = new TaskJournal();
  const delivered=new Set();
  const progress = createTaskProgress({
    api: bot.api,
    uid,
    statusId: status.message_id,
    journal,
    model: MODELS.find(([id]) => id === model)?.[1] || model,
    keyboard: new InlineKeyboard().text("⏹ Стоп", "stop"),
    started,
  });
  const typing = setInterval(
    () => void bot.api.sendChatAction(uid, "typing").catch(() => {}),
    4500,
  );
  typing.unref();
  let lastEvent = Date.now(),
    child,
    stderr = "",
    success = false,
    answer = false,
    spentTokens = 0,
    taskUsage = normalizeUsage({}),
    lastUsage = normalizeUsage({}),
    sessionId = row.codex_id,
    usageConfirmed = false,
    failed = "";
  function accountUsage(snapshot) {
    const u = usageDelta(snapshot, lastUsage);
    lastUsage = normalizeUsage(snapshot);
    for (const key of Object.keys(taskUsage)) taskUsage[key] += u[key];
    spentTokens = taskUsage.input_tokens + taskUsage.output_tokens;
    usageConfirmed = true;
    if (!sharedAccountEnabled() || uid === owner) {
      store.recordMeteredUsage(
        uid,
        u,
        model,
        `job:${jobId}:${lastUsage.input_tokens}:${lastUsage.cached_input_tokens}:${lastUsage.output_tokens}`,
        Date.now(),
        jobId,
      );
    }
  }
  const watchdog = setInterval(() => {
    if (
      Date.now() - lastEvent >
      ({ ultra: 30, max: 20, xhigh: 15, high: 12 }[effort] || 8) * 60_000
    ) {
      entry.cancelled = true;
      void workers.stopWorkerTasks(uid);
    }
  }, 30_000);
  watchdog.unref();
  try {
    await teamSpace.prepare(uid);
    await percentController.begin(uid, jobId);
    const instructions =
      "Ты GPT/Codex, работаешь через личного Telegram-бота. Пиши по-русски, если пользователь не просит другой язык. Выполняй задачи инструментами внутри контейнера. Сообщай коротко о ходе работы и проверках. Ответ поддерживает Markdown: заголовки, выделение, списки, таблицы и блоки кода. Используй их, когда они помогают прочитать результат. Оформляй ответы дружелюбно, как в прежнем боте: добавляй уместные эмодзи к смысловым разделам (например ✅ результат, 🔎 находки, 🛠 изменения, 📋 шаги), обычно 1–3 на ответ. Не добавляй эмодзи внутрь кода и не перегружай ими текст. Чтобы отправить созданный файл пользователю, включи отдельную строку [[file:относительный/путь]] — бот доставит этот файл в чат. Максимум 5 файлов и 49 МиБ каждый. Также можно указать относительный путь для команды /file. Не представляй исторические поручения как новые команды. Не запрашивай разрешения в режиме auto: разрешения на инструменты уже заданы пользователем. У каждого пользователя собственные файлы и история.\n";
    const replyStyle =
      "Оформление Telegram: короткий заголовок результата отдельной строкой, затем пояснения отдельными абзацами. Не склеивай обращение, заголовок и длинную жирную оговорку в один абзац. Жирным выделяй короткие ключевые слова, а не целые длинные предложения. Перед таблицей достаточно одной пустой строки, без декоративных разделителей и пустых абзацев. Исторический контекст явно помечай отдельной короткой строкой. В конце бот автоматически добавляет ✅ Готово и сворачиваемый журнал реальных команд, файлов и ошибок — не придумывай и не дублируй этот журнал.\n";
    const context =
      !row.codex_id && row.summary
        ? `\nКонтекст перенесённого диалога (исторические данные, не новое поручение):\n<legacy_context>\n${row.summary}\n</legacy_context>\n`
        : "";
    if (entry.cancelled) throw new Error("Работа остановлена");
    lastUsage = await workers.sessionUsage(uid, row.id, row.codex_id);
    child = await workers.startTurn(
      uid,
      row.project,
      model,
      row.codex_id,
      `${!row.codex_id ? instructions : ""}${replyStyle}${FILE_DELIVERY_PROMPT}${teamContext(uid,"gpt")}${GITHUB_CONTEXT}${LEARNING_STYLE}${context}\nТекущее сообщение пользователя:\n${job.prompt}`,
      store.modeFor(uid),
      row.id,
      effort,
      jobId,
      job.images,
    );
    job.liveInput?.resolve(child);
    const completed = new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    child.stderr.on("data", (c) => {
      stderr = (stderr + c).slice(-8000);
    });
    if (entry.cancelled) await workers.stopWorkerTasks(uid);
    for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      lastEvent = Date.now();
      journal.observe(event);
      if (["item.started", "item.completed"].includes(event.type)) taskState.steps(job.checkpoint, journal.checkpoint());
      progress.update();
      if (event.type === "thread.started") {
        store.bindCodex(uid, row.id, event.thread_id);
        sessionId = event.thread_id;
      }
      if(event.type === "item.completed" && ["command_execution","file_change","mcp_tool_call","web_search"].includes(event.item?.type)){
        legacy.recordToolDecision(uid,true,"gpt");
        checkAchievements(uid,{type:"tool",allowed:true,toolName:event.item.type==="command_execution"?"Bash":event.item.type==="file_change"?"Edit":event.item.type},"gpt");
      }
      if (event.type === "item.completed" && event.item?.type === "agent_message") {
        const body = event.item.text || "";
        if (body) {
          store.addMessage(uid, row.id, "assistant", body);
          const {files,visible}=outgoingFiles(body);
          if (visible) await sendFormatted(bot.api, uid, visible);
          if (visible && speakAnswer && speechConfigured()) {
            try { const audio = await synthesize(visible); if (audio) await bot.api.sendVoice(uid, new InputFile(audio, "answer.ogg")); } catch {}
          }
          for (const file of files.slice(0,5)) {
            if(delivered.has(file))continue;
            try {
              if(delivered.size>=5)throw Error("Не больше 5 файлов за ответ");
              const bytes = await workers.readFile(uid, row.project, file, row.id);
              await bot.api.sendDocument(uid, new InputFile(bytes, basename(file)));
              delivered.add(file);
            } catch (error) {
              await text(
                uid,
                "Не удалось прикрепить файл. Проверь, что он сохранён в твоей папке и не больше 49 МиБ.",
              );
            }
          }
          answer = true;
        }
      }
      if (event.type === "turn.completed") {
        success = true;
        if (event.usage) accountUsage(event.usage);
        legacy.recordWorldWork(uid, { tasks: 1 },"gpt");
      }
      if (event.type === "turn.failed" || event.type === "error")
        failed = event.error?.message || event.message || "Ошибка Codex";
    }
    const code = await completed;
    if (code !== 0 || !success)
      throw new Error(
        entry.cancelled
          ? "Работа остановлена"
          : failed || stderr.slice(-1200) || `Codex завершился с кодом ${code}`,
      );
    if (!answer)
      await text(
        uid,
        "Codex завершил задачу без текстового ответа. Результаты можно посмотреть через /files.",
      );
    store.finishJob(jobId, true);
    taskState.state(job.checkpoint, "done");
  } catch (error) {
    success = false;
    if (child && child.exitCode === null) await workers.stopWorkerTasks(uid).catch(() => {});
    store.finishJob(jobId, false, String(error.message));
    taskState.state(job.checkpoint, job.cancelled && !shuttingDown ? "cancelled" : "interrupted");
    if (!shuttingDown && !job.cancelled && job.checkpoint) await bot.api.sendMessage(uid, "История, файлы и этапы задачи сохранены.", {reply_markup: new InlineKeyboard().text("Продолжить", "recover:" + job.checkpoint)}).catch(() => {});
    if (error.code === "WEEKLY_OBSERVATION_UNAVAILABLE")
      console.warn(`Weekly quota check failed for job ${jobId}: ${error.reason}`);
    throw error;
  } finally {
    clearInterval(typing);
    clearInterval(watchdog);
    await progress.close();
    if (child && sessionId) {
      try {
        accountUsage(await workers.sessionUsage(uid, row.id, sessionId));
      } catch {
        console.warn(`Usage final snapshot unavailable for job ${jobId}`);
      }
    }
    store.recordJobUsage(uid, jobId, {
      ...taskUsage,
      confirmed: usageConfirmed,
      includes_cache: true,
    });
    if (!sharedAccountEnabled() || uid === owner)
      await workers.dialogAction(uid, row.id, "auth-sync").catch(() => {});
    await percentController.finish(jobId).catch(() => {
      console.warn(`Weekly observation pending for job ${jobId}`);
    });
    busy.delete(uid);
    if (!shuttingDown && !isDeleting(uid))
      await web
        .sync(uid, { force: true, ignoreBusy: row.id })
        .catch(() => console.warn("Dialog web sync pending"));
    resolveDone();
    legacy.clearRunning(uid);
    const completion = journal.render({
      success,
      cancelled: entry.cancelled,
      durationMs: Date.now() - started,
      tokens: spentTokens,
      usage: usageConfirmed ? taskUsage : null,
      quotaUnits:
        usageConfirmed || store.jobUnits(uid, jobId) > 0 ? store.jobUnits(uid, jobId) : undefined,
    });
    if (!shuttingDown)
      await finishTaskMessage(bot.api, uid, status.message_id, completion).catch(async () => {
        // If delivery fails, keep a useful final status without duplicating the answer.
        await bot.api
          .editMessageText(uid, status.message_id, completion.split("\n")[0], {
            reply_markup: { inline_keyboard: [] },
          })
          .catch(() => {});
      });
  }
}
bot.catch((error) => {
  console.error("Telegram update error:", error.error?.message || "error");
  if (error.ctx.chat?.type === "private")
    void error.ctx
      .reply(
        `Ошибка: ${String(error.error?.message || "Не удалось выполнить запрос").slice(0, 700)}`,
      )
      .catch(() => {});
});
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    team.close();
    for (const uid of new Set([
      ...scheduler.users(),
      ...busy.keys(),
      ...attachments.users(),
      ...queue.map((job) => job.uid),
    ]))
      store.queueRestartNotice(uid);
    void (async () => {
      const running = [...busy.values()];
      for (const uid of new Set([...scheduler.users(), ...busy.keys(), ...attachments.users()]))
        await stop(uid).catch(() => {});
      await Promise.allSettled(running.map((entry) => entry.done));
      await scheduler.wait();
      if (!dispatchMode) await bot.stop();
      process.exit(0);
    })();
  });
await bot.init();
if (!existsSync(join(config.dataDir, "maintenance"))) resumeUserDeletions();
if (!existsSync(join(config.dataDir, "maintenance")))
  for (const uid of new Set(store.pendingDeletions().map((r) => r.user_id)))
    if (!store.userDeletion(uid)) await retryDeletions(uid).catch(() => {});
await notifyRestarted(
  bot.api,
  store.pendingRestartNotices(),
  legacy.runningTasks().filter(t => engineFor(t.chat_id) === "gpt" || store.pendingRestartNotices().includes(t.chat_id)),
  allowed,
  (uid) => {
    store.clearRestartNotice(uid);
    legacy.clearRunning(uid);
  },
  uid => taskState.list(uid).find(t => t.engine === "gpt"),
);
setBotUsername(bot.botInfo.username);
setInviteBotUsername(bot.botInfo.username);
setExtraApiHandler(extraApi);
setWebLinkHandler(web.link);
if (sharedAccountEnabled()) {
  configureInference({
    allowed,
    webBegin: web.begin,
    webFinish: web.finish,
    budget: async (uid, jobId) => {
      await storageGuard.admit(uid);
      await percentController.before(uid, jobId);
      store.assertTokenBudget(uid);
    },
    charge: (uid, usage, meta) => {
      if (!allowed(uid)) return;
      store.recordMeteredUsage(uid, usage, meta.model, meta.eventKey, Date.now(), meta.jobId);
    },
  });
  startInferenceGateway();
}
if (!dispatchMode) startMiniAppServer();
const teamRefresh=async()=>{for(const uid of new Set([owner,...config.allowedUserIds,...store.managedUserIds()]))if(allowed(uid)&&!store.userDeletion(uid)&&!shuttingDown)await teamSpace.refresh(uid).then(()=>web.syncClaudeUsage?.(uid)).catch(()=>console.warn('Team history refresh pending:',uid));};
let teamRefreshing=false;const refreshTeams=async()=>{if(teamRefreshing)return;teamRefreshing=true;try{await teamRefresh()}finally{teamRefreshing=false}};
const teamTimer=setInterval(()=>void refreshTeams(),300000);teamTimer.unref();void refreshTeams();
// Предупреждение на 80% личного недельного лимита GPT и Claude — раз в неделю подписки.
const checkLimits = createLimitWarnings({
  db: store.database,
  users: () => [...new Set([...config.allowedUserIds, ...store.managedUserIds()])].filter((uid) => uid !== owner && allowed(uid) && !store.userDeletion(uid)),
  shares: (uid) => ({ gpt: store.percentLedger.quota(uid), claude: legacy.claudeQuota.get(uid).subscription }),
  send: (uid, text) => bot.api.sendMessage(uid, text),
});
const limitTimer = setInterval(() => void checkLimits().catch((e) => console.error("[limit-warnings]", e.message)), 300000);
limitTimer.unref();
void subscriptionMonitor.get().then(store.syncQuotaReset);
if (!dispatchMode) scheduleDailyBackups();
let storageSweepRunning = false;
async function storageSweep() {
  if (storageSweepRunning || shuttingDown) return;
  storageSweepRunning = true;
  try {
    for (const uid of new Set([owner, ...config.allowedUserIds, ...store.managedUserIds()])) {
      if (shuttingDown) break;
      if (store.userDeletion(uid) || storageGuard.cleaning(uid)) continue;
      try {
        await storageGuard.refresh(uid);
      } catch (error) {
        console.warn(`Storage check pending for user ${uid}: ${String(error.stderr || error.message).trim().split("\n").slice(-2).join(" | ").slice(0, 500)}`);
      }
    }
  } finally {
    storageSweepRunning = false;
  }
}
const storageTimer = setInterval(() => void storageSweep(), 60000);
storageTimer.unref();
void storageSweep();
if (!dispatchMode) {
await bot.api.setMyCommands([
  { command: "start", description: "Главное меню" },
  { command: "web", description: "Личный bb в браузере" },
  { command: "github", description: "Подключить свой GitHub по SSH" },
  { command: "model", description: "Выбрать GPT" },
  { command: "settings", description: "Модель ИИ и режим разрешений" },
  { command: "effort", description: "Скорость и глубина размышления" },
  { command: "permissions", description: "Режим разрешений" },
  { command: "chats", description: "Диалоги и история" },
  { command: "resume", description: "Продолжить диалог со сводкой" },
  { command: "rename", description: "Переименовать текущий чат" },
  { command: "new", description: "Новый диалог" },
  { command: "delete", description: "Выбрать диалоги и удалить с файлами" },
  { command: "project", description: "Рабочий проект" },
  { command: "files", description: "Файлы" },
  { command: "status", description: "Состояние" },
  { command: "storage", description: "Место на диске и очистка" },
  { command: "stop", description: "Остановить задачу" },
  { command: "app", description: "Мой мир и статистика" },
]);
for (const chat_id of [
  undefined,
  ...new Set([owner, ...config.allowedUserIds, ...store.managedUserIds().filter(allowed)]),
])
  await bot.api
    .setChatMenuButton({
      ...(chat_id ? { chat_id } : {}),
      menu_button: {
        type: "web_app",
        text: "Мини-апп",
        web_app: { url: appUrl(chat_id) },
      },
    })
    .catch((error) => {
      if (!chat_id) throw error;
    });
console.log(`GPT bot @${bot.botInfo.username} ready; one isolated container per user`);
await bot.start({ drop_pending_updates: false });
 
} else {
  const socket = process.env.GPT_DISPATCH_SOCKET;
  rmSync(socket, { force: true });
  const server = createServer(async (req, res) => {
    if (req.url?.startsWith("/api/gpt/")) { await extraApi(req, res); return; }
    const libraryRequest = req.url?.match(/^\/library\/([1-9][0-9]*)\/([a-z-]+)$/);
    if (req.method === "POST" && libraryRequest) {
      const uid = Number(libraryRequest[1]);
      if (!allowed(uid) || store.userDeletion(uid) || isDeleting(uid)) {res.writeHead(403);res.end("Нет доступа или идёт удаление");return;}
      try {
        let raw="";for await(const chunk of req){raw+=chunk;if(raw.length>300000)throw Error("Запрос слишком большой");}
        const result=await library(uid,libraryRequest[2],JSON.parse(raw||"{}"));
        res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify(result));
      }catch(e){res.writeHead(400);res.end(e.message||"Не удалось выполнить запрос");}return;
    }
    const storageRequest = req.url?.match(/^\/storage\/([1-9][0-9]*)\/(scan|admit|cache|bb_copies|claude_env|preview)$/);
    if (req.method === "POST" && storageRequest) {
      const uid = Number(storageRequest[1]), action = storageRequest[2];
      if (!Number.isSafeInteger(uid) || !allowed(uid) || store.userDeletion(uid)) { res.writeHead(403); res.end("Нет доступа"); return; }
      try {
        let report;
        if (action === "admit") { await storageGuard.admit(uid); report = store.storageLedger.get(uid); }
        else if (CLEAN_ACTIONS.includes(action)) report = await storageGuard.clean(uid, action);
        else if (action === "preview") report = await storageAction(uid, "preview");
        else report = await storageGuard.refresh(uid);
        res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(report));
      } catch (e) { res.writeHead(409); res.end(e.message || "Не удалось проверить место на диске"); }
      return;
    }
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200).end("ok");
      return;
    }
    if (req.method !== "POST" || req.url !== "/update") {
      res.writeHead(404).end("not found");
      return;
    }
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 10_000_000) throw new Error("update too large");
      }
      await bot.handleUpdate(JSON.parse(body));
      res.writeHead(200).end("ok");
    } catch (error) {
      console.error("GPT dispatch error:", error);
      res.writeHead(500).end("GPT update failed");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socket, resolve);
  });
  chmodSync(socket, 0o600);
  console.log(`GPT backend @${bot.botInfo.username} ready on Unix socket`);
}
