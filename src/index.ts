import { Bot, GrammyError, HttpError, InlineKeyboard, type CommandContext, type Context } from "grammy";
import { listSessions, type PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { config } from "./config.js";
import {
  clearCredential,
  getChat,
  getCredential,
  getOrCreateUser,
  getUsageToday,
  listRateLimits,
  recordMessage,
  saveChat,
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
  resolvePermission,
} from "./agent/permissions.js";
import {
  closeAll,
  ensureSession,
  getSession,
  resetSession,
  switchProject,
  workspaceFor,
} from "./bot/session.js";
import {
  HELP,
  acceptCredential,
  askForCredential,
  awaitingKindFor,
  finishLogin,
  sendStart,
  startAwaiting,
  stopAwaiting,
} from "./bot/onboarding.js";
import { MODELS } from "./bot/keyboards.js";
import { isScreenId, renderScreen, type ScreenId } from "./bot/screens.js";
import { checkAchievements, renderUnlocked, unlockedIds } from "./achievements.js";
import { ACHIEVEMENTS, CAT_LEVELS, catForTokens, formatTokens, nextCat } from "./cats.js";
import { esc, formatUsd } from "./agent/render.js";
import { startMiniAppServer } from "./miniapp/server.js";
import {
  activeChannel,
  chooseChannel,
  describeChannel,
  parsePool,
  setActiveChannel,
} from "./proxy.js";

const bot = new Bot(config.botToken);

/** Доступ. Без белого списка бот отдаёт шелл кому угодно, поэтому проверка идёт первой. */
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (userId === undefined) return;
  if (config.allowedUserIds.length > 0 && !config.allowedUserIds.includes(userId)) {
    await ctx.reply("Этот бот приватный.");
    return;
  }
  await next();
});

// ── Вход ─────────────────────────────────────────────────────────────────────

bot.command("start", async (ctx) => {
  await sendStart(ctx);
});

bot.command("help", async (ctx) => {
  await ctx.reply(HELP, { parse_mode: "HTML" });
});

bot.command("logout", async (ctx) => {
  const userId = ctx.from!.id;
  clearCredential(userId);
  stopAwaiting(userId);
  await resetSession(ctx.chat.id, userId);
  await ctx.reply("Доступ удалён из базы. Войти заново — /start");
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
  await ctx.editMessageText(view.text, { parse_mode: "HTML", reply_markup: view.keyboard })
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
bot.command("resume", async (ctx) => {
  const userId = ctx.from!.id;
  const chatRow = getChat(ctx.chat.id);
  const project = chatRow?.project ?? "default";
  const cwd = workspaceFor(userId, project);

  let sessions;
  try {
    sessions = await listSessions({ dir: cwd, limit: 10 });
  } catch (error) {
    await ctx.reply(`⚠️ Не смог прочитать список чатов: ${esc(String(error).slice(0, 200))}`, {
      parse_mode: "HTML",
    });
    return;
  }

  if (sessions.length === 0) {
    await ctx.reply(
      `В проекте <code>${esc(project)}</code> прошлых чатов нет. Напиши что-нибудь — начнётся первый.`,
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
    lines.push(`${index + 1}. <b>${esc(title)}</b>\n    ${when}`);
    kb.text(`${index + 1}. ${title.slice(0, 28)}`, `rs:${s.sessionId}`).row();
  });

  await ctx.reply(
    `Чаты проекта <code>${esc(project)}</code>:\n\n${lines.join("\n")}`,
    { parse_mode: "HTML", reply_markup: kb },
  );
});

bot.callbackQuery(/^rs:(.+)$/, async (ctx) => {
  const sessionId = ctx.match[1] ?? "";
  const userId = ctx.from.id;
  const chatId = ctx.chat!.id;
  const chatRow = getChat(chatId);

  // Живой диалог закрываем: продолжать надо именно ту сессию, что выбрали.
  await resetSession(chatId, userId);
  saveChat({
    chatId,
    userId,
    project: chatRow?.project ?? "default",
    sessionId,
    title: chatRow?.title ?? null,
    permissionMode: chatRow?.permission_mode ?? "default",
  });

  await ctx.answerCallbackQuery("Вернулся в чат");
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
  await ctx.reply("↩️ Вернулся в этот чат. Пиши — продолжу с того места.");
});

// ── Настройки ────────────────────────────────────────────────────────────────

async function showScreen(ctx: CommandContext<Context>, id: ScreenId): Promise<void> {
  const view = renderScreen(id, { userId: ctx.from!.id, chatId: ctx.chat.id });
  await ctx.reply(view.text, { parse_mode: "HTML", reply_markup: view.keyboard });
}

bot.command("menu", async (ctx) => showScreen(ctx, "menu"));
bot.command("mode", async (ctx) => showScreen(ctx, "mode"));
bot.command("model", async (ctx) => showScreen(ctx, "model"));

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

bot.command("stats", async (ctx) => {
  const userId = ctx.from!.id;
  const user = getOrCreateUser(userId);
  const today = getUsageToday(userId);
  const cat = catForTokens(user.total_tokens);
  const next = nextCat(user.total_tokens);
  const modelLabel = MODELS.find(([id]) => id === (user.model ?? ""))?.[1] ?? user.model;

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
      `Всего: ${formatTokens(user.total_tokens)} токенов · ${formatUsd(user.total_cost_usd)}`,
      `Сегодня: ${formatTokens(today.tokens)} токенов`,
      `Сообщений: ${user.total_messages} · сессий: ${user.total_sessions}`,
      `Инструментов разрешено: ${user.tools_allowed} · отклонено: ${user.tools_denied}`,
      `Серия дней подряд: ${user.streak_days}`,
    ].join("\n"),
    { parse_mode: "HTML" },
  );
});

