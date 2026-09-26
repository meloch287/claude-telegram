import {
  query,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  type PermissionMode,
} from "@anthropic-ai/claude-agent-sdk";
import { MessageQueue } from "./queue.js";
import {
  createPermissionBridge,
  flushChat,
  hasPending,
  type PermissionBridgeHooks,
} from "./permissions.js";
import { createDangerGuard } from "./guard.js";
import {
  describeToolShort,
  chunk,
  formatDuration,
  esc,
  splitCodeBlocks,
  codeBlockFileName,
  RICH_LIMIT,
  describeToolMarkdown,
  details,
  fence,
  tail,
} from "./render.js";
import { loadMcpServers } from "../mcp.js";
import { snapshot, reportChanges, formatSize, type Snapshot } from "../bot/artifacts.js";
import { credentialEnv, type Credential } from "../auth.js";
import { activeProxyUrl } from "../proxy.js";
import { config } from "../config.js";

export interface ConversationOutput {
  /** Отправить сообщение, вернуть его message_id. */
  send(html: string): Promise<number | undefined>;
  /** Строка состояния: одно сообщение, которое перерисовывается по ходу работы. */
  status(html: string): Promise<void>;
  /** Убрать строку состояния (работа закончена). */
  clearStatus(finalHtml?: string): Promise<void>;
  /** Ответ агента: Markdown, который Telegram рисует сам (sendRichMessage). */
  sendRich(markdown: string): Promise<number | undefined>;
  /** Прочитать ответ вслух, если о том просили. Необязательно и не мешает тексту. */
  speak?(text: string): Promise<void>;
  /** Задача закончена: можно подвесить кнопки к последнему сообщению. */
  finished?(): Promise<void>;
  /** Отдать файл с диска. */
  document(path: string, caption?: string, fileName?: string): Promise<void>;
  /** Отдать файлом текст, которого на диске нет. */
  documentFromText(text: string, fileName: string, caption?: string): Promise<void>;
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
  /** Приходит только событием. Пусто — значит обновление из /usage, там его нет. */
  status?: "allowed" | "allowed_warning" | "rejected";
  utilization?: number;
  resetsAt?: number;
}

/**
 * Читающие инструменты одобряются молча — в терминале Claude Code ведёт себя
 * так же. Всё, что меняет файлы или запускает команды, уходит в кнопки.
 */
const AUTO_APPROVED = [
  "Read",
  "Glob",
  "Grep",
  "TodoWrite",
  "WebSearch",
  // Серверы MCP из mcp.json только читают: context7 отдаёт документацию
  // библиотек, deepwiki — разбор публичных репозиториев. Спрашивать на каждый
  // такой запрос — тот же шум, что и подтверждать Read.
  //
  // Имена перечислены поимённо, а не шаблоном: новый сервер должен сначала
  // спросить разрешение, а не получить его молча по совпадению префикса.
  "mcp__context7__query-docs",
  "mcp__context7__resolve-library-id",
  "mcp__deepwiki__ask_question",
  "mcp__deepwiki__read_wiki_contents",
  "mcp__deepwiki__read_wiki_structure",
];

/**
 * Скиллы и настройки берём из тех же источников, что обычный Claude Code:
 * `user` — ~/.claude (скиллы и глобальные настройки), `project` — CLAUDE.md и
 * .claude рабочей папки, `local` — личные правила проекта. Без этого поля SDK
 * не читает ничего, и агент в боте отличался бы от агента в терминале.
 */
const SETTING_SOURCES = ["user", "project", "local"] as const;

/** Не чаще раза в минуту: метод ходит в сеть, а задач за минуту бывает много. */
const RATE_LIMIT_REFRESH_MS = 60_000;

/**
 * Сколько молчания считать зависанием.
 *
 * В норме агент подаёт признаки жизни постоянно: куски текста, вызовы
 * инструментов, их результаты. Восемь минут полной тишины при том, что задача
 * числится идущей, — это уже не работа, а застрявшая сессия.
 */
