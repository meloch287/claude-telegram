import { mkdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { Api } from "grammy";
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { Conversation } from "../agent/conversation.js";
import { TelegramOutput } from "./output.js";
import { config } from "../config.js";
import {
  getCredential,
  getChat,
  getOrCreateUser,
  recordSessionStart,
  recordToolDecision,
  recordUsage,
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

  const credential = getCredential(userId);
  if (!credential) throw new Error("Не выполнен вход: /start");

  const output = new TelegramOutput(api, chatId);
  const permissionMode = (chatRow?.permission_mode ?? "default") as PermissionMode;

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
    onUsage: ({ tokens, costUsd }) => {
      if (tokens <= 0 && costUsd <= 0) return;
      recordUsage(userId, tokens, costUsd);
      const unlocked = checkAchievements(userId, { type: "usage" });
      if (unlocked.length > 0) void notify(renderUnlocked(unlocked));
    },
    onSessionId: (sessionId) => {
      const current = getChat(chatId);
      if (current?.session_id !== sessionId) recordSessionStart(userId);
      saveChat({ chatId, userId, project, sessionId, permissionMode });
    },
    onToolDecision: (toolName, allowed) => {
      recordToolDecision(userId, allowed);
      const unlocked = checkAchievements(userId, { type: "tool", toolName, allowed });
      if (unlocked.length > 0) void notify(renderUnlocked(unlocked));
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
    permissionMode: chatRow?.permission_mode ?? "default",
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
  saveChat({ chatId, userId, project: safe, sessionId: null, permissionMode: "default" });
  workspaceFor(userId, safe);
  return safe;
}

export async function closeAll(): Promise<void> {
  await Promise.allSettled([...sessions.values()].map((s) => s.conversation.close()));
  sessions.clear();
}
