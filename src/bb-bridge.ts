/**
 * Мост «рабочая зона bb → Claude бота».
 *
 * Claude-диалог из bb ведёт тот же движок, что и Telegram: тот же Conversation,
 * та же папка диалога, та же сессия на диске. Поэтому история одна, а пишет
 * в неё один процесс — этот. Пока ход идёт из bb, Telegram этот диалог не
 * поднимает (bb-locks); занятый в Telegram диалог bb не трогает.
 *
 * Сокет — только для ai-gpt-backend (root, права 600): тот проверяет токен
 * контейнера и подставляет uid. Ответ хода — поток NDJSON:
 *   {type:"text", text}   — реплика агента (Markdown);
 *   {type:"status", text} — строка хода работы (шаги);
 *   {type:"note", text}   — служебное сообщение (ошибка, файл, просьба подтвердить);
 *   {type:"context", used, size} — заполненность контекста после хода (для индикатора bb);
 *   {type:"done", stopReason} — ход закончен.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { chmodSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Api } from "grammy";
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { Conversation, type ConversationOutput } from "./agent/conversation.js";
import type { PermissionBridgeHooks } from "./agent/permissions.js";
import { createDialog, dialogRecord, dialogRecords, prepareDialog, updateDialog, type DialogRecord } from "./agent/dialog-workspace.js";
import { TelegramOutput } from "./bot/output.js";
import { getSession, releaseIdleSession } from "./bot/session.js";
import { bbAcquire, bbHolds, bbRelease, bbStop } from "./bb-locks.js";
import { engineAllowed, engineClosedText } from "./engine-access.js";
import { adoptBbDialog, parseAdopt } from "./bb-adopt.js";
import { claudeModelLabel, claudeModels, claudePreferences, saveClaudePreferences } from "./claude-settings.js";
import { config } from "./config.js";
import {
  credentialFor,
  getChat,
  recordRateLimit,
  recordSessionStart,
  recordToolDecision,
  recordUsage,
  recordWorldWork,
} from "./db.js";

const ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export const BB_BRIDGE_SOCKET = join(config.dataDir, "claude-bb.sock");

type Event = { type: "text" | "status" | "note"; text: string } | { type: "context"; used: number; size: number } | { type: "done"; stopReason: "end_turn" | "cancelled" | "refusal" };

export function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|pre|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Вывод хода в bb. Реплики агента уходят как текст; журнал задачи, который
 * Telegram получает после результата, bb не нужен — у него свой журнал.
 * Карточки разрешений остаются в Telegram: там есть кнопки.
 */
export class BbOutput implements ConversationOutput {
  #emit: (event: Event) => void;
  #telegram: PermissionBridgeHooks;
  #active: () => boolean;

  constructor(emit: (event: Event) => void, telegramHooks: PermissionBridgeHooks, active: () => boolean) {
    this.#emit = emit;
    this.#telegram = telegramHooks;
    this.#active = active;
  }

