import { InlineKeyboard, type Context } from "grammy";
import { config } from "../config.js";
import {
  credentialFor,
  getCredential,
  getOrCreateUser,
  inviterOf,
  setCredential,
  markOnboarded,
} from "../db.js";
import { detectKind, describeKind, maskSecret, type AuthKind } from "../auth.js";
import { renderScreen } from "./screens.js";

/** Пользователи, от которых сейчас ждём токен или ключ. */
const awaiting = new Map<number, AuthKind>();

export function awaitingKindFor(userId: number): AuthKind | undefined {
  return awaiting.get(userId);
}

export function startAwaiting(userId: number, kind: AuthKind): void {
  awaiting.set(userId, kind);
}

export function stopAwaiting(userId: number): void {
  awaiting.delete(userId);
}

/** Стартовый экран — то же меню, что и по /menu, плюс предупреждение о доступе. */
export async function sendStart(ctx: Context): Promise<void> {
  const userId = ctx.from!.id;

  // Приглашённого не спрашиваем ни о каком ключе: он работает по подписке
  // владельца, и экран входа для него — тупик. Раньше бот встречал его
  // просьбой прислать токен, а на «привет» отвечал «не похоже на токен».
  if (!getCredential(userId) && credentialFor(userId)) {
    getOrCreateUser(userId);
    markOnboarded(userId);
    // Если он до этого успел попасть на экран входа, снимаем ожидание токена:
    // иначе следующее «привет» бот снова разберёт как ключ.
    stopAwaiting(userId);
    await ctx.reply("Клод бот\n\nНапиши задачу или отправь вложение.",{reply_markup:new InlineKeyboard().text("GPT","engine:gpt").text("Claude ✓","engine:claude")});
    return;
  }

  const view = renderScreen("menu", { userId, chatId: ctx.chat!.id });
  const openAccess =
    config.allowedUserIds.length === 0
      ? `\n\n⚠️ Бот открыт всем. Твой id: <code>${ctx.from?.id}</code> — впиши в <code>ALLOWED_USER_IDS</code>.`
      : "";
  await ctx.reply(`${view.text}${openAccess}`, {
    parse_mode: "HTML",
    reply_markup: view.keyboard,
  });
}

const SUBSCRIPTION_PROMPT = `
🎫 <b>Вход по подписке</b>

На компьютере, где стоит Claude Code, выполни:

<code>claude setup-token</code>

Команда проведёт через тот же браузерный вход, что и обычно, и выдаст долгоживущий токен. Пришли его следующим сообщением.

Сообщение с токеном удалю сразу. Сам токен шифрую AES-256-GCM и держу в своей базе; убрать — /logout.
`.trim();

const API_PROMPT = `
🔌 <b>Вход по API-ключу</b>

1. <b>console.anthropic.com</b> → API keys → Create key
2. Скопируй ключ (начинается с <code>sk-ant-</code>)
3. Пришли следующим сообщением

Сообщение с ключом удалю сразу. Ключ шифрую AES-256-GCM; убрать — /logout.
`.trim();

export async function askForCredential(ctx: Context, kind: AuthKind): Promise<void> {
  await ctx.reply(kind === "subscription" ? SUBSCRIPTION_PROMPT : API_PROMPT, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

export async function finishLogin(ctx: Context, userId: number, secret: string): Promise<void> {
  const user = getOrCreateUser(userId);
  const kind = user.auth_kind ?? "api";

  await ctx.reply(
    `✅ Вошёл: ${describeKind(kind)} · <code>${maskSecret(secret)}</code>\n\n` +
      `Просто напиши, что нужно сделать.\n\n` +
      `<code>/resume</code> — вернуться в один из прошлых чатов\n` +
      `<code>/help</code> — все команды`,
    { parse_mode: "HTML" },
  );
}

/**
 * Принимает присланный секрет. Возвращает false, если он не похож ни на токен
 * подписки, ни на ключ API, — тогда пользователю показывается подсказка.
 */
export function acceptCredential(userId: number, text: string, chosen: AuthKind): boolean {
  const value = text.trim();
  // Форма подписочного токена однозначна и перебивает выбор кнопкой: промахнуться
  // кнопкой легко. Но если форму не опознали — идём за выбором пользователя,
  // а не отказываем: форматы секретов у Anthropic со временем меняются.
  const kind = detectKind(value) ?? (value.length >= 20 ? chosen : null);
  if (kind === null) return false;
  setCredential(userId, { kind, secret: value });
  markOnboarded(userId);
  return true;
}

