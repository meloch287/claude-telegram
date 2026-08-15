import { appendFileSync, mkdirSync, renameSync, statSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";

/**
 * Свой лог в файл рядом с базой.
 *
 * Изнутри контейнера `docker logs` не прочитать: сокет docker туда не проброшен
 * и пробрасывать его незачем — это root на хосте. Поэтому бот пишет копию
 * своего вывода в файл на томе, а /logs отдаёт хвост этого файла в чат.
 * Так разбор «почему отвалилось» перестаёт требовать ssh.
 */

const LOG_PATH = join(config.dataDir, "bot.log");
const PREVIOUS_PATH = join(config.dataDir, "bot.log.1");
/** Больше пары мегабайт в чат всё равно не отдать, а место на сервере в дефиците. */
const ROTATE_AT_BYTES = 2 * 1024 * 1024;

let installed = false;

function rotateIfBig(): void {
  try {
    if (statSync(LOG_PATH).size < ROTATE_AT_BYTES) return;
    // Одно поколение назад: история глубже интересна редко, а место занимает.
    renameSync(LOG_PATH, PREVIOUS_PATH);
  } catch {
    // Файла ещё нет — ротировать нечего.
  }
}

function stamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function line(level: string, args: unknown[]): string {
  const text = args
    .map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return `${a.message}\n${a.stack ?? ""}`;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
  return `${stamp()} ${level} ${text}\n`;
}

/**
 * Подменяет console: вывод продолжает идти в stdout (его читает docker logs),
 * а копия ложится в файл. Ошибку записи глотаем молча — иначе неудачная запись
 * лога вызвала бы console.error, тот снова попытался бы записать, и так по кругу.
 */
export function startFileLog(): void {
  if (installed) return;
  installed = true;
  mkdirSync(config.dataDir, { recursive: true });

  for (const [method, level] of [
    ["log", "INFO"],
    ["warn", "WARN"],
    ["error", "ERROR"],
  ] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args);
      try {
        rotateIfBig();
        appendFileSync(LOG_PATH, line(level, args));
      } catch {
        // Молчим намеренно: см. комментарий выше.
      }
    };
  }
}

/** Последние строки лога. Меньше запрошенного вернётся, если лога столько нет. */
export function tailLog(lines: number): string {
  if (!existsSync(LOG_PATH)) return "";
  const content = readFileSync(LOG_PATH, "utf8");
  const all = content.split("\n").filter(Boolean);
  return all.slice(-lines).join("\n");
}
