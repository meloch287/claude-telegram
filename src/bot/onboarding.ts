import type { Context } from "grammy";
import { config } from "../config.js";
import { getOrCreateUser, setCredential, setTier } from "../db.js";
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
  const view = renderScreen("menu", { userId: ctx.from!.id, chatId: ctx.chat!.id });
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
export function acceptCredential(userId: number, text: string): boolean {
  const value = text.trim();
  // Верим формату, а не нажатой кнопке: промахнуться кнопкой легко, а секрет
  // однозначно опознаётся по виду.
  const kind = detectKind(value);
  if (kind === null) return false;
  setCredential(userId, { kind, secret: value });
  setTier(userId, "max"); // тарифов больше нет, поле лишь помечает пройденный вход
  return true;
}

export const HELP = `
<b>Команды</b>

/menu — главное меню
/resume — прошлые чаты списком, вернуться кнопкой
/new — начать с чистого листа
/stop — прервать агента
/mode — спрашивать разрешения / править молча / только план
/model — сменить модель
/project имя — переключить рабочую папку
/stats — расход и мой кот
/cats — коты и достижения
/logout — удалить сохранённый доступ
/help — это сообщение

<b>Как это работает</b>

Пишешь задачу текстом. Агент работает в папке проекта и на каждое опасное действие присылает карточку: разрешить, отклонить, отклонить с объяснением, «всегда разрешать» — последнее запоминается и в следующих сессиях не спрашивается.

Пока агент работает, сверху висит строка состояния с текущими шагами. Кнопка «Стоп» в карточке или /stop прерывают немедленно.
`.trim();
