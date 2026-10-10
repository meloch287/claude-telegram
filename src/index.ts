import { createToolsMenu } from "./bot/tools-menu.js";
import { taskState } from "./bot/task-state.js";
import { setExtraApiHandler } from "./miniapp/server.js";
import { beginClaudeWork } from "./bot/claude-work.js";
import { registerClaudeStorage, isClaudeCleaning, stopClaudeForStorage } from "./bot/claude-storage.js";
import { gptStorage } from "./engine.js";
import { dialogRecord, updateDialog } from "./agent/dialog-workspace.js";
import { registerClaudeDeleteMenu } from "./bot/delete-menu.js";
import { claudeDeleteOperations, isClaudeDeleting } from "./bot/claude-deletion.js";
import { listAllUserSessions, userSessionInfo, userSessionMessages, renameUserSession } from "./agent/session-history.js";
import {isGitHubUpdate} from "./github.js";
import {claudeUsageText} from "./claude-usage.js";
import {imageMime,videoPreview} from "./bot/media.js";
import {readFileSync as readMediaFile} from "node:fs";
import { sendHelp } from "./bot/help.js";
import { ADMIN_ID, isAdmin } from "./admin.js";
import { getModeData } from "./db.js";
import { catForMode } from "./cats.js";
import { claudePreferences, claudeModels, claudeModelLabel, refreshClaudeModels, saveClaudePreferences } from "./claude-settings.js";
import { CACHE_RESET_NOTICE, claudeCacheWarm, reloadClaudeSettings } from "./bot/session.js";
import {
  Bot,
  GrammyError,
  HttpError,
  InlineKeyboard,
  InputFile,
  type CommandContext,
  type Context,
} from "grammy";
import { HttpsProxyAgent } from "https-proxy-agent";
import { statSync, readdirSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import {
  type PermissionMode,
} from "@anthropic-ai/claude-agent-sdk";
import { fetchTelegramFile } from "./bot/tgFile.js";
import { config } from "./config.js";
import {
  clearCredential,
  getCredential,
  getChat,
  credentialFor,
  getOrCreateUser,
  getUsageToday,
  allowUser,
  disallowUser,
  inviterOf,
  isUserAllowedInDb,
  isGptUserAllowed,
  listAllowedUsers,
  listRateLimits,
  quotaLeft,
  setQuota,
  usageSince,
  recordMessage,
  saveChat,
  setDisplayName,
  setModel,
  closeDb,
} from "./db.js";
import { describeKind } from "./auth.js";
import {
  answerQuestion,
  beginDenyComment,
  cancelDenyComment,
  getPermission,
  getQuestion,
  pendingCommentFor,
  hasPending,
  flushChat,
  resolvePermission,
} from "./agent/permissions.js";
import {
  closeAll,
  ensureSession,
  getSession,
  resetSession,
  restartSessionsForChannelChange,
  switchProject,
  workspaceFor,
  backgroundTasks,
  startBackgroundTask,
  stopBackgroundTask,
} from "./bot/session.js";
import {
  acceptCredential,
  askForCredential,
  awaitingKindFor,
  finishLogin,
  sendStart,
  startAwaiting,
  stopAwaiting,
} from "./bot/onboarding.js";
import { MODELS, commitKeyboard } from "./bot/keyboards.js";
import { isScreenId, renderScreen, type ScreenId } from "./bot/screens.js";
import { checkAchievements, renderUnlocked, unlockedIds } from "./achievements.js";
import { ACHIEVEMENTS, CAT_LEVELS, catForTokens, formatTokens, nextCat } from "./cats.js";
import { esc, prepareRichMarkdown, details, fence } from "./agent/render.js";
import { limitTitle, percentOf, toMillis, WINDOWS } from "./limits.js";
import { subscriptionUsage } from "./subscription-usage.js";
import { saveTelegramFile, saveAttachment } from "./bot/attachments.js";
import { transcribe, transcriptionConfigured, TranscriptionNotConfigured } from "./bot/voice.js";
import { formatSize } from "./bot/artifacts.js";
import { cloneRepository } from "./bot/repos.js";
import {
  commitAll,
  diff as gitDiff,
  findRepos,
  status,
  suggestCommitMessage,
  type RepoStatus,
} from "./bot/git.js";
import { setBotUsername, setWorldNotifier, startMiniAppServer } from "./miniapp/server.js";
import { isWorkflowCommand, listWorkflows, syncAllWorkflows } from "./claude-workflows.js";
import { scheduleDailyBackups } from "./backup.js";
import {
  activeChannel,
  chooseChannel,
  describeChannel,
  parsePool,
  setActiveChannel,
  startChannelWatch,
} from "./proxy.js";
import { startFileLog, tailLog } from "./log.js";
import { engineFor, setEngine, gptReady, forwardToGpt, type Engine } from "./engine.js";
import { requestWorker } from "./claude-workers.js";
import { runningTasks, clearRunning } from "./db.js";
import { startBbBridge } from "./bb-bridge.js";
import { engineAllowed, engineClosedText } from "./engine-access.js";

// Раньше всего остального: иначе первые же строки о выборе канала и о том,
// что пошло не так на старте, в файл не попадут — а именно они нужны, когда
// бот не поднялся.
startFileLog();

/**
 * Канал до Telegram.
 *
 * Раньше grammY ходил в api.telegram.org напрямую, и на этом хосте запросы
 * стабильно отваливались по таймауту (`connect ETIMEDOUT 149.154.167.220`):
 * бот молча переставал отвечать, а пользователи видели «не работает».
 * Одно время Telegram гнали через тот же прокси-пул, что и Anthropic. Так бот
 * стал зависеть от прокси целиком: падал канал — и бот терял не только доступ к
 * модели, но и связь с людьми. А с этого хоста api.telegram.org отвечает
 * напрямую. Поэтому по умолчанию идём прямо, а TELEGRAM_PROXY остаётся
 * запасным выходом на случай, когда прямой снова начнёт отваливаться.
 */
function telegramFetchOptions(): { agent: HttpsProxyAgent<string> } | undefined {
  const url = (process.env.TELEGRAM_PROXY ?? "").trim();
  if (!url) return undefined;
  console.log(`📮 Telegram через прокси: ${url}`);
  return { agent: new HttpsProxyAgent(url) };
}

/**
 * Свой сервер Bot API, если он поднят.
 *
 * Облачный отдаёт ботам файлы не больше 20 МБ и принимает не больше 50 —
 * поэтому архив на сорок мегабайт до бота просто не доходил.
 */
const apiRoot = (process.env.TELEGRAM_API_ROOT ?? "").trim();

const tgFetch = telegramFetchOptions();
const bot = new Bot(config.botToken, {
  client: {
    ...(apiRoot ? { apiRoot } : {}),
    ...(tgFetch ? { baseFetchConfig: tgFetch } : {}),
  },
});

/**
 * Сеть до телеграма иногда отваливается на несколько секунд. Без повтора
 * ответ пропадает совсем: человек видит «печатает», потом тишину и пишет
 * «ау». Повторяем отправку — телеграм отвечает отказом (GrammyError) на
 * настоящие ошибки, а сюда попадают только обрывы связи.
 */
bot.api.config.use(async (prev, method, payload, signal) => {
  const паузы = [1000, 3000, 7000];
  for (let попытка = 0; ; попытка += 1) {
    try {
      return await prev(method, payload, signal);
    } catch (error) {
      const сетевая = error instanceof HttpError;
      if (!сетевая || /^(?:send|forward|copy)/.test(method) && method !== "sendChatAction" || попытка >= паузы.length) throw error;
      console.warn(`[tg] ${method}: связь оборвалась, повтор через ${паузы[попытка]} мс`);
      await new Promise((готово) => setTimeout(готово, паузы[попытка]));
    }
  }
});

/** Владелец — первый в списке из .env. Он один распоряжается доступом. */
function ownerId(): number | undefined {
  return ADMIN_ID;
}

/**
 * Кому можно пользоваться ботом: список из .env плюс выданные из чата.
 *
 * Список из .env главный и неотзываемый — он остаётся последним рубежом, если
 * базу потеряли или испортили. Выданное командой /admin лежит в базе и
 * отзывается там же.
 */
function isAllowed(userId: number): boolean {
  return isGptUserAllowed(userId);
}

taskState.recover("claude");
const toolsMenu = createToolsMenu({
  api: bot.api,
  activeClaude(uid) { workspaceFor(uid, getChat(uid)?.project || "default"); return getChat(uid)!.session_id!; },
  async openClaude(uid, id) {
    if (isClaudeDeleting(uid) || isClaudeCleaning(uid) || getSession(uid)?.conversation.busy) throw Error("Дождись завершения текущей задачи или нажми /stop");
    const record = dialogRecord(uid, id);
    if (!record) throw Error("Диалог удалён или недоступен");
    const current = getChat(uid);
    if (current?.session_id === id) return;
    await resetSession(uid, uid);
    saveChat({ chatId: uid, userId: uid, project: record.project, sessionId: id, title: record.title, permissionMode: current?.permission_mode ?? config.defaultPermissionMode });
  },
  async submitClaude(ctx, text, images) {
    if (!await requireLogin(ctx)) return false;
    const done = beginClaudeWork(ctx.from!.id);
    try { return await runTask(ctx, text, images); } finally { done(); }
  },
});
setExtraApiHandler(toolsMenu.api);

/** Один токен и один поток Telegram updates для обоих движков. */
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  // Приглашение гасит GPT-часть (invites.mjs), а новичка ещё нет в списке доступа:
  // без этой ветки его встречал отказ ниже и ссылка не срабатывала.
  if (userId !== undefined && ctx.chat?.type === "private" && !isAllowed(userId) && /^\/start(?:@\w+)?\s+invite_\S+\s*$/.test(ctx.message?.text ?? "")) {
    try {
      await forwardToGpt(ctx.update);
      if (isAllowed(userId)) requestWorker(userId);
    } catch (error) {
      console.error("[invite] GPT dispatch failed:", error);
      await ctx.reply("Не получилось принять приглашение. Попробуй открыть ссылку ещё раз через минуту.").catch(() => {});
    }
    return;
  }
  if (userId === undefined || ctx.chat?.type !== "private" || !isAllowed(userId)) {
    await next();
    return;
  }
  if (isClaudeDeleting(userId) || isClaudeCleaning(userId)) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery("Удаляю чаты Claude. Подожди немного.");
    else await ctx.reply("Удаляю чаты Claude. Подожди немного.");
    return;
  }
  if (await toolsMenu.handle(ctx)) return;
  const deleteMode = (ctx.callbackQuery?.data?.startsWith("cdel:") || ctx.callbackQuery?.data?.startsWith("cdisk:")) ? "claude" : ctx.callbackQuery?.data?.startsWith("del:") ? "gpt" : null;
  if (deleteMode && engineFor(userId) !== deleteMode) {
    await ctx.answerCallbackQuery("Режим изменился. Открой /delete заново.");
    return;
  }
  const command = ctx.message?.text?.trim() ?? "";
  if(/^\/start(?:@\w+)?\s+usage_claude$/i.test(command)){
    await ctx.reply(await claudeUsageText(userId));return;
  }
  if (ctx.callbackQuery?.data === "claude:stop") {
    await ctx.answerCallbackQuery();
    await getSession(ctx.chat.id)?.conversation.interrupt();
    return;
  }
  const callback = ctx.callbackQuery?.data?.startsWith("engine:")
    ? ctx.callbackQuery.data.slice("engine:".length)
    : null;
  if (callback) {
    const raw = callback.trim().toLowerCase();
    if (callback) await ctx.answerCallbackQuery();
    if (raw === "claude" || raw === "gpt") {
      const engine = raw as Engine;
      if (engine === "gpt" && !isGptUserAllowed(userId)) {
        await ctx.reply("Для твоего аккаунта доступ к GPT закрыт.");
        return;
      }
      if (engine === "gpt" && !(await gptReady())) {
        await ctx.reply("GPT пока недоступен. Claude Code продолжает работать.");
        return;
      }
      setEngine(userId, engine);
      await ctx.reply(
        engine === "claude"
          ? "Клод бот"
          : "GPT бот",
      );
      return;
    }
    await ctx.reply(`Сейчас: ${engineFor(userId) === "claude" ? "Claude Code" : "GPT Codex"}. Выбери режим:`, {
      reply_markup: new InlineKeyboard()
        .text("Claude Code", "engine:claude")
        .text("GPT Codex", "engine:gpt"),
    });
    return;
  }
  const workflowsList = /^\/workflows(?:@\w+)?(?:\s|$)/i.test(command);
  if (!workflowsList && (ctx.callbackQuery?.data === "stop" || isGitHubUpdate(command, ctx.callbackQuery?.data) || engineFor(userId) === "gpt" || /^\/(?:web|webapp)(?:@\w+)?(?:\s|$)/i.test(command))) {
    if (!isGptUserAllowed(userId)) {
      setEngine(userId, "claude");
      await ctx.reply("Доступ к GPT закрыт. Режим переключён на Claude Code.");
      return;
    }
    try {
      await forwardToGpt(ctx.update);
    } catch (error) {
      console.error("[engine] GPT dispatch failed:", error);
      await ctx.reply("GPT временно недоступен. Выбрать Claude — /start.").catch(() => {});
    }
    return;
  }
  await next();
});

