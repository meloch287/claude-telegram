import { taskState } from "../bot/task-state.js";
import { contextFromTurn, readContextUsage } from "./context-usage.js";
import { gptStorage } from "../engine.js";
import {claudeTeamContext,cancelClaudeTeam} from "../team-context.js";
import {claudeQuota} from "../db.js";
import {refreshClaudeUsage} from "../claude-usage.js";
import {outgoingFiles,deliveryPath,FILE_DELIVERY_PROMPT} from '../bot/delivery.js';
import {execFile as deliveryExec} from 'node:child_process';
import {promisify as deliveryPromisify} from 'node:util';
const readDelivery=deliveryPromisify(deliveryExec);
import {syncClaudeGitHub} from "../github.js";
import {readFileSync} from "node:fs";
import {imageMime} from "../bot/media.js";
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
import { claudeRuntimeOptions, claudeModels, claudeModelLabel, claudePreferences } from "../claude-settings.js";
import { spawnWorker, workerFor } from "./isolation.js";

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
  recovery?(id: string): Promise<void>;
  /** Отдать файл с диска. */
  document(path: string, caption?: string, fileName?: string): Promise<void>;
  documentBytes?(bytes: Uint8Array,fileName:string): Promise<void>;
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
  /** Задача закончилась успехом: на острове это брёвна и камень. */
  task?: boolean;
  /** Удавшиеся git commit и git push за задачу: чудеса и золото на острове. */
  commits?: number;
  pushes?: number;
}

/** git commit / git push в команде Bash; пробный прогон не считается. */
export function gitActions(command: string): { commit: boolean; push: boolean } {
  const parts = command.split(/&&|\|\||;|\n/);
  const has = (verb: string) =>
    parts.some(
      (p) => new RegExp(`\\bgit\\b[^|]*\\s${verb}(\\s|$)`).test(p) && !/--dry-run/.test(p),
    );
  return { commit: has("commit"), push: has("push") };
}

