import {syncClaudeGitHub} from "../dist/github.js";
import { readFile } from "node:fs/promises";
import { InlineKeyboard } from "grammy";
import { runInWorker } from "./worker.mjs";
import { userId } from "./policy.mjs";
const script = await readFile(new URL("./github-keys.py", import.meta.url), "utf8");
const esc = (s) =>
  String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
export function parseGitAuthor(value) {
  const parts = value.split("|").map((s) => s.trim());
  const hasControl = [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
  if (
    parts.length !== 2 ||
    !parts[0] ||
    parts[0].length > 100 ||
    hasControl ||
    /[<>]/.test(parts[0]) ||
    parts[1].length > 254 ||
    !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(parts[1])
  )
    throw Error("Формат: /github author Имя Фамилия | email@example.com");
  return { name: parts[0], email: parts[1] };
}
export function createGitHubService({
  run = runInWorker,
  sync = run === runInWorker ? syncClaudeGitHub : async () => {},
  profile = async (login) => {
    const response = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "gpt-telegram-bot" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw Error("GitHub profile unavailable");
    return response.json();
  },
} = {}) {
  async function action(uid, kind, data = {}) {
    userId(uid);
    try {
      const out = await run(
        uid,
        ["python3", "-c", script, kind, String(uid), "/home/agent", JSON.stringify(data)],
        { timeout: 30000, maxBuffer: 32768 },
      );
      const result = JSON.parse(out.stdout);
      if (!/^ssh-ed25519 [A-Za-z0-9+/=]+ ai-bot-[0-9]+$/.test(result.publicKey))
        throw Error("Invalid public key");
      await sync(uid);
      return result;
    } catch {
      throw Error("Не удалось настроить GitHub. Проверь место на диске и повтори /github.");
    }
  }
  return {
    key: (uid) => action(uid, "key"),
    author: (uid, value) => action(uid, "author", parseGitAuthor(value)),
    async check(uid) {
      const result = await action(uid, "check");
      if (
        result.connection === "connected" &&
        !result.login.includes("/") &&
        (!result.author.name || !result.author.email)
      ) {
        try {
          const account = await profile(result.login);
          if (
            !Number.isSafeInteger(account.id) ||
            account.id <= 0 ||
            typeof account.login !== "string" ||
            account.login.toLowerCase() !== result.login.toLowerCase()
          )
            throw Error("Invalid profile");
          const author = await action(uid, "autoauthor", {
            name: account.login,
            email: `${account.id}+${account.login}@users.noreply.github.com`,
          });
          result.author = author.author;
        } catch {
          /* SSH works even if GitHub's public profile API is unavailable. */
        }
      }
      return result;
    },
  };
}
export function githubView(result, { showKey = false } = {}) {
  const kb = new InlineKeyboard();
  if (result.connection === "connected" && !showKey) {
    const author =
      result.author.name && result.author.email
        ? `\n\n✍️ Коммиты: ${esc(result.author.name)}\n<code>${esc(result.author.email)}</code>`
        : "\n\n✍️ Укажи автора коммитов кнопкой ниже.";
    return {
      text: `✅ <b>GitHub подключён</b>\n${esc(result.login.includes("/") ? "Репозиторий: " + result.login : "Аккаунт: @" + result.login)}${author}\n\nПришли ссылку на репозиторий и задачу: изучить код, внести правки, сделать коммит или push. Один личный ключ работает в GPT, Claude и bb.`,
      keyboard: kb
        .text("🔑 SSH-ключ", "github:key")
        .text("✍️ Автор коммитов", "github:author")
        .row()
        .text("🔄 Проверить", "github:check"),
    };
  }
  const status =
    {
      not_added:
        "⏳ GitHub пока не принял ключ. Добавь его как <b>Authentication Key</b> и проверь снова.\n\n",
      unavailable: "🌐 GitHub сейчас не отвечает. Повтори проверку чуть позже.\n\n",
      host_key_error: "⚠️ Не удалось подтвердить сервер GitHub. Подключение остановлено.\n\n",
    }[result.connection] || "";
  return {
    text: `🐙 <b>Твой GitHub</b>\n\n${status}1. Скопируй публичный SSH-ключ:\n<code>${esc(result.publicKey)}</code>\n\n2. Открой настройки GitHub → <b>New SSH key</b> → <b>Authentication Key</b>, вставь ключ и сохрани.\n3. Нажми «Проверить».\n\n🔐 Закрытый ключ доступен только твоим GPT и Claude на сервере.`,
    keyboard: kb
      .url("🔗 Добавить ключ в GitHub", "https://github.com/settings/ssh/new")
      .row()
      .text("✅ Я добавил — проверить", "github:check")
      .row()
      .text("✍️ Автор коммитов", "github:author"),
  };
}
export function registerGitHub(bot, { show, admit, service = createGitHubService() }) {
  const render = (ctx, result, options) => {
    const view = githubView(result, options);
    return show(ctx, view.text, view.keyboard, { parse_mode: "HTML" });
  };
  async function perform(ctx, kind, value) {
    await admit(ctx.from.id);
    if (kind === "check") await show(ctx, "🔎 Проверяю подключение к GitHub…");
    const result = await service[kind](ctx.from.id, value);
    if (kind === "author")
      return show(
        ctx,
        `✅ Автор коммитов сохранён\n\n${result.author.name}\n${result.author.email}`,
        new InlineKeyboard().text("⬅️ GitHub", "github:key"),
      );
    return render(ctx, result, { showKey: kind === "key" });
  }
  bot.command("github", async (ctx) => {
    const value = ctx.match.trim();
    if (value === "check") return perform(ctx, "check");
    if (value.startsWith("author ")) return perform(ctx, "author", value.slice(7));
    if (value) return ctx.reply("Команды: /github · /github check · /github author Имя | email");
    return perform(ctx, "check");
  });
  bot.hears(/^(?:github|гитхаб)$/i, (ctx) => perform(ctx, "check"));
  bot.callbackQuery(/^github:(key|check|author)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (ctx.match[1] === "author")
      return show(
        ctx,
        "✍️ Автор коммитов\n\nОтправь команду:\n/github author Имя Фамилия | email@example.com\n\nМожно указать приватный noreply-email из настроек GitHub → Emails.",
        new InlineKeyboard()
          .url("Email в GitHub", "https://github.com/settings/emails")
          .row()
          .text("⬅️ Назад", "github:key"),
      );
    return perform(ctx, ctx.match[1]);
  });
}

export const GITHUB_CONTEXT =
  "GitHub подключается на уровне пользователя и доступен во всех его диалогах. Если существует /home/agent/.ssh/gpt-github/id_ed25519, используй общий SSH-ключ и GIT_CONFIG_GLOBAL=/home/agent/.gitconfig. Сведения последней проверки — /home/agent/.ssh/gpt-github/account.json. Проверка: ssh -T git@github.com; фраза successfully authenticated означает успех даже с кодом 1. gh auth status проверяет отдельный OAuth и не означает, что GitHub по SSH не подключён. Не проси повторную авторизацию без реальной проверки SSH/git. Не показывай приватный ключ.\n";