  async send(html: string): Promise<number | undefined> {
    const text = plainText(html);
    if (text) this.#emit({ type: "note", text });
    return undefined;
  }
  async status(html: string): Promise<void> {
    const text = plainText(html);
    if (text) this.#emit({ type: "status", text });
  }
  async clearStatus(): Promise<void> {}
  async sendRich(markdown: string): Promise<number | undefined> {
    if (this.#active() && markdown.trim()) this.#emit({ type: "text", text: markdown });
    return undefined;
  }
  async document(path: string, caption?: string, fileName?: string): Promise<void> {
    this.#emit({ type: "note", text: `📎 Файл: ${fileName ?? path.split("/").pop()}${caption ? ` — ${plainText(caption)}` : ""} (лежит в папке диалога, в Telegram придёт по запросу)` });
  }
  async documentBytes(_bytes: Uint8Array, fileName: string): Promise<void> {
    this.#emit({ type: "note", text: `📎 Файл: ${fileName}` });
  }
  async documentFromText(_text: string, fileName: string): Promise<void> {
    this.#emit({ type: "note", text: `📎 Файл: ${fileName}` });
  }
  async typing(): Promise<void> {}
  startTyping(): void {}
  stopTyping(): void {}

  get permissionHooks(): PermissionBridgeHooks {
    const telegram = this.#telegram;
    return {
      onAsk: async (pending) => {
        this.#emit({ type: "note", text: "🔐 Нужно подтверждение — кнопки пришли в Telegram." });
        return telegram.onAsk(pending);
      },
      onQuestion: async (pending) => {
        this.#emit({ type: "note", text: "❓ Claude задал вопрос — ответь кнопками в Telegram." });
        return telegram.onQuestion(pending);
      },
      onTimeout: (pending) => telegram.onTimeout(pending),
    };
  }
}

class BridgeError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 512_000) throw new BridgeError(413, "Слишком длинное сообщение");
    chunks.push(chunk as Buffer);
  }
  if (!size) return {};
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    throw new BridgeError(400, "Нечитаемый запрос");
  }
}

function waitIdle(conversation: Conversation): Promise<void> {
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (!conversation.busy || conversation.closed) {
        clearInterval(timer);
        // Хвост после результата (сообщения об ошибке) успевает уйти.
        setTimeout(resolve, 700);
      }
    }, 250);
  });
}

export interface BridgeDeps {
  api: Api;
  /** Подменяются в тестах. */
  createConversation?: (deps: ConstructorParameters<typeof Conversation>[0]) => Conversation;
  prepare?: typeof prepareDialog;
  create?: typeof createDialog;
  adopt?: typeof adoptBbDialog;
}
/** Один перенос на тред bb за раз: повторный запрос ждёт первый, а не создаёт второй диалог. */
const adopting = new Map<string, Promise<string>>();
/** Выданные недавно пустые диалоги: bb ещё может прислать в них первый ход. */
const handedOut = new Map<string, number>();
const HAND_OUT_MS = 10 * 60_000;

/**
 * Диалог для новой ветки bb. bb создаёт и пробные сессии (узнать модели), в которых
 * никто не пишет, — поэтому пустой диалог, выданный больше 10 минут назад и так и не
 * начатый, отдаём снова, а не плодим «Новые диалоги». Открытый в Telegram не трогаем.
 */
function dialogForBb(userId: number, create: typeof createDialog): DialogRecord {
  const now = Date.now();
  for (const [id, at] of handedOut) if (now - at > HAND_OUT_MS) handedOut.delete(id);
  const project = getChat(userId)?.project ?? "default";
  const open = getSession(userId)?.conversation.sessionId ?? getChat(userId)?.session_id;
  const spare = dialogRecords(userId).find((r) => !r.started && !r.deleted && !r.origin && r.project === project && r.id !== open && !handedOut.has(`${userId}:${r.id}`));
  const record = spare ?? create(userId, project);
  handedOut.set(`${userId}:${record.id}`, now);
  return record;
}

/** Модели и глубина Claude для меню bb (агент tg-claude-acp). */
function settingsFor(userId: number) {
  const prefs = claudePreferences(userId);
  return {
    models: claudeModels(userId).map((m) => ({ value: m.value, name: claudeModelLabel(m), efforts: m.supportedEffortLevels ?? [] })),
    model: prefs.model,
    effort: prefs.effort,
  };
}

