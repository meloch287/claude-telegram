import { query, type Query, type SDKMessage, type SDKUserMessage, type PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { MessageQueue } from "./queue.js";
import { createPermissionBridge, flushChat, type PermissionBridgeHooks } from "./permissions.js";
import { describeToolShort, chunk, formatUsd, formatDuration, esc, TELEGRAM_LIMIT } from "./render.js";
import { credentialEnv, type Credential } from "../auth.js";
import { activeProxyUrl } from "../proxy.js";

export interface ConversationOutput {
  /** Отправить сообщение, вернуть его message_id. */
  send(html: string): Promise<number | undefined>;
  /** Строка состояния: одно сообщение, которое перерисовывается по ходу работы. */
  status(html: string): Promise<void>;
  /** Убрать строку состояния (работа закончена). */
  clearStatus(finalHtml?: string): Promise<void>;
  /** Дописать живой ответ. force — отрисовать немедленно, минуя троттлинг. */
  stream(text: string, force?: boolean): Promise<void>;
  /** Ответ закончен: следующий пойдёт в новое сообщение. */
  endStream(): Promise<void>;
  typing(): Promise<void>;
  /** «Печатает…» на всё время работы: статус живёт 5 секунд и требует пульса. */
  startTyping(): void;
  stopTyping(): void;
  permissionHooks: PermissionBridgeHooks;
}

export interface ConversationUsage {
  tokens: number;
  costUsd: number;
}

export interface ConversationDeps {
  chatId: number;
  userId: number;
  cwd: string;
  credential: Credential;
  /** null — модель по умолчанию, как в обычном Claude Code. */
  model: string | null;
  permissionMode: PermissionMode;
  permissionTimeoutMs: number;
  resumeSessionId: string | null;
  output: ConversationOutput;
  /** Вызывается на каждом result с ДЕЛЬТОЙ расхода, не с накопленным итогом. */
  onUsage(usage: ConversationUsage): void;
  onSessionId(sessionId: string): void;
  /** Сохранённой сессии не оказалось на диске — забыть её в базе. */
  onResumeLost(): void;
  onToolDecision(toolName: string, allowed: boolean): void;
  /** Лимиты подписки. Приходят событием по ходу работы, а не по запросу. */
  onRateLimit(limit: RateLimitUpdate): void;
}

export interface RateLimitUpdate {
  limitType: string;
  status: "allowed" | "allowed_warning" | "rejected";
  utilization?: number;
  resetsAt?: number;
}

/**
 * Читающие инструменты одобряются молча — в терминале Claude Code ведёт себя
 * так же. Всё, что меняет файлы или запускает команды, уходит в кнопки.
 */
const AUTO_APPROVED = ["Read", "Glob", "Grep", "TodoWrite", "WebSearch"];

/**
 * Окружение подпроцесса. Лишний способ входа нужно именно удалить: если
 * оставить унаследованный ANTHROPIC_API_KEY рядом с токеном подписки, работа
 * молча пойдёт по API — то есть по деньгам вместо лимитов подписки.
 */
function buildEnv(credential: Credential): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  for (const [key, value] of Object.entries(credentialEnv(credential))) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }

  // Канал выхода выбран на старте пробой. Пустая строка — идти напрямую;
  // тогда унаследованные переменные прокси нужно снять, иначе подпроцесс
  // всё равно уйдёт в них.
  const proxy = activeProxyUrl();
  for (const key of ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"]) {
    if (proxy) env[key] = proxy;
    else delete env[key];
  }
  return env;
}

const SYSTEM_APPEND = `
Ты работаешь через Telegram-бота. Собеседник читает тебя с телефона.

- Отвечай коротко. Один-два абзаца там, где в терминале написал бы десять.
- Не вываливай большие куски кода в ответ: правь файлы инструментами, а в сообщении говори, что изменил.
- Не рисуй ASCII-таблицы и деревья каталогов — в мобильном клиенте они разъезжаются.
- Markdown-разметку не используй: сообщения уходят в Telegram как обычный текст.
- Если задача длинная, коротко сообщай о ходе работы между шагами.
`.trim();

/**
 * Один живой диалог = один вызов query() со streaming input.
 *
 * Пока очередь сообщений не закрыта, сессия жива: можно доталкивать реплики,
 * дёргать interrupt() и менять режим разрешений на лету. Альтернатива —
 * новый query() на каждое сообщение с resume — теряет всё это и переплачивает
 * на прогреве.
 */
export class Conversation {
  readonly chatId: number;
  #deps: ConversationDeps;
  #queue = new MessageQueue<SDKUserMessage>();
  #query: Query | null = null;
  #pump: Promise<void> | null = null;
  #sessionId: string | null = null;
  #busy = false;
  #activity: string[] = [];
  #liveText = "";
  #lastText: string | null = null;
  #resumeSessionId: string | null;
  #closed = false;

