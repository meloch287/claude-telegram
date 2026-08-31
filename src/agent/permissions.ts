import type { PermissionResult, PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";

/**
 * Мост между `canUseTool` из Agent SDK и кнопками в Telegram.
 *
 * Агент останавливается на вызове инструмента и ждёт ровно столько, сколько
 * нужно — документация SDK прямо разрешает держать колбэк pending бесконечно.
 * Единственное, чего делать нельзя, — вернуть `null`: это fail-closed, вызов
 * останется заблокированным навсегда. Поэтому любой выход отсюда резолвится.
 */

export type Decision =
  | { kind: "allow" }
  | { kind: "allow_always" }
  | { kind: "deny"; message?: string }
  | { kind: "stop" };

export interface PendingPermission {
  id: string;
  chatId: number;
  toolName: string;
  input: Record<string, unknown>;
  /** Готовая формулировка от бриджа SDK, например «Claude wants to read foo.txt». */
  title?: string;
  displayName?: string;
  description?: string;
  suggestions: PermissionUpdate[];
  toolUseID: string;
  /** id сообщения-карточки в Telegram, чтобы отредактировать его после решения. */
  messageId?: number;
  createdAt: number;
  resolve: (decision: Decision) => void;
}

export interface PendingQuestion {
  id: string;
  chatId: number;
  questions: QuestionSpec[];
  answers: Record<string, string>;
  index: number;
  messageId?: number;
  resolve: (result: PermissionResult) => void;
}

export interface QuestionSpec {
  question: string;
  header: string;
  options: { label: string; description: string }[];
  multiSelect?: boolean;
}

let counter = 0;
function nextId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}${counter.toString(36)}${Date.now().toString(36).slice(-4)}`;
}

const permissions = new Map<string, PendingPermission>();
const questions = new Map<string, PendingQuestion>();
/** Чат → id разрешения, для которого пользователь сейчас пишет причину отказа. */
const awaitingComment = new Map<number, string>();

export function getPermission(id: string): PendingPermission | undefined {
  return permissions.get(id);
}

export function getQuestion(id: string): PendingQuestion | undefined {
  return questions.get(id);
}

export function resolvePermission(id: string, decision: Decision): PendingPermission | undefined {
  const pending = permissions.get(id);
  if (!pending) return undefined;
  permissions.delete(id);
  awaitingComment.delete(pending.chatId);
  pending.resolve(decision);
  return pending;
}

export function beginDenyComment(chatId: number, permissionId: string): void {
  awaitingComment.set(chatId, permissionId);
}

export function pendingCommentFor(chatId: number): string | undefined {
  return awaitingComment.get(chatId);
}

export function cancelDenyComment(chatId: number): void {
  awaitingComment.delete(chatId);
}

/**
 * Ждём ли мы сейчас ответа пользователя в этом чате. Нужно сторожу зависаний:
 * пока висит карточка, тишина со стороны агента — это норма, а не поломка.
 */
export function hasPending(chatId: number): boolean {
  for (const pending of permissions.values()) if (pending.chatId === chatId) return true;
  for (const pending of questions.values()) if (pending.chatId === chatId) return true;
  return false;
}

/** Все висящие запросы чата — нужно закрыть при /new, /stop и падении сессии. */
export function flushChat(chatId: number, decision: Decision): number {
  let closed = 0;
  for (const [id, pending] of permissions) {
    if (pending.chatId !== chatId) continue;
    permissions.delete(id);
    pending.resolve(decision);
    closed += 1;
  }
  for (const [id, pending] of questions) {
    if (pending.chatId !== chatId) continue;
    questions.delete(id);
    pending.resolve({
      behavior: "deny",
      message: decision.kind === "deny" && decision.message
        ? decision.message
        : "Диалог сброшен пользователем",
    });
    closed += 1;
  }
  awaitingComment.delete(chatId);
  return closed;
}

export interface PermissionBridgeHooks {
  /** Показать карточку разрешения. Возвращает id отправленного сообщения. */
  onAsk(pending: PendingPermission): Promise<number | undefined>;
  /** Показать очередной вопрос AskUserQuestion. */
  onQuestion(pending: PendingQuestion): Promise<number | undefined>;
  /** Сработало по таймауту — сообщить пользователю, что запрос протух. */
  onTimeout(pending: PendingPermission): Promise<void>;
}

export interface PermissionBridgeOptions {
  chatId: number;
  timeoutMs: number;
  /** Инструменты, одобряемые молча (дублирует allowedTools, но покрывает ask-правила). */
  autoApprove: Set<string>;
  hooks: PermissionBridgeHooks;
}

export interface DecisionRequest {
  chatId: number;
  toolName: string;
  input: Record<string, unknown>;
  timeoutMs: number;
  hooks: PermissionBridgeHooks;
  signal: AbortSignal;
  suggestions?: PermissionUpdate[];
  title?: string;
  displayName?: string;
  description?: string;
  toolUseID: string;
}

/**
 * Показывает карточку и ждёт решения пользователя.
 *
 * Вынесено из моста, потому что спрашивать нужно из двух мест: обычный путь
 * через canUseTool и сторож опасных команд на PreToolUse, который работает
 * там, где canUseTool не зовут вовсе.
 *
 * Функция обязана разрешиться всегда: любой выход — таймаут, обрыв, неудачная
 * отправка карточки — даёт отказ, но не молчание. Молчание здесь означало бы
 * навсегда заблокированный вызов.
 */
export function requestDecision(request: DecisionRequest): Promise<Decision> {
  const { chatId, toolName, input, timeoutMs, hooks, signal } = request;
  const id = nextId("p");

  return new Promise<Decision>((resolvePromise) => {
    let settled = false;
    const finish = (decision: Decision) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      permissions.delete(id);
      resolvePromise(decision);
    };

    const pending: PendingPermission = {
      id,
      chatId,
      toolName,
      input,
      title: request.title,
      displayName: request.displayName,
      description: request.description,
      suggestions: request.suggestions ?? [],
      toolUseID: request.toolUseID,
      createdAt: Date.now(),
      resolve: finish,
    };

    const onAbort = () => {
      permissions.delete(id);
      finish({ kind: "deny", message: "Запрос отменён" });
    };
    signal.addEventListener("abort", onAbort, { once: true });

    const timer = setTimeout(() => {
      permissions.delete(id);
      void hooks.onTimeout(pending);
      finish({ kind: "deny", message: "Пользователь не ответил на запрос разрешения вовремя" });
    }, timeoutMs);
    // Висящий таймер не должен удерживать процесс живым при выключении.
    timer.unref?.();

    permissions.set(id, pending);
    void hooks
      .onAsk(pending)
      .then((messageId) => {
        const stored = permissions.get(id);
        if (stored) stored.messageId = messageId;
      })
      .catch((error: unknown) => {
        // Не смогли показать карточку — молча блокировать нельзя.
        permissions.delete(id);
        finish({ kind: "deny", message: `Не удалось запросить подтверждение: ${String(error)}` });
      });
  });
}

/** Решение пользователя в форму, которую понимает SDK. */
export function decisionToResult(
  decision: Decision,
  suggestions: PermissionUpdate[] = [],
): PermissionResult {
  switch (decision.kind) {
    case "allow":
      return { behavior: "allow" };
    case "allow_always":
      return {
        behavior: "allow",
        // Правила с destination localSettings пишутся в .claude/settings.local.json,
        // поэтому «Всегда» переживает перезапуск сессии.
        updatedPermissions: suggestions.filter(
          (s) => s.destination === "localSettings" || s.destination === "session",
        ),
      };
    case "deny":
      return {
        behavior: "deny",
        message: decision.message ?? "Пользователь отклонил это действие",
      };
    case "stop":
      return { behavior: "deny", message: "Пользователь остановил работу", interrupt: true };
  }
}

export function createPermissionBridge(options: PermissionBridgeOptions) {
  const { chatId, timeoutMs, autoApprove, hooks } = options;

  return async function canUseTool(
    toolName: string,
    input: Record<string, unknown>,
    ctx: {
      signal: AbortSignal;
      suggestions?: PermissionUpdate[];
      title?: string;
      displayName?: string;
      description?: string;
      toolUseID: string;
    },
  ): Promise<PermissionResult> {
    if (toolName === "AskUserQuestion") {
      return askQuestion(chatId, input, hooks);
    }

    if (autoApprove.has(toolName)) {
      return { behavior: "allow" };
    }

    const decision = await requestDecision({
      chatId,
      toolName,
      input,
      timeoutMs,
      hooks,
      signal: ctx.signal,
      suggestions: ctx.suggestions,
      title: ctx.title,
      displayName: ctx.displayName,
      description: ctx.description,
      toolUseID: ctx.toolUseID,
    });
    return decisionToResult(decision, ctx.suggestions ?? []);
  };
}

async function askQuestion(
  chatId: number,
  input: Record<string, unknown>,
  hooks: PermissionBridgeHooks,
): Promise<PermissionResult> {
  const specs = Array.isArray(input.questions) ? (input.questions as QuestionSpec[]) : [];
  if (specs.length === 0) {
    return { behavior: "allow", updatedInput: { questions: [], answers: {} } };
  }

  const id = nextId("q");
  return new Promise<PermissionResult>((resolve) => {
    const pending: PendingQuestion = {
      id,
      chatId,
      questions: specs,
      answers: {},
      index: 0,
      resolve: (result) => {
        questions.delete(id);
        resolve(result);
      },
    };
    questions.set(id, pending);
    void hooks.onQuestion(pending).then((messageId) => {
      const stored = questions.get(id);
      if (stored) stored.messageId = messageId;
    });
  });
}

/** Пользователь выбрал вариант — переходим к следующему вопросу или отдаём ответы агенту. */
export function answerQuestion(
  id: string,
  optionLabel: string,
): { pending: PendingQuestion; done: boolean } | undefined {
  const pending = questions.get(id);
  if (!pending) return undefined;

  const current = pending.questions[pending.index];
  if (!current) return undefined;
  pending.answers[current.question] = optionLabel;
  pending.index += 1;

  const done = pending.index >= pending.questions.length;
  if (done) {
    pending.resolve({
      behavior: "allow",
      updatedInput: { questions: pending.questions, answers: pending.answers },
    });
  }
  return { pending, done };
}
