import {
  Bot,
  GrammyError,
  HttpError,
  InlineKeyboard,
  InputFile,
  type CommandContext,
  type Context,
} from "grammy";
import { statSync, readdirSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { listSessions, type PermissionMode } from "@anthropic-ai/claude-agent-sdk";
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
  resolvePermission,
} from "./agent/permissions.js";
import {
  closeAll,
  ensureSession,
  getSession,
  resetSession,
  switchProject,
  workspaceFor,
  backgroundTasks,
  startBackgroundTask,
  stopBackgroundTask,
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
import { MODELS, commitKeyboard } from "./bot/keyboards.js";
import { isScreenId, renderScreen, type ScreenId } from "./bot/screens.js";
import { checkAchievements, renderUnlocked, unlockedIds } from "./achievements.js";
import { ACHIEVEMENTS, CAT_LEVELS, catForTokens, formatTokens, nextCat } from "./cats.js";
import { esc, formatUsd } from "./agent/render.js";
import { limitTitle, percentOf, toMillis, WINDOWS } from "./limits.js";
import { subscriptionUsage } from "./subscription-usage.js";
import { saveTelegramFile } from "./bot/attachments.js";
import { transcribe, transcriptionConfigured, TranscriptionNotConfigured } from "./bot/voice.js";
import { speechConfigured } from "./bot/speak.js";
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
import { setBotUsername, startMiniAppServer } from "./miniapp/server.js";
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

// Раньше всего остального: иначе первые же строки о выборе канала и о том,
// что пошло не так на старте, в файл не попадут — а именно они нужны, когда
// бот не поднялся.
startFileLog();

const bot = new Bot(config.botToken);

/** Владелец — первый в списке из .env. Он один распоряжается доступом. */
function ownerId(): number | undefined {
  return config.allowedUserIds[0];
}

/**
 * Кому можно пользоваться ботом: список из .env плюс выданные из чата.
 *
 * Список из .env главный и неотзываемый — он остаётся последним рубежом, если
 * базу потеряли или испортили. Выданное командой /admin лежит в базе и
 * отзывается там же.
 */
function isAllowed(userId: number): boolean {
  if (config.allowedUserIds.length === 0) return true;
  if (config.allowedUserIds.includes(userId)) return true;
  return isUserAllowedInDb(userId);
}

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
    await ctx.reply(`Этот бот приватный. Твой номер: ${userId}`);
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

// ── Вход ─────────────────────────────────────────────────────────────────────

bot.command("start", async (ctx) => {
  await sendStart(ctx);
});

bot.command("help", async (ctx) => {
  await ctx.reply(HELP, { parse_mode: "HTML" });
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
bot.command("resume", async (ctx) => {
  const userId = ctx.from!.id;
  const chatRow = getChat(ctx.chat.id);
  const project = chatRow?.project ?? "default";
  const cwd = workspaceFor(userId, project);

  // «/resume все» — чаты из всех проектов пользователя. Без этого чат,
  // начатый в другом проекте, найти было нельзя вовсе.
  const wantsAll = /^(все|всё|all)$/i.test(ctx.match?.toString().trim() ?? "");

  let sessions;
  try {
    if (wantsAll) {
      const root = resolve(config.workspaceRoot, String(userId));
      const projects = readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
      const found = await Promise.all(
        projects.map(async (name) => {
          const list = await listSessions({ dir: join(root, name), limit: 10 }).catch(() => []);
          return list.map((item) => ({ ...item, project: name }));
        }),
      );
      sessions = found
        .flat()
        .sort((a, b) => Number(new Date(b.lastModified)) - Number(new Date(a.lastModified)))
        .slice(0, 10);
    } else {
      sessions = await listSessions({ dir: cwd, limit: 10 });
    }
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

async function showDiff(ctx: CommandContext<Context> | Context): Promise<void> {
  const repo = await resolveRepo(ctx);
  if (!repo) return;

  try {
    const state = await status(repo);
    if (state.entries.length === 0) {
      await ctx.reply(`${describeStatus(state, repo)}\n\nЧисто: менять нечего.`, {
        parse_mode: "HTML",
      });
      return;
    }

    const summary = await gitDiff(repo);
    const head = `${describeStatus(state, repo)}\n\n<b>Изменено файлов: ${summary.files}</b>`;
    const stat = summary.stat ? `\n<pre>${esc(summary.stat)}</pre>` : "";
    await ctx.reply(head + stat, { parse_mode: "HTML" });

    // Сам дифф отправляем файлом: в сообщении он и не поместится, и читаться
    // на телефоне будет плохо, а файл открывается просмотрщиком.
    if (summary.patch.trim()) {
      const note = summary.truncated ? " (обрезан)" : "";
      await ctx.replyWithDocument(
        new InputFile(Buffer.from(summary.patch, "utf8"), `${basename(repo)}.diff`),
        { caption: `Полный дифф${note}` },
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
bot.callbackQuery(/^act:(go|diff|commit|test)$/, async (ctx) => {
  const действие = ctx.match[1];
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);

  if (действие === "diff") {
    await ctx.answerCallbackQuery("Смотрю изменения");
    await showDiff(ctx);
    return;
  }
  if (действие === "commit") {
    await ctx.answerCallbackQuery("Готовлю коммит");
    await startCommit(ctx, "");
    return;
  }

  const задача =
    действие === "go" ? "Продолжай." : "Прогони тесты проекта. Если упали — разберись и почини.";
  await ctx.answerCallbackQuery(действие === "go" ? "Продолжаю" : "Запускаю тесты");
  // Эхо задачи в чат: иначе в переписке остаётся ответ без вопроса, и через
  // день непонятно, с чего бот вдруг побежал.
  await ctx.reply(`▶️ <i>${esc(задача)}</i>`, { parse_mode: "HTML" });
  await runTask(ctx, задача);
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
/** Чаты, где бот читает вслух всегда, а не только в ответ на голосовое. */
const alwaysVoice = new Set<number>();

/**
 * Постоянная озвучка. На голосовое бот отвечает голосом и без неё; эта команда
 * для тех, кто пишет текстом, а слушать хочет.
 */
bot.command("voice", async (ctx) => {
  const chatId = ctx.chat.id;
  if (!speechConfigured()) {
    await ctx.reply("Озвучка не настроена: задай <code>TTS_URL</code> в <code>.env</code>.", {
      parse_mode: "HTML",
    });
    return;
  }
  if (alwaysVoice.has(chatId)) {
    alwaysVoice.delete(chatId);
    await ctx.reply("🔇 Больше не читаю вслух. На голосовые всё равно отвечу голосом.");
    return;
  }
  alwaysVoice.add(chatId);
  await ctx.reply("🔊 Буду читать ответы вслух. Выключить — /voice ещё раз.");
});

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
      // Токены и деньги ставим рядом только там, где они про один период:
      // импортированная история идёт отдельной строкой, стоимости у неё нет.
      `В боте: ${formatTokens(user.total_tokens - user.history_tokens)} токенов · ${formatUsd(user.total_cost_usd)}`,
      ...(user.history_tokens > 0
        ? [`Импортировано: ${formatTokens(user.history_tokens)} токенов (без стоимости)`]
        : []),
      `Всего с историей: ${formatTokens(user.total_tokens)} токенов`,
      `Сегодня: ${formatTokens(today.tokens)} токенов`,
      `Сообщений: ${user.total_messages - user.history_messages} · сессий: ${user.total_sessions}`,
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

  // Спрашивают про остаток — значит хотят свежее число, а не то, что осело
  // после прошлой задачи. Живой сессии может и не быть: тогда покажем базу.
  const session = getSession(ctx.chat.id);
  if (session) await session.conversation.refreshRateLimits(true);
  const lines = [
    "<b>Чат</b>",
    chat?.title ? esc(chat.title) : "новый — ещё ни одной задачи",
    "",
    "<b>Канал выхода</b>",
    channel
      ? `✅ ${esc(describeChannel(channel))}`
      : "❌ рабочего канала нет — Anthropic недоступен ни напрямую, ни через прокси",
  ];

  // Две шкалы показываем всегда: недельное окно присылает событие только на
  // подходе к пределу, и до тех пор строка просто отсутствовала — это читалось
  // как поломка, хотя данных действительно нет.
  const known = new Map(listRateLimits(ctx.from!.id).map((row) => [row.limit_type, row]));

  lines.push("", "<b>Лимиты подписки</b>");
  for (const { type, ms } of WINDOWS) {
    const row = known.get(type);
    const own = subscriptionUsage(ms);
    const viaBot = usageSince(ctx.from!.id, ms);
    const parts = [`<b>${esc(limitTitle(type))}</b>`];
    const ceiling = type === "five_hour" ? config.limitFiveHourTokens : config.limitSevenDayTokens;
    const свой = percentOf(own.tokens, ceiling);
    if (row?.utilization != null) {
      parts.push(`${Math.round(row.utilization)}%`);
    } else if (свой !== null) {
      // Процент от своего потолка: у Anthropic его этим токеном не взять.
      parts.push(`${свой}% из 100 (${formatTokens(own.tokens)} из ${formatTokens(ceiling)})`);
    } else {
      parts.push(`замер ${formatTokens(own.tokens)} (через бота ${formatTokens(viaBot.tokens)})`);
    }
    if (row?.resets_at) {
      parts.push(
        `сброс ${new Date(toMillis(row.resets_at)).toLocaleString("ru-RU", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })}`,
      );
    }
    lines.push(parts.join(" · "));
  }

  if (![...known.values()].some((row) => row.utilization != null)) {
    lines.push(
      "",
      "<i>Процент считается от своего потолка: число Anthropic приходит с claude.ai, " +
        "а он с этого сервера отдаёт проверку Cloudflare. Расход берётся из транскриптов — " +
        "всё, что сделал Claude Code на сервере, вместе с кэшем. Потолок задаётся в .env: " +
        "LIMIT_FIVE_HOUR_TOKENS и LIMIT_SEVEN_DAY_TOKENS.</i>",
    );
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
async function runTask(ctx: Context, prompt: string, вслух = false): Promise<boolean> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (userId === undefined || chatId === undefined) return false;

  const остаток = quotaLeft(userId);
  if (остаток && остаток.left <= 0) {
    await ctx.reply(
      `📊 Суточная квота исчерпана: ${formatTokens(остаток.used)} из ${formatTokens(остаток.limit)} токенов.\n\n` +
        "Она обнулится завтра. Или попроси того, кто тебя позвал, поднять предел.",
    );
    return false;
  }

  recordMessage(userId);
  try {
    const session = ensureSession({
      api: ctx.api,
      chatId,
      userId,
      notify: (html) => ctx.reply(html, { parse_mode: "HTML" }),
    });
    // Голосом отвечаем на голосовое или когда включён постоянный режим.
    // Ставится на каждую задачу: иначе после одного голосового бот заговорил бы
    // навсегда, а этого никто не просил.
    session.output.voiceReply = вслух || alwaysVoice.has(chatId);
    await session.conversation.send(prompt);
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
    saved = await saveTelegramFile(ctx.api, fileId, cwd, suggested);
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

  await runTask(ctx, prompt);
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
    saved = await saveTelegramFile(ctx.api, media.file_id, cwd, suggested);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ctx.reply(`⚠️ Не смог принять видео: ${esc(message)}`, { parse_mode: "HTML" });
    return;
  }

  const caption = ctx.message.caption?.trim();
  await ctx.reply(
    `🎬 Сохранил <code>${esc(saved.name)}</code>. Смотреть видео я не умею, но файл на месте — скажи, что с ним делать.`,
    { parse_mode: "HTML" },
  );

  await runTask(
    ctx,
    caption
      ? `${caption}\n\nВидеофайл лежит здесь: ${saved.path}`
      : `Пользователь прислал видеофайл: ${saved.path}. Содержимое посмотреть нельзя — при необходимости используй инструменты (например, ffmpeg через Bash).`,
  );
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
    const response = await fetch(url);
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

  await runTask(ctx, text, true);
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
      permissionMode: chatRow?.permission_mode ?? "default",
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
  { command: "file", description: "забрать файл из проекта" },
  { command: "context", description: "насколько заполнен контекст" },
  { command: "bg", description: "запустить задачу в фоне" },
  { command: "stop", description: "остановить агента" },
  { command: "mode", description: "режим разрешений" },
  { command: "model", description: "сменить модель" },
  { command: "clone", description: "забрать репозиторий" },
  { command: "diff", description: "что изменилось в коде" },
  { command: "commit", description: "закоммитить изменения" },
  { command: "project", description: "переключить проект" },
  { command: "stats", description: "расход и мой кот" },
  { command: "cats", description: "коты и достижения" },
  { command: "status", description: "канал выхода и лимиты" },
  { command: "voice", description: "читать ответы вслух" },
  { command: "logs", description: "хвост лога (владельцу)" },
  { command: "admin", description: "кому можно пользоваться ботом (владельцу)" },
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
}

/**
 * Дальше канал перепроверяется сам. Владельцу пишем только о смене: молчаливое
 * переключение выглядело бы как необъяснимая пауза в работе, а сообщение на
 * каждую проверку раз в десять минут превратилось бы в шум.
 */
startChannelWatch(parsePool(config.proxyPool), {
  requireCountry: config.proxyRequireCountry || undefined,
  onChange: (next, previous) => {
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

// Имя нужно мини-аппу для ссылки «поделиться». Спрашиваем один раз: меняется
// оно разве что вручную в BotFather.
const me = await bot.api.getMe().catch(() => null);
if (me?.username) setBotUsername(me.username);

startMiniAppServer();
scheduleDailyBackups();

console.log("🤖 Бот запущен");
await bot.start({ drop_pending_updates: true });
