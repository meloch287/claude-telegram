import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";
import { encrypt, decrypt } from "./crypto.js";
import type { TierId } from "./tiers.js";
import type { AuthKind, Credential } from "./auth.js";

mkdirSync(config.dataDir, { recursive: true });

const db = new DatabaseSync(join(config.dataDir, "bot.db"));
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  user_id        INTEGER PRIMARY KEY,
  tier           TEXT    NOT NULL DEFAULT 'free',
  api_key_enc    TEXT,
  auth_kind      TEXT,
  model          TEXT,
  onboarded      INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  last_active_day TEXT,
  streak_days    INTEGER NOT NULL DEFAULT 0,
  total_tokens   INTEGER NOT NULL DEFAULT 0,
  total_cost_usd REAL    NOT NULL DEFAULT 0,
  total_messages INTEGER NOT NULL DEFAULT 0,
  total_sessions INTEGER NOT NULL DEFAULT 0,
  tools_allowed  INTEGER NOT NULL DEFAULT 0,
  tools_denied   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chats (
  chat_id         INTEGER PRIMARY KEY,
  user_id         INTEGER NOT NULL,
  project         TEXT    NOT NULL DEFAULT 'default',
  session_id      TEXT,
  title           TEXT,
  permission_mode TEXT    NOT NULL DEFAULT 'default',
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_daily (
  user_id INTEGER NOT NULL,
  day     TEXT    NOT NULL,
  tokens  INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL   NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS achievements (
  user_id     INTEGER NOT NULL,
  achievement TEXT    NOT NULL,
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, achievement)
);

CREATE TABLE IF NOT EXISTS rate_limits (
  user_id     INTEGER NOT NULL,
  limit_type  TEXT    NOT NULL,
  status      TEXT    NOT NULL,
  utilization REAL,
  resets_at   INTEGER,
  seen_at     INTEGER NOT NULL,
  PRIMARY KEY (user_id, limit_type)
);

CREATE TABLE IF NOT EXISTS projects_seen (
  user_id INTEGER NOT NULL,
  project TEXT    NOT NULL,
  PRIMARY KEY (user_id, project)
);
`);

/**
 * Догоняем базы, созданные до появления колонок: CREATE TABLE IF NOT EXISTS
 * молча пропускает уже существующую таблицу и новые поля не добавляет.
 */
for (const [table, column, type] of [
  ["users", "auth_kind", "TEXT"],
  ["users", "model", "TEXT"],
  ["chats", "title", "TEXT"],
] as const) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!existing.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

export interface UserRow {
  user_id: number;
  tier: TierId;
  api_key_enc: string | null;
  auth_kind: AuthKind | null;
  model: string | null;
  onboarded: number;
  created_at: number;
  last_active_day: string | null;
  streak_days: number;
  total_tokens: number;
  total_cost_usd: number;
  total_messages: number;
  total_sessions: number;
  tools_allowed: number;
  tools_denied: number;
}

export interface ChatRow {
  chat_id: number;
  user_id: number;
  project: string;
  session_id: string | null;
  title: string | null;
  permission_mode: string;
  updated_at: number;
}

const stmts = {
  getUser: db.prepare("SELECT * FROM users WHERE user_id = ?"),
  insertUser: db.prepare("INSERT OR IGNORE INTO users (user_id, created_at) VALUES (?, ?)"),
  setTier: db.prepare("UPDATE users SET tier = ?, onboarded = 1 WHERE user_id = ?"),
  setKey: db.prepare("UPDATE users SET api_key_enc = ?, auth_kind = ? WHERE user_id = ?"),
  setModel: db.prepare("UPDATE users SET model = ? WHERE user_id = ?"),
  bumpCounter: db.prepare("UPDATE users SET total_messages = total_messages + 1 WHERE user_id = ?"),
  bumpSessions: db.prepare("UPDATE users SET total_sessions = total_sessions + 1 WHERE user_id = ?"),
  bumpTools: db.prepare(
    "UPDATE users SET tools_allowed = tools_allowed + ?, tools_denied = tools_denied + ? WHERE user_id = ?",
  ),
  addUsage: db.prepare(
    "UPDATE users SET total_tokens = total_tokens + ?, total_cost_usd = total_cost_usd + ? WHERE user_id = ?",
  ),
  setStreak: db.prepare("UPDATE users SET last_active_day = ?, streak_days = ? WHERE user_id = ?"),
  addHistory: db.prepare(
    "UPDATE users SET total_tokens = total_tokens + ?, total_messages = total_messages + ? WHERE user_id = ?",
  ),

  getChat: db.prepare("SELECT * FROM chats WHERE chat_id = ?"),
  upsertChat: db.prepare(`
    INSERT INTO chats (chat_id, user_id, project, session_id, title, permission_mode, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      project = excluded.project,
      session_id = excluded.session_id,
      title = excluded.title,
      permission_mode = excluded.permission_mode,
      updated_at = excluded.updated_at
  `),

  getDayUsage: db.prepare("SELECT tokens, cost_usd FROM usage_daily WHERE user_id = ? AND day = ?"),
  addDayUsage: db.prepare(`
    INSERT INTO usage_daily (user_id, day, tokens, cost_usd) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, day) DO UPDATE SET
      tokens = tokens + excluded.tokens,
      cost_usd = cost_usd + excluded.cost_usd
  `),

  unlockAchievement: db.prepare(
    "INSERT OR IGNORE INTO achievements (user_id, achievement, unlocked_at) VALUES (?, ?, ?)",
  ),
  listAchievements: db.prepare("SELECT achievement, unlocked_at FROM achievements WHERE user_id = ?"),

  upsertLimit: db.prepare(`
    INSERT INTO rate_limits (user_id, limit_type, status, utilization, resets_at, seen_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, limit_type) DO UPDATE SET
      status = excluded.status,
      utilization = excluded.utilization,
      resets_at = excluded.resets_at,
      seen_at = excluded.seen_at
  `),
  listLimits: db.prepare("SELECT * FROM rate_limits WHERE user_id = ? ORDER BY limit_type"),

  seeProject: db.prepare("INSERT OR IGNORE INTO projects_seen (user_id, project) VALUES (?, ?)"),
  countProjects: db.prepare("SELECT COUNT(*) AS n FROM projects_seen WHERE user_id = ?"),
};

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getOrCreateUser(userId: number): UserRow {
  stmts.insertUser.run(userId, Date.now());
  return stmts.getUser.get(userId) as unknown as UserRow;
}

export function setTier(userId: number, tier: TierId): void {
  stmts.setTier.run(tier, userId);
}

export function setCredential(userId: number, credential: Credential): void {
  stmts.setKey.run(encrypt(credential.secret), credential.kind, userId);
}

export function getCredential(userId: number): Credential | null {
  const row = stmts.getUser.get(userId) as unknown as UserRow | undefined;
  if (!row?.api_key_enc || !row.auth_kind) return null;
  try {
    return { kind: row.auth_kind, secret: decrypt(row.api_key_enc) };
  } catch {
    // Сменился ENCRYPTION_KEY — старые секреты уже не расшифровать.
    return null;
  }
}

export function clearCredential(userId: number): void {
  stmts.setKey.run(null, null, userId);
}

/** Импорт истории из транскриптов Claude Code: разовая доливка счётчиков. */
export function addHistoricalUsage(userId: number, tokens: number, messages: number): void {
  getOrCreateUser(userId);
  stmts.addHistory.run(tokens, messages, userId);
}

export function setModel(userId: number, model: string | null): void {
  stmts.setModel.run(model, userId);
}

export function getChat(chatId: number): ChatRow | undefined {
  return stmts.getChat.get(chatId) as unknown as ChatRow | undefined;
}

export function saveChat(chat: {
  chatId: number;
  userId: number;
  project: string;
  sessionId: string | null;
  title?: string | null;
  permissionMode: string;
}): void {
  stmts.upsertChat.run(
    chat.chatId,
    chat.userId,
    chat.project,
    chat.sessionId,
    chat.title ?? null,
    chat.permissionMode,
    Date.now(),
  );
}

export function recordMessage(userId: number): void {
  stmts.bumpCounter.run(userId);
}

export function recordSessionStart(userId: number): void {
  stmts.bumpSessions.run(userId);
}

export function recordToolDecision(userId: number, allowed: boolean): void {
  stmts.bumpTools.run(allowed ? 1 : 0, allowed ? 0 : 1, userId);
}

export function recordUsage(userId: number, tokens: number, costUsd: number): void {
  stmts.addUsage.run(tokens, costUsd, userId);
  stmts.addDayUsage.run(userId, today(), tokens, costUsd);
}

export function getUsageToday(userId: number): { tokens: number; cost_usd: number } {
  const row = stmts.getDayUsage.get(userId, today()) as
    | { tokens: number; cost_usd: number }
    | undefined;
  return row ?? { tokens: 0, cost_usd: 0 };
}

/** Возвращает новое значение серии; 0 если серия прервалась и началась заново. */
export function touchStreak(userId: number): number {
  const user = getOrCreateUser(userId);
  const day = today();
  if (user.last_active_day === day) return user.streak_days;

  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const streak = user.last_active_day === yesterday ? user.streak_days + 1 : 1;
  stmts.setStreak.run(day, streak, userId);
  return streak;
}

export function unlockAchievement(userId: number, id: string): boolean {
  const before = stmts.listAchievements.all(userId).length;
  stmts.unlockAchievement.run(userId, id, Date.now());
  return stmts.listAchievements.all(userId).length > before;
}

export function listAchievements(userId: number): { achievement: string; unlocked_at: number }[] {
  return stmts.listAchievements.all(userId) as unknown as {
    achievement: string;
    unlocked_at: number;
  }[];
}

export interface RateLimitRow {
  user_id: number;
  limit_type: string;
  status: string;
  utilization: number | null;
  resets_at: number | null;
  seen_at: number;
}

/**
 * Лимиты приходят событием во время работы, а не по запросу. Поэтому храним
 * последнее известное значение на каждый тип окна и время, когда его видели, —
 * без отметки времени показывать такие данные нельзя, они устаревают молча.
 */
export function recordRateLimit(
  userId: number,
  limit: { limitType: string; status: string; utilization?: number; resetsAt?: number },
): void {
  stmts.upsertLimit.run(
    userId,
    limit.limitType,
    limit.status,
    limit.utilization ?? null,
    limit.resetsAt ?? null,
    Date.now(),
  );
}

export function listRateLimits(userId: number): RateLimitRow[] {
  return stmts.listLimits.all(userId) as unknown as RateLimitRow[];
}

export function seeProject(userId: number, project: string): number {
  stmts.seeProject.run(userId, project);
  const row = stmts.countProjects.get(userId) as unknown as { n: number };
  return row.n;
}

export function closeDb(): void {
  db.close();
}