/** Доступ. Без белого списка бот отдаёт шелл кому угодно, поэтому проверка идёт первой. */
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (userId === undefined) return;
  // Имя пригодится в таблице коопа. Пишем на каждом сообщении: человек может
  // его сменить, и прошлогоднее показывало бы соседям не того.
  if (isAllowed(userId)) {
    const имя = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ");
    setDisplayName(userId, имя || ctx.from?.username || null);
  }

  if (!isAllowed(userId)) {
    // Свой номер человеку виден: владельцу он нужен, чтобы добавить его,
    // а посторонний узнаёт только то, что и так знает про себя.
    await ctx.reply("ЗДЕСЬ ЗАНЯТО!!! ВЫШЕЛ НАХУЙ ОТСЮДА");
    return;
  }
  await next();
});

/**
 * В группе бот не должен отвечать на каждую реплику.
 *
 * Белый список закрывает доступ, но не болтливость: в общем чате двух
 * совладельцев бот иначе влезал бы в любой разговор. Поэтому в группах он
 * отзывается только на обращение — упоминание, ответ на его сообщение или
 * команду.
 */
bot.use(async (ctx, next) => {
  const chat = ctx.chat;
  if (!chat || chat.type === "private") {
    await next();
    return;
  }

  const message = ctx.message;
  if (!message) {
    await next();
    return;
  }

  const text = message.text ?? message.caption ?? "";
  const username = ctx.me.username;
  const addressed =
    text.startsWith("/") ||
    (username && text.includes(`@${username}`)) ||
    message.reply_to_message?.from?.id === ctx.me.id;

  if (!addressed) return;
  await next();
});

bot.use(async (ctx, next) => {
  const text = ctx.message?.text || "";
  const needsSpace = ctx.message && (!text.startsWith("/") || /^\/(?:bg|clone|commit)(?:\s|$)/.test(text));
  if (ctx.chat?.type === "private" && needsSpace) {
    const end = beginClaudeWork(ctx.from!.id);
    try {
      try { await gptStorage(ctx.from!.id, "admit"); }
      catch (e) { await ctx.reply(e instanceof Error ? e.message : "Проверь место через /storage."); return; }
      await next();
    } finally { end(); }
    return;
  }
  await next();
});

// ── Вход ─────────────────────────────────────────────────────────────────────

bot.command("start", async (ctx) => {
  await sendStart(ctx);
});

bot.command("help", async (ctx) => {
  await sendHelp(ctx, "claude");
});

/** Готовые воркфлоу Claude Code: оркестрация субагентов одной командой. */
bot.command("workflows", async (ctx) => {
  const list = listWorkflows(ctx.from!.id);
  if (!list.length) {
    await ctx.reply("Готовые воркфлоу работают в режиме Claude Code. Переключиться — /start.");
    return;
  }
  const lines = list.map((w) => `/${w.name} — ${esc(w.description)}`);
  await ctx.reply(
    "<b>Готовые воркфлоу</b>\n\nКаждый раскладывает задачу на субагентов и перепроверяет результат.\n\n" +
      lines.join("\n\n") +
      "\n\nНапиши команду и задачу, например: <code>/review</code> или <code>/plan перевести бота на вебхуки</code>. " +
      "Можно и словами: «сделай ревью воркфлоу». Без включённой оркестрации запуск подтверждают кнопкой." +
      (engineFor(ctx.from!.id) === "gpt" ? "\n\nСейчас выбран GPT — воркфлоу работают в режиме Claude, переключиться: /start." : ""),
    { parse_mode: "HTML" },
  );
});

bot.command("logout", async (ctx) => {
  const userId = ctx.from!.id;
  // Убираем только свой ключ. Приглашённому убирать нечего: он работает по
  // подписке владельца, и «доступ удалён» ввело бы его в заблуждение —
  // отозвать его может только владелец через /admin.
  const свой = getCredential(userId) !== null;
  clearCredential(userId);
  stopAwaiting(userId);
  await resetSession(ctx.chat.id, userId);
  await ctx.reply(
    свой
      ? "Доступ удалён из базы. Войти заново — /start"
      : credentialFor(userId)
        ? "Своего ключа у тебя и не было: работаешь по подписке владельца. Отозвать её может только он."
        : "Удалять нечего — входа не было.",
  );
});

/**
 * Переходы между экранами. Сообщение перерисовывается на месте, а не шлётся
 * новым: иначе после трёх нажатий чат забит одинаковыми меню.
 */
bot.callbackQuery(/^nav:(.+)$/, async (ctx) => {
  const id = ctx.match[1] ?? "";
  if (!isScreenId(id)) {
    await ctx.answerCallbackQuery("Неизвестный экран");
    return;
  }
  const view = renderScreen(id as ScreenId, { userId: ctx.from.id, chatId: ctx.chat!.id });
  await ctx.answerCallbackQuery();
  await ctx
    .editMessageText(view.text, { parse_mode: "HTML", reply_markup: view.keyboard })
    .catch(() => ctx.reply(view.text, { parse_mode: "HTML", reply_markup: view.keyboard }));
});

bot.callbackQuery("auth:logout", async (ctx) => {
  const userId = ctx.from.id;
  clearCredential(userId);
  stopAwaiting(userId);
  await resetSession(ctx.chat!.id, userId);
  await ctx.answerCallbackQuery("Доступ удалён");
  const view = renderScreen("auth", { userId, chatId: ctx.chat!.id });
  await ctx
    .editMessageText(view.text, { parse_mode: "HTML", reply_markup: view.keyboard })
    .catch(() => undefined);
});

bot.callbackQuery(/^auth:(subscription|api)$/, async (ctx) => {
  const kind = ctx.match[1] === "subscription" ? "subscription" : "api";
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
  startAwaiting(ctx.from.id, kind);
  await askForCredential(ctx, kind);
});

// ── Сессии ───────────────────────────────────────────────────────────────────

bot.command("new", async (ctx) => {
  await resetSession(ctx.chat.id, ctx.from!.id);
  await ctx.reply("🧹 Прошлый чат закрыт. Следующее сообщение начнёт новый.");
});

/** Забрать файл из рабочей папки проекта. */
bot.command("file", async (ctx) => {
  const userId = ctx.from!.id;
  const requested = ctx.match?.toString().trim() ?? "";
  if (!requested) {
    await ctx.reply("Укажи путь: <code>/file отчёт.md</code>", { parse_mode: "HTML" });
    return;
  }

  const chatRow = getChat(ctx.chat.id);
  const cwd = workspaceFor(userId, chatRow?.project ?? "default");
  const target = resolve(cwd, requested);

  // Выход за пределы рабочей папки закрыт: иначе /file ../../.env отдал бы
  // ключи всем, у кого есть доступ к боту.
  if (target !== cwd && !target.startsWith(cwd + sep)) {
    await ctx.reply("⛔ Только файлы внутри проекта.");
    return;
  }

  let info;
  try {
    info = statSync(target);
  } catch {
    await ctx.reply(`Не нашёл <code>${esc(requested)}</code>.`, { parse_mode: "HTML" });
    return;
  }
  if (!info.isFile()) {
    await ctx.reply("Это не файл.");
    return;
  }
  if (info.size > 50 * 1024 * 1024) {
    await ctx.reply(`Файл ${formatSize(info.size)} — Telegram не пропустит больше 50 МБ.`);
    return;
  }

  await ctx.replyWithDocument(new InputFile(target, basename(target)), {
    caption: `<code>${esc(requested)}</code> · ${formatSize(info.size)}`,
    parse_mode: "HTML",
  });
});

/** Насколько заполнено окно контекста — чтобы понимать, когда пора /compact. */
bot.command("context", async (ctx) => {
  const session = getSession(ctx.chat.id);
  if (!session) {
    await ctx.reply("Живого чата нет — контекст пустой.");
    return;
  }
  const usage = await session.conversation.contextUsage();
  if (!usage) {
    await ctx.reply("Не смог узнать заполненность контекста в этой сессии.");
    return;
  }

  // Полоса нагляднее числа, но само число оставляем: по нему принимают решение.
  const filled = Math.min(10, Math.round(usage.percentage / 10));
  const bar = "█".repeat(filled) + "░".repeat(10 - filled);
  const hint =
    usage.percentage >= 80
      ? "\n\nПора сжимать: /compact"
      : usage.percentage >= 50
        ? "\n\nЕщё есть запас."
        : "";
  await ctx.reply(
    `<b>Контекст</b>\n<code>${bar}</code> ${usage.percentage}%\n` +
      `${usage.total.toLocaleString("ru-RU")} из ${usage.max.toLocaleString("ru-RU")} токенов${hint}`,
    { parse_mode: "HTML" },
  );
});

