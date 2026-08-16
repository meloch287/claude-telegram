import type { Context } from "grammy";
import { config } from "../config.js";
import { getOrCreateUser, setCredential, markOnboarded } from "../db.js";
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

export const HELP = `
<b>Команды</b>

/menu — главное меню
/new — начать с чистого листа
/resume — прошлые чаты списком (/resume все — по всем проектам)
/context — насколько контекст заполнен
/stop — прервать агента
/file путь — забрать файл из проекта
/mode — спрашивать разрешения / править молча / только план
/model — сменить модель
/clone адрес — забрать репозиторий в проект
/diff — что изменилось в коде
/commit [текст] — закоммитить; без текста сообщение придумает модель
/project имя — переключить рабочую папку
/logs [строк] — хвост лога бота (владельцу)
/admin — кому можно пользоваться ботом (владельцу)
/stats — расход и мой кот
/cats — коты и достижения
/logout — удалить сохранённый доступ
/help — это сообщение

<b>Как это работает</b>

Пишешь задачу текстом. Агент работает в папке проекта и на каждое опасное действие присылает карточку: разрешить, отклонить, отклонить с объяснением, «всегда разрешать» — последнее запоминается и в следующих сессиях не спрашивается.

Пока агент работает, сверху висит строка состояния с текущими шагами — включая субагентов, которых он запускает сам. Кнопка «Стоп» в карточке или /stop прерывают немедленно.

<b>Что ещё понимает</b>

🎤 <b>Голосовые</b> — расшифрую и покажу текст, чтобы ты видел, что я расслышал.
📨 <b>Пересланное</b> — с подписью автора; серию сообщений склею в одну задачу.
📎 <b>Фото и файлы</b> — с подписью вместо объяснения.
📄 <b>Файлы обратно</b> — что агент создал за задачу, пришлю в чат; остальное по /file.
🎬 <b>Видео и кружки</b> — сохраню файлом; смотреть не умею, но скажу, где лежит.
🖼️ <b>Стикеры, гео, контакты, опросы</b> — переведу в текст и передам.
💭 <b>Ход мысли</b> виден, пока агент думает, — паузу больше не спутать с зависанием.
🖥️ <b>Вывод команд</b> и ошибки инструментов приходят в чат, а не только в пересказе.
⏳ <b>Фоновые задачи</b> отчитываются, когда закончат.
🧩 <b>Скиллы</b> — твои 56 плюс встроенные. Вызываются сами или командой: <code>/tdd</code>, <code>/shape</code>, <code>/review</code>.
📚 <b>MCP</b> — context7 (свежая документация библиотек) и deepwiki (разбор чужих репозиториев), подключены и не спрашивают разрешения на чтение.
🗺️ В режиме «только план» план приходит карточкой с кнопкой «План принят, работай».

В группе отзываюсь только на обращение: упоминание, ответ на моё сообщение или команду.
`.trim();
