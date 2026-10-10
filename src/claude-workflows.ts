/**
 * Готовые воркфлоу Claude Code (оркестрация субагентов) для пользователей бота.
 *
 * Исходники лежат в claude-workflows/ рядом с dist; бот раскладывает их в
 * ~/.claude/workflows каждого изолированного Claude Code, и там они становятся
 * командами вида /review. Писать в домашнюю папку пользователя должен он сам,
 * поэтому раскладка идёт дочерним процессом под его uid.
 */
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { workerFor } from "./agent/isolation.js";
import type { SyncResult, WorkflowItem } from "./workflow-sync-child.js";

const SOURCE_DIR = fileURLToPath(new URL("../claude-workflows/", import.meta.url));
const CHILD = fileURLToPath(new URL("./workflow-sync-child.js", import.meta.url));
/** Встроенные воркфлоу Claude Code, которые тоже пропускаем как команды. */
const BUILTIN = new Map([["deep-research", "Глубокое исследование вопроса по множеству источников с перекрёстной проверкой"]]);
const NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;

export function managedWorkflows(): WorkflowItem[] {
  if (!existsSync(SOURCE_DIR)) return [];
  return readdirSync(SOURCE_DIR)
    .filter((file) => file.endsWith(".js"))
    .sort()
    .map((file) => ({ name: file.slice(0, -3), body: readFileSync(join(SOURCE_DIR, file), "utf8") }));
}

/** Пользователи с изолированным Claude Code — из той же карты, что и workerFor. */
export function claudeWorkerUsers(): number[] {
  return (process.env.CLAUDE_WORKER_UID_MAP ?? "")
    .split(",")
    .map((entry) => Number(entry.trim().split(":")[0]))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
}

const synced = new Set<number>();
/** Раскладывает воркфлоу пользователю один раз за жизнь процесса (force — заново). */
export function syncWorkflows(userId: number, force = false): SyncResult | null {
  if (!force && synced.has(userId)) return null;
  const items = managedWorkflows();
  if (!items.length) return null;
  const worker = workerFor(userId);
  const run = spawnSync(process.execPath, [CHILD], {
    input: JSON.stringify({ dir: join(worker.home, ".claude", "workflows"), items }),
    uid: worker.uid,
    gid: worker.gid,
    cwd: worker.home,
    env: { HOME: worker.home, PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8" },
    encoding: "utf8",
    timeout: 15_000,
  });
  if (run.status !== 0) {
    throw new Error(`Раскладка воркфлоу для ${userId} не удалась: ${(run.stderr || run.error?.message || "").slice(0, 300)}`);
  }
  synced.add(userId);
  return JSON.parse(run.stdout) as SyncResult;
}

export function syncAllWorkflows(): void {
  for (const userId of claudeWorkerUsers()) {
    try {
      const result = syncWorkflows(userId, true);
      if (result && (result.installed.length || result.updated.length)) {
        console.log(`[workflows] ${userId}: +${result.installed.length} новых, ${result.updated.length} обновлено, ${result.kept.length} оставлено как у человека`);
      }
    } catch (error) {
      console.error("[workflows]", error instanceof Error ? error.message : error);
    }
  }
}

export interface WorkflowInfo {
  name: string;
  description: string;
}
/** Воркфлоу пользователя для списка /workflows: свои, разложенные ботом и встроенные. */
export function listWorkflows(userId: number): WorkflowInfo[] {
  const list: WorkflowInfo[] = [];
  let dir: string;
  try {
    dir = join(workerFor(userId).home, ".claude", "workflows");
  } catch {
    return [];
  }
  if (existsSync(dir) && !lstatSync(dir).isSymbolicLink()) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".js")).sort()) {
      const path = join(dir, file);
      if (lstatSync(path).isSymbolicLink() || statSync(path).size > 200_000) continue;
      const head = readFileSync(path, "utf8").slice(0, 3000);
      const name = /\bname:\s*'([a-z0-9][a-z0-9-]{0,40})'/.exec(head)?.[1] ?? file.slice(0, -3);
      const description = /\bdescription:\s*'([^']{1,300})'/.exec(head)?.[1] ?? "";
      if (NAME.test(name)) list.push({ name, description });
    }
  }
  for (const [name, description] of BUILTIN) if (!list.some((w) => w.name === name)) list.push({ name, description });
  return list;
}

/** Команда из Telegram — это воркфлоу Claude Code, а не неизвестная команда бота? */
export function isWorkflowCommand(userId: number, name: string): boolean {
  if (!NAME.test(name)) return false;
  if (BUILTIN.has(name)) return true;
  try {
    const file = join(workerFor(userId).home, ".claude", "workflows", `${name}.js`);
    return existsSync(file) && !lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
}