/**
 * Фоновая задача. Основной диалог у чата один, и вторая просьба ждёт своей
 * очереди — это верно для разговора, но мешает, когда хочется запустить долгое
 * «прогони тесты и почини» и продолжать говорить о другом.
 */
bot.command("bg", async (ctx) => {
  if (!(await requireLogin(ctx))) return;
  const chatId = ctx.chat.id;
  const prompt = ctx.match?.toString().trim() ?? "";

  if (!prompt) {
    const running = backgroundTasks(chatId);
    if (running.length === 0) {
      await ctx.reply(
        "Фоновых задач нет.\n\n<code>/bg задача</code> — запустить в фоне, " +
          "не занимая основной диалог.",
        { parse_mode: "HTML" },
      );
      return;
    }
    const lines = running.map((task) => {
      const минут = Math.max(1, Math.round((Date.now() - task.startedAt) / 60000));
      return `№${task.id} · ${минут} мин · <i>${esc(task.prompt.slice(0, 60))}</i>`;
    });
    await ctx.reply(
      `<b>Фоновые задачи</b>\n\n${lines.join("\n")}\n\n<code>/bg стоп НОМЕР</code> — прервать`,
      { parse_mode: "HTML" },
    );
    return;
  }

  const [первое, второе] = prompt.split(/\s+/);
  if (/^(стоп|stop)$/i.test(первое ?? "")) {
    const id = Number(второе);
    if (!Number.isInteger(id)) {
      await ctx.reply("Нужен номер задачи: <code>/bg стоп 1</code>", { parse_mode: "HTML" });
      return;
    }
    const остановлена = await stopBackgroundTask(chatId, id);
    await ctx.reply(остановлена ? `⏹️ Прервал задачу №${id}.` : "Такой задачи нет.");
    return;
  }

  try {
    const id = await startBackgroundTask({
      api: ctx.api,
      chatId,
      userId: ctx.from!.id,
      notify: (html) => ctx.reply(html, { parse_mode: "HTML" }),
      prompt,
    });
    await ctx.reply(
      `🧵 Задача №${id} пошла в фоне. Отчитаюсь, когда закончит — основной диалог свободен.`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ctx.reply(`⚠️ Не запустил: ${esc(message)}`, { parse_mode: "HTML" });
  }
});

bot.command("stop", async (ctx) => {
  const session = getSession(ctx.chat.id);
  if (!session) {
    await ctx.reply("Сейчас нечего останавливать.");
    return;
  }
  await session.conversation.interrupt();
  const unlocked = checkAchievements(ctx.from!.id, { type: "interrupt" });
  await ctx.reply("⏹️ Остановил.");
  if (unlocked.length > 0) await ctx.reply(renderUnlocked(unlocked), { parse_mode: "HTML" });
});

/**
 * Прошлые чаты этого проекта. Сессии Claude Code лежат файлами рядом с рабочей
 * папкой, поэтому список тот же, что показал бы `claude --resume` в терминале.
 */
const claudeDeleteMenu = registerClaudeDeleteMenu(bot, claudeDeleteOperations);
const claudeStorageMenu = registerClaudeStorage(bot, claudeDeleteMenu.open);
bot.callbackQuery(/^disk:/, async ctx => {
  await ctx.answerCallbackQuery();
  if (ctx.callbackQuery.data === "disk:dialogs") await claudeDeleteMenu.open(ctx);
  else await claudeStorageMenu.show(ctx);
});

bot.command("resume", async (ctx) => {
  const userId = ctx.from!.id;
  const chatRow = getChat(ctx.chat.id);
  const project = chatRow?.project ?? "default";

  // «/resume все» — чаты из всех проектов пользователя. Без этого чат,
  // начатый в другом проекте, найти было нельзя вовсе.
  const wantsAll = /^(все|всё|all)$/i.test(ctx.match?.toString().trim() ?? "");

  let sessions;
  try {
    sessions = (await listAllUserSessions(userId))
      .map(item => ({ ...item, project: dialogRecord(userId, item.sessionId)?.project ?? "default" }))
      .filter(item => wantsAll || item.project === project)
      .sort((a, b) => b.lastModified - a.lastModified)
      .slice(0, 10);
  } catch (error) {
    await ctx.reply(`⚠️ Не смог прочитать список чатов: ${esc(String(error).slice(0, 200))}`, {
      parse_mode: "HTML",
    });
    return;
  }

  if (sessions.length === 0) {
    await ctx.reply(
      wantsAll
        ? "Прошлых чатов нет ни в одном проекте. Напиши что-нибудь — начнётся первый."
        : `В проекте <code>${esc(project)}</code> прошлых чатов нет. Напиши что-нибудь — начнётся первый.`,
      { parse_mode: "HTML" },
    );
    return;
  }

  const kb = new InlineKeyboard();
  const lines: string[] = [];
  sessions.forEach((s, index) => {
    const when = new Date(s.lastModified).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    const title = (s.customTitle || s.summary || s.firstPrompt || "без названия").slice(0, 48);
    const where = "project" in s ? ` · ${esc(String(s.project))}` : "";
    lines.push(`${index + 1}. <b>${esc(title)}</b>\n    ${when}${where}`);
    kb.text(`${index + 1}. ${title.slice(0, 28)}`, `rs:${s.sessionId}`).row();
  });

  const heading = wantsAll
    ? "Чаты по всем проектам:"
    : `Чаты проекта <code>${esc(project)}</code> (все — <code>/resume все</code>):`;
  await ctx.reply(`${heading}\n\n${lines.join("\n")}`, {
    parse_mode: "HTML",
    reply_markup: kb,
  });
});

/**
 * Чем закончился прошлый чат.
 *
 * Возвращаясь в чат недельной давности, человек не помнит, на чём встал, и
 * первым делом спрашивает «а что мы тут делали». Показываем последний обмен
 * репликами — этого хватает, чтобы вспомнить, и не приходится листать вверх.
 */
async function lastExchange(userId: number, sessionId: string, cwd: string): Promise<string | null> {
  try {
    const messages = await userSessionMessages(userId, sessionId, cwd);
    if (!messages.length) return null;

    const текст = (m: (typeof messages)[number]): string => {
      const payload = m.message as { content?: unknown } | string | undefined;
      if (typeof payload === "string") return payload;
      const content = (payload as { content?: unknown })?.content;
      if (typeof content === "string") return content;
      if (!Array.isArray(content)) return "";
      return content
        .filter((b): b is { type: string; text: string } => {
          const block = b as { type?: string; text?: string };
          return block?.type === "text" && typeof block.text === "string";
        })
        .map((b) => b.text)
        .join(" ")
        .trim();
    };

    // Идём с конца: последние осмысленные реплики каждой стороны.
    let вопрос = "";
    let ответ = "";
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i]!;
      const t = текст(m).replace(/\s+/g, " ").trim();
      if (!t) continue;
      if (!ответ && m.type === "assistant") ответ = t;
      else if (!вопрос && m.type === "user") вопрос = t;
      if (вопрос && ответ) break;
    }
    if (!вопрос && !ответ) return null;

    const кусок = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
    const parts: string[] = [];
    if (вопрос) parts.push(`<b>Ты:</b> ${esc(кусок(вопрос, 220))}`);
    if (ответ) parts.push(`<b>Я:</b> ${esc(кусок(ответ, 320))}`);
    return parts.join("\n\n");
  } catch {
    // Транскрипт мог не найтись — это не повод ломать возврат в чат.
    return null;
  }
}

bot.callbackQuery(/^rs:(.+)$/, async (ctx) => {
  const sessionId = ctx.match[1] ?? "";
  const userId = ctx.from.id;
  const chatId = ctx.chat!.id;
  const chatRow = getChat(chatId);

  const info = await userSessionInfo(userId, sessionId).catch(() => null);
  if (!info?.cwd) {
    await ctx.answerCallbackQuery("Диалог недоступен. Открой /resume заново.");
    return;
  }
  if (getSession(chatId)?.conversation.busy) {
    await ctx.answerCallbackQuery("Дождись завершения задачи или нажми /stop.");
    return;
  }
  const project = dialogRecord(userId, sessionId)?.project ?? "default";

  // Живой диалог закрываем: продолжать надо именно ту сессию, что выбрали.
  await resetSession(chatId, userId);
  saveChat({
    chatId,
    userId,
    project,
    sessionId,
    title: info.customTitle || info.summary || null,
    permissionMode: chatRow?.permission_mode ?? config.defaultPermissionMode,
  });

  await ctx.answerCallbackQuery("Вернулся в чат");
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);

  // Напоминаем, на чём встали: без этого возврат в чат недельной давности
  // начинается с «а что мы тут делали».
  const cwd = workspaceFor(userId, project);
  const хвост = await lastExchange(userId, sessionId, cwd);
  await ctx.reply(
    хвост
      ? `↩️ Вернулся в этот чат. На чём остановились:\n\n${хвост}\n\nПиши — продолжу.`
      : "↩️ Вернулся в этот чат. Пиши — продолжу с того места.",
    { parse_mode: "HTML" },
  );
});

// ── Настройки ────────────────────────────────────────────────────────────────

async function showScreen(ctx: CommandContext<Context>, id: ScreenId): Promise<void> {
  const view = renderScreen(id, { userId: ctx.from!.id, chatId: ctx.chat.id });
  await ctx.reply(view.text, { parse_mode: "HTML", reply_markup: view.keyboard });
}

bot.command("menu", async (ctx) => showScreen(ctx, "menu"));
bot.command("mode", async (ctx) => showScreen(ctx, "mode"));
bot.command("model", async (ctx) => {
  await refreshClaudeModels(ctx.from!.id).catch(() => {});
  const raw = (ctx.match ?? "").trim();
  if (raw) {
    if (getSession(ctx.chat.id)?.conversation.busy) { await ctx.reply("Дождись завершения задачи или нажми /stop."); return; }
    try {
      const before = claudePreferences(ctx.from!.id).model, warm = claudeCacheWarm(ctx.chat.id);
      const value = saveClaudePreferences(ctx.from!.id, { model: raw });
      await reloadClaudeSettings(ctx.chat.id);
      await ctx.reply(`Модель Claude: ${value.model}${warm && value.model !== before ? "\n\n" + CACHE_RESET_NOTICE : ""}`);
    } catch (error) { await ctx.reply(error instanceof Error ? error.message : "Не удалось выбрать модель"); }
    return;
  }
  await showScreen(ctx, "model");
});
bot.command("effort", async (ctx) => showScreen(ctx, "thinking"));
bot.command("thinking", async (ctx) => showScreen(ctx, "thinking"));


/**
 * Забрать репозиторий в рабочую папку проекта.
 *
 * Без этого агент сидит в пустом каталоге и любая задача про «наш код»
 * упирается в то, что смотреть не на что.
 */