  // modelUsage и total_cost_usd в streaming-сессии накопительные:
  // каждый result содержит итог с начала сессии. Пишем в статистику разницу.
  #lastTokens = 0;
  #lastCost = 0;

  constructor(deps: ConversationDeps) {
    this.#deps = deps;
    this.chatId = deps.chatId;
    this.#resumeSessionId = deps.resumeSessionId;
  }

  get sessionId(): string | null {
    return this.#sessionId;
  }

  get busy(): boolean {
    return this.#busy;
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** Добавляет реплику пользователя. Первый вызов поднимает сессию. */
  async send(text: string): Promise<void> {
    if (this.#closed) throw new Error("Диалог уже закрыт");
    if (!this.#query) this.#start();
    this.#busy = true;
    this.#activity = [];
    this.#liveText = "";
    this.#lastText = text;
    this.#queue.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      session_id: this.#sessionId ?? "",
    } as SDKUserMessage);

    this.#deps.output.startTyping();
    // Первый инструмент может появиться через десяток секунд, а до тех пор
    // чат выглядит мёртвым. Строку состояния показываем сразу.
    await this.#deps.output.status("принял, думаю…");
  }

  async interrupt(): Promise<void> {
    if (!this.#query) return;
    flushChat(this.chatId, { kind: "deny", message: "Пользователь остановил работу" });
    try {
      await this.#query.interrupt();
    } catch {
      // interrupt доступен только в streaming-режиме и только пока сессия жива;
      // если она уже завершилась, гасить нечего.
    }
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.#deps.permissionMode = mode;
    if (!this.#query) return;
    await this.#query.setPermissionMode(mode);
  }

  async setModel(model: string): Promise<void> {
    if (!this.#query) return;
    await this.#query.setModel(model);
  }

  /** Закрывает сессию: очередь завершается, query() доигрывает и выходит. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#deps.output.stopTyping();
    flushChat(this.chatId, { kind: "deny", message: "Сессия закрыта" });
    if (!this.#queue.closed) this.#queue.close();
    try {
      await this.#pump;
    } catch {
      // Ошибку насоса уже показали пользователю в #pumpMessages.
    }
  }

  #start(): void {
    const { credential, model, cwd, permissionMode, permissionTimeoutMs, output } = this.#deps;
    const resumeSessionId = this.#resumeSessionId;

    const canUseTool = createPermissionBridge({
      chatId: this.chatId,
      timeoutMs: permissionTimeoutMs,
      autoApprove: new Set(AUTO_APPROVED),
      hooks: output.permissionHooks,
    });

    this.#query = query({
      prompt: this.#queue,
      options: {
        cwd,
        ...(model ? { model } : {}),
        // Набор инструментов не урезаем: это обычный Claude Code, просто в чате.
        allowedTools: AUTO_APPROVED,
        permissionMode,
        // Без этого флага SDK не пускает в bypassPermissions вовсе.
        ...(permissionMode === "bypassPermissions"
          ? { allowDangerouslySkipPermissions: true }
          : {}),
        canUseTool,
        ...(resumeSessionId ? { resume: resumeSessionId } : {}),
        systemPrompt: { type: "preset", preset: "claude_code", append: SYSTEM_APPEND },
        // Без этого SDK отдаёт только готовые сообщения, и в чате тишина всё
        // время, пока модель печатает.
        includePartialMessages: true,
        // env заменяет окружение подпроцесса целиком, а не дополняет его,
        // поэтому process.env нужно расстелить руками — иначе не будет PATH.
        env: buildEnv(credential),
        stderr: (data: string) => {
          if (data.trim()) console.error(`[claude:${this.chatId}] ${data.trim()}`);
        },
      },
    });

    this.#pump = this.#pumpMessages();
  }

  async #pumpMessages(): Promise<void> {
    if (!this.#query) return;
    try {
      for await (const message of this.#query) {
        await this.#handle(message);
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.#busy = false;
      this.#deps.output.stopTyping();
      flushChat(this.chatId, { kind: "deny", message: "Сессия упала" });
      this.#query = null;
      this.#queue = new MessageQueue<SDKUserMessage>();

      // Сохранённая сессия не найдена: файлы могли пропасть вместе с
      // пересборкой контейнера, а идентификатор в базе остался. Начинаем
      // заново и повторяем реплику — пользователю незачем это разгребать.
      if (/No conversation found/i.test(text) && this.#resumeSessionId) {
        this.#resumeSessionId = null;
        this.#sessionId = null;
        this.#deps.onResumeLost();
        await this.#deps.output.clearStatus();
        await this.#deps.output.send("↻ Прошлый чат не нашёлся, начинаю новый.");
        if (this.#lastText) await this.send(this.#lastText);
        return;
      }

      await this.#deps.output.clearStatus();
      await this.#deps.output.send(
        `⚠️ Сессия оборвалась.\n\n<code>${esc(text.slice(0, 500))}</code>\n\nНапиши что-нибудь — я подниму её заново.`,
      );
    }
  }

  async #handle(message: SDKMessage): Promise<void> {
    const { output } = this.#deps;

    switch (message.type) {
      case "system": {
        if (message.subtype === "init") {
          this.#sessionId = message.session_id;
          this.#deps.onSessionId(message.session_id);
        }
        return;
      }

      case "stream_event": {
        // Кусочки текста по мере генерации: из них и собирается живой ответ.
        const event = message.event as {
          type?: string;
          delta?: { type?: string; text?: string };
        };
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
          this.#liveText += event.delta.text ?? "";
          await output.stream(this.#liveText);
        }
        return;
      }

      case "assistant": {
        for (const block of message.message.content) {
          if (block.type === "text" && block.text.trim()) {
            const full = block.text.trim();
            // Дорисовываем начисто: в потоке могли пропасть куски из-за
            // троттлинга, а это окончательный текст блока.
            if (full.length <= TELEGRAM_LIMIT) {
              await output.stream(full, true);
            } else {
              await output.endStream();
              for (const part of chunk(esc(full))) await output.send(part);
            }
            this.#liveText = "";
            await output.endStream();
          } else if (block.type === "tool_use") {
            this.#activity.push(
              describeToolShort(block.name, (block.input ?? {}) as Record<string, unknown>),
            );
            await this.#renderActivity();
          }
        }
        return;
      }

      case "rate_limit_event": {
        const info = message.rate_limit_info;
        // Тип окна может не прийти — тогда записывать нечего: без него
        // непонятно, к чему относится процент.
        if (info.rateLimitType) {
          this.#deps.onRateLimit({
            limitType: info.rateLimitType,
            status: info.status,
            utilization: info.utilization,
            resetsAt: info.resetsAt,
          });
        }
        return;
      }

      case "result": {
        this.#busy = false;
        this.#deps.output.stopTyping();
        const tokens = totalTokens(message);
        const cost = message.total_cost_usd ?? 0;

        // Дельта: значения накопительные с начала сессии.
        const deltaTokens = Math.max(0, tokens - this.#lastTokens);
        const deltaCost = Math.max(0, cost - this.#lastCost);
        this.#lastTokens = tokens;
        this.#lastCost = cost;
        this.#deps.onUsage({ tokens: deltaTokens, costUsd: deltaCost });

        for (const denial of message.permission_denials ?? []) {
          this.#deps.onToolDecision(denial.tool_name, false);
        }

        const summary =
          message.subtype === "success"
            ? `✅ Готово · ${formatDuration(message.duration_ms)} · ${formatTokensShort(deltaTokens)} · ${formatUsd(deltaCost)}`
            : `⚠️ Прервано: ${esc(message.subtype)}`;
        await output.clearStatus(summary);

        if (message.subtype !== "success" && "result" in message && message.result) {
          await output.send(esc(String(message.result).slice(0, 1000)));
        }
        return;
      }

      default:
        return;
    }
  }

  #lastRender = 0;
  async #renderActivity(): Promise<void> {
    // Telegram душит частые правки сообщений; полторы секунды — безопасный шаг.
    const now = Date.now();
    if (now - this.#lastRender < 1500) return;
    this.#lastRender = now;
    const tail = this.#activity.slice(-6);
    const more = this.#activity.length - tail.length;
    const head = more > 0 ? `<i>…ещё ${more} шаг(ов)</i>\n` : "";
    await this.#deps.output.status(`${head}${tail.join("\n")}`);
  }
}

/**
 * Считаем вход и выход, но НЕ чтение кэша.
 *
 * Чтение кэша стоит десятую часть обычного токена и растёт лавинообразно: на
 * реальной истории оно даёт 59 миллиардов против 232 миллионов настоящих.
 * Сложив всё вместе, счётчик показывал бы числа, к которым проделанная работа
 * отношения не имеет, и уровни котов брались бы за неделю.
 *
 * modelUsage, а не usage: второй покрывает только главный цикл и занижает
 * расход на задачах с субагентами.
 */
function totalTokens(message: Extract<SDKMessage, { type: "result" }>): number {
  const models = message.modelUsage ?? {};
  let total = 0;
  for (const usage of Object.values(models)) {
    total += usage.inputTokens + usage.outputTokens;
  }
  return total;
}

function formatTokensShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M токенов`;
  if (n >= 1_000) return `${Math.round(n / 1000)}k токенов`;
  return `${n} токенов`;
}
