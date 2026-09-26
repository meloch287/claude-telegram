/** Форматирование данных агента в сообщения Telegram (parse_mode: HTML). */

export function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function code(text: string): string {
  return `<code>${esc(text)}</code>`;
}

export function pre(text: string, lang?: string): string {
  const open = lang ? `<pre><code class="language-${lang}">` : "<pre>";
  const close = lang ? "</code></pre>" : "</pre>";
  return `${open}${esc(text)}${close}`;
}

/** Telegram режет сообщения на 4096 символах; берём запас под разметку. */
export const TELEGRAM_LIMIT = 3900;

/** Rich-сообщение вмещает 32 768 символов; запас — под экранирование. */
export const RICH_LIMIT = 30000;

/**
 * Markdown агента → Markdown, который Telegram поймёт как задумано.
 *
 * Rich Markdown Telegram считает текст между знаками доллара формулой LaTeX.
 * Агент пишет доллары про деньги («$5 против $12»), и такая фраза уезжала бы
 * формулой. Поэтому доллары вне кода экранируем; блоки и строки кода не
 * трогаем — внутри них экранирование не действует и не нужно.
 */
/**
 * Раскладка ответа перед отправкой.
 *
 * Модель, особенно в долгой сессии, пишет сплошной прозой: абзацы без
 * заголовков и списков, и в Telegram такой ответ читается стеной. Здесь два
 * дешёвых приёма, которые ничего не выдумывают за модель:
 *  - перенос строки внутри абзаца становится настоящим переносом (Markdown
 *    иначе склеивает соседние строки в одну);
 *  - абзац, начинающийся с короткой темы перед тире или двоеточием
 *    («Трекер — баг настоящий», «Проверки: 201 тест»), получает тему жирным.
 * Блоки кода, списки, заголовки, таблицы и HTML не трогаем.
 */
export function layoutMarkdown(text: string): string {
  return text
    .split(/(```[\s\S]*?```)/)
    .map((part, index) => (index % 2 === 1 ? part : layoutProse(part)))
    .join("");
}

const STRUCTURED_LINE = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|\||>|<|\[\^)/;
const LEAD_IN = /^([^\n.!?:—*]{2,48}?)( — |: )/u;
const HEADING = /^\s*#{1,6}\s/;
const HTML_LINE = /^\s*<\/?(details|summary)/i;
/**
 * Пустой абзац между блоками. Telegram рисует абзацы rich-сообщения впритык,
 * пустая строка в Markdown зазора не даёт (проверено 23.09.2026: блоки
 * приходят как paragraph/paragraph без отступа). Абзац из одного неразрывного
 * пробела сохраняется отдельным блоком и читается как пустая строка.
 */
const SPACER = "\u00a0";

function layoutProse(text: string): string {
  const blocks = text.split(/\n{2,}/).map(layoutBlock);
  const out: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    out.push(block);
    const next = blocks[i + 1];
    if (next !== undefined && needsSpacer(block, next)) out.push(SPACER);
  }
  return out.join("\n\n");
}

/** Заголовки и теги свёрнутых блоков несут свой отступ; пустые края не трогаем. */
function needsSpacer(before: string, after: string): boolean {
  if (!before.trim() || !after.trim()) return false;
  for (const block of [before, after]) {
    if (HEADING.test(block) || HTML_LINE.test(block) || block.startsWith("---")) return false;
  }
  return true;
}

