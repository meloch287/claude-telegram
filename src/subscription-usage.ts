import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Расход подписки за скользящее окно — по транскриптам Claude Code.
 *
 * Почему не по своей таблице расхода: она считает только то, что прошло через
 * бота, и только настоящие input/output. Подписка же тратится на всё, что
 * запускает Claude Code в этом контейнере — включая субагентов, — и считает
 * ещё и кэш. Транскрипты знают и то, и другое: у каждой реплики модели есть
 *timestamp и полный usage.
 *
 * Чего эти числа НЕ знают: работы с других машин. Если ты гоняешь Claude Code
 * в терминале на своём ноутбуке, его расход в лимит подписки идёт, а сюда не
 * попадает — этих файлов на сервере просто нет.
 */

const PROJECTS_DIR = join(homedir(), ".claude", "projects");
/** Файл больше этого читать построчно накладно, а таких в норме и не бывает. */
const MAX_FILE_BYTES = 64 * 1024 * 1024;
/** Ответ живёт минуту: мини-апп открывают чаще, чем меняются числа. */
const CACHE_TTL_MS = 60_000;

export interface SubscriptionUsage {
  /** Всё, что списывается с подписки: вход, выход и кэш. */
  tokens: number;
  /** Настоящие вход и выход, без кэша — для сравнения со счётчиком бота. */
  tokensWithoutCache: number;
  /** Сколько реплик модели попало в окно. */
  replies: number;
  /** Сколько файлов пришлось прочитать: видно, дорого ли обходится подсчёт. */
  filesScanned: number;
}

const cache = new Map<number, { at: number; value: SubscriptionUsage }>();

function* jsonlFiles(dir: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // Каталога нет — значит Claude Code здесь ещё не работал.
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* jsonlFiles(path);
    else if (entry.name.endsWith(".jsonl")) yield path;
  }
}

function scan(windowMs: number): SubscriptionUsage {
  const since = Date.now() - windowMs;
  const result: SubscriptionUsage = {
    tokens: 0,
    tokensWithoutCache: 0,
    replies: 0,
    filesScanned: 0,
  };

  for (const path of jsonlFiles(PROJECTS_DIR)) {
    let info;
    try {
      info = statSync(path);
    } catch {
      continue;
    }
    // Файл, не менявшийся с начала окна, внутри окна записей не содержит.
    // Это и есть главная экономия: за пять часов файлов остаются единицы.
    if (info.mtimeMs < since || info.size > MAX_FILE_BYTES) continue;
    result.filesScanned += 1;

    let content;
    try {
      content = readFileSync(path, "utf8");
    } catch {
      continue;
    }

    for (const line of content.split("\n")) {
      // Дешёвая отсечка до разбора JSON: строк в транскриптах сотни тысяч.
      if (!line.includes('"usage"')) continue;
      try {
        const record = JSON.parse(line) as {
          timestamp?: string;
          message?: { usage?: Record<string, number> };
        };
        const usage = record.message?.usage;
        if (!usage || !record.timestamp) continue;
        const at = Date.parse(record.timestamp);
        if (!Number.isFinite(at) || at < since) continue;

        const input = usage.input_tokens ?? 0;
        const output = usage.output_tokens ?? 0;
        const cacheWrite = usage.cache_creation_input_tokens ?? 0;
        const cacheRead = usage.cache_read_input_tokens ?? 0;

        result.replies += 1;
        result.tokensWithoutCache += input + output;
        result.tokens += input + output + cacheWrite + cacheRead;
      } catch {
        // Оборванная строка в конце активной сессии — обычное дело.
      }
    }
  }
  return result;
}

export function subscriptionUsage(windowMs: number): SubscriptionUsage {
  const hit = cache.get(windowMs);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const value = scan(windowMs);
  cache.set(windowMs, { at: Date.now(), value });
  return value;
}
