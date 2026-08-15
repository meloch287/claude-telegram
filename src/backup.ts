import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";
import { pruneUsageEvents } from "./db.js";

/**
 * Копии базы. В bot.db лежит всё, что нельзя восстановить пересборкой:
 * зашифрованные ключи, расход, достижения и привязка чатов к сессиям.
 *
 * Копия снимается через VACUUM INTO — штатный способ SQLite снять
 * согласованный снимок работающей базы. Обычное копирование файла в режиме WAL
 * даёт битый результат: часть данных лежит в -wal и в основной файл ещё не
 * переехала.
 *
 * Хранение внутри процесса бота, а не системным cron: так копии продолжают
 * сниматься после пересборки образа, и не нужно ничего заводить на хосте.
 */

const BACKUP_DIR = join(config.dataDir, "backups");
const KEEP_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function backupNow(): string | null {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const target = join(BACKUP_DIR, `bot-${today()}.db`);

  // За сегодня копия уже есть — второй раз за день незачем.
  try {
    statSync(target);
    return null;
  } catch {
    // Нет файла — значит снимаем.
  }

  const source = new DatabaseSync(join(config.dataDir, "bot.db"), { readOnly: true });
  try {
    // Путь подставляется в SQL строкой: VACUUM INTO не принимает параметры.
    // Значение своё, из конфига, а не пользовательское.
    source.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } finally {
    source.close();
  }
  return target;
}

function prune(): number {
  let removed = 0;
  const edge = Date.now() - KEEP_DAYS * DAY_MS;
  for (const name of readdirSync(BACKUP_DIR)) {
    if (!/^bot-\d{4}-\d{2}-\d{2}\.db$/.test(name)) continue;
    const path = join(BACKUP_DIR, name);
    if (statSync(path).mtimeMs < edge) {
      unlinkSync(path);
      removed += 1;
    }
  }
  return removed;
}

function runOnce(): void {
  try {
    const made = backupNow();
    const removed = prune();
    // Заодно подчищаем расход старше недельного окна: он больше ни на что не
    // влияет, а таблица без чистки растёт без конца.
    const events = pruneUsageEvents();
    if (events > 0) console.log(`🧹 Убрано старых записей расхода: ${events}`);
    if (made) {
      const size = (statSync(made).size / 1024).toFixed(0);
      console.log(
        `💾 Копия базы: ${made} (${size} КБ)${removed ? `, удалено старых: ${removed}` : ""}`,
      );
    }
  } catch (error) {
    // Провал копии не должен ронять бота: это фоновая гигиена, а не работа.
    console.error("⚠️  Не удалось снять копию базы:", (error as Error).message);
  }
}

export function scheduleDailyBackups(): void {
  runOnce();
  // Раз в сутки. Проверка «копия за сегодня уже есть» делает повтор безвредным,
  // поэтому точное время не важно и переживать перезапуск не нужно.
  const timer = setInterval(runOnce, DAY_MS);
  // Иначе таймер держал бы процесс живым при штатном завершении.
  timer.unref();
}