bot.command("clone", async (ctx) => {
  const userId = ctx.from!.id;
  const url = ctx.match?.toString().trim() ?? "";
  if (!url) {
    await ctx.reply(
      "Укажи адрес репозитория:\n<code>/clone https://github.com/user/repo</code>\n\n" +
        "Приватные — с токеном в адресе:\n<code>/clone https://ТОКЕН@github.com/user/repo</code>",
      { parse_mode: "HTML" },
    );
    return;
  }
  if (!/^https:\/\/[\w.@:-]+\/[\w./-]+$/.test(url)) {
    await ctx.reply("Похоже, это не https-адрес репозитория.");
    return;
  }

  const chatRow = getChat(ctx.chat.id);
  const project = chatRow?.project ?? "default";
  const cwd = workspaceFor(userId, project);

  const note = await ctx.reply("⏳ Забираю репозиторий…");
  try {
    const target = await cloneRepository(url, cwd);
    await ctx.api.editMessageText(
      ctx.chat.id,
      note.message_id,
      `📦 Забрал в проект <code>${esc(project)}</code>: <code>${esc(target)}</code>\n\nТеперь можно ставить задачи по этому коду.`,
      { parse_mode: "HTML" },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ctx.api.editMessageText(
      ctx.chat.id,
      note.message_id,
      `⚠️ Не получилось: <code>${esc(message.slice(0, 500))}</code>`,
      { parse_mode: "HTML" },
    );
  }
});

// ── Git прямо из чата ────────────────────────────────────────────────────────
// Клон уже был, но всё остальное приходилось просить агента словами. Эти четыре
// команды закрывают обычный круг: посмотреть, закоммитить, отправить, открыть PR.

/**
 * Ищет репозиторий в папке текущего проекта и объясняет, если нашлось не одно.
 * Возвращает null, если работать не с чем — сообщение пользователю уже ушло.
 */
async function resolveRepo(ctx: CommandContext<Context> | Context): Promise<string | null> {
  const chatRow = getChat(ctx.chat!.id);
  const project = chatRow?.project ?? "default";
  const cwd = workspaceFor(ctx.from!.id, project);
  const repos = findRepos(cwd);

  if (repos.length === 0) {
    await ctx.reply(
      `В проекте <code>${esc(project)}</code> нет репозитория.\n\n` +
        "Забрать: <code>/clone https://github.com/user/repo</code>",
      { parse_mode: "HTML" },
    );
    return null;
  }
  if (repos.length > 1) {
    const names = repos.map((path) => `• <code>${esc(basename(path))}</code>`).join("\n");
    await ctx.reply(
      `В проекте несколько репозиториев, не знаю, какой брать:\n\n${names}\n\n` +
        "Разведи их по проектам: <code>/project имя</code>.",
      { parse_mode: "HTML" },
    );
    return null;
  }
  return repos[0] ?? null;
}

/** Заголовок «где мы сейчас»: ветка, отставание от сервера, число изменений. */
function describeStatus(state: RepoStatus, repo: string): string {
  const parts = [`🌿 <code>${esc(state.branch)}</code> · <code>${esc(basename(repo))}</code>`];
  if (state.ahead) parts.push(`↑${state.ahead}`);
  if (state.behind) parts.push(`↓${state.behind}`);
  if (!state.remote) parts.push("нет ветки на сервере");
  return parts.join(" · ");
}

/** Rich-сообщение в ответ на команду; если Telegram разметку не принял — обычным текстом. */
async function replyRich(ctx: Context, markdown: string): Promise<void> {
  if (!ctx.chat) return;
  try {
    await ctx.api.raw.sendRichMessage({
      chat_id: ctx.chat.id,
      rich_message: { markdown: prepareRichMarkdown(markdown) },
    });
  } catch (error) {
    console.error(`[rich] ${(error as Error).message}`);
    await ctx.reply(markdown.replace(/<[^>]+>/g, "").slice(0, 3900));
  }
}

/** Столько диффа помещается в сообщение, чтобы его ещё читали; остальное файлом. */
const DIFF_IN_MESSAGE = 6000;

async function showDiff(ctx: CommandContext<Context> | Context): Promise<void> {
  const repo = await resolveRepo(ctx);
  if (!repo) return;

  try {
    const state = await status(repo);
    const arrows = `${state.ahead ? ` ↑${state.ahead}` : ""}${state.behind ? ` ↓${state.behind}` : ""}`;
    const head = `## 🔀 Дифф · \`${basename(repo)}\` · ветка \`${state.branch}\`${arrows}`;
    if (state.entries.length === 0) {
      await replyRich(ctx, `${head}\n\nЧисто: менять нечего.`);
      return;
    }

    const summary = await gitDiff(repo);
    const cell = (path: string) => "`" + path.replace(/\|/g, "\\|").replace(/`/g, "ˋ") + "`";
    const rows = summary.entries.map(
      (e) => `| ${cell(e.path)} | ${e.binary ? "бинарный" : `+${e.added} −${e.deleted}`} |`,
    );
    for (const path of summary.untracked) rows.push(`| ${cell(path)} | новый |`);
    const more = rows.length > 40 ? `\n| …и ещё ${rows.length - 40} | |` : "";
    const table =
      rows.length > 0
        ? `| Файл | Изменения |\n|:-----|----------:|\n${rows.slice(0, 40).join("\n")}${more}`
        : "";

    const patch = summary.patch.trim();
    const cut = patch.length > DIFF_IN_MESSAGE || summary.truncated;
    const block = patch
      ? `\n\n${details(`📄 Патч${cut ? " (начало)" : ""}`, fence(patch.slice(0, DIFF_IN_MESSAGE), "diff"))}`
      : "";
    await replyRich(ctx, `${head}\n\n**Изменено файлов: ${summary.files}**\n\n${table}${block}`);

    // Полный дифф файлом, только если в сообщение он не влез: файл открывается
    // просмотрщиком и читается лучше, чем километр в чате.
    if (cut) {
      await ctx.replyWithDocument(
        new InputFile(Buffer.from(summary.patch, "utf8"), `${basename(repo)}.diff`),
        { caption: summary.truncated ? "Полный дифф (обрезан до 12 КБ)" : "Полный дифф" },
      );
    }
  } catch (error) {
    await ctx.reply(`⚠️ ${esc((error as Error).message.slice(0, 500))}`, { parse_mode: "HTML" });
  }
}

bot.command("diff", (ctx) => showDiff(ctx));

/**
 * Предложенные сообщения коммита ждут кнопки. Ключ короткий: callback_data
 * ограничен 64 байтами, туда не влезет ни путь, ни само сообщение.
 */
const pendingCommits = new Map<string, { repo: string; message: string }>();
let commitSeq = 0;

async function startCommit(ctx: CommandContext<Context> | Context, given: string): Promise<void> {
  const repo = await resolveRepo(ctx);
  if (!repo) return;

  try {
    const state = await status(repo);
    if (state.entries.length === 0) {
      await ctx.reply("Нечего коммитить: изменений нет.");
      return;
    }

    if (given) {
      const hash = await commitAll(repo, given);
      await ctx.reply(`✅ Коммит <code>${esc(hash)}</code>\n\n${esc(given)}\n\nОтправить: /push`, {
        parse_mode: "HTML",
      });
      return;
    }

    const credential = credentialFor(ctx.from!.id);
    if (!credential) {
      await ctx.reply("Сначала войди: /start");
      return;
    }

    const note = await ctx.reply("⏳ Смотрю изменения и придумываю сообщение…");
    const user = getOrCreateUser(ctx.from!.id);
    const suggested = await suggestCommitMessage(repo, credential, user.model);
    if (!suggested) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        note.message_id,
        "Не смог придумать сообщение. Напиши своё: <code>/commit текст</code>",
        { parse_mode: "HTML" },
      );
      return;
    }

    const id = String(++commitSeq);
    pendingCommits.set(id, { repo, message: suggested });
    await ctx.api.editMessageText(
      ctx.chat!.id,
      note.message_id,
      `${describeStatus(state, repo)}\n\nСообщение коммита:\n\n<b>${esc(suggested)}</b>\n\n` +
        `Файлов затронуто: ${state.entries.length}`,
      { parse_mode: "HTML", reply_markup: commitKeyboard(id) },
    );
  } catch (error) {
    await ctx.reply(`⚠️ ${esc((error as Error).message.slice(0, 500))}`, { parse_mode: "HTML" });
  }
}

bot.command("commit", (ctx) => startCommit(ctx, ctx.match?.toString().trim() ?? ""));

/**
 * Кнопки быстрых действий под ответом. На телефоне набрать «покажи дифф»
 * дороже, чем нажать, — поэтому девять действий из десяти вынесены сюда.
 *
 * Кнопки снимаются сразу после нажатия: они относятся к тому ответу, а не к
 * следующему, и оставлять их — значит предлагать повторить вчерашнее.
 */
bot.callbackQuery(/^act:(diff|commit)$/, async (ctx) => {
  const действие = ctx.match[1];
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);

  if (действие === "diff") {
    await ctx.answerCallbackQuery("Смотрю изменения");
    await showDiff(ctx);
    return;
  }
  await ctx.answerCallbackQuery("Готовлю коммит");
  await startCommit(ctx, "");
});

bot.callbackQuery(/^gc:(\d+):(y|n)$/, async (ctx) => {
  const id = ctx.match[1] ?? "";
  const action = ctx.match[2];
  const pending = pendingCommits.get(id);
  if (!pending) {
    await ctx.answerCallbackQuery("Это предложение уже неактуально");
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
    return;
  }
  pendingCommits.delete(id);
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);

  if (action === "n") {
    await ctx.answerCallbackQuery("Отменил");
    await ctx.reply("Отменил. Своё сообщение: <code>/commit текст</code>", { parse_mode: "HTML" });
    return;
  }

  await ctx.answerCallbackQuery("Коммичу");
  try {
    const hash = await commitAll(pending.repo, pending.message);
    await ctx.reply(
      `✅ Коммит <code>${esc(hash)}</code>\n\n${esc(pending.message)}\n\nОтправить: /push`,
      { parse_mode: "HTML" },
    );
  } catch (error) {
    await ctx.reply(`⚠️ ${esc((error as Error).message.slice(0, 500))}`, { parse_mode: "HTML" });
  }
});

/**
 * Переименование чата.
 *
 * Автоназвание берётся из первой реплики и часто выходит бессмысленным:
 * «Привет» или «сделай так же, но…». В списке /resume по такому чат не найти.
 * Имя пишется в сам транскрипт сессии, поэтому переживает перезапуск и видно
 * его будет и в терминале.
 */
