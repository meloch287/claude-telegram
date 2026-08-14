/**
 * Переносит историю расхода из транскриптов Claude Code в базу бота.
 *
 * Claude Code хранит каждую сессию файлом ~/.claude/projects/<проект>/<uuid>.jsonl,
 * где у каждого ответа модели есть блок usage. Складываем вход и выход по всем
 * файлам — это и есть «сколько потрачено за всё время».
 *
 * Чтение кэша намеренно не считаем: оно стоит десятую часть обычного токена и
 * на реальной истории даёт числа в сотни раз больше настоящих, превращая
 * счётчик в бессмыслицу.
 *
 *   npx tsx scripts/import-history.ts <telegram-user-id> [--apply]
 *
 * Без --apply только считает и печатает. С --apply дописывает в базу,
 * поэтому повторный запуск удвоит цифры — это разовая операция.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const userId = Number(process.argv[2]);
const apply = process.argv.includes("--apply");

if (!Number.isInteger(userId)) {
  console.error("Укажи telegram user id: npx tsx scripts/import-history.ts 123456789 [--apply]");
  process.exit(1);
}

const root = process.env.CLAUDE_PROJECTS_DIR ?? join(homedir(), ".claude", "projects");

/**
 * Транскрипты лежат на машине, где работал Claude Code, а база бота — на
 * сервере. Поэтому числа можно посчитать здесь и применить там, передав их
 * переменными: пересылать 3400 файлов ради двух чисел незачем.
 */
const preTokens = Number(process.env.IMPORT_TOKENS ?? "");
const preReplies = Number(process.env.IMPORT_REPLIES ?? "");
const precomputed = Number.isFinite(preTokens) && preTokens > 0;

function* jsonlFiles(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* jsonlFiles(path);
    else if (entry.endsWith(".jsonl")) yield path;
  }
}

let input = 0;
let output = 0;
let replies = 0;
let files = 0;

for (const file of precomputed ? [] : jsonlFiles(root)) {
  files += 1;
  const content = readFileSync(file, "utf8");
  for (const line of content.split("\n")) {
    // Дешёвая отсечка до разбора JSON: строк в транскриптах сотни тысяч.
    if (!line.includes('"usage"')) continue;
    try {
      const record = JSON.parse(line) as { message?: { usage?: Record<string, number> } };
      const usage = record.message?.usage;
      if (!usage) continue;
      replies += 1;
      input += usage.input_tokens ?? 0;
      output += usage.output_tokens ?? 0;
    } catch {
      // Оборванная строка в конце файла — обычное дело для активной сессии.
    }
  }
}

const total = precomputed ? preTokens : input + output;
if (precomputed) replies = Number.isFinite(preReplies) ? preReplies : 0;
const format = (n: number) => n.toLocaleString("ru-RU");

if (precomputed) {
  console.log("Числа переданы готовыми, транскрипты не читаю.");
} else {
  console.log(`Каталог: ${root}`);
  console.log(`Файлов сессий: ${format(files)}`);
  console.log(`  вход:  ${format(input)}`);
  console.log(`  выход: ${format(output)}`);
}
console.log(`Ответов модели: ${format(replies)}`);
console.log(`ИТОГО: ${format(total)} токенов`);

if (!apply) {
  console.log("\nЭто пробный прогон. Чтобы записать в базу, добавь --apply");
  process.exit(0);
}

const { addHistoricalUsage, getOrCreateUser } = await import("../src/db.js");
const before = getOrCreateUser(userId).total_tokens;
addHistoricalUsage(userId, total, replies);
const after = getOrCreateUser(userId).total_tokens;
console.log(`\nБыло: ${format(before)} → стало: ${format(after)}`);
