import { syncWorkflows } from "../claude-workflows.js";
import { bbHolds } from "../bb-locks.js";
import { engineAllowed, engineClosedText } from "../engine-access.js";
import { createDialog, dialogRecord, prepareDialog, updateDialog } from "../agent/dialog-workspace.js";
import { claudePreferences } from "../claude-settings.js";
import { mkdirSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { Api } from "grammy";
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { Conversation } from "../agent/conversation.js";
import { TelegramOutput } from "./output.js";
import { config } from "../config.js";
import { prepareWorkspace } from "../agent/isolation.js";
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
  const safe = sanitizeProject(project), chat = getChat(userId);
  let record = chat?.session_id && chat.project === safe ? dialogRecord(userId, chat.session_id) : undefined;
  if (!record) {
    if (chat?.session_id && chat.project === safe) throw Error("Папка диалога не найдена. Открой /resume.");
    record = createDialog(userId, safe);
    saveChat({ chatId: userId, userId, project: safe, sessionId: record.id, permissionMode: chat?.permission_mode ?? config.defaultPermissionMode, title: chat?.project === safe ? chat.title : null });
  }
  return prepareDialog(userId, record);
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
  let chatRow = getChat(chatId);
  const project = chatRow?.project ?? "default";
  if (bbHolds(userId, chatRow?.session_id)) {
    throw new Error("этот диалог сейчас отвечает в рабочей зоне bb. Дождись ответа там или открой другой диалог в /resume.");
  }
  const cwd = workspaceFor(userId, project);
  chatRow = getChat(chatId);

  const credential = credentialFor(userId);
  if (!credential) throw new Error("Не выполнен вход: /start");

  const output = new TelegramOutput(api, chatId);
  // Кнопкам под ответом нужно знать, где искать репозиторий.
  output.projectDir = cwd;
  const permissionMode = (chatRow?.permission_mode ??
    config.defaultPermissionMode) as PermissionMode;

  try {
    // Новый пользователь мог появиться после старта бота — разложим и ему.
    syncWorkflows(userId);
  } catch (error) {
    console.error("[workflows]", error instanceof Error ? error.message : error);
  }
  const conversation = new Conversation({
    chatId,
    userId,
    cwd,
    credential,
    model: claudePreferences(userId).model,
    permissionMode,
    permissionTimeoutMs: config.permissionTimeoutMs,
    resumeSessionId: chatRow?.session_id && dialogRecord(userId, chatRow.session_id)?.started ? chatRow.session_id : null,
    initialSessionId: chatRow?.session_id ?? undefined,
    output,
    onUsage: ({ tokens, costUsd, task, commits, pushes }) => {
      recordWorldWork(userId, { tasks: task ? 1 : 0, commits, pushes });
      if (tokens <= 0 && costUsd <= 0) return;
      recordUsage(userId, tokens, costUsd);
      const unlocked = checkAchievements(userId, { type: "usage" });
      if (unlocked.length > 0) void notify(renderUnlocked(unlocked));
    },
    onSessionId: (sessionId) => {
      const wasStarted = dialogRecord(userId, sessionId)?.started;
      updateDialog(userId, sessionId, { started: true });
      const current = getChat(chatId);
      if (!wasStarted) recordSessionStart(userId);
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
    onContext: (context) => {
      // Индикатор контекста в bb берёт цифру отсюда, когда тред открывают.
      const id = getChat(chatId)?.session_id;
      if (id) try { updateDialog(userId, id, { context }); } catch { /* диалог удалён */ }
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

/** Закрывает простаивающий диалог, не трогая выбор: следующее сообщение поднимет его заново. */
export async function releaseIdleSession(chatId: number): Promise<void> {
  const session = sessions.get(chatId);
  if (!session || session.conversation.busy) return;
  sessions.delete(chatId);
  await session.conversation.close();
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
 * Фоновая задача — отдельная сессия со своей папкой: свой контекст, свой
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
  if (!engineAllowed("claude", userId)) throw new Error(engineClosedText("claude"));

  const running = background.get(chatId) ?? new Map<number, BackgroundTask>();
  if (running.size >= MAX_BACKGROUND) throw new TooManyBackgroundTasks();

  const user = getOrCreateUser(userId);
  const chatRow = getChat(chatId);
  const project = chatRow?.project ?? "default";
  const dialog = createDialog(userId, project);
  const cwd = prepareDialog(userId, dialog);

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

  try {
    // Новый пользователь мог появиться после старта бота — разложим и ему.
    syncWorkflows(userId);
  } catch (error) {
    console.error("[workflows]", error instanceof Error ? error.message : error);
  }
  const conversation = new Conversation({
    chatId,
    userId,
    cwd,
    credential,
    model: claudePreferences(userId).model,
    // Фоновая задача не начинает с чужого места: продолжать чей-то диалог она
    // не должна, у неё своя мысль.
    permissionMode: (chatRow?.permission_mode ?? config.defaultPermissionMode) as PermissionMode,
    permissionTimeoutMs: config.permissionTimeoutMs,
    resumeSessionId: null,
    initialSessionId: dialog.id,
    output,
    onUsage: ({ tokens, costUsd, task, commits, pushes }) => {
      recordWorldWork(userId, { tasks: task ? 1 : 0, commits, pushes });
      if (tokens > 0 || costUsd > 0) recordUsage(userId, tokens, costUsd);
      // Один результат — одна законченная задача: дальше ей нечего делать.
      void finish(`✅ Фоновая задача №${id} готова: <i>${prompt.slice(0, 80)}</i>`);
    },
    onSessionId: sessionId => updateDialog(userId, sessionId, { started: true, title: prompt.slice(0, 80) }),
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
      .interrupt(true)
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

/**
 * Смена модели или глубины посреди диалога: следующий запрос перечитает весь
 * диалог без кэша (кэш привязан к модели и, у большинства моделей, к глубине).
 * Предупреждаем, только если кэш ещё тёплый: диалог открыт или был занят меньше
 * часа назад (основной диалог держит кэш час). Вызывать до reloadClaudeSettings.
 */
export const CACHE_RESET_NOTICE = "⚠️ Диалог уже идёт: следующий ответ перечитает его целиком без кэша и съест больше лимита. Чтобы не тратить, меняй модель и глубину перед /new.";
export function claudeCacheWarm(chatId: number, now = Date.now()): boolean {
  const live = sessions.get(chatId);
  if (live && !live.conversation.closed && live.conversation.sessionId) return true;
  const chat = getChat(chatId);
  return !!chat?.session_id && now - chat.updated_at < 3600_000;
}

export async function reloadClaudeSettings(chatId: number): Promise<void> {
  const session = sessions.get(chatId);
  if (!session) return;
  if (session.conversation.busy) throw Error("Дождись завершения текущей задачи или нажми /stop");
  sessions.delete(chatId);
  await session.conversation.close();
}