bot.command("rename", async (ctx) => {
  const userId = ctx.from!.id;
  const chatId = ctx.chat.id;
  const title = ctx.match?.toString().trim() ?? "";

  const chatRow = getChat(chatId);
  const sessionId = chatRow?.session_id;
  if (!sessionId) {
    await ctx.reply(
      "Этот чат ещё не начат — переименовывать нечего.\n\nНапиши задачу, а потом " +
        "<code>/rename название</code>.",
      { parse_mode: "HTML" },
    );
    return;
  }

  if (!title) {
    const текущее = chatRow?.title;
    await ctx.reply(
      `Как назвать этот чат?\n\n<code>/rename название</code>` +
        (текущее ? `\n\nСейчас: <b>${esc(текущее)}</b>` : ""),
      { parse_mode: "HTML" },
    );
    return;
  }

  const cwd = workspaceFor(userId, chatRow?.project ?? "default");
  try {
    if (dialogRecord(userId, sessionId)?.started) await renameUserSession(userId, sessionId, title.slice(0, 80), cwd);
    updateDialog(userId, sessionId, { title: title.slice(0, 80) });
  } catch (error) {
    await ctx.reply(`⚠️ Не переименовалось: ${esc(String(error).slice(0, 200))}`, {
      parse_mode: "HTML",
    });
    return;
  }

  // Дублируем имя в свою базу: /status и заголовки читают её, а не транскрипт.
  saveChat({
    chatId,
    userId,
    project: chatRow?.project ?? "default",
    sessionId,
    title: title.slice(0, 80),
    permissionMode: chatRow?.permission_mode ?? config.defaultPermissionMode,
  });

  await ctx.reply(`✏️ Теперь этот чат называется <b>${esc(title.slice(0, 80))}</b>.`, {
    parse_mode: "HTML",
  });
});

bot.command("project", async (ctx) => {
  const userId = ctx.from!.id;
  const arg = ctx.match?.toString().trim() ?? "";
  if (!arg) {
    const project = getChat(ctx.chat.id)?.project ?? "default";
    await ctx.reply(
      `Проект: <code>${esc(project)}</code>\nПапка: <code>${esc(workspaceFor(userId, project))}</code>\n\nСменить: <code>/project имя</code>`,
      { parse_mode: "HTML" },
    );
    return;
  }
  const project = await switchProject(ctx.chat.id, userId, arg);
  const unlocked = checkAchievements(userId, { type: "project", project });
  await ctx.reply(
    `📂 Проект: <code>${esc(project)}</code>\nПапка: <code>${esc(workspaceFor(userId, project))}</code>`,
    { parse_mode: "HTML" },
  );
  if (unlocked.length > 0) await ctx.reply(renderUnlocked(unlocked), { parse_mode: "HTML" });
});

// ── Статистика и коты ────────────────────────────────────────────────────────

/**
 * Хвост собственного лога в чат.
 *
 * Только владельцу: в логе видно, кто и что писал боту, включая чужие чаты,
 * если их когда-нибудь пустят. Первый в ALLOWED_USER_IDS и есть владелец.
 */
bot.command("logs", async (ctx) => {
  const owner = config.allowedUserIds[0];
  if (owner === undefined || ctx.from!.id !== owner) {
    await ctx.reply("Лог отдаю только владельцу бота.");
    return;
  }

  const asked = Number.parseInt(ctx.match?.toString().trim() ?? "", 10);
  const lines = Number.isFinite(asked) ? Math.min(Math.max(asked, 1), 2000) : 60;
  const tail = tailLog(lines);

  if (!tail) {
    await ctx.reply("Лог пока пуст — бот только что стартовал.");
    return;
  }

  // В сообщение влезает немного, а хвост в двести строк уже не влезает совсем.
  // Короткий отдаём текстом, чтобы читалось без скачивания; длинный — файлом.
  if (tail.length <= 3500) {
    await ctx.reply(`<pre>${esc(tail)}</pre>`, { parse_mode: "HTML" });
    return;
  }
  await ctx.replyWithDocument(new InputFile(Buffer.from(tail, "utf8"), "bot.log"), {
    caption: `Последние ${tail.split("\n").length} строк лога`,
  });
});

// ── Доступ к боту ────────────────────────────────────────────────────────────

/**
 * Управление списком тех, кому можно пользоваться ботом.
 *
 * Только владельцу: доступ сюда — это доступ к шеллу на машине, и раздавать
 * его должен один человек, а не всякий, кого уже пустили.
 */
bot.command("admin", async (ctx) => {
  const userId = ctx.from!.id;
  if(!isAdmin(userId)){await ctx.reply("Управление доступно только владельцу.");return;}

  // Приглашать может каждый, у кого свой доступ. У кого его нет — тому нечего
  // делить: он сам работает по чужой подписке.
  if (!getCredential(userId)) {
    const inviter = inviterOf(userId);
    if (inviter !== null) {
      await ctx.reply(
        "Ты на приглашённой подписке — делиться пока нечем.\n\n" +
          "Подключишь свой доступ — сможешь звать других, и расход пойдёт по твоему ключу.",
        { reply_markup: new InlineKeyboard().text("🎫 Подключить свой доступ", "nav:auth") },
      );
      return;
    }
    await ctx.reply("Сначала подключи свой доступ: /start");
    return;
  }

  const arg = ctx.match?.toString().trim() ?? "";
  const [действие, кто, ...остальное] = arg.split(/\s+/);

  if (действие === "quota" || действие === "квота") {
    const id = Number(кто);
    if (!Number.isInteger(id) || id <= 0) {
      await ctx.reply("Нужен номер: <code>/admin quota НОМЕР 200000</code>", {
        parse_mode: "HTML",
      });
      return;
    }
    if (inviterOf(id) !== userId && userId !== ownerId()) {
      await ctx.reply("Квоту ставит тот, кто звал.");
      return;
    }
    const слово = (остальное[0] ?? "").toLowerCase();
    // Ноль и «нет» снимают ограничение: отдельная команда для снятия была бы
    // лишней, а ноль читается однозначно.
    const снять = слово === "0" || слово === "нет" || слово === "off";
    const число = снять ? null : Number(слово.replace(/[\s_]/g, ""));
    if (!снять && (!Number.isFinite(число) || (число as number) <= 0)) {
      await ctx.reply(
        "Сколько токенов в сутки? <code>/admin quota НОМЕР 200000</code>\n" +
          "Снять ограничение — <code>/admin quota НОМЕР 0</code>",
        { parse_mode: "HTML" },
      );
      return;
    }
    if (!setQuota(id, число)) {
      await ctx.reply("Такого в списке нет.");
      return;
    }
    await bot.api
      .sendMessage(
        id,
        снять
          ? "🔓 Ограничение снято: можно работать без суточного предела."
          : `📊 Тебе поставили суточную квоту: ${formatTokens(число as number)} токенов в день.`,
      )
      .catch(() => undefined);
    await ctx.reply(
      снять
        ? `🔓 Снял ограничение с <code>${id}</code>.`
        : `📊 Квота <code>${id}</code>: ${formatTokens(число as number)} токенов в сутки.`,
      { parse_mode: "HTML" },
    );
    return;
  }

  if (действие === "add" || действие === "del") {
    const id = Number(кто);
    if (!Number.isInteger(id) || id <= 0) {
      await ctx.reply(
        "Нужен числовой номер пользователя.\n\n" +
          "Его видно в ответе бота, когда человек ему напишет: бот отвечает " +
          "«этот бот приватный» и называет номер.",
      );
      return;
    }
    if (действие === "add") {
      if (id === userId) {
        await ctx.reply("Себя приглашать некуда — у тебя свой доступ.");
        return;
      }
      allowUser(id, userId, остальное.join(" ") || null);
      // Человек должен узнать, что его позвали, — иначе он просто напишет боту
      // и не поймёт, почему тот вдруг отвечает.
      const позвал = ctx.from!.first_name || "Владелец подписки";
      const дошло = await bot.api
        .sendMessage(
          id,
          `🎫 ${esc(позвал)} позвал тебя в общую подписку Claude.\n\n` +
            "Вводить ничего не нужно — просто напиши задачу словами. Расход пойдёт по " +
            "подписке пригласившего, а статистика и кот в мини-аппе у тебя свои.\n\n" +
            "Захочешь работать по своему ключу — /start.",
          { parse_mode: "HTML" },
        )
        .then(() => true)
        .catch(() => false);

      await ctx.reply(
        `✅ Пустил <code>${id}</code>.` +
          (дошло
            ? " Сообщение ему отправил."
            : " Написать ему не смог — пусть сам напишет боту первым."),
        { parse_mode: "HTML" },
      );
      return;
    }
    if (config.allowedUserIds.includes(id)) {
      await ctx.reply(
        "Этого не отозвать отсюда: он записан в ALLOWED_USER_IDS в .env. " +
          "Убери его там и перезапусти бота.",
      );
      return;
    }
    if (inviterOf(id) !== userId && userId !== ownerId()) {
      await ctx.reply("Его звал не ты — и отозвать можешь только тот, кто звал.");
      return;
    }
    await ctx.reply(
      disallowUser(id) ? `🚫 Отозвал доступ у <code>${id}</code>.` : "Такого в списке и не было.",
      { parse_mode: "HTML" },
    );
    return;
  }

  await showAccessList(ctx, userId);
});

/** Кого позвал этот человек: список с кнопками отзыва. */
async function showAccessList(
  ctx: CommandContext<Context> | Context,
  userId: number,
): Promise<void> {
  if(!isAdmin(userId))return;
  // Владелец видит всех: он отвечает за машину целиком. Остальные — только тех,
  // кого позвали сами, чтобы не лезть в чужие подписки.
  const общий = userId === ownerId();
  const приглашённые = общий ? listAllowedUsers() : listAllowedUsers(userId);

  const lines = [общий ? "<b>Доступ к боту</b>" : "<b>Кого ты позвал</b>", ""];

  if (общий) {
    lines.push("<i>Из .env — отсюда не отзываются:</i>");
    if (config.allowedUserIds.length === 0) {
      lines.push("⚠️ список пуст — бот отвечает кому угодно");
    } else {
      config.allowedUserIds.forEach((id, index) => {
        lines.push(`<code>${id}</code>${index === 0 ? " — владелец" : ""}`);
      });
    }
    lines.push("", "<i>Позваны из чата:</i>");
  }

  if (приглашённые.length === 0) {
    lines.push("пока никого");
  } else {
    for (const row of приглашённые) {
      const when = new Date(row.added_at).toLocaleDateString("ru-RU");
      const чей = общий && row.added_by !== userId ? ` · позвал ${row.added_by}` : "";
      const свой = getCredential(row.user_id) ? " · работает по своему ключу" : "";
      // Квоту показываем вместе с тем, сколько уже съедено сегодня: голое
      // ограничение без расхода ничего не говорит.
      const остаток = quotaLeft(row.user_id);
      const квота = остаток
        ? ` · сегодня ${formatTokens(остаток.used)} из ${formatTokens(остаток.limit)}`
        : свой
          ? ""
          : " · без ограничения";
      lines.push(
        `<code>${row.user_id}</code>${row.note ? ` — ${esc(row.note)}` : ""} · с ${when}${чей}${свой}${квота}`,
      );
    }
  }

  lines.push(
    "",
    "<code>/admin add НОМЕР [заметка]</code> — позвать",
    "<code>/admin del НОМЕР</code> — отозвать",
    "<code>/admin quota НОМЕР 200000</code> — суточная квота, 0 снимает",
    "",
    "Позванный работает по твоей подписке, но статистика и кот у него свои.",
    "Свой номер бот называет человеку сам, когда тот пишет в закрытый бот.",
  );

  const keyboard = new InlineKeyboard();
  for (const row of приглашённые) {
    keyboard.text(`🚫 ${row.note || row.user_id}`, `adm:del:${row.user_id}`).row();
  }

  await ctx.reply(lines.join("\n"), {
    parse_mode: "HTML",
    reply_markup: приглашённые.length > 0 ? keyboard : undefined,
  });
}