bot.command("cats", async (ctx) => {
  const userId = ctx.from!.id;
  const user = getOrCreateUser(userId);
  const current = catForTokens(user.total_tokens);
  const have = unlockedIds(userId);

  const catLines = CAT_LEVELS.map((cat) => {
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

bot.command("status", async (ctx) => {
  const channel = activeChannel();
  const chat = getChat(ctx.chat.id);
  const lines = [
    "<b>Чат</b>",
    chat?.title ? esc(chat.title) : "новый — ещё ни одной задачи",
    "",
    "<b>Канал выхода</b>",
    channel
      ? `✅ ${esc(describeChannel(channel))}`
      : "❌ рабочего канала нет — Anthropic недоступен ни напрямую, ни через прокси",
  ];

  const limits = listRateLimits(ctx.from!.id);
  lines.push("", "<b>Лимиты подписки</b>");
  if (limits.length === 0) {
    lines.push("данных пока нет — они приходят по ходу работы агента");
  } else {
    for (const limit of limits) {
      const percent = limit.utilization === null ? "?" : `${Math.round(limit.utilization)}%`;
      const seen = new Date(limit.seen_at).toLocaleString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      });
      lines.push(`${esc(limit.limit_type)}: ${percent} · данные на ${seen}`);
    }
  }

  await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
});

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
  const session = getSession(chatId);
  if (session) await session.conversation.setPermissionMode(mode);

  await ctx.answerCallbackQuery("Режим изменён");
  const view = renderScreen("mode", { userId: ctx.from.id, chatId });
  await ctx.editMessageReplyMarkup({ reply_markup: view.keyboard }).catch(() => undefined);
});

