import { readdirSync, lstatSync,openSync,closeSync,constants,realpathSync } from "node:fs";
import { join, relative, sep,resolve } from "node:path";

/**
 * Что агент создал за время задачи.
 *
 * Раньше результат оставался на сервере: бот умел слать только текст, и файл,
 * картинку или отчёт можно было забрать разве что через git push. Здесь мы
 * снимаем отпечаток рабочей папки до задачи и сравниваем после — изменившееся
 * предлагаем прислать.
 */

/** Внутрь этих каталогов не смотрим: интересны результаты, а не зависимости. */
const SKIP = new Set([
  ".git",
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  "dist",
  "build",
  ".next",
  "target",
]);

/** Больше десяти тысяч файлов — это репозиторий, а не результат работы. */
const MAX_ENTRIES = 10_000;

export type Snapshot = Map<string, number>;

export function snapshot(root: string): Snapshot {
  const seen: Snapshot = new Map();
  try{if(realpathSync(root)!==resolve(root))return seen;walk(root, root, seen);}catch{}
  return seen;
}

function walk(root: string, dir: string, into: Snapshot, logical=dir): void {
 if(into.size>=MAX_ENTRIES)return;
 let fd:number;try{fd=openSync(dir,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW)}catch{return}
 try{for(const entry of readdirSync(`/proc/self/fd/${fd}`)){
  if(SKIP.has(entry))continue;
  const pinned=`/proc/self/fd/${fd}/${entry}`,path=join(logical,entry);
  try{const info=lstatSync(pinned);if(info.isSymbolicLink())continue;if(info.isDirectory())walk(root,pinned,into,path);else if(info.isFile()&&info.nlink===1)into.set(relative(root,path),info.mtimeMs)}catch{}
  if(into.size>=MAX_ENTRIES)return;
 }}finally{closeSync(fd)}
}

export interface Artifact {
  /** Путь относительно рабочей папки — его и показываем пользователю. */
  relative: string;
  absolute: string;
  size: number;
  isNew: boolean;
}

/** Телеграм не принимает от ботов файлы больше пятидесяти мегабайт. */
const MAX_SEND_BYTES = 49 * 1024 * 1024;

/**
 * Порог «это не результат, а массовая операция».
 *
 * Клонирование репозитория, установка зависимостей или сборка меняют сотни
 * файлов разом. Ни один из них не является тем, что пользователь просил, и
 * слать их в чат — только зашумлять.
 */
const BULK_THRESHOLD = 40;

export interface ChangeReport {
  /** Файлы, которые имеет смысл прислать. Пусто при массовой операции. */
  files: Artifact[];
  /** Сколько файлов изменилось всего — в том числе при массовой операции. */
  total: number;
  /** Массовая операция: клон, установка зависимостей, сборка. */
  bulk: boolean;
}

/**
 * Что изменилось между двумя отпечатками. Возвращает новые файлы первыми:
 * они интереснее правок в уже существующих.
 */
export function changedSince(root: string, before: Snapshot, limit = 10): Artifact[] {
  return reportChanges(root, before, limit).files;
}

export function reportChanges(root: string, before: Snapshot, limit = 10): ChangeReport {
  const after = snapshot(root);
  const changed: Artifact[] = [];

  for (const [path, mtime] of after) {
    const previous = before.get(path);
    if (previous !== undefined && previous === mtime) continue;
    const absolute = join(root, path);
    let size: number;
    try {
      const info=lstatSync(absolute);if(!info.isFile()||info.nlink!==1)continue;size=info.size;
    } catch {
      continue;
    }
    if (size === 0 || size > MAX_SEND_BYTES) continue;
    // Вложения пользователь прислал сам — возвращать их обратно незачем.
    if (path.startsWith(`вложения${sep}`)) continue;
    changed.push({ relative: path, absolute, size, isNew: previous === undefined });
  }

  changed.sort((a, b) => Number(b.isNew) - Number(a.isNew) || a.relative.localeCompare(b.relative));

  if (changed.length > BULK_THRESHOLD) {
    return { files: [], total: changed.length, bulk: true };
  }
  return { files: changed.slice(0, limit), total: changed.length, bulk: false };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}