bot.callbackQuery(/^adm:del:(\d+)$/, async (ctx) => {
  const userId = ctx.from.id;
  if(!isAdmin(userId)){await ctx.answerCallbackQuery("Управление доступно только владельцу.");return;}
  const id = Number(ctx.match[1]);
  // Отозвать может тот, кто звал, и владелец машины. Иначе один приглашённый
  // выкидывал бы другого из чужой подписки.
  if (inviterOf(id) !== userId && userId !== ownerId()) {
    await ctx.answerCallbackQuery("Его звал не ты");
    return;
  }
  const убран = disallowUser(id);
  await ctx.answerCallbackQuery(убран ? "Доступ отозван" : "Его уже не было");
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
  await showAccessList(ctx, userId);
});

bot.command("stats", async (ctx) => {
  const userId = ctx.from!.id;
  const user = {...getOrCreateUser(userId),...getModeData("claude").stats(userId)};
  const today = getModeData("claude").daily(userId,1)[0]!;
  const cat = catForMode(catForTokens(user.total_tokens),"claude");
  const nextRaw = nextCat(user.total_tokens);
  const next = nextRaw ? catForMode(nextRaw,"claude") : null;
  const selected = claudeModels(userId).find(model => model.value === claudePreferences(userId).model)!;
  const modelLabel = claudeModelLabel(selected);

  await ctx.reply(
    [
      `Вход: ${user.auth_kind ? describeKind(user.auth_kind) : "не выполнен"}`,
      `Модель: ${esc(String(modelLabel))}`,
      "",
      `🐱 <b>${esc(cat.name)}</b> — уровень ${cat.level}/10`,
      `<i>${esc(cat.title)}</i>`,
      next
        ? `До «${esc(next.name)}»: ${formatTokens(next.threshold - user.total_tokens)} токенов`
        : "Максимальный уровень достигнут",
      "",
      // Импортированная история идёт отдельной строкой: у неё другая природа.
      `В боте: ${formatTokens(user.total_tokens - user.history_tokens)} токенов`,
      ...(user.history_tokens > 0
        ? [`Импортировано: ${formatTokens(user.history_tokens)} токенов (без стоимости)`]
        : []),
      `Всего с историей: ${formatTokens(user.total_tokens)} токенов`,
      `Сегодня: ${formatTokens(today.tokens)} токенов`,
      `Сообщений: ${user.total_messages - user.history_messages} · сессий: ${user.total_sessions}`,
      `Инструментов разрешено: ${user.tools_allowed}`,
      `Серия дней подряд: ${user.streak_days}`,
    ].join("\n"),
    { parse_mode: "HTML" },
  );
});

bot.command("cats", async (ctx) => {
  const userId = ctx.from!.id;
  const user = {...getOrCreateUser(userId),...getModeData("claude").stats(userId)};
  const current = catForTokens(user.total_tokens);
  const have = unlockedIds(userId);

  const catLines = CAT_LEVELS.map(cat=>catForMode(cat,"claude")).map((cat) => {
    const open = user.total_tokens >= cat.threshold;
    const marker = cat.level === current.level ? "👉" : open ? "✅" : "🔒";
    const name = open ? `<b>${esc(cat.name)}</b>` : esc(cat.name);
    return `${marker} ${cat.level}. ${name} — ${formatTokens(cat.threshold)}`;
  }).join("\n");

  const achievementLines = ACHIEVEMENTS.map((a) => {
    const done = have.has(a.id);
    return `${done ? a.icon : "▫️"} ${done ? `<b>${esc(a.name)}</b>` : esc(a.name)} — ${esc(a.description)}`;
  }).join("\n");

  await ctx.reply(
    `🐈 <b>Коты</b>\n${catLines}\n\n🏆 <b>Достижения</b> (${have.size}/${ACHIEVEMENTS.length})\n${achievementLines}`,
    { parse_mode: "HTML" },
  );
});

bot.command(["usage","status"],async ctx=>{await ctx.reply(await claudeUsageText(ctx.from!.id));});

// ── Инлайн-кнопки ────────────────────────────────────────────────────────────

bot.callbackQuery(/^m:(.+)$/, async (ctx) => {
  const mode = (ctx.match[1] ?? "default") as PermissionMode;
  const chatId = ctx.chat!.id;
  const chatRow = getChat(chatId);
  saveChat({
    chatId,
    userId: ctx.from.id,
    project: chatRow?.project ?? "default",
    sessionId: chatRow?.session_id ?? null,
    permissionMode: mode,
  });
  // allowDangerouslySkipPermissions задаётся при создании сессии, на лету его
  // не включить. Поэтому при переходе в режим без вопросов живую сессию
  // закрываем — следующая реплика поднимет её уже с нужным флагом.
  const session = getSession(chatId);
  if (mode === "bypassPermissions") {
    await resetSession(chatId, ctx.from.id);
  } else if (session) {
    await session.conversation.setPermissionMode(mode);
  }

  await ctx.answerCallbackQuery(
    mode === "bypassPermissions" ? "Режим без вопросов включён" : "Режим изменён",
  );
  const view = renderScreen("mode", { userId: ctx.from.id, chatId });
  await ctx.editMessageReplyMarkup({ reply_markup: view.keyboard }).catch(() => undefined);
});

bot.callbackQuery(/^(md|ce):(.+)$/, async (ctx) => {
  if (getSession(ctx.chat!.id)?.conversation.busy) { await ctx.answerCallbackQuery("Дождись завершения задачи или нажми /stop"); return; }
  const kind = ctx.match[1], raw = ctx.match[2] ?? "default", userId = ctx.from.id;
  try {
    const patch = kind === "md" ? { model: raw } : { effort: raw === "default" ? null : raw };
    const before = claudePreferences(userId), warm = claudeCacheWarm(ctx.chat!.id);
    const after = saveClaudePreferences(userId, patch);
    await reloadClaudeSettings(ctx.chat!.id);
    const resetsCache = warm && (after.model !== before.model || after.effort !== before.effort);
    await ctx.answerCallbackQuery(resetsCache ? { text: CACHE_RESET_NOTICE, show_alert: true } : "Настройки Claude сохранены");
    const view = renderScreen(kind === "md" ? "model" : "thinking", { userId, chatId: ctx.chat!.id });
    await ctx.editMessageReplyMarkup({ reply_markup: view.keyboard }).catch(() => undefined);
  } catch (error) { await ctx.answerCallbackQuery(error instanceof Error ? error.message : "Не удалось сохранить"); }
});

bot.callbackQuery(/^p:([^:]+):(.+)$/, async (ctx) => {
  const id = ctx.match[1] ?? "";
  const action = ctx.match[2] ?? "";
  const pending = getPermission(id);

  if (!pending) {
    await ctx.answerCallbackQuery("Этот запрос уже неактуален");
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
    return;
  }

  if (action === "c") {
    beginDenyComment(ctx.chat!.id, id);
    await ctx.answerCallbackQuery("Напиши, что сделать вместо этого");
    await ctx.reply("✍️ Напиши следующим сообщением, почему нет и что делать вместо этого.");
    return;
  }

  const toolName = pending.toolName;
  const decisions: Record<
    string,
    { label: string; kind: "allow" | "allow_always" | "deny" | "stop" }
  > = {
    a: { label: "✅ Разрешено", kind: "allow" },
    w: { label: "♾️ Разрешено навсегда", kind: "allow_always" },
    d: { label: "🚫 Отклонено", kind: "deny" },
    s: { label: "⏹️ Остановлено", kind: "stop" },
  };
  const decision = decisions[action];
  if (!decision) {
    await ctx.answerCallbackQuery("Неизвестное действие");
    return;
  }

  resolvePermission(id, { kind: decision.kind } as never);
  await ctx.answerCallbackQuery(decision.label);
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
  await ctx
    .editMessageText(`${ctx.callbackQuery.message?.text ?? ""}\n\n${decision.label}`.trim())
    .catch(() => undefined);

  const allowed = decision.kind === "allow" || decision.kind === "allow_always";
  const unlocked = checkAchievements(ctx.from.id, { type: "tool", toolName, allowed });
  if (unlocked.length > 0) await ctx.reply(renderUnlocked(unlocked), { parse_mode: "HTML" });
});

bot.callbackQuery(/^q:([^:]+):(\d+)$/, async (ctx) => {
  const id = ctx.match[1] ?? "";
  const optionIndex = Number(ctx.match[2] ?? "0");
  const pending = getQuestion(id);
  if (!pending) {
    await ctx.answerCallbackQuery("Вопрос уже неактуален");
    return;
  }
  const label = pending.questions[pending.index]?.options[optionIndex]?.label;
  if (!label) {
    await ctx.answerCallbackQuery("Такого варианта нет");
    return;
  }

  const result = answerQuestion(id, label);
  await ctx.answerCallbackQuery(label);
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);

  if (result && !result.done) {
    const session = getSession(ctx.chat!.id);
    if (session) await session.output.renderQuestion(result.pending);
  }
});

// ── Обычные сообщения ────────────────────────────────────────────────────────

/**
 * Отдать реплику агенту. Один путь на все виды сообщений: текст, голос, файл,
 * пересылку — иначе обработка ошибок разъезжается по копиям.
 */
async function runTask(ctx: Context, prompt: string, images: string[] = []): Promise<boolean> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (userId === undefined || chatId === undefined) return false;
  // Админ может временно закрыть Claude для всех, кроме себя.
  if (!engineAllowed("claude", userId)) {
    await ctx.reply(engineClosedText("claude"));
    return false;
  }

  // Внутренняя суточная квота больше не блокирует: она отказывала «квота
  // исчерпана», хотя лимитов подписки хватало с запасом (04.09.2026). Расход
  // по-прежнему считается и виден в списке пользователей.
  recordMessage(userId);
  try {
    const session = ensureSession({
      api: ctx.api,
      chatId,
      userId,
      notify: (html) => ctx.reply(html, { parse_mode: "HTML" }),
    });
    // Голосом — по выбору человека (/voice или мини-апп): выкл, на голосовые
    // (задача пришла голосовым черновиком) или всегда. По умолчанию — текстом.
    session.output.voiceReply = taskState.replyByVoice(userId);
    await session.conversation.send(prompt,images);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ctx.reply(`⚠️ Не смог запустить агента: ${esc(message)}`, { parse_mode: "HTML" });
    return false;
  }
}

/** Проверка входа: без неё любой обработчик молча ничего не делает. */
async function requireLogin(ctx: Context): Promise<boolean> {
  if (credentialFor(ctx.from!.id)) return true;
  await sendStart(ctx);
  return false;
}

/**
 * Фото и документы. Файл кладём в папку проекта, агенту передаём путь и подпись:
 * «вот скриншот, объясняю» работает как обычная задача, только с картинкой.
 */