bot.callbackQuery(/^md:(.+)$/, async (ctx) => {
  const raw = ctx.match[1] ?? "default";
  const model = raw === "default" ? null : raw;
  const userId = ctx.from.id;
  setModel(userId, model);

  const session = getSession(ctx.chat!.id);
  if (session && model) await session.conversation.setModel(model);

  await ctx.answerCallbackQuery("Модель изменена");
  const view = renderScreen("model", { userId, chatId: ctx.chat!.id });
  await ctx.editMessageReplyMarkup({ reply_markup: view.keyboard }).catch(() => undefined);
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
  const decisions: Record<string, { label: string; kind: "allow" | "allow_always" | "deny" | "stop" }> = {
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

bot.on("message:text", async (ctx) => {
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  const text = ctx.message.text;

  // 1. Ждём токен подписки или ключ API.
  if (awaitingKindFor(userId)) {
    if (!acceptCredential(userId, text)) {
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

  // 3. Вход не выполнен.
  if (!getCredential(userId)) {
    await sendStart(ctx);
    return;
  }

  // 4. Обычная реплика агенту.
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
      permissionMode: chatRow?.permission_mode ?? "default",
    });
    await ctx.reply(`💬 Новый чат: <b>${esc(text.slice(0, 60))}</b>`, { parse_mode: "HTML" });
  }

  recordMessage(userId);
  const unlocked = checkAchievements(userId, { type: "message", hour: new Date().getHours() });

  try {
    const session = ensureSession({
      api: ctx.api,
      chatId,
      userId,
      notify: (html) => ctx.reply(html, { parse_mode: "HTML" }),
    });
    await session.conversation.send(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ctx.reply(`⚠️ Не смог запустить агента: ${esc(message)}`, { parse_mode: "HTML" });
    return;
  }

  if (unlocked.length > 0) await ctx.reply(renderUnlocked(unlocked), { parse_mode: "HTML" });
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
  await bot.stop();
  await closeAll();
  closeDb();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await bot.api.setMyCommands([
  { command: "menu", description: "главное меню" },
  { command: "resume", description: "прошлые чаты" },
  { command: "new", description: "начать заново" },
  { command: "stop", description: "остановить агента" },
  { command: "mode", description: "режим разрешений" },
  { command: "model", description: "сменить модель" },
  { command: "project", description: "переключить проект" },
  { command: "stats", description: "расход и мой кот" },
  { command: "cats", description: "коты и достижения" },
  { command: "status", description: "канал выхода и лимиты" },
  { command: "logout", description: "удалить доступ" },
  { command: "help", description: "справка" },
]);

// Канал выхода выбирается до старта: если Anthropic недоступен, лучше узнать
// об этом в логе сразу, а не на первой задаче пользователя.
const choice = await chooseChannel(parsePool(config.proxyPool), {
  requireCountry: config.proxyRequireCountry || undefined,
});
setActiveChannel(choice.active);
for (const status of choice.checked) {
  const mark = status.reachable ? "✅" : "❌";
  const code = status.httpStatus === null ? status.error ?? "нет ответа" : `HTTP ${status.httpStatus}`;
  console.log(`${mark} ${status.candidate.label}: ${code}${status.country ? ` · ${status.country}` : ""}`);
}
if (choice.active) {
  console.log(`🌍 Выход: ${describeChannel(choice.active)}`);
} else {
  console.warn("⚠️  Рабочего канала до Anthropic нет. Агент не сможет работать.");
}

/**
 * Мини-апп вешается на кнопку меню Telegram — ту, что рядом с полем ввода.
 * Инлайн-кнопка внутри сообщения уезжает вверх с историей и теряется, а эта
 * висит всегда. Без chat_id значение становится умолчанием для всех чатов.
 */
if (config.miniappUrl) {
  await bot.api.setChatMenuButton({
    menu_button: {
      type: "web_app",
      text: "🐱 Кот",
      web_app: { url: config.miniappUrl },
    },
  });
  console.log(`🐱 Кнопка мини-аппа повешена на меню: ${config.miniappUrl}`);
} else {
  // Иначе осталась бы кнопка от прошлого запуска, ведущая в никуда.
  await bot.api.setChatMenuButton({ menu_button: { type: "commands" } });
}

startMiniAppServer();

console.log("🤖 Бот запущен");
await bot.start({ drop_pending_updates: true });
