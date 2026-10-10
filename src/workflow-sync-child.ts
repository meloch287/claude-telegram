/**
 * Раскладка готовых воркфлоу Claude Code в ~/.claude/workflows пользователя.
 *
 * Запускается отдельным процессом ОТ ИМЕНИ пользователя (uid/gid его Claude
 * Code), а не от root: папка принадлежит ему, и подменённая символическая
 * ссылка не уведёт запись за пределы его собственных прав.
 *
 * Обновляется только то, что человек не правил сам: хэши поставленных версий
 * лежат в .managed.json. Изменённый или удалённый им файл остаётся как есть.
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface WorkflowItem {
  name: string;
  body: string;
}
export interface SyncResult {
  installed: string[];
  updated: string[];
  kept: string[];
}

const NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;
const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

function writeAtomic(target: string, body: string): void {
  const temp = `${target}.tmp-${process.pid}`;
  writeFileSync(temp, body, { mode: 0o600 });
  renameSync(temp, target);
}

export function syncDir(dir: string, items: WorkflowItem[]): SyncResult {
  const result: SyncResult = { installed: [], updated: [], kept: [] };
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (lstatSync(dir).isSymbolicLink()) throw new Error("Папка воркфлоу — символическая ссылка, пропускаю");
  const manifestPath = join(dir, ".managed.json");
  let manifest: Record<string, string> = {};
  try {
    const raw: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (raw && typeof raw === "object" && !Array.isArray(raw)) manifest = raw as Record<string, string>;
  } catch {
    // Первая раскладка: манифеста ещё нет.
  }
  for (const item of items) {
    if (!NAME.test(item.name)) continue;
    const target = join(dir, `${item.name}.js`);
    const wanted = sha(item.body);
    if (existsSync(target)) {
      if (lstatSync(target).isSymbolicLink()) {
        result.kept.push(item.name);
        continue;
      }
      const current = sha(readFileSync(target, "utf8"));
      if (current === wanted) {
        manifest[item.name] = wanted;
        continue;
      }
      if (manifest[item.name] !== current) {
        result.kept.push(item.name);
        continue;
      }
      result.updated.push(item.name);
    } else if (manifest[item.name] !== undefined) {
      result.kept.push(item.name);
      continue;
    } else {
      result.installed.push(item.name);
    }
    writeAtomic(target, item.body);
    manifest[item.name] = wanted;
  }
  writeAtomic(manifestPath, JSON.stringify(manifest, null, 1) + "\n");
  return result;
}

// Запуск отдельным процессом: задание приходит в stdin, итог уходит в stdout.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const job = JSON.parse(readFileSync(0, "utf8")) as { dir: string; items: WorkflowItem[] };
  process.stdout.write(JSON.stringify(syncDir(job.dir, job.items)));
}