bot.on(["message:photo", "message:document"], async (ctx) => {
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;

  if (!credentialFor(userId)) {
    await sendStart(ctx);
    return;
  }

  const chatRow = getChat(chatId);
  const project = chatRow?.project ?? "default";
  const cwd = workspaceFor(userId, project);

  // У фото несколько размеров; последний — самый крупный.
  const photo = ctx.message.photo?.at(-1);
  const document = ctx.message.document;
  const fileId = photo?.file_id ?? document?.file_id;
  if (!fileId) return;

  const suggested = document?.file_name ?? `фото-${Date.now()}.jpg`;

  let saved;
  try {
    saved = await saveTelegramFile(ctx.api, fileId, cwd, suggested, userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ctx.reply(`⚠️ Не смог принять файл: ${esc(message)}`, { parse_mode: "HTML" });
    return;
  }

  const caption = ctx.message.caption?.trim();
  await ctx.reply(`📎 Принял <code>${esc(saved.name)}</code>`, { parse_mode: "HTML" });

  const prompt = caption
    ? `${caption}\n\nФайл лежит здесь: ${saved.path}`
    : `Пользователь прислал файл: ${saved.path}. Посмотри на него и скажи, что видишь.`;

  await runTask(ctx, prompt, imageMime(readMediaFile(saved.path))?[saved.path]:[]);
});

/**
 * Голосовые. Раньше их просто не существовало для бота: отправишь — и тишина,
 * будто он сломался. Теперь либо расшифровываем и работаем как с текстом, либо
 * честно говорим, что расшифровка не подключена.
 */
/**
 * Видео, видеокружки и гифки. Смотреть их агент не умеет, поэтому честно
 * сохраняем файл и говорим, где он лежит: дальше человек скажет, что с ним
 * делать. Молчать нельзя — это выглядит как поломка.
 */
bot.on(["message:video", "message:video_note", "message:animation"], async (ctx) => {
  if (!(await requireLogin(ctx))) return;

  const media = ctx.message.video ?? ctx.message.video_note ?? ctx.message.animation;
  if (!media) return;

  const chatRow = getChat(ctx.chat.id);
  const cwd = workspaceFor(ctx.from.id, chatRow?.project ?? "default");
  const suggested = ("file_name" in media && media.file_name) || `видео-${Date.now()}.mp4`;

  let saved;
  try {
    saved = await saveTelegramFile(ctx.api, media.file_id, cwd, suggested, ctx.from.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ctx.reply(`⚠️ Не смог принять видео: ${esc(message)}`, { parse_mode: "HTML" });
    return;
  }

  const caption = ctx.message.caption?.trim();
  const images:string[]=[];
  let description="Видео сохранено. Кадры не удалось подготовить — не выдумывай его содержимое.";
  try{
    const preview=await videoPreview(readMediaFile(saved.path));
    for(let i=0;i<preview.frames.length;i++)images.push(saveAttachment(ctx.from.id,cwd,`кадр-${i+1}.jpg`,preview.frames[i]!).path);
    description=`Видео, длительность ${Math.round(preview.duration)} сек. Приложены ${images.length} отдельных кадра по ходу видео; звук не расшифрован.`;
  }catch{await ctx.reply("Видео сохранено, но кадры извлечь не удалось.");}
  await runTask(ctx,`${caption||"Посмотри приложенное видео."}\n${description}\nВидеофайл: ${saved.path}`,images);

});

/**
 * Стикеры, геопозиция, контакты, опросы. Смысл в них есть, просто он не
 * текстовый — переводим в текст и отдаём как обычную реплику.
 */
bot.on(["message:sticker", "message:location", "message:contact", "message:poll"], async (ctx) => {
  if (!(await requireLogin(ctx))) return;

  const message = ctx.message;
  let prompt: string;

  if (message.sticker) {
    const emoji = message.sticker.emoji ?? "";
    prompt = `Пользователь прислал стикер ${emoji} (набор «${message.sticker.set_name ?? "без набора"}»).`;
  } else if (message.location) {
    const { latitude, longitude } = message.location;
    prompt = `Пользователь прислал геопозицию: ${latitude}, ${longitude}.`;
  } else if (message.contact) {
    const contact = message.contact;
    const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ");
    prompt = `Пользователь прислал контакт: ${name}, телефон ${contact.phone_number}.`;
  } else if (message.poll) {
    const options = message.poll.options.map((o) => `- ${o.text}`).join("\n");
    prompt = `Пользователь прислал опрос «${message.poll.question}»:\n${options}`;
  } else {
    return;
  }

  await runTask(ctx, prompt);
});

bot.on(["message:voice", "message:audio"], async (ctx) => {
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;

  if (!credentialFor(userId)) {
    await sendStart(ctx);
    return;
  }

  if (!transcriptionConfigured()) {
    await ctx.reply(
      "🎤 Голосовые пока не расшифровываю: не задан <code>WHISPER_URL</code>.\n\n" +
        "Подключи любой сервис с интерфейсом OpenAI — и я начну их понимать. Пока напиши текстом.",
      { parse_mode: "HTML" },
    );
    return;
  }

  const voice = ctx.message.voice ?? ctx.message.audio;
  if (!voice) return;

  const note = await ctx.reply("🎤 Слушаю…");
  let text: string;
  try {
    const file = await ctx.api.getFile(voice.file_id);
    if (!file.file_path) throw new Error("Telegram не отдал путь к файлу");
    const url = `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`;
    const response = await fetchTelegramFile(url);
    if (!response.ok) throw new Error(`не скачать голосовое: HTTP ${response.status}`);
    const audio = Buffer.from(await response.arrayBuffer());
    text = await transcribe(audio, file.file_path.split("/").pop() ?? "voice.ogg");
  } catch (error) {
    const message =
      error instanceof TranscriptionNotConfigured
        ? "расшифровка не настроена"
        : error instanceof Error
          ? error.message
          : String(error);
    await ctx.api.editMessageText(chatId, note.message_id, `⚠️ Не разобрал голосовое: ${message}`);
    return;
  }

  // Показываем расшифровку: если распознало неверно, это видно сразу, а не по
  // странному ответу агента.
  await ctx.api.editMessageText(chatId, note.message_id, `🎤 <i>${esc(text)}</i>`, {
    parse_mode: "HTML",
  });

  await runTask(ctx, text);
});

/**
 * Кто написал пересланное сообщение.
 *
 * Без подписи агент видит текст без источника и отвечает не на то: «переведи»
 * и «ответь ему» требуют знать, чья это реплика.
 */
function forwardAuthor(origin: NonNullable<Parameters<typeof describeOrigin>[0]>): string {
  return describeOrigin(origin);
}

function describeOrigin(origin: {
  type: string;
  sender_user?: { first_name: string; last_name?: string; username?: string };
  sender_user_name?: string;
  sender_chat?: { title?: string };
  chat?: { title?: string };
}): string {
  switch (origin.type) {
    case "user": {
      const user = origin.sender_user;
      const name = [user?.first_name, user?.last_name].filter(Boolean).join(" ");
      return user?.username ? `${name} (@${user.username})` : name || "кто-то";
    }
    case "hidden_user":
      return origin.sender_user_name ?? "скрытый отправитель";
    case "chat":
      return origin.sender_chat?.title ?? "чат";
    case "channel":
      return origin.chat?.title ?? "канал";
    default:
      return "неизвестный источник";
  }
}

/**
 * Пересылки копятся секунду и уходят агенту одним куском.
 *
 * Telegram шлёт каждое пересланное сообщение отдельным обновлением, и без
 * буфера пересылка переписки из пяти реплик запускала бы пять задач подряд,
 * каждая со своим обрывком.
 */
const FORWARD_WINDOW_MS = 1200;
const forwardBuffers = new Map<number, { lines: string[]; timer: NodeJS.Timeout }>();

function bufferForward(
  chatId: number,
  line: string,
  flush: (text: string, count: number) => Promise<void>,
): void {
  const existing = forwardBuffers.get(chatId);
  if (existing) {
    clearTimeout(existing.timer);
    existing.lines.push(line);
  }
  const lines = existing?.lines ?? [line];
  const timer = setTimeout(() => {
    forwardBuffers.delete(chatId);
    const body =
      lines.length === 1
        ? `Пересланное сообщение:\n\n${lines[0]}`
        : `Пересланная переписка (${lines.length} сообщени(й)):\n\n${lines.join("\n\n")}`;
    void flush(body, lines.length);
  }, FORWARD_WINDOW_MS);
  timer.unref?.();
  forwardBuffers.set(chatId, { lines, timer });
}

/**
 * Неизвестная команда не должна уходить агенту.
 *
 * Иначе получается путаница: человек пишет /admin на старой версии бота, текст
 * летит в Claude Code как обычная реплика, и тот отвечает «Unknown command» —
 * будто команду не понял бот, хотя её просто нет в этой сборке. Ловим здесь,
 * до общего обработчика текста.
 */
bot.on("message:text", async (ctx, next) => {
  const text = ctx.message.text;
  if (!text.startsWith("/")) {
    await next();
    return;
  }
  const имя = text.slice(1).split(/[\s@]/)[0] ?? "";
  // Готовые воркфлоу (/review, /plan, /deep-research…) — это команды Claude Code:
  // отдаём их агенту как есть, он сам развернёт воркфлоу.
  if (isWorkflowCommand(ctx.from.id, имя.toLowerCase())) {
    await next();
    return;
  }
  await ctx.reply(`Нет такой команды: <code>/${esc(имя)}</code>\n\nВсе команды — /help, готовые воркфлоу — /workflows.`, {
    parse_mode: "HTML",
  });
});

bot.on("message:text", async (ctx) => {
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  const text = ctx.message.text;

  // 1. Ждём токен подписки или ключ API.
  const awaitingKind = awaitingKindFor(userId);
  if (awaitingKind) {
    if (!acceptCredential(userId, text, awaitingKind)) {
      await ctx.reply(
        "Не похоже ни на токен подписки, ни на ключ API.\n\n" +
          "Токен даёт <code>claude setup-token</code>, ключ начинается с <code>sk-ant-</code>.",
        { parse_mode: "HTML" },
      );
      return;
    }
    stopAwaiting(userId);
    // Секрет не должен остаться в истории чата.
    await ctx.api.deleteMessage(chatId, ctx.message.message_id).catch(() => undefined);
    await finishLogin(ctx, userId, text.trim());
    return;
  }

  // 2. Пишут причину отказа для висящего разрешения.
  const commentFor = pendingCommentFor(chatId);
  if (commentFor) {
    const pending = getPermission(commentFor);
    cancelDenyComment(chatId);
    if (pending) {
      resolvePermission(commentFor, { kind: "deny", message: text });
      await ctx.reply("🚫 Отклонил и передал твоё объяснение.");
      return;
    }
  }

  // 2.5. Висит запрос разрешения, а человек ответил текстом, не кнопкой.
  //
  // Так делают почти все: на карточку «Claude хочет использовать WebFetch»
  // пишут «нет, лучше сделай иначе». Раньше такой текст уходил в никуда, а
  // агент продолжал ждать нажатия до самого таймаута — полчаса тишины, и со
  // стороны это выглядит как зависший бот.
  //
  // Считаем это отказом с объяснением: сам текст уходит агенту как причина,
  // и работа продолжается с учётом сказанного.
  if (hasPending(chatId)) {
    const closed = flushChat(chatId, { kind: "deny", message: text });
    if (closed > 0) {
      await ctx.reply(
        closed === 1
          ? "🚫 Понял, не буду. Передал агенту твоё объяснение."
          : `🚫 Понял, не буду (${closed} запроса). Передал агенту твоё объяснение.`,
      );
      return;
    }
  }

  // 3. Вход не выполнен.
  if (!credentialFor(userId)) {
    await sendStart(ctx);
    return;
  }

  // 4. Пересылка: подписываем автора и копим серию в один кусок.
  const origin = ctx.message.forward_origin;
  if (origin) {
    bufferForward(chatId, `[${forwardAuthor(origin)}]: ${text}`, async (body, count) => {
      await ctx.reply(
        count === 1 ? "📨 Принял пересланное." : `📨 Принял ${count} пересланных сообщений.`,
      );
      await runTask(ctx, body);
    });
    return;
  }

  // 5. Обычная реплика агенту.
  // Чат без названия — новый. Называем его первой репликой: так в /resume и
  // /status видно, о чём он, а не безликий идентификатор сессии.
  const chatRow = getChat(chatId);
  if (!chatRow?.title) {
    saveChat({
      chatId,
      userId,
      project: chatRow?.project ?? "default",
      sessionId: chatRow?.session_id ?? null,
      title: text.slice(0, 60),
      permissionMode: chatRow?.permission_mode ?? config.defaultPermissionMode,
    });
    await ctx.reply(`💬 Новый чат: <b>${esc(text.slice(0, 60))}</b>`, { parse_mode: "HTML" });
  }

  const unlocked = checkAchievements(userId, { type: "message", hour: new Date().getHours() });
  if (!(await runTask(ctx, text))) return;
  if (unlocked.length > 0) await ctx.reply(renderUnlocked(unlocked), { parse_mode: "HTML" });
});

/**
 * Всё, для чего обработчика нет.
 *
 * Стоит последним и ловит остаток: игры, платежи, служебные события. Молчание
 * на сообщение неотличимо от поломки, поэтому лучше честно сказать, что не
 * понял, чем сделать вид, что ничего не приходило.
 */
bot.on("message", async (ctx) => {
  if (!credentialFor(ctx.from.id)) return;
  await ctx.reply(
    "🤷 Такое я пока не разбираю. Понимаю текст, голос, фото, документы, видео, " +
      "стикеры, геопозицию, контакты и опросы — а ещё пересылки.",
  );
});

// ── Ошибки и завершение ──────────────────────────────────────────────────────

bot.catch((err) => {
  console.error(`Ошибка в обновлении ${err.ctx.update.update_id}:`);
  if (err.error instanceof GrammyError) console.error("Telegram API:", err.error.description);
  else if (err.error instanceof HttpError) console.error("Сеть:", err.error);
  else console.error(err.error);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`\n${signal}: закрываю сессии…`);
  await Promise.allSettled([closeAll(), bot.stop()]);
  closeDb();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));


let checkingClaudeStorage = false;
const claudeStorageTimer = setInterval(async () => {
  if (checkingClaudeStorage) return;
  checkingClaudeStorage = true;
  try {
    for (const uid of new Set([...runningTasks().map(t => t.chat_id), ...config.allowedUserIds, ADMIN_ID])) {
      if (!getSession(uid)?.conversation.busy && !backgroundTasks(uid).length) continue;
      try { await gptStorage(uid, "admit"); }
      catch { await stopClaudeForStorage(uid); }
    }
  } finally { checkingClaudeStorage = false; }
}, 60000);
claudeStorageTimer.unref();

await bot.api.setMyCommands([
  {command:"start",description:"Главное меню · GPT и Claude"},
  {command:"github",description:"Подключить GitHub к GPT и Claude"},
  {command:"web",description:"Рабочая зона в браузере"},
  {command:"new",description:"Новый диалог"},
  {command:"resume",description:"Прошлые диалоги"},
  {command:"delete",description:"Удалить чаты и их файлы"},
  {command:"storage",description:"Место на диске и очистка"},
  {command:"search",description:"Поиск по чатам GPT и Claude"},
  {command:"files",description:"Галерея файлов и ZIP"},
  {command:"continue",description:"Продолжить прерванную задачу"},
  {command:"voice",description:"Включить или выключить озвучку"},
  {command:"usage",description:"Лимиты выбранного ИИ"},
  {command:"workflows",description:"Готовые воркфлоу с субагентами (Claude)"},
  {command:"stop",description:"Остановить задачу"},
  {command:"help",description:"Все команды"},
]);

// Мини-апп поднимаем ПЕРВЫМ, до перебора каналов.
//
// На нём висит /healthz, по которому docker судит, жив ли контейнер. Перебор
// каналов идёт по сети и на мёртвой подписке занимает больше минуты: пять проб
// по пятнадцать секунд. Всё это время проба здоровья не отвечала, контейнер
// считался больным, и выкатка откатывалась — притом что бот был совершенно
// исправен, просто ждал VPN. Здоровье должно означать «процесс жив и
// обслуживает», а не «канал до Anthropic поднялся».
startMiniAppServer();
// Готовые воркфлоу Claude Code — в ~/.claude/workflows каждого пользователя.
syncAllWorkflows();
// Подарок или пираты с чужого острова — повод открыть мир: пишем хозяину.
setWorldNotifier(async (userId, text) => {
  await bot.api.sendMessage(userId, text);
});
scheduleDailyBackups();

// Канал выхода выбирается до приёма сообщений: если Anthropic недоступен,
// лучше узнать об этом в логе сразу, а не на первой задаче пользователя.
const choice = await chooseChannel(parsePool(config.proxyPool), {
  requireCountry: config.proxyRequireCountry || undefined,
});
setActiveChannel(choice.active);
for (const status of choice.checked) {
  const mark = status.reachable ? "✅" : "❌";
  const code =
    status.httpStatus === null ? (status.error ?? "нет ответа") : `HTTP ${status.httpStatus}`;
  console.log(
    `${mark} ${status.candidate.label}: ${code}${status.country ? ` · ${status.country}` : ""}`,
  );
}
if (choice.active) {
  console.log(`🌍 Выход: ${describeChannel(choice.active)}`);
} else {
  console.warn("⚠️  Рабочего канала до Anthropic нет. Агент не сможет работать.");
  if (process.env.REQUIRE_PROXY === "1") {
    throw new Error("Обязательный прокси недоступен: бот не запускается.");
  }
}

/**
 * Дальше канал перепроверяется сам. Владельцу пишем только о смене: молчаливое
 * переключение выглядело бы как необъяснимая пауза в работе, а сообщение на
 * каждую проверку раз в десять минут превратилось бы в шум.
 */
startChannelWatch(parsePool(config.proxyPool), {
  requireCountry: config.proxyRequireCountry || undefined,
  onChange: (next, previous) => {
    // Живые агенты держат адрес прокси, выданный им при запуске, и после
    // смены канала продолжали бы биться в мёртвый. Переподнимаем их.
    if (next) {
      const restarted = restartSessionsForChannelChange();
      if (restarted > 0) console.log(`🔁 Сессий переподнято после смены канала: ${restarted}`);
    }
    const owner = config.allowedUserIds[0];
    if (owner === undefined) return;
    const was = previous ? describeChannel(previous) : "неизвестно";
    const text = next
      ? `🌍 Канал выхода переключён.\n\nБыл: <code>${esc(was)}</code>\nСтал: <code>${esc(describeChannel(next))}</code>`
      : `⚠️ Живого канала до Anthropic не осталось. Был: <code>${esc(was)}</code>\n\nАгент не сможет работать, пока канал не поднимется.`;
    // Сбой отправки не должен ронять процесс: это уведомление, а не работа.
    void bot.api.sendMessage(owner, text, { parse_mode: "HTML" }).catch(() => {});
  },
});

/**
 * Мини-апп вешается на кнопку меню Telegram — ту, что рядом с полем ввода.
 * Инлайн-кнопка внутри сообщения уезжает вверх с историей и теряется, а эта
 * висит всегда. Без chat_id значение становится умолчанием для всех чатов.
 */
if (config.miniappUrl) {
  const url = new URL("modes.html", config.miniappUrl.endsWith("/") ? config.miniappUrl : config.miniappUrl + "/").href;
  for (const chat_id of [undefined, ...config.allowedUserIds]) {
    await bot.api.setChatMenuButton({
      ...(chat_id ? { chat_id } : {}),
      menu_button: { type: "web_app", text: "Мой бот", web_app: { url } },
    }).catch(error => { if (!chat_id) throw error; });
  }
} else {
  // Иначе осталась бы кнопка от прошлого запуска, ведущая в никуда.
  await bot.api.setChatMenuButton({ menu_button: { type: "commands" } });
}

// Имя нужно мини-аппу для ссылки «поделиться». Спрашиваем один раз: меняется
// оно разве что вручную в BotFather.
const me = await bot.api.getMe().catch(() => null);
if (me?.username) setBotUsername(me.username);

/**
 * Разбор оборванных задач.
 *
 * Процесс может уйти в любой момент — пересборка образа, сторож, нехватка
 * памяти. Задача при этом умирает молча: в чате остаётся «работаю…», человек
 * ждёт ответа, а ответить уже некому. Раньше это выглядело как «бот встал и
 * больше не работает». Теперь при старте проходим по тому, что осталось
 * висеть, и говорим прямо.
 */
for (const task of runningTasks()) {
  clearRunning(task.chat_id);
  const прошло = Math.round((Date.now() - task.started_at) / 60_000);
  const текст =
    "⚠️ Бот перезапустился, задача оборвалась" +
    (прошло > 0 ? ` (шла ${прошло} мин)` : "") +
    ".\n\nИстория и этапы сохранены. Открой /continue, чтобы продолжить задачу.";
  try {
    await bot.api.editMessageText(task.chat_id, task.message_id, текст, { reply_markup: taskState.list(task.chat_id).length ? new InlineKeyboard().text("Продолжить", "recover:" + taskState.list(task.chat_id)[0]!.id) : undefined });
  } catch {
    // Сообщение могли удалить или оно слишком старое для правки — тогда просто
    // пишем новым, молчать здесь нельзя.
    await bot.api.sendMessage(task.chat_id, текст, { reply_markup: taskState.list(task.chat_id).length ? new InlineKeyboard().text("Продолжить", "recover:" + taskState.list(task.chat_id)[0]!.id) : undefined }).catch(() => {});
  }
}

console.log("🤖 Бот запущен");
// Claude-диалоги из рабочей зоны bb идут через этот же движок (см. bb-bridge.ts).
const bbBridge = startBbBridge({ api: bot.api });
bbBridge.on("error", (error) => console.error("[bb-bridge]", error));
await bot.start({ drop_pending_updates: true });
