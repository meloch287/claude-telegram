/**
 * Общий выключатель движков: админ может временно закрыть GPT или Claude для
 * всех, кроме себя. Флаги лежат в data/engine-access.json; их читают оба
 * процесса (ai-bot — Claude, ai-gpt-backend — GPT, bb и консультации).
 */
import { readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isAdmin } from "./admin.js";
import { config } from "./config.js";

export type AccessEngine = "gpt" | "claude";
export interface EngineAccess { gpt: boolean; claude: boolean; updatedAt: number }

const path = () => join(config.dataDir, "engine-access.json");
let cache: { mtime: number; value: EngineAccess } | null = null;

export function engineAccess(): EngineAccess {
  let mtime = 0;
  try { mtime = statSync(path()).mtimeMs; } catch { return { gpt: true, claude: true, updatedAt: 0 }; }
  if (cache && cache.mtime === mtime) return cache.value;
  let value: EngineAccess = { gpt: true, claude: true, updatedAt: 0 };
  try {
    const raw = JSON.parse(readFileSync(path(), "utf8")) as Partial<EngineAccess>;
    // Испорченный файл не должен закрыть доступ: только явный false выключает.
    value = { gpt: raw.gpt !== false, claude: raw.claude !== false, updatedAt: Number(raw.updatedAt) || 0 };
  } catch {
    // оставляем всё открытым
  }
  cache = { mtime, value };
  return value;
}

export function setEngineAccess(engine: AccessEngine, enabled: boolean): EngineAccess {
  const next = { ...engineAccess(), [engine]: enabled, updatedAt: Date.now() };
  const temp = `${path()}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(next) + "\n", { mode: 0o600 });
  renameSync(temp, path());
  cache = null;
  return next;
}

/** Админ всегда работает; остальным — по флагу. */
export function engineAllowed(engine: AccessEngine, userId: number | undefined): boolean {
  return isAdmin(userId) || engineAccess()[engine];
}

export function engineClosedText(engine: AccessEngine): string {
  return `⏸ ${engine === "gpt" ? "GPT" : "Claude"} временно ограничен. Попробуй позже.`;
}