async function runTurn(deps: BridgeDeps, userId: number, sessionId: string, text: string, res: ServerResponse): Promise<void> {
  const record = dialogRecord(userId, sessionId);
  if (!record) throw new BridgeError(404, "Диалог не найден. Возможно, его удалили в Telegram.");
  const credential = credentialFor(userId);
  if (!credential) throw new BridgeError(403, "Claude не подключён: открой бота и выполни /start.");
  if (bbHolds(userId, sessionId)) throw new BridgeError(409, "Этот диалог уже отвечает в bb.");
  let conversation: Conversation | null = null;
  let stopped = false;
  // Сначала занять диалог: с этого момента Telegram его не поднимет.
  if (!bbAcquire(userId, sessionId, async () => { stopped = true; await conversation?.interrupt(); })) {
    throw new BridgeError(409, "Этот диалог уже отвечает в bb.");
  }
  const telegram = getSession(userId);
  const chat = getChat(userId);
  if (telegram && !telegram.conversation.closed && (telegram.conversation.sessionId === sessionId || chat?.session_id === sessionId)) {
    if (telegram.conversation.busy) {
      bbRelease(userId, sessionId);
      throw new BridgeError(409, "Этот диалог сейчас работает в Telegram. Дождись ответа там.");
    }
    await releaseIdleSession(userId);
  }
  res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
  const emit = (event: Event) => {
    if (!res.destroyed) res.write(JSON.stringify(event) + "\n");
  };
  res.once("close", () => {
    if (!res.writableFinished && conversation?.busy) {
      stopped = true;
      void conversation.interrupt().catch(() => undefined);
    }
  });
  try {
    const cwd = (deps.prepare ?? prepareDialog)(userId, record);
    const output = new BbOutput(emit, new TelegramOutput(deps.api, userId).permissionHooks, () => !!conversation?.busy);
    const options: ConstructorParameters<typeof Conversation>[0] = {
      chatId: userId,
      userId,
      cwd,
      credential,
      model: claudePreferences(userId).model,
      permissionMode: (chat?.permission_mode ?? config.defaultPermissionMode) as PermissionMode,
      permissionTimeoutMs: config.permissionTimeoutMs,
      resumeSessionId: record.started ? sessionId : null,
      initialSessionId: sessionId,
      output,
      onUsage: ({ tokens, costUsd, task, commits, pushes }) => {
        recordWorldWork(userId, { tasks: task ? 1 : 0, commits, pushes });
        if (tokens > 0 || costUsd > 0) recordUsage(userId, tokens, costUsd);
      },
      onSessionId: () => {
        if (!dialogRecord(userId, sessionId)?.started) {
          updateDialog(userId, sessionId, { started: true });
          recordSessionStart(userId);
        }
      },
      onResumeLost: () => {},
      onToolDecision: (_tool, allowed) => recordToolDecision(userId, allowed),
      onRateLimit: (limit) => recordRateLimit(userId, limit),
    };
    conversation = deps.createConversation ? deps.createConversation(options) : new Conversation(options);
    await conversation.send(text);
    await waitIdle(conversation);
    // Индикатор контекста в bb: без этого он навсегда застывал на цифре старого
    // провайдера (у Али 87% три дня).
    // Обычно цифра уже есть из итога хода; полный пересчёт SDK (~12 с) — только запасной путь.
    const known = conversation.lastContext?.();
    let timer: NodeJS.Timeout | undefined;
    const context = known && known.max > 0 ? known : await Promise.race([
      conversation.contextUsage?.().catch(() => null) ?? Promise.resolve(null),
      new Promise<null>((resolve) => { timer = setTimeout(resolve, 20000, null); }),
    ]).finally(() => clearTimeout(timer));
    if (context && context.max > 0) {
      const value = { used: context.total, size: context.max };
      try { updateDialog(userId, sessionId, { context: value }); } catch { /* диалог удалён */ }
      emit({ type: "context", ...value });
    }
    emit({ type: "done", stopReason: stopped ? "cancelled" : "end_turn" });
  } catch (error) {
    emit({ type: "note", text: `⚠️ ${error instanceof Error ? error.message : String(error)}` });
    emit({ type: "done", stopReason: "refusal" });
  } finally {
    bbRelease(userId, sessionId);
    await conversation?.close().catch(() => undefined);
    res.end();
  }
}

