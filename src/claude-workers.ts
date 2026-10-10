/**
 * Карта «пользователь Telegram → uid изолированного Claude Code».
 *
 * Первые исполнители записаны в .env (CLAUDE_WORKER_UID_MAP), новых создаёт
 * root-служба ai-bot-claude-workers (scripts/claude-workers.py) и дописывает в
 * data/claude-workers.json. Бот читает файл на лету — перезапуск не нужен.
 * Не нашёл исполнителя — оставляет запрос (data/claude-workers.request):
 * служба по нему просыпается сразу, а не ждёт таймера.
 */
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";

export const WORKERS_FILE = join(config.dataDir, "claude-workers.json");
export const WORKERS_REQUEST = join(config.dataDir, "claude-workers.request");

let cache: { mtimeMs: number; map: Map<number, number> } | null = null;

function fileMap(): Map<number, number> {
  let mtimeMs: number;
  try { mtimeMs = statSync(WORKERS_FILE).mtimeMs; } catch { return new Map(); }
  if (cache?.mtimeMs === mtimeMs) return cache.map;
  const map = new Map<number, number>();
  try {
    const raw: unknown = JSON.parse(readFileSync(WORKERS_FILE, "utf8"));
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [id, uid] of Object.entries(raw)) {
        if (/^[1-9]\d*$/.test(id) && Number.isSafeInteger(uid) && (uid as number) >= 1000) map.set(Number(id), uid as number);
      }
    }
  } catch { /* битый файл — как будто его нет; .env остаётся */ }
  cache = { mtimeMs, map };
  return map;
}

/** Все исполнители: .env и файл службы (при расхождении прав .env). */
export function workerMap(): Map<number, number> {
  const map = new Map(fileMap());
  for (const entry of (process.env.CLAUDE_WORKER_UID_MAP ?? "").split(",")) {
    const [id, uid] = entry.trim().split(":").map(Number);
    if (Number.isSafeInteger(id) && id! > 0 && Number.isSafeInteger(uid) && uid! >= 1000) map.set(id!, uid!);
  }
  return map;
}

/** Попросить службу создать исполнителя (не чаще раза в 10 секунд). */
let lastRequest = 0;
export function requestWorker(userId: number): void {
  if (Date.now() - lastRequest < 10_000) return;
  lastRequest = Date.now();
  try { writeFileSync(WORKERS_REQUEST, `${userId} ${Date.now()}\n`, { mode: 0o600 }); } catch { /* служба всё равно пройдёт по таймеру */ }
}
