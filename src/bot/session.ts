import { mkdirSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { Api } from "grammy";
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { Conversation } from "../agent/conversation.js";
import { TelegramOutput } from "./output.js";
import { config } from "../config.js";
import {
  credentialFor,
  getChat,
  getOrCreateUser,
  recordSessionStart,
  recordRateLimit,
  recordToolDecision,
  recordUsage,
  recordWorldWork,
  saveChat,
} from "../db.js";
import { checkAchievements, renderUnlocked } from "../achievements.js";

export interface ChatSession {
  conversation: Conversation;
  output: TelegramOutput;
  project: string;
}

const sessions = new Map<number, ChatSession>();

/** Имя проекта попадает в путь на диске — режем всё, кроме безопасных символов. */
export function sanitizeProject(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё._-]+/gi, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 48);
  return cleaned || "default";
}

export function workspaceFor(userId: number, project: string): string {
  const safe = sanitizeProject(project);
  const root = resolve(config.workspaceRoot, String(userId));
  const dir = resolve(root, safe);
  // Страховка от `..` в имени: путь обязан остаться внутри каталога пользователя.
  if (dir !== root && !dir.startsWith(root + sep)) {
    throw new Error(`Недопустимое имя проекта: ${name(project)}`);
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

function name(value: string): string {
  return value.slice(0, 40);
}

export function getSession(chatId: number): ChatSession | undefined {
  return sessions.get(chatId);
}

export interface EnsureOptions {
  api: Api;
  chatId: number;
  userId: number;
  /** Показать пользователю разблокированные достижения. */
  notify(html: string): Promise<unknown>;
}

export function ensureSession(options: EnsureOptions): ChatSession {
  const existing = sessions.get(options.chatId);
  if (existing && !existing.conversation.closed) return existing;

  const { api, chatId, userId, notify } = options;
  const user = getOrCreateUser(userId);
  const chatRow = getChat(chatId);
  const project = chatRow?.project ?? "default";
  const cwd = workspaceFor(userId, project);

  const credential = credentialFor(userId);
  if (!credential) throw new Error("Не выполнен вход: /start");

  const output = new TelegramOutput(api, chatId);
  // Кнопкам под ответом нужно знать, где искать репозиторий.
  output.projectDir = cwd;
  const permissionMode = (chatRow?.permission_mode ??
    config.defaultPermissionMode) as PermissionMode;

  const conversation = new Conversation({
    chatId,
    userId,
    cwd,
    credential,
    model: user.model,
    permissionMode,
    permissionTimeoutMs: config.permissionTimeoutMs,
    resumeSessionId: chatRow?.session_id ?? null,
    output,
    onUsage: ({ tokens, costUsd, task, commits, pushes }) => {
      recordWorldWork(userId, { tasks: task ? 1 : 0, commits, pushes });
      if (tokens <= 0 && costUsd <= 0) return;
      recordUsage(userId, tokens, costUsd);
      const unlocked = checkAchievements(userId, { type: "usage" });
      if (unlocked.length > 0) void notify(renderUnlocked(unlocked));
    },
    onSessionId: (sessionId) => {
      const current = getChat(chatId);
      if (current?.session_id !== sessionId) recordSessionStart(userId);
      saveChat({
        chatId,
        userId,
        project,
        sessionId,
        title: current?.title ?? null,
        permissionMode,
      });
    },
    onResumeLost: () => {
      const current = getChat(chatId);
      saveChat({
        chatId,
        userId,
        project,
        sessionId: null,
        title: current?.title ?? null,
        permissionMode,
      });
    },
    onToolDecision: (toolName, allowed) => {
      recordToolDecision(userId, allowed);
      const unlocked = checkAchievements(userId, { type: "tool", toolName, allowed });
      if (unlocked.length > 0) void notify(renderUnlocked(unlocked));
    },
    onRateLimit: (limit) => {
      // Только запись для /status и мини-аппа. В чат про лимиты не пишем:
      // SDK присылал «лимит исчерпан», когда по факту запаса было полно, и
      // это только пугало (04.09.2026). Если запрос реально отклонён, ошибка
      // и так придёт ответом на сообщение.
      recordRateLimit(userId, limit);
    },
  });

  const session: ChatSession = { conversation, output, project };
  sessions.set(chatId, session);
  return session;
}

/** Закрывает диалог и забывает session_id — следующее сообщение начнёт с чистого листа. */
export async function resetSession(chatId: number, userId: number): Promise<void> {
  const session = sessions.get(chatId);
  if (session) {
    await session.conversation.close();
    sessions.delete(chatId);
  }
  const chatRow = getChat(chatId);
  saveChat({
    chatId,
    userId,
    project: chatRow?.project ?? "default",
    sessionId: null,
    permissionMode: chatRow?.permission_mode ?? config.defaultPermissionMode,
  });
}

/** Смена проекта = смена рабочей папки, поэтому текущий диалог закрывается. */
export async function switchProject(
  chatId: number,
  userId: number,
  project: string,
): Promise<string> {
  const safe = sanitizeProject(project);
  const session = sessions.get(chatId);
  if (session) {
    await session.conversation.close();
    sessions.delete(chatId);
  }
  saveChat({
    chatId,
    userId,
    project: safe,
    sessionId: null,
    permissionMode: config.defaultPermissionMode,
  });
  workspaceFor(userId, safe);
  return safe;
}

export async function closeAll(): Promise<void> {
  await Promise.allSettled([...sessions.values()].map((s) => s.conversation.close()));
  sessions.clear();
}

/**
 * Фоновые задачи.
 *
 * Основной диалог у чата один: вторая просьба встаёт в очередь и ждёт. Это
 * правильно для разговора, но мешает, когда хочется запустить длинное «прогони
 * тесты и почини» и продолжать разговаривать.
 *
 * Фоновая задача — отдельная сессия в той же папке проекта: свой контекст, свой
 * счёт токенов, свои карточки разрешений. Отвечает она в тот же чат, но
 * помечает себя, иначе два потока сообщений не различить.
 */

/** Больше двух на чат не пускаем: карточки разрешений от трёх задач сразу не разобрать. */
const MAX_BACKGROUND = 2;

interface BackgroundTask {
  id: number;
  prompt: string;
  startedAt: number;
  conversation: Conversation;
}

const background = new Map<number, Map<number, BackgroundTask>>();
let backgroundSeq = 0;

export function backgroundTasks(chatId: number): BackgroundTask[] {
  return [...(background.get(chatId)?.values() ?? [])];
}

export class TooManyBackgroundTasks extends Error {
  constructor() {
    super(`больше ${MAX_BACKGROUND} фоновых задач на чат не запускается`);
  }
}

export async function startBackgroundTask(
  options: EnsureOptions & { prompt: string },
): Promise<number> {
  const { api, chatId, userId, notify, prompt } = options;

  const running = background.get(chatId) ?? new Map<number, BackgroundTask>();
  if (running.size >= MAX_BACKGROUND) throw new TooManyBackgroundTasks();

  const user = getOrCreateUser(userId);
  const chatRow = getChat(chatId);
  const project = chatRow?.project ?? "default";
  const cwd = workspaceFor(userId, project);

  const credential = credentialFor(userId);
  if (!credential) throw new Error("Не выполнен вход: /start");

  const id = ++backgroundSeq;
  const output = new TelegramOutput(api, chatId);
  // Строку состояния фоновая задача не ведёт: две строки, перебивающие друг
  // друга, читаются как мигание. О ходе дела скажет отчёт в конце.
  output.quiet = true;

  let finished = false;
  const finish = async (итог: string) => {
    if (finished) return;
    finished = true;
    running.delete(id);
    if (running.size === 0) background.delete(chatId);
    await notify(итог);
    await task.conversation.close().catch(() => undefined);
  };

  const conversation = new Conversation({
    chatId,
    userId,
    cwd,
    credential,
    model: user.model,
    // Фоновая задача не начинает с чужого места: продолжать чей-то диалог она
    // не должна, у неё своя мысль.
    permissionMode: (chatRow?.permission_mode ?? config.defaultPermissionMode) as PermissionMode,
    permissionTimeoutMs: config.permissionTimeoutMs,
    resumeSessionId: null,
    output,
    onUsage: ({ tokens, costUsd, task, commits, pushes }) => {
      recordWorldWork(userId, { tasks: task ? 1 : 0, commits, pushes });
      if (tokens > 0 || costUsd > 0) recordUsage(userId, tokens, costUsd);
      // Один результат — одна законченная задача: дальше ей нечего делать.
      void finish(`✅ Фоновая задача №${id} готова: <i>${prompt.slice(0, 80)}</i>`);
    },
    onSessionId: () => {},
    onResumeLost: () => {},
    onToolDecision: (toolName, allowed) => recordToolDecision(userId, allowed),
    onRateLimit: (limit) => recordRateLimit(userId, limit),
  });

  const task: BackgroundTask = { id, prompt, startedAt: Date.now(), conversation };
  running.set(id, task);
  background.set(chatId, running);

  await conversation.send(prompt);
  return id;
}

/** Останавливает фоновую задачу. false — такой не было. */
export async function stopBackgroundTask(chatId: number, id: number): Promise<boolean> {
  const task = background.get(chatId)?.get(id);
  if (!task) return false;
  await task.conversation.close().catch(() => undefined);
  background.get(chatId)?.delete(id);
  return true;
}

/**
 * Канал выхода сменился.
 *
 * Адрес прокси подпроцесс агента получает один раз, при запуске, и живёт с ним
 * много ходов подряд (см. buildEnv в conversation.ts). После смены канала он
 * так и бился бы в мёртвый адрес, пока SDK не исчерпает повторы: в чате это
 * выглядело как бесконечное «связь оборвалась, переподключаюсь» (21.09.2026).
 * Поэтому живые диалоги закрываем: следующее сообщение поднимет сессию заново,
 * уже с новым каналом, а контекст вернётся через resume по session_id из базы.
 *
 * close() ждёт, пока подпроцесс доиграет, а застрявший в повторах доигрывает
 * минутами — поэтому из реестра сессию убираем сразу, а закрытие не ждём.
 * Фоновые задачи закрываем тоже: продолжать им нечем.
 *
 * Возвращает число закрытых диалогов.
 */
export function restartSessionsForChannelChange(): number {
  let closed = 0;
  for (const [chatId, session] of sessions) {
    sessions.delete(chatId);
    if (session.conversation.closed) continue;
    closed++;
    const wasBusy = session.conversation.busy;
    void session.conversation
      .interrupt()
      .catch(() => undefined)
      .then(() => session.conversation.close())
      .catch(() => undefined);
    // Простаивающий диалог переподнимется незаметно. Прерванную задачу
    // человек должен увидеть: иначе она просто перестанет отвечать.
    if (wasBusy) {
      void session.output
        .send(
          "⚠️ Канал выхода в интернет сменился, текущую задачу пришлось прервать.\n\n" +
            "Напиши, что делать дальше — продолжу с того же места.",
        )
        .catch(() => undefined);
    }
  }
  for (const [chatId, tasks] of background) {
    for (const task of tasks.values()) {
      closed++;
      void task.conversation.close().catch(() => undefined);
    }
    background.delete(chatId);
  }
  return closed;
}