export function createBbBridgeHandler(deps: BridgeDeps) {
  const create = deps.create ?? createDialog;
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      if (req.method !== "POST") throw new BridgeError(405, "Нужен POST");
      const adoptMatch = /^\/v1\/(\d{1,15})\/adopt$/.exec(req.url ?? "");
      if (adoptMatch) {
        // Перенос Claude-диалога, начатого в bb на «Claude Code» контейнера (зовёт ai-gpt-backend).
        const userId = Number(adoptMatch[1]);
        if (!Number.isSafeInteger(userId) || userId <= 0) throw new BridgeError(400, "Неверный пользователь");
        if (!engineAllowed("claude", userId)) throw new BridgeError(403, engineClosedText("claude"));
        if (!credentialFor(userId)) throw new BridgeError(403, "Claude не подключён");
        const request = parseAdopt(await readJson(req));
        const key = `${userId}:${request.origin}`;
        const job = adopting.get(key) ?? (deps.adopt ?? adoptBbDialog)(userId, request).finally(() => adopting.delete(key));
        adopting.set(key, job);
        const sessionId = await job;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId }));
        return;
      }
      const match = /^\/v1\/(\d{1,15})\/(?:(new|settings)|([0-9a-f-]{36})\/(check|turn|cancel))$/.exec(req.url ?? "");
      if (!match) throw new BridgeError(404, "Неизвестный адрес");
      const userId = Number(match[1]);
      if (!Number.isSafeInteger(userId) || userId <= 0) throw new BridgeError(400, "Неверный пользователь");
      const body = await readJson(req);
      if (!engineAllowed("claude", userId) && match[4] !== "check" && match[4] !== "cancel") throw new BridgeError(403, engineClosedText("claude"));
      if (match[2] === "settings") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(settingsFor(userId)));
        return;
      }
      if (match[2]) {
        if (!credentialFor(userId)) throw new BridgeError(403, "Claude не подключён: открой бота и выполни /start.");
        const record = dialogForBb(userId, create);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId: record.id }));
        return;
      }
      const sessionId = match[3] ?? "";
      if (!ID.test(sessionId)) throw new BridgeError(400, "Неверный диалог");
      if (match[4] === "check") {
        res.writeHead(200, { "content-type": "application/json" });
        const record = dialogRecord(userId, sessionId);
        res.end(JSON.stringify({ ok: !!record, busy: bbHolds(userId, sessionId), context: record?.context ?? null }));
        return;
      }
      if (match[4] === "cancel") {
        const stopped = await bbStop(userId, sessionId);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ stopped }));
        return;
      }
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) throw new BridgeError(400, "Пустое сообщение");
      // Модель и глубина, выбранные в меню bb, — общие с Telegram: выбрал там — так и в боте.
      const prefs = claudePreferences(userId);
      const patch: Record<string, unknown> = {};
      if (typeof body.model === "string" && body.model !== prefs.model) patch.model = body.model;
      if ((body.effort === null || typeof body.effort === "string") && body.effort !== prefs.effort && "effort" in body) patch.effort = body.effort;
      if (Object.keys(patch).length) {
        try { saveClaudePreferences(userId, patch); } catch (error) { console.error("[bb-bridge] настройки из bb:", error instanceof Error ? error.message : error); }
      }
      handedOut.delete(`${userId}:${sessionId}`);
      await runTurn(deps, userId, sessionId, text, res);
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      const status = error instanceof BridgeError ? error.status : 500;
      if (status === 500) console.error("[bb-bridge]", error);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Ошибка моста" }));
    }
  };
}

export function startBbBridge(deps: BridgeDeps, path = BB_BRIDGE_SOCKET) {
  if (existsSync(path)) unlinkSync(path);
  const server = createServer(createBbBridgeHandler(deps));
  server.listen(path, () => chmodSync(path, 0o600));
  return server;
}
