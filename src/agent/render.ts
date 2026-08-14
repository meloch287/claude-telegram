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
export function describeToolDetailed(
  toolName: string,
  input: Record<string, unknown>,
): string {
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
      return `Файл: ${code(path)}\nРазмер: ${content.length} символов\n\n${pre(truncate(content, 800))}`;
    }
    case "Edit": {
      const path = str(input, "file_path") ?? "";
      const oldStr = str(input, "old_string") ?? "";
      const newStr = str(input, "new_string") ?? "";
      const diff = [
        ...oldStr.split("\n").slice(0, 12).map((l) => `- ${l}`),
        ...newStr.split("\n").slice(0, 12).map((l) => `+ ${l}`),
      ].join("\n");
      return `Файл: ${code(path)}\n\n${pre(truncate(diff, 900), "diff")}`;
    }
    case "Read": {
      const path = str(input, "file_path") ?? "";
      return `Прочитать ${code(path)}`;
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