const STALL_MS = 8 * 60_000;
/** Как часто смотреть. Чаще незачем: спешить тут некуда. */
const STALL_CHECK_MS = 60_000;

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
  // gh читает GH_TOKEN, git — свой credential helper (см. ниже). Оба берут
  // токен из окружения, поэтому в файлы конфигурации он не попадает.
  if (config.githubToken) {
    env.GITHUB_TOKEN = config.githubToken;
    env.GH_TOKEN = config.githubToken;
    // Helper отдаёт логин и пароль на stdout и читает токен из окружения:
    // так секрет не оседает в ~/.gitconfig внутри тома.
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "credential.https://github.com.helper";
    env.GIT_CONFIG_VALUE_0 =
      "!f() { echo username=x-access-token; echo password=$GITHUB_TOKEN; }; f";
  }

  const proxy = activeProxyUrl();
  for (const key of ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"]) {
    if (proxy) env[key] = proxy;
    else delete env[key];
  }
  return env;
}

/** Пределы журнала: больше на телефоне всё равно не читают. */
const MAX_STEPS = 40;
const MAX_OUTPUTS = 8;
const MAX_ERRORS = 5;
const OUTPUT_LIMIT = 1200;

const SYSTEM_APPEND = `
Ты работаешь через Telegram-бота. Собеседник читает тебя с телефона.

- Отвечай коротко. Один-два абзаца там, где в терминале написал бы десять.
- Не вываливай большие куски кода в ответ: правь файлы инструментами, а в сообщении говори, что изменил.
- Если задача длинная, коротко сообщай о ходе работы между шагами.

# Оформление ответа

Сообщения уходят в Telegram как Markdown, и Telegram рисует его сам: заголовки
через #, **жирный**, списки, таблицы, код в обратных кавычках и свёрнутые блоки
<details><summary>Название</summary> … </details>. Сплошной прозой не пиши:
стена абзацев на телефоне не читается. Структуру выбирай сам под содержание,
правило одно — всё, что длиннее трёх предложений, разбивай:

- заголовок ## на каждый смысловой блок: что сделал, что нашёл, что проверил;
- заголовки и названия свёрнутых блоков начинай с эмодзи по смыслу:
  🔧 что сделал, 🔍 что нашёл, ✅ проверки, ⚠️ риски, ➡️ следующий шаг;
- перечисления — списком, ключевые слова и цифры — жирным;
- сравнения, параметры, «было/стало» и результаты проверок — таблицей,
  а не абзацем;
- команды, пути, имена файлов — в обратных кавычках;
- подробности, нужные не всем (логи, разборы, длинные списки), — в свёрнутый
  <details>, чтобы главное читалось без раскрытия;
- деревья каталогов и ASCII-графику не рисуй.

Итог законченной задачи оформляй карточкой:

# <эмодзи по смыслу> <Название задачи в трёх-пяти словах>

**Статус:** ✔ готово | ⚠ готово с оговорками | ✖ не вышло — полфразы, что это значит

## 🧭 Итог

Два-четыре предложения: что сделано и что важно знать.

<details><summary>📋 Полный итог</summary>

Что именно менял, где и почему — списком. **➡️ Следующий шаг**, если он есть.

</details>

<details><summary>🔬 Проверки и подробности</summary>

Что проверял и чем — таблицей «проверка | итог»: команды, коды ответов, тесты. Что не проверял — тоже.

</details>

Между тегами details/summary и содержимым — пустая строка. Короткие ответы на
вопросы карточкой не оформляй, но заголовки и списки используй и в них, если
ответ длиннее пары предложений.

# Карта проекта

В корне каждого проекта, с которым работаешь, держи файл КАРТА.md — короткий
справочник по хозяйству: где сервер и как на него зайти, где лежат настройки и
секреты (путь, не значения), как выкатывать и как откатываться, чем проверять
(команда), где смотреть логи, какие внешние сервисы задействованы и что у них
может отвалиться. Схему связей рисуй словами или простым списком: кто кого
вызывает и через что ходит наружу.

Правила простые:

- Файла нет — заведи его при первой же работе с проектом, не спрашивая.
- Что-то поменял в устройстве (адрес, порт, прокси, способ выкатки, новый
  сервис, новая команда проверки) — сразу правь КАРТУ в том же заходе. Это не
  отдельная задача и не «потом».
- Секреты в КАРТУ не пиши: только где они лежат.
- Держи её короткой. Это шпаргалка, чтобы следующий заход начинался с работы,
  а не с разведки, — не документация проекта.

# Проверка перед отчётом

Если в проекте есть команда проверки (scripts/verify.sh или то, что указано в
КАРТЕ), прогоняй её перед тем, как сказать «готово». Не прошла — либо чини,
либо честно пиши, что именно красное. Отчёт «сделал» без прогона — вранье,
даже если код выглядит правильным.
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
  /** tool_use_id → имя инструмента: результаты приходят отдельными сообщениями. */
  #toolNames = new Map<string, string>();
  /** tool_use_id → шаг в Markdown: им подписывается вывод в журнале. */
  #toolLabels = new Map<string, string>();
  /** Что делал агент за задачу — чек-лист в журнале. */
  #steps: string[] = [];
  /** Вывод команд и ошибки инструментов копятся и уходят одним свёрнутым блоком. */
  #toolOutputs: { label: string; text: string }[] = [];
  #toolErrors: { label: string; text: string }[] = [];
  #lastText: string | null = null;
  #resumeSessionId: string | null;
  #closed = false;

  // modelUsage и total_cost_usd в streaming-сессии накопительные:
  // каждый result содержит итог с начала сессии. Пишем в статистику разницу.
  #lastTokens = 0;
  #lastRateLimitFetch = 0;
  /** Когда в последний раз приходило хоть что-то от агента. */
  #lastActivity = Date.now();
  #stallTimer: NodeJS.Timeout | null = null;
  #lastCost = 0;

  /** Состояние рабочей папки до задачи — чтобы понять, что агент создал. */
  #before: Snapshot | null = null;

  /**
   * Последняя известная заполненность контекста.
   *
   * SDK кладёт её на сообщения агента даром, поэтому запоминаем: отдельный
   * запрос ходит в API и может не ответить, а показать что-то надо всегда.
   */
  #context: { percentage: number; total: number; max: number } | null = null;

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
    this.#toolNames.clear();
    this.#toolLabels.clear();
    this.#steps = [];
    this.#toolOutputs = [];
    this.#toolErrors = [];
    this.#lastText = text;
    // Снимок до работы: по разнице после результата видно, какие файлы
    // появились или изменились, и их можно вернуть в чат.
    try {
      this.#before = snapshot(this.#deps.cwd);
    } catch {
      this.#before = null;
    }
    this.#queue.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      session_id: this.#sessionId ?? "",
    } as SDKUserMessage);

    this.#deps.output.startTyping();
    this.#lastActivity = Date.now();
    this.#watchStall();
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

  /** Насколько заполнено окно контекста. null — узнать не удалось. */
  async contextUsage(): Promise<{ percentage: number; total: number; max: number } | null> {
    if (!this.#query) return this.#context;
    try {
      const response = await this.#query.getContextUsage();
      const usage = (response as { context_usage?: unknown }).context_usage ?? response;
      const u = usage as { percentage?: number; total_tokens?: number; raw_max_tokens?: number };
      if (typeof u.percentage !== "number") return this.#context;
      this.#context = {
        percentage: u.percentage,
        total: u.total_tokens ?? 0,
        max: u.raw_max_tokens ?? 0,
      };
      return this.#context;
    } catch {
      // Запрос ходит в API и может не ответить. Тогда отдаём последнее, что
      // приезжало с сообщениями агента, — это лучше, чем «не знаю».
      return this.#context;
    }
  }

  /**
   * Забирает все окна лимитов разом.
   *
   * Событие rate_limit_event приносит по одному окну и часто без процента —
   * поэтому в статистике висело только пятичасовое, да и то пустое. Метод
   * /usage отдаёт сразу пятичасовое, недельное и по моделям, с процентами и
   * временем сброса.
   *
   * Метод помечен экспериментальным, и его имя автор обещает сменить, поэтому
   * зовём через проверку наличия: пропадёт — бот просто останется на событиях,
   * а не упадёт.
   */
  async refreshRateLimits(force = false): Promise<void> {
    if (!this.#query) return;
    const now = Date.now();
    // Запрос ходит в claude.ai, а result приходит на каждую задачу: без
    // промежутка получилось бы по обращению на каждое сообщение.
    if (!force && now - this.#lastRateLimitFetch < RATE_LIMIT_REFRESH_MS) return;
    this.#lastRateLimitFetch = now;

    const holder = this.#query as unknown as Record<string, unknown>;
    const method = holder["usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET"];
    if (typeof method !== "function") return;

    try {
      const response = await (method as () => Promise<unknown>).call(this.#query);
      const data = response as {
        rate_limits_available?: boolean;
        rate_limits?: Record<
          string,
          { utilization?: number | null; resets_at?: string | null } | null
        > | null;
      };
      // По API-ключу лимиты плана не действуют, и показывать нечего.
      if (data.rate_limits_available === false || !data.rate_limits) return;

      for (const [limitType, window] of Object.entries(data.rate_limits)) {
        if (!window) continue;
        const utilization = typeof window.utilization === "number" ? window.utilization : undefined;
        const parsed = window.resets_at ? Date.parse(window.resets_at) : Number.NaN;
        const resetsAt = Number.isFinite(parsed) ? parsed : undefined;
        // Пустое окно писать незачем: строка без числа и без срока ничего не
        // говорит, а место в списке занимает.
        if (utilization === undefined && resetsAt === undefined) continue;
        this.#deps.onRateLimit({ limitType, utilization, resetsAt });
      }
    } catch {
      // Экспериментальный метод, да ещё и по сети. Не ответил — покажем то,
      // что уже лежит в базе.
    }
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
    // Сторож живёт вместе с диалогом: без этого таймер остался бы висеть на
    // каждой закрытой сессии.
    if (this.#stallTimer) {
      clearInterval(this.#stallTimer);
      this.#stallTimer = null;
    }
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

    // Сторож необратимого. Нужен именно на PreToolUse: в режиме «без вопросов»
    // canUseTool не зовут вовсе, и карточки — вместе с кнопкой «Стоп» — не
    // появляются. Читает режим через функцию, а не значением: режим меняют
    // на лету из /mode, а хук создаётся один раз на сессию.
    const dangerGuard = createDangerGuard({
      chatId: this.chatId,
      timeoutMs: permissionTimeoutMs,
      hooks: output.permissionHooks,
      currentMode: () => this.#deps.permissionMode,
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
        // Сторож необратимого отключается в .env (DANGER_GUARD=0): тогда бот
        // не спрашивает вообще ничего, это осознанный выбор владельца.
        ...(config.dangerGuard ? { hooks: { PreToolUse: [{ hooks: [dangerGuard] }] } } : {}),
        ...(resumeSessionId ? { resume: resumeSessionId } : {}),
        systemPrompt: { type: "preset", preset: "claude_code", append: SYSTEM_APPEND },
        // Скиллы, CLAUDE.md и правила проекта.
        settingSources: [...SETTING_SOURCES],
        mcpServers: loadMcpServers(),
        // Промежуточные куски текста не нужны: живой черновик убран, ответ
        // уходит целиком, когда готов. Признак жизни даёт строка состояния.
        includePartialMessages: false,
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

  /**
   * Сторож зависаний.
   *
   * Молчаливо застрявшая сессия — худший вид поломки: «печатает» крутится
   * вечно, новые сообщения копятся в очереди, и человеку не за что зацепиться.
   * Ни ошибки, ни ответа он не получает и решает, что бот сломан навсегда.
   *
   * Пока висит карточка разрешения, тишина — это норма: агент ждёт человека, а
   * не завис. Поэтому такие паузы сторож пропускает.
   */
  #watchStall(): void {
    if (this.#stallTimer) return;
    const timer = setInterval(() => {
      if (!this.#busy) return;
      if (hasPending(this.chatId)) return;
      if (Date.now() - this.#lastActivity < STALL_MS) return;
      void this.#handleStall();
    }, STALL_CHECK_MS);
    timer.unref?.();
    this.#stallTimer = timer;
  }

  async #handleStall(): Promise<void> {
    const минут = Math.round((Date.now() - this.#lastActivity) / 60_000);
    this.#busy = false;
    this.#deps.output.stopTyping();
    await this.#deps.output.clearStatus().catch(() => undefined);
    flushChat(this.chatId, { kind: "deny", message: "Сессия застряла" });

    // Саму сессию закрываем: продолжать с застрявшего места нечего, а очередь
    // накопленных сообщений иначе так и останется висеть.
    this.#query = null;
    this.#queue = new MessageQueue<SDKUserMessage>();
    this.#lastActivity = Date.now();

    await this.#deps.output
      .send(
        `⚠️ Задача застряла: ${минут} мин без единого признака жизни.\n\n` +
          "Сессию закрыл. Напиши задачу заново — подниму с чистого листа.",
      )
      .catch(() => undefined);
  }

  async #pumpMessages(): Promise<void> {
    if (!this.#query) return;
    try {
      for await (const message of this.#query) {
        this.#lastActivity = Date.now();
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

      // Claude Code не даёт режим «без вопросов» под root. Сырой текст ошибки
      // тут ничего не объясняет, поэтому переводим его на человеческий.
      if (/cannot be used with root/i.test(text)) {
        await this.#deps.output.send(
          "⚠️ Режим «без вопросов» недоступен: Claude Code запрещает его под root.\n\n" +
            "Переключись на другой режим в /mode — или пересобери контейнер, он должен работать не от root.",
        );
        return;
      }

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
          return;
        }
        // Субагент — самая долгая часть работы, и без этого чат замирает на
        // минуты без единого признака жизни.
        if (message.subtype === "task_started") {
          const started = message as unknown as { description?: string; subagent_type?: string };
          const kind = started.subagent_type ? ` (${started.subagent_type})` : "";
          this.#activity.push(`🤖 субагент${esc(kind)}: ${esc(started.description ?? "работает")}`);
          await this.#renderActivity(true);
          return;
        }
        // Сжатие контекста: без отчёта /compact выглядит как зависание.
        if (message.subtype === "compact_boundary") {
          const meta = (
            message as unknown as {
              compact_metadata?: { trigger?: string; pre_tokens?: number; post_tokens?: number };
            }
          ).compact_metadata;
          const before = meta?.pre_tokens ?? 0;
          const after = meta?.post_tokens;
          const how = meta?.trigger === "auto" ? "сам" : "по просьбе";
          const sizes =
            after === undefined
              ? `было ${formatTokensShort(before)}`
              : `${formatTokensShort(before)} → ${formatTokensShort(after)}`;
          await output.send(`🗜️ Контекст сжат (${how}): ${sizes}. Нить разговора сохранена.`);
          return;
        }

        // Фоновая задача завершилась. Она может доигрывать уже после ответа,
        // и без этого сообщения результат просто терялся.
        if (message.subtype === "task_notification") {
          const task = message as unknown as {
            status?: string;
            summary?: string;
            output_file?: string;
          };
          const mark = task.status === "completed" ? "✅" : task.status === "failed" ? "❌" : "⏹️";
          const where = task.output_file ? `\n\nВывод: <code>${esc(task.output_file)}</code>` : "";
          await output.send(
            `${mark} Фоновая задача: ${esc(task.summary ?? task.status ?? "завершилась")}${where}`,
          );
          return;
        }

        if (message.subtype === "background_tasks_changed") {
          const payload = message as unknown as {
            tasks?: { description: string }[];
          };
          const tasks = payload.tasks ?? [];
          if (tasks.length > 0) {
            const list = tasks.map((t) => `• ${esc(t.description)}`).join("\n");
            await output.send(`⏳ В фоне сейчас:\n${list}`);
          }
          return;
        }

        // Обрыв связи с API. Через прокси это не редкость, и молчание тут
        // неотличимо от зависшего бота.
        if (message.subtype === "api_retry") {
          const retry = message as unknown as { attempt?: number; max_retries?: number };
          this.#activity.push(
            `🔄 связь оборвалась, переподключаюсь (${retry.attempt ?? 1} из ${retry.max_retries ?? 1})`,
          );
          await this.#renderActivity(true);
          return;
        }

        if (message.subtype === "task_progress") {
          const progress = message as unknown as { description?: string };
          if (progress.description) {
            this.#activity.push(`   ↳ ${esc(progress.description)}`);
            await this.#renderActivity();
          }
          return;
        }
        return;
      }

      case "assistant": {
        const usage = (
          message as unknown as {
            context_usage?: { percentage?: number; total_tokens?: number; raw_max_tokens?: number };
          }
        ).context_usage;
        if (usage && typeof usage.percentage === "number") {
          this.#context = {
            percentage: usage.percentage,
            total: usage.total_tokens ?? 0,
            max: usage.raw_max_tokens ?? 0,
          };
        }

        for (const block of message.message.content) {
          if (block.type === "text" && block.text.trim()) {
            const full = block.text.trim();
            let fileIndex = 0;
            for (const part of splitCodeBlocks(full)) {
              if (part.kind === "file") {
                fileIndex += 1;
                const name = codeBlockFileName(part.language, fileIndex);
                await output.documentFromText(part.body, name, `📄 <code>${esc(name)}</code>`);
                continue;
              }
              // Rich-сообщение вмещает 32 тысячи символов: режем только совсем длинное.
              for (const piece of chunk(part.body, RICH_LIMIT)) await output.sendRich(piece);
            }
            // Озвучка после текста, а не вместо: голос догоняет ответ, который
            // уже можно читать. Ошибка тут ответа не отменяет.
            if (output.speak) await output.speak(full).catch(() => undefined);
          } else if (block.type === "tool_use") {
            this.#toolNames.set(block.id, block.name);
            const step = describeToolMarkdown(
              block.name,
              (block.input ?? {}) as Record<string, unknown>,
            );
            this.#toolLabels.set(block.id, step);
            this.#steps.push(step);
            this.#activity.push(
              describeToolShort(block.name, (block.input ?? {}) as Record<string, unknown>),
            );
            await this.#renderActivity();
          }
        }
        return;
      }

      // Результаты инструментов. Показываем не всё: вывод Read или Grep занял бы
      // экран без пользы. Но ошибка и вывод команды — это то, ради чего человек
      // и смотрит в чат.
      case "user": {
        const content = message.message.content;
        if (typeof content === "string" || !Array.isArray(content)) return;
        for (const block of content) {
          if (typeof block !== "object" || block === null) continue;
          const result = block as {
            type?: string;
            tool_use_id?: string;
            is_error?: boolean;
            content?: unknown;
          };
          if (result.type !== "tool_result") continue;

          const toolName = this.#toolNames.get(result.tool_use_id ?? "") ?? "";
          const text = flattenToolResult(result.content);
          if (!text) continue;

          const label =
            (this.#toolLabels.get(result.tool_use_id ?? "") ?? toolName) || "инструмент";
          // Вывод и ошибки не шлём сразу: раньше каждая команда улетала
          // отдельным сообщением и чат превращался в ленту логов. Теперь всё
          // копится и уходит в конце задачи одним журналом со свёрнутыми блоками.
          if (result.is_error) {
            this.#toolErrors.push({ label, text });
            continue;
          }
          if (toolName === "Bash") this.#toolOutputs.push({ label, text });
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

        // Задача закончилась — самое время узнать, сколько осталось.
        // Не ждём: пользователю важен ответ, а не свежесть счётчика.
        void this.refreshRateLimits();

        this.#deps.onUsage({ tokens: deltaTokens, costUsd: deltaCost });

        for (const denial of message.permission_denials ?? []) {
          this.#deps.onToolDecision(denial.tool_name, false);
        }

        const summary =
          message.subtype === "success"
            ? `✅ Готово · ${formatDuration(message.duration_ms)} · ${formatTokensShort(deltaTokens)}`
            : `⚠️ Прервано: ${esc(message.subtype)}`;
        // Журнал задачи заменяет строку состояния: итог плюс свёрнутые шаги,
        // вывод команд и ошибки. Если показывать нечего — просто итог.
        const journal = this.#journal(summary);
        if (journal) {
          await output.clearStatus();
          await output.sendRich(journal);
        } else {
          await output.clearStatus(summary);
        }
        // Кнопки под последним сообщением: на телефоне набрать «покажи дифф»
        // дороже, чем нажать. Ошибка тут ответа не отменяет.
        if (output.finished) await output.finished().catch(() => undefined);

        if (message.subtype !== "success" && "result" in message && message.result) {
          await output.send(esc(String(message.result).slice(0, 1000)));
        }

        await this.#offerArtifacts();
        return;
      }

      default:
        return;
    }
  }

  /**
   * Файлы, появившиеся за задачу. Раньше результат оставался на сервере, и
   * забрать его можно было только через git.
   */
  async #offerArtifacts(): Promise<void> {
    const before = this.#before;
    this.#before = null;
    if (!before) return;

    let report;
    try {
      report = reportChanges(this.#deps.cwd, before);
    } catch {
      return;
    }

    // Массовая операция: клон, установка зависимостей, сборка. Слать это в чат
    // бессмысленно, но и промолчать нельзя — пользователь должен знать, что в
    // папке что-то большое произошло.
    if (report.bulk) {
      await this.#deps.output.send(
        `📁 В проекте изменилось ${report.total} файлов — похоже на клон или сборку, в чат не тащу. Нужен конкретный: /file &lt;путь&gt;`,
      );
      return;
    }

    const files = report.files;
    if (files.length === 0) return;

    // Сыпать в чат десяток файлов подряд — шум. Один-два отдаём сразу,
    // остальные перечисляем: забрать можно командой /file.
    const send = files.slice(0, 2);
    for (const file of send) {
      await this.#deps.output.document(
        file.absolute,
        `${file.isNew ? "🆕" : "✏️"} <code>${esc(file.relative)}</code> · ${formatSize(file.size)}`,
        file.relative.split("/").pop(),
      );
    }

    const rest = files.slice(2);
    if (rest.length > 0) {
      const list = rest.map((f) => `• <code>${esc(f.relative)}</code> · ${formatSize(f.size)}`);
      await this.#deps.output.send(
        `Ещё изменилось:\n${list.join("\n")}\n\nЗабрать: /file &lt;путь&gt;`,
      );
    }
  }

  /**
   * Журнал задачи: итоговая строка и до трёх свёрнутых блоков — шаги
   * чек-листом, вывод команд, ошибки инструментов. Возвращает null, если
   * кроме итога показывать нечего.
   */
  #journal(summary: string): string | null {
    const steps = this.#steps;
    const outputs = this.#toolOutputs.slice(-MAX_OUTPUTS);
    const errors = this.#toolErrors.slice(-MAX_ERRORS);
    if (steps.length === 0 && outputs.length === 0 && errors.length === 0) return null;

    const parts = [summary];
    if (steps.length > 0) {
      const shown = steps.slice(0, MAX_STEPS).map((step) => `- [x] ${step}`);
      if (steps.length > MAX_STEPS) shown.push(`- …и ещё ${steps.length - MAX_STEPS}`);
      parts.push(details(`☑️ Шаги (${steps.length})`, shown.join("\n")));
    }
    if (outputs.length > 0) {
      const skipped = this.#toolOutputs.length - outputs.length;
      const body = outputs
        .map((o) => `**${o.label}**\n\n${fence(tail(o.text, OUTPUT_LIMIT))}`)
        .join("\n\n");
      const note = skipped > 0 ? `\n\n_…и ещё ${skipped} раньше_` : "";
      parts.push(details(`🖥️ Вывод команд (${this.#toolOutputs.length})`, body + note));
    }
    if (errors.length > 0) {
      const body = errors
        .map((e) => `**${e.label}**\n\n${fence(tail(e.text, OUTPUT_LIMIT))}`)
        .join("\n\n");
      parts.push(details(`⚠️ Ошибки инструментов (${this.#toolErrors.length})`, body));
    }
    return parts.join("\n\n");
  }

  #lastRender = 0;
  async #renderActivity(force = false): Promise<void> {
    // Telegram душит частые правки сообщений; полторы секунды — безопасный шаг.
    const now = Date.now();
    if (!force && now - this.#lastRender < 1500) return;
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

/** Содержимое tool_result бывает строкой и массивом блоков. */
export function flattenToolResult(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") parts.push(block);
    else if (typeof block === "object" && block !== null) {
      const b = block as { type?: string; text?: string };
      if (b.type === "text" && b.text) parts.push(b.text);
    }
  }
  return parts.join("\n").trim();
}

/** Вывод команды в моноширинном блоке, обрезанный с хвоста, а не с головы. */
export function preBlock(text: string, limit: number): string {
  const trimmed =
    text.length <= limit ? text : `…(начало срезано)\n${text.slice(text.length - limit)}`;
  return `<pre>${esc(trimmed)}</pre>`;
}

function formatTokensShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M токенов`;
  if (n >= 1_000) return `${Math.round(n / 1000)}k токенов`;
  return `${n} токенов`;
}