function layoutBlock(paragraph: string): string {
  const lines = paragraph.split("\n");
  if (lines.some((line) => STRUCTURED_LINE.test(line))) return paragraph;
  const joined = lines.map((line) => line.trimEnd()).join("  \n");
  const lead = LEAD_IN.exec(joined);
  if (!lead) return joined;
  // Подводка уже с эмодзи — второе не вешаем.
  const marker = /^[\p{L}\p{N}«"]/u.test(lead[1]!) ? "🔹 " : "";
  return joined.replace(LEAD_IN, `${marker}**$1**$2`);
}

export function prepareRichMarkdown(text: string): string {
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((part, index) =>
      index % 2 === 1
        ? hideSecrets(part, "code")
        : hideSecrets(part.replace(/\$/g, "\\$"), "prose"),
    )
    .join("");
}

/**
 * Секреты в тексте. Вывод команд и ответы агента то и дело содержат токены,
 * ключи и пароли — из .env, из логов, из curl. На скриншоте или в пересылке
 * они утекают незаметно. В прозе секрет заворачивается в спойлер (нажал —
 * увидел), в коде спойлер не рисуется, поэтому там середина заменяется
 * многоточием. Список шаблонов намеренно короткий: ложные срабатывания на
 * обычных словах раздражают сильнее, чем редкий пропуск.
 */
const SECRET_PATTERNS: { re: RegExp; keep?: number }[] = [
  { re: /sk-ant-[A-Za-z0-9_-]{16,}/g },
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { re: /\bAKIA[0-9A-Z]{16}\b/g },
  { re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { re: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g },
  { re: /(Bearer\s+)[A-Za-z0-9._~+/-]{16,}=*/g, keep: 1 },
  {
    re: /((?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\s*[=:]\s*["']?)([^\s"'&,;]{6,})/gi,
    keep: 1,
  },
];

export function hideSecrets(text: string, where: "prose" | "code"): string {
  let out = text;
  for (const { re, keep } of SECRET_PATTERNS) {
    out = out.replace(re, (match, ...groups: unknown[]) => {
      const prefix = keep ? String(groups[keep - 1] ?? "") : "";
      const secret = match.slice(prefix.length);
      return (
        prefix + (where === "code" ? maskSecret(secret) : `<tg-spoiler>${secret}</tg-spoiler>`)
      );
    });
  }
  return out;
}

function maskSecret(secret: string): string {
  if (secret.length <= 8) return "•".repeat(secret.length);
  return `${secret.slice(0, 4)}…${secret.slice(-3)}`;
}

/** Свёрнутый блок Rich Markdown. Пустые строки вокруг тела обязательны. */
export function details(summary: string, body: string, open = false): string {
  return `<details${open ? " open" : ""}><summary>${summary}</summary>\n\n${body}\n\n</details>`;
}

/** Блок кода. Тройные кавычки внутри заменяем, иначе они закроют ограждение раньше времени. */
export function fence(text: string, lang = ""): string {
  return "```" + lang + "\n" + text.replace(/```/g, "ˋˋˋ") + "\n```";
}

/** Хвост длинного вывода: ошибки и итоги команд обычно в конце. */
export function tail(text: string, limit: number): string {
  return text.length <= limit ? text : `…(начало срезано)\n${text.slice(text.length - limit)}`;
}

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

function mono(text: string): string {
  return "`" + text.replace(/`/g, "ˋ") + "`";
}

/** Шаг задачи для чек-листа в журнале — то же, что describeToolShort, но в Markdown. */
export function describeToolMarkdown(toolName: string, input: Record<string, unknown>): string {
  const icon = toolIcon(toolName);
  switch (toolName) {
    case "Bash":
      return `${icon} ${mono(clip((str(input, "command") ?? "").split("\n")[0] ?? "", 120))}`;
    case "Read":
    case "Write":
    case "Edit":
    case "NotebookEdit": {
      const path = str(input, "file_path") ?? str(input, "notebook_path") ?? "";
      return `${icon} ${toolName} ${mono(shortPath(path))}`;
    }
    case "Grep":
      return `${icon} поиск ${mono(clip(str(input, "pattern") ?? "", 60))}`;
    case "Glob":
      return `${icon} ${mono(str(input, "pattern") ?? "")}`;
    case "WebSearch":
      return `${icon} ${clip(str(input, "query") ?? "", 80)}`;
    case "WebFetch":
      return `${icon} ${mono(clip(str(input, "url") ?? "", 80))}`;
    case "Task":
      return `${icon} субагент: ${clip(str(input, "description") ?? "", 60)}`;
    default:
      return `${icon} ${toolName}`;
  }
}

export function truncate(text: string, limit = 600): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n… (обрезано, ещё ${text.length - limit} символов)`;
}

/** Режет длинный текст на куски по границам строк, чтобы не рвать разметку посреди слова. */
export function chunk(text: string, limit = TELEGRAM_LIMIT): string[] {
  if (text.length <= limit) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < limit * 0.5) cut = limit;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  if (rest) parts.push(rest);
  return parts;
}

const TOOL_ICONS: Record<string, string> = {
  Read: "📖",
  Write: "📝",
  Edit: "✏️",
  NotebookEdit: "📓",
  Bash: "🖥️",
  Glob: "🗂️",
  Grep: "🔍",
  WebSearch: "🌐",
  WebFetch: "🌐",
  Task: "🤖",
  TodoWrite: "📋",
  AskUserQuestion: "❓",
};

export function toolIcon(toolName: string): string {
  return TOOL_ICONS[toolName] ?? "🔧";
}

function str(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  return typeof value === "string" ? value : null;
}

/** Короткая строка «что агент делает» — для ленты активности. */
export function describeToolShort(toolName: string, input: Record<string, unknown>): string {
  const icon = toolIcon(toolName);
  switch (toolName) {
    case "Bash": {
      const cmd = str(input, "command") ?? "";
      return `${icon} ${code(truncate(cmd.split("\n")[0] ?? "", 120))}`;
    }
    case "Read":
    case "Write":
    case "Edit":
    case "NotebookEdit": {
      const path = str(input, "file_path") ?? str(input, "notebook_path") ?? "";
      return `${icon} ${esc(toolName)} ${code(shortPath(path))}`;
    }
    case "Grep": {
      const pattern = str(input, "pattern") ?? "";
      return `${icon} поиск ${code(truncate(pattern, 60))}`;
    }
    case "Glob":
      return `${icon} ${code(str(input, "pattern") ?? "")}`;
    case "WebSearch":
      return `${icon} ${esc(truncate(str(input, "query") ?? "", 80))}`;
    case "WebFetch":
      return `${icon} ${code(truncate(str(input, "url") ?? "", 80))}`;
    case "Task":
      return `${icon} субагент: ${esc(truncate(str(input, "description") ?? "", 60))}`;
    default:
      return `${icon} ${esc(toolName)}`;
  }
}

/** Подробное описание для карточки разрешения — пользователь решает по нему. */
export function describeToolDetailed(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "Bash": {
      const cmd = str(input, "command") ?? "";
      const description = str(input, "description");
      const head = description ? `${esc(description)}\n\n` : "";
      return `${head}${pre(truncate(cmd, 1200), "bash")}`;
    }
    case "Write": {
      const path = str(input, "file_path") ?? "";
      const content = str(input, "content") ?? "";
      const lines = content.split("\n");
      return (
        `Файл: ${code(shortPath(path))}\n` +
        `<b>${lines.length}</b> строк, ${content.length} символов\n\n` +
        pre(truncate(lines.slice(0, 12).join("\n"), 700))
      );
    }
    case "Edit": {
      const path = str(input, "file_path") ?? "";
      const oldLines = (str(input, "old_string") ?? "").split("\n");
      const newLines = (str(input, "new_string") ?? "").split("\n");
      // Полный дифф на телефоне разъезжается и тонет. Показываем сводку и
      // несколько первых строк — этого хватает, чтобы решить, разрешать ли.
      const head = [
        ...oldLines.slice(0, 4).map((l) => `- ${truncate(l, 90)}`),
        ...newLines.slice(0, 4).map((l) => `+ ${truncate(l, 90)}`),
      ].join("\n");
      const rest = oldLines.length + newLines.length - 8;
      const tail = rest > 0 ? `\n… ещё ${rest} строк(и)` : "";
      return (
        `Файл: ${code(shortPath(path))}\n` +
        `<b>−${oldLines.length}</b> / <b>+${newLines.length}</b> строк\n\n` +
        pre(`${head}${tail}`, "diff")
      );
    }
    case "Read": {
      const path = str(input, "file_path") ?? "";
      return `Прочитать ${code(path)}`;
    }
    case "ExitPlanMode": {
      // План написан для чтения человеком: JSON-дамп здесь бесполезен.
      const plan = str(input, "plan") ?? "";
      return esc(truncate(plan, 3000));
    }
    case "Task": {
      const description = str(input, "description") ?? "";
      const type = str(input, "subagent_type");
      const prompt = str(input, "prompt") ?? "";
      const who = type ? ` (${esc(type)})` : "";
      return `Запустить субагента${who}: <b>${esc(description)}</b>\n\n${pre(truncate(prompt, 700))}`;
    }
    case "WebFetch":
      return `Загрузить ${code(str(input, "url") ?? "")}`;
    default: {
      const json = JSON.stringify(input, null, 2);
      return pre(truncate(json, 900), "json");
    }
  }
}

/** Показываем последние сегменты пути: полный путь в мобильном экране бесполезен. */
export function shortPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 3) return path;
  return `…/${parts.slice(-3).join("/")}`;
}

export function formatUsd(value: number): string {
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} с`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} мин ${seconds % 60} с`;
}

/**
 * Длинный текст лучше отдать файлом, чем ломать о лимит сообщения: код в
 * мобильном клиенте всё равно разъезжается, а файл открывается и сохраняется.
 */
export const SEND_AS_FILE_OVER = 1800;

/** Имя для такого файла: по языку из ограждения, иначе просто txt. */
export function codeBlockFileName(language: string | undefined, index: number): string {
  const extensions: Record<string, string> = {
    ts: "ts",
    typescript: "ts",
    js: "js",
    javascript: "js",
    py: "py",
    python: "py",
    sh: "sh",
    bash: "sh",
    json: "json",
    yaml: "yml",
    yml: "yml",
    sql: "sql",
    html: "html",
    css: "css",
    go: "go",
    rust: "rs",
    rs: "rs",
    java: "java",
  };
  const extension = extensions[(language ?? "").toLowerCase()] ?? "txt";
  return `фрагмент-${index}.${extension}`;
}

export interface SplitPart {
  kind: "text" | "file";
  body: string;
  language?: string;
}

/**
 * Разбирает ответ на текст и длинные блоки кода. Короткие блоки остаются
 * в сообщении: отдавать файлом три строки — издевательство.
 */
export function splitCodeBlocks(text: string): SplitPart[] {
  const parts: SplitPart[] = [];
  const fence = /```(\w+)?\n([\s\S]*?)```/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = fence.exec(text)) !== null) {
    const [full, language, body] = match;
    if (body !== undefined && body.length > SEND_AS_FILE_OVER) {
      const before = text.slice(last, match.index).trim();
      if (before) parts.push({ kind: "text", body: before });
      parts.push({ kind: "file", body, language });
      last = match.index + full.length;
    }
  }

  const rest = text.slice(last).trim();
  if (rest) parts.push({ kind: "text", body: rest });
  return parts.length > 0 ? parts : [{ kind: "text", body: text }];
}