export interface ConversationDeps {
  createQuery?: typeof query;
  chatId: number;
  userId: number;
  cwd: string;
  credential: Credential;
  /** null — модель по умолчанию, как в обычном Claude Code. */
  model: string | null;
  permissionMode: PermissionMode;
  permissionTimeoutMs: number;
  resumeSessionId: string | null;
  initialSessionId?: string;
  output: ConversationOutput;
  /** Вызывается на каждом result с ДЕЛЬТОЙ расхода, не с накопленным итогом. */
  onUsage(usage: ConversationUsage): void;
  onSessionId(sessionId: string): void;
  /** Сохранённой сессии не оказалось на диске — забыть её в базе. */
  onResumeLost(): void;
  /** Заполненность контекста после хода (токены и окно модели). */
  onContext?(context: { used: number; size: number }): void;
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
function buildEnv(credential: Credential, userId: number): Record<string, string> {
  const worker = workerFor(userId);
  const proxy = activeProxyUrl();
  if (!proxy) throw new Error("Claude Code остановлен: обязательный прокси недоступен.");
  const env: Record<string, string> = {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    LANG: "C.UTF-8",
    AI_TEAM_ENGINE: "claude",
    HOME: worker.home,
    GIT_CONFIG_GLOBAL: `${worker.home}/.gitconfig`,
    USER: worker.name,
    LOGNAME: worker.name,
    XDG_CONFIG_HOME: `${worker.home}/.config`,
    XDG_CACHE_HOME: `${worker.home}/.cache`,
    HTTP_PROXY: proxy,
    HTTPS_PROXY: proxy,
    http_proxy: proxy,
    https_proxy: proxy,
    NO_PROXY: "localhost,127.0.0.1",
    no_proxy: "localhost,127.0.0.1",
  };
  for (const [key, value] of Object.entries(credentialEnv(credential))) {
    if (value !== undefined) env[key] = value;
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

Пиши по-русски, если пользователь не попросил другой язык.
Короткий заголовок результата — отдельной строкой, затем пояснения отдельными абзацами.
Не склеивай обращение, заголовок и длинную жирную оговорку. Жирным выделяй короткие ключевые слова.
Используй Markdown: списки, таблицы, блоки кода и <details><summary>Подробности</summary>…</details>, когда они помогают.
Перед таблицей, списком и после заголовка — одна пустая строка. Без декоративных разделителей.
Добавляй обычно 1–3 уместных эмодзи, не внутри кода. Исторический контекст помечай отдельной строкой.
Не навязывай длинный шаблон карточки короткому ответу.
Между смысловыми абзацами ставь два перевода строки, а не один: одинарный перенос не отделяет абзац визуально.
Один абзац — одна мысль, обычно 1–3 коротких предложения. Не начинай технический ответ с длинного приветствия.
Несколько действий или недостающих данных перечисляй короткими пунктами. Не выделяй жирным целый пункт или предложение.
Если предыдущий контекст доступен в истории, сначала прочитай его и проверь пути инструментами, затем сообщай, чего действительно не хватает.
Бот сам добавляет «✅ Готово», время и сворачиваемый журнал реальных шагов, вывода команд и ошибок.
Не придумывай и не дублируй этот журнал. В ответе коротко сообщи результат, проверки и реальные ограничения.

# GitHub

Команда /github подключает личный GitHub сразу к GPT, Claude и веб-интерфейсу.
Ключ Claude лежит в $HOME/.ssh/gpt-github/id_ed25519, сведения проверки в account.json рядом.
Используй GIT_CONFIG_GLOBAL из окружения, он сохраняет подключение во всех проектах.
Проверка: ssh -T git@github.com. Фраза successfully authenticated означает успех даже с кодом 1.
gh auth status проверяет отдельный OAuth. Не проси повторную авторизацию без реальной проверки SSH/git.
Не показывай приватный ключ. У каждого пользователя только его ключ и репозитории.

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
  #checkpoint: string | undefined;
  readonly chatId: number;
  #deps: ConversationDeps;
  #queue = new MessageQueue<SDKUserMessage>();
  #query: Query | null = null;
  #pump: Promise<void> | null = null;
  #sessionId: string | null = null;
  #busy = false;
  #turnStarted = 0;
  #progressTimer: NodeJS.Timeout | null = null;
  #renderingActivity = false;
  #activity: string[] = [];
  /** tool_use_id → имя инструмента: результаты приходят отдельными сообщениями. */
  #toolNames = new Map<string, string>();
  /** tool_use_id → шаг в Markdown: им подписывается вывод в журнале. */
  #toolLabels = new Map<string, string>();
  // Git-действия текущей задачи: засчитываются, только если команда удалась.
  #gitPending = new Map<string, { commit: boolean; push: boolean }>();
  #turnCommits = 0;
  #turnPushes = 0;
  /** Что делал агент за задачу — чек-лист в журнале. */
  #steps: {id: string; label: string}[] = [];
  #stepResults = new Map<string, boolean>();
  #interrupted = false;
  #activeModel: string | null = null;
  /** Вывод команд и ошибки инструментов копятся и уходят одним свёрнутым блоком. */
  #toolOutputs: { label: string; text: string }[] = [];
  #toolErrors: { label: string; text: string }[] = [];
  #lastText: string | null = null;
  #resumeSessionId: string | null;
  #closed = false;
  #lastImages: string[] = [];

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
  /** usage последнего ответа основной ветки — для мгновенной заполненности контекста. */
  #lastUsage: unknown = null;

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
  #delivered=new Set<string>();
  async send(text: string, images: string[] = []): Promise<void> {
    this.#delivered.clear();
    if(!this.#deps.createQuery) { await gptStorage(this.#deps.userId, "admit"); claudeQuota.assert(this.#deps.userId); }
    if (this.#closed) throw new Error("Диалог уже закрыт");
    if (!this.#query) {
      if (!this.#deps.createQuery) await syncClaudeGitHub(this.#deps.userId);
      this.#start();
    }
    if (this.#deps.initialSessionId) {
      if (this.#busy && this.#checkpoint) taskState.append(this.#checkpoint, text);
      else this.#checkpoint = taskState.begin(this.#deps.userId, "claude", this.#deps.initialSessionId || this.#sessionId || this.#resumeSessionId || "", text, images);
    }
    this.#busy = true;
    this.#turnStarted = Date.now();
    this.#activity = [];
    this.#toolNames.clear();
    this.#toolLabels.clear();
    this.#steps = [];
    this.#stepResults.clear();
    this.#interrupted = false;
    this.#toolOutputs = [];
    this.#toolErrors = [];
    this.#lastText = text;
    this.#lastImages = images;
    // Снимок до работы: по разнице после результата видно, какие файлы
    // появились или изменились, и их можно вернуть в чат.
    try {
      this.#before = snapshot(this.#deps.cwd);
    } catch {
      this.#before = null;
    }
    this.#queue.push({
      type: "user",
      message: { role: "user", content: images.length ? [
        {type:"text",text},
        ...images.slice(0,12).map(path=>{const bytes=readFileSync(path),mime=imageMime(bytes);if(!mime)throw Error("Неподдерживаемый формат изображения");return {type:"image",source:{type:"base64",media_type:mime,data:bytes.toString("base64")}};})
      ] : text },
      parent_tool_use_id: null,
      session_id: this.#sessionId ?? "",
    } as SDKUserMessage);

    this.#deps.output.startTyping();
    this.#lastActivity = Date.now();
    this.#watchStall();
    void this.#renderActivity(true).catch(() => {});
    if (!this.#progressTimer) {
      this.#progressTimer = setInterval(() => {if (this.#busy) void this.#renderActivity().catch(() => {});}, 5000);
      this.#progressTimer.unref?.();
    }
  }

  async interrupt(preserve = false): Promise<void> {
    if(!this.#deps.createQuery)void cancelClaudeTeam(this.#deps.userId);
    if (!this.#query || !this.#busy) return;
    this.#interrupted = true;
    taskState.state(this.#checkpoint, preserve ? "interrupted" : "cancelled");
    this.#checkpoint = undefined;
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

  /** Заполненность по итогу последнего хода — без запроса к API. */
  lastContext(): { percentage: number; total: number; max: number } | null {
    return this.#context;
  }

  /** Насколько заполнено окно контекста. null — узнать не удалось. */
  async contextUsage(): Promise<{ percentage: number; total: number; max: number } | null> {
    if (!this.#query) return this.#context;
    try {
      const response = await this.#query.getContextUsage();
      const usage = readContextUsage((response as { context_usage?: unknown }).context_usage ?? response);
      if (!usage) return this.#context;
      this.#context = usage;
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
    // Экспериментальный /usage SDK ходит в тот же эндпоинт лимитов, который Anthropic
    // закрывает 429 на час. Лимиты берём из заголовков крошечного запроса
    // (claude-usage.ts) с общим интервалом для бота и bb.
    if (this.#deps.createQuery) return;
    const now = Date.now();
    if (!force && now - this.#lastRateLimitFetch < RATE_LIMIT_REFRESH_MS) return;
    this.#lastRateLimitFetch = now;
    await refreshClaudeUsage(this.#deps.userId).catch(() => undefined);
  }

  async setModel(model: string): Promise<void> {
    if (!this.#query) return;
    await this.#query.setModel(model);
    this.#activeModel = model;
  }

  /** Закрывает сессию: очередь завершается, query() доигрывает и выходит. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#busy) taskState.state(this.#checkpoint, "interrupted");
    if (this.#progressTimer) clearInterval(this.#progressTimer);
    this.#progressTimer = null;
    this.#deps.output.stopTyping();
    // Сторож живёт вместе с диалогом: без этого таймер остался бы висеть на
    // каждой закрытой сессии.
    if (this.#stallTimer) {
      clearInterval(this.#stallTimer);
      this.#stallTimer = null;
    }
    flushChat(this.chatId, { kind: "deny", message: "Сессия закрыта" });
    if (!this.#queue.closed) this.#queue.close();
    this.#query?.close();
    try {
      await this.#pump;
    } catch {
      // Ошибку насоса уже показали пользователю в #pumpMessages.
    }
  }

  #start(): void {
    const { credential, model, cwd, permissionMode, permissionTimeoutMs, output, userId } = this.#deps;
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
      askOnDanger: config.dangerGuard,
    });

    this.#query = (this.#deps.createQuery ?? query)({
      prompt: this.#queue,
      options: {
        cwd,
        ...claudeRuntimeOptions(userId),
        // Набор инструментов не урезаем: это обычный Claude Code, просто в чате.
        // Включённая оркестрация — уже согласие человека: Workflow не спрашиваем
        // карточкой на каждый запуск. Без неё запуск воркфлоу подтверждают кнопкой.
        allowedTools: claudePreferences(userId).orchestration ? [...AUTO_APPROVED, "Workflow"] : AUTO_APPROVED,
        permissionMode,
        // Без этого флага SDK не пускает в bypassPermissions вовсе.
        ...(permissionMode === "bypassPermissions"
          ? { allowDangerouslySkipPermissions: true }
          : {}),
        canUseTool,
        // Хук нужен режиму «без вопросов»: гасит уточняющие вопросы (AskUserQuestion).
        // Спрашивать про необратимое он будет, только если в .env DANGER_GUARD=1.
        hooks: { PreToolUse: [{ hooks: [dangerGuard] }] },
        ...(resumeSessionId ? { resume: resumeSessionId } : this.#deps.initialSessionId ? { sessionId: this.#deps.initialSessionId } : {}),
        systemPrompt: { type: "preset", preset: "claude_code", append: SYSTEM_APPEND + "\nСоздавай файлы, репозитории, зависимости, сборки и временные данные внутри текущей рабочей папки этого диалога. У каждого диалога отдельная папка; при удалении диалога она удаляется целиком. Общую историю и файлы других диалогов используй как справочные данные.\n" + FILE_DELIVERY_PROMPT + "\n" + claudeTeamContext(userId) },
        // Скиллы, CLAUDE.md и правила проекта.
        settingSources: [...SETTING_SOURCES],
        mcpServers: loadMcpServers(),
        // Промежуточные куски текста не нужны: живой черновик убран, ответ
        // уходит целиком, когда готов. Признак жизни даёт строка состояния.
        includePartialMessages: false,
        // env заменяет окружение подпроцесса целиком, а не дополняет его,
        // поэтому process.env нужно расстелить руками — иначе не будет PATH.
        env: { ...buildEnv(credential, userId), XDG_CACHE_HOME: `${cwd}/.cache`, npm_config_cache: `${cwd}/.npm`, TMPDIR: `${cwd}/.tmp` },
        spawnClaudeCodeProcess: (options) => spawnWorker(userId, options),
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
      const wasBusy = this.#busy;
      taskState.state(this.#checkpoint, "interrupted");
      if (this.#checkpoint && !this.#closed) await this.#deps.output.recovery?.(this.#checkpoint).catch(() => {});
      this.#busy = false;
      this.#deps.output.stopTyping();
      flushChat(this.chatId, { kind: "deny", message: "Сессия упала" });
      this.#query = null;
      this.#queue = new MessageQueue<SDKUserMessage>();
      this.#resumeSessionId = this.#sessionId ?? this.#resumeSessionId;
      if (this.#closed) return;
      console.error(`[claude:${this.chatId}] session failed: ${text.slice(0,500)}`);
      if (/exited with code 143|SIGTERM/i.test(text)) {
        await this.#deps.output.clearStatus();
        if(wasBusy)await this.#deps.output.send("Claude был перезапущен. История сохранена — отправь «Продолжи», чтобы продолжить задачу.");
        return;
      }

      // Сохранённая сессия не найдена: файлы могли пропасть вместе с
      // пересборкой контейнера, а идентификатор в базе остался. Начинаем
      // заново и повторяем реплику — пользователю незачем это разгребать.
      if (/No conversation found/i.test(text) && this.#resumeSessionId) {
        this.#resumeSessionId = null;
        this.#sessionId = null;
        this.#deps.onResumeLost();
        await this.#deps.output.clearStatus();
        await this.#deps.output.send("↻ Прошлый чат не нашёлся, начинаю новый.");
        if (this.#lastText) await this.send(this.#lastText, this.#lastImages);
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
          this.#activeModel = message.model;
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
        const usage = readContextUsage((message as unknown as { context_usage?: unknown }).context_usage);
        if (usage) this.#context = usage;
        if (!message.parent_tool_use_id && message.message.usage) this.#lastUsage = message.message.usage;

        for (const block of message.message.content) {
          if (block.type === "text" && block.text.trim()) {
            const outgoing=outgoingFiles(block.text.trim());
            const full = outgoing.visible;
            for(const file of outgoing.files.slice(0,5)){
              try{
                await this.#deliverArtifact(file);
              }catch{await output.send('Не удалось прикрепить файл. Проверь, что он сохранён в твоей папке и не больше 49 МиБ.');}
            }
            let fileIndex = 0;
            for (const part of splitCodeBlocks(full)) {
              if (part.kind === "file") {
                fileIndex += 1;
                const name = codeBlockFileName(part.language, fileIndex);
                await output.documentFromText(part.body, name, `📄 <code>${esc(name)}</code>`);
                continue;
              }
              // Rich-сообщение вмещает 32 тысячи символов: режем только совсем длинное.
              await output.sendRich(part.body);
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
            if (block.name === "Bash") {
              const git = gitActions(String((block.input as { command?: unknown })?.command ?? ""));
              if (git.commit || git.push) this.#gitPending.set(block.id, git);
            }
            this.#steps.push({id: block.id, label: step});
            taskState.steps(this.#checkpoint, this.#steps.slice(-30).map(s => ({label:s.label,done:this.#stepResults.get(s.id) ?? false})));
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

          this.#stepResults.set(result.tool_use_id ?? "", !result.is_error);
          taskState.steps(this.#checkpoint, this.#steps.slice(-30).map(s => ({label:s.label,done:this.#stepResults.get(s.id) ?? false})));
          const git = this.#gitPending.get(result.tool_use_id ?? "");
          if (git) {
            this.#gitPending.delete(result.tool_use_id ?? "");
            if (!result.is_error) {
              if (git.commit) this.#turnCommits += 1;
              if (git.push) this.#turnPushes += 1;
            }
          }

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
        taskState.state(this.#checkpoint, message.subtype === "success" && !this.#interrupted ? "done" : this.#interrupted ? "cancelled" : "interrupted");
        if (message.subtype !== "success" && this.#checkpoint && !this.#interrupted) await output.recovery?.(this.#checkpoint).catch(() => {});
        this.#checkpoint = undefined;
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
        const fast = contextFromTurn(this.#lastUsage, (message as { modelUsage?: unknown }).modelUsage);
        if (fast) this.#context = fast;
        const onContext = this.#deps.onContext;
        if (onContext && fast) onContext({ used: fast.total, size: fast.max });
        else if (onContext)
          void this.contextUsage()
            .then((c) => { if (c && c.max > 0) onContext({ used: c.total, size: c.max }); })
            .catch(() => undefined);

        this.#deps.onUsage({
          tokens: deltaTokens,
          costUsd: deltaCost,
          task: message.subtype === "success" && !this.#interrupted,
          commits: this.#turnCommits,
          pushes: this.#turnPushes,
        });
        this.#turnCommits = 0;
        this.#turnPushes = 0;
        this.#gitPending.clear();

        for (const denial of message.permission_denials ?? []) {
          this.#deps.onToolDecision(denial.tool_name, false);
        }

        const summary =
          this.#interrupted ? `⏹ Остановлено · ${formatDuration(message.duration_ms)}` : message.subtype === "success"
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
  async #deliverArtifact(file:string):Promise<void>{
                const {userId,cwd}=this.#deps;
                const root=`/opt/ai-bot/tenants/${userId}/workspace/AI-bot/User${userId}`;
                const normalized=file.startsWith(`/opt/AI-bot/User${userId}/`)?file.replace(`/opt/AI-bot/User${userId}`,root):file;
                const target=deliveryPath(cwd,root,normalized);
                if(this.#delivered.has(target.path))return;
                if(this.#delivered.size>=5)throw Error('До 5 файлов за ответ. Попроси собрать архив.');
                const worker=workerFor(userId);
                const result=await readDelivery('python3',[new URL('../../gpt/deliver-file.py',import.meta.url).pathname,target.root,target.name],{uid:worker.uid,gid:worker.gid,encoding:'buffer',maxBuffer:50*1024*1024});
                if(!this.#deps.output.documentBytes)throw Error('Отправка вложений недоступна');
                await this.#deps.output.documentBytes(result.stdout,target.name.split('/').pop()!);
                this.#delivered.add(target.path);
  }

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
        `📁 В проекте изменилось ${report.total} файлов — похоже на клон или сборку, в чат не тащу. Напиши, какой файл прислать.`,
      );
      return;
    }

    const files = report.files.filter(f=>!this.#delivered.has(f.absolute));
    if (files.length === 0) return;

    // Сыпать в чат десяток файлов подряд — шум. Один-два отдаём сразу,
    // остальные перечисляем: забрать можно командой /file.
    const send = files.slice(0, Math.min(2,5-this.#delivered.size));
    for (const file of send) {
      try{await this.#deliverArtifact(file.absolute);}catch{await this.#deps.output.send('Не удалось прикрепить файл. Напиши его название, чтобы повторить отправку.');}
    }

    const rest = files.slice(send.length);
    if (rest.length > 0) {
      const list = rest.map((f) => `• <code>${esc(f.relative)}</code> · ${formatSize(f.size)}`);
      await this.#deps.output.send(
        `Ещё изменилось:\n${list.join("\n")}\n\nНапиши «пришли» и название файла.`,
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
      const shown = steps.slice(0, MAX_STEPS).map((step) => {
        const done = this.#stepResults.get(step.id);
        return `${done === true ? "- [x]" : "- [ ]"} ${done === false ? "⚠️ " : done === undefined ? "⏸ " : ""}${step.label}`;
      });
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
    const now = Date.now();
    if (!this.#busy || this.#closed || this.#renderingActivity || (!force && now - this.#lastRender < 1500)) return;
    this.#lastRender = now;
    this.#renderingActivity = true;
    try {
      const recent = this.#activity.slice(-4);
      const selected = this.#activeModel ?? claudePreferences(this.#deps.userId).model;
      const info = claudeModels(this.#deps.userId).find(m => m.value === selected || m.resolvedModel === selected);
      const label = info ? claudeModelLabel(info).replace(/^По умолчанию · /, "") : selected === "default" ? "Claude Code" : selected;
      const heading = `✨ <b>${esc(label)}</b> · ${formatDuration(now - this.#turnStarted)}`;
      await this.#deps.output.status(`${heading}\n\n${recent.length ? recent.join("\n") : "✍️ Готовлю ответ…"}`);
    } finally { this.#renderingActivity = false; }
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
