import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";
import { encrypt, decrypt } from "./crypto.js";
import { looksLikeOauthToken, type AuthKind, type Credential } from "./auth.js";

mkdirSync(config.dataDir, { recursive: true });

const db = new DatabaseSync(join(config.dataDir, "bot.db"));
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  user_id        INTEGER PRIMARY KEY,
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
  tools_denied   INTEGER NOT NULL DEFAULT 0,
  -- Часть total_*, пришедшая из импорта старых транскриптов, а не наработанная
  -- ботом. Денег за неё в total_cost_usd нет и быть не может: те сессии шли
  -- мимо бота, и их стоимость взять неоткуда. Храним отдельно, чтобы в
  -- статистике не сравнивались токены за всю жизнь с деньгами за два дня.
  history_tokens   INTEGER NOT NULL DEFAULT 0,
  history_messages INTEGER NOT NULL DEFAULT 0
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

-- Расход с отметкой времени. Подённой таблицы не хватает: окна подписки
-- скользящие — пять часов и семь суток, — и «сколько ушло за последние пять
-- часов» из суток не вычислить. Записи старше восьми суток чистятся: недельное
-- окно длиннее не бывает, а таблица иначе растёт без конца.
CREATE TABLE IF NOT EXISTS usage_events (
  user_id  INTEGER NOT NULL,
  at       INTEGER NOT NULL,
  tokens   INTEGER NOT NULL,
  cost_usd REAL    NOT NULL
);

CREATE INDEX IF NOT EXISTS usage_events_by_user_at ON usage_events (user_id, at);

-- Доступ, выданный из чата командой /admin. Список из .env этим не отменяется:
-- он остаётся последним рубежом на случай, если базу потеряли или испортили.
CREATE TABLE IF NOT EXISTS allowed_users (
  user_id  INTEGER PRIMARY KEY,
  note     TEXT,
  added_by INTEGER NOT NULL,
  added_at INTEGER NOT NULL
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
  ["users", "history_tokens", "INTEGER NOT NULL DEFAULT 0"],
  // Имя нужно только для таблицы коопа: номер вместо имени там читать нельзя.
  ["users", "display_name", "TEXT"],
  ["users", "history_messages", "INTEGER NOT NULL DEFAULT 0"],
  ["chats", "title", "TEXT"],
] as const) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!existing.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

/**
 * Столбец tier остался от системы тарифов, которой больше нет: модель и режим
 * разрешений выбираются кнопками, а лимиты приходят от подписки. Роняем его
 * отдельной миграцией, потому что CREATE TABLE IF NOT EXISTS про существующую
 * таблицу молчит и лишнее поле само не исчезнет.
 */
{
  const columns = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  if (columns.some((c) => c.name === "tier")) {
    db.exec("ALTER TABLE users DROP COLUMN tier");
  }
}

/**
 * Разовая доводка баз, где импорт истории уже прошёл, а колонок под неё ещё не
 * было. Токены делятся точно: живой расход всегда пишется и в users, и в
 * usage_daily, поэтому разница между ними — ровно импортированное.
 *
 * С сообщениями точности нет: подённой разбивки по ним не ведётся. Всё, что
 * накопилось до этой миграции, записывается в историю целиком. Ошибка — те
 * несколько ответов, что бот успел дать до неё; на фоне двухсот тысяч
 * импортированных это доли процента, а дальше счёт идёт раздельно.
 */
{
  const stale = db
    .prepare(
      `SELECT u.user_id, u.total_tokens, u.total_messages,
              COALESCE((SELECT SUM(tokens) FROM usage_daily d WHERE d.user_id = u.user_id), 0) AS live
         FROM users u
        WHERE u.history_tokens = 0 AND u.history_messages = 0 AND u.total_tokens > 0`,
    )
    .all() as { user_id: number; total_tokens: number; total_messages: number; live: number }[];

  const fill = db.prepare(
    "UPDATE users SET history_tokens = ?, history_messages = ? WHERE user_id = ?",
  );
  for (const row of stale) {
    const imported = row.total_tokens - row.live;
    // Расхождения нет — значит всё наработано ботом, историю не выдумываем.
    if (imported <= 0) continue;
    fill.run(imported, row.total_messages, row.user_id);
    console.log(
      `↺ Разделил статистику пользователя ${row.user_id}: импорт ${imported}, бот ${row.live}`,
    );
  }
}

export interface UserRow {
  user_id: number;
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
  history_tokens: number;
  history_messages: number;
  display_name: string | null;
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
  markOnboarded: db.prepare("UPDATE users SET onboarded = 1 WHERE user_id = ?"),
  setKey: db.prepare("UPDATE users SET api_key_enc = ?, auth_kind = ? WHERE user_id = ?"),
  setModel: db.prepare("UPDATE users SET model = ? WHERE user_id = ?"),
  setDisplayName: db.prepare("UPDATE users SET display_name = ? WHERE user_id = ?"),
  bumpCounter: db.prepare("UPDATE users SET total_messages = total_messages + 1 WHERE user_id = ?"),
  bumpSessions: db.prepare(
    "UPDATE users SET total_sessions = total_sessions + 1 WHERE user_id = ?",
  ),
  bumpTools: db.prepare(
    "UPDATE users SET tools_allowed = tools_allowed + ?, tools_denied = tools_denied + ? WHERE user_id = ?",
  ),
  addUsage: db.prepare(
    "UPDATE users SET total_tokens = total_tokens + ?, total_cost_usd = total_cost_usd + ? WHERE user_id = ?",
  ),
  setStreak: db.prepare("UPDATE users SET last_active_day = ?, streak_days = ? WHERE user_id = ?"),
  addHistory: db.prepare(
    `UPDATE users SET total_tokens = total_tokens + ?, total_messages = total_messages + ?,
                      history_tokens = history_tokens + ?, history_messages = history_messages + ?
      WHERE user_id = ?`,
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
  listAchievements: db.prepare(
    "SELECT achievement, unlocked_at FROM achievements WHERE user_id = ?",
  ),

  upsertLimit: db.prepare(`
    INSERT INTO rate_limits (user_id, limit_type, status, utilization, resets_at, seen_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, limit_type) DO UPDATE SET
      status = excluded.status,
      utilization = excluded.utilization,
      resets_at = excluded.resets_at,
      seen_at = excluded.seen_at
  `),
  // Отдельный запрос для обновлений из /usage: там есть проценты и время
  // сброса, но нет статуса. Затирать им ранее пришедшее «предупреждение»
  // нельзя, поэтому при конфликте статус остаётся прежним.
  upsertLimitUsage: db.prepare(`
    INSERT INTO rate_limits (user_id, limit_type, status, utilization, resets_at, seen_at)
    VALUES (?, ?, 'allowed', ?, ?, ?)
    ON CONFLICT(user_id, limit_type) DO UPDATE SET
      utilization = excluded.utilization,
      resets_at = excluded.resets_at,
      seen_at = excluded.seen_at
  `),
  listLimits: db.prepare("SELECT * FROM rate_limits WHERE user_id = ? ORDER BY limit_type"),
  listAllowed: db.prepare("SELECT * FROM allowed_users ORDER BY added_at"),
  allowUser: db.prepare(
    "INSERT INTO allowed_users (user_id, note, added_by, added_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET note = excluded.note",
  ),
  disallowUser: db.prepare("DELETE FROM allowed_users WHERE user_id = ?"),
  isAllowed: db.prepare("SELECT user_id FROM allowed_users WHERE user_id = ?"),
  getAllowed: db.prepare("SELECT * FROM allowed_users WHERE user_id = ?"),
  addEvent: db.prepare(
    "INSERT INTO usage_events (user_id, at, tokens, cost_usd) VALUES (?, ?, ?, ?)",
  ),
  sumSince: db.prepare(
    "SELECT COALESCE(SUM(tokens), 0) AS tokens, COALESCE(SUM(cost_usd), 0) AS cost FROM usage_events WHERE user_id = ? AND at >= ?",
  ),
  prunEvents: db.prepare("DELETE FROM usage_events WHERE at < ?"),
  listDayUsage: db.prepare(
    "SELECT day, tokens, cost_usd FROM usage_daily WHERE user_id = ? ORDER BY day DESC LIMIT ?",
  ),

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

export function markOnboarded(userId: number): void {
  stmts.markOnboarded.run(userId);
}

export function setCredential(userId: number, credential: Credential): void {
  stmts.setKey.run(encrypt(credential.secret), credential.kind, userId);
}

export function getCredential(userId: number): Credential | null {
  const row = stmts.getUser.get(userId) as unknown as UserRow | undefined;
  if (!row?.api_key_enc || !row.auth_kind) return null;

  let secret: string;
  try {
    secret = decrypt(row.api_key_enc);
  } catch {
    // Сменился ENCRYPTION_KEY — старые секреты уже не расшифровать.
    return null;
  }

  // Чиним записи, сделанные до исправления порядка распознавания: токен
  // подписки тогда сохранялся как ключ API и уходил не в ту переменную,
  // из-за чего Anthropic отвечал «API key is invalid».
  if (row.auth_kind === "api" && looksLikeOauthToken(secret)) {
    stmts.setKey.run(row.api_key_enc, "subscription", userId);
    return { kind: "subscription", secret };
  }

  return { kind: row.auth_kind, secret };
}

export function clearCredential(userId: number): void {
  stmts.setKey.run(null, null, userId);
}

/** Импорт истории из транскриптов Claude Code: разовая доливка счётчиков. */
export function addHistoricalUsage(userId: number, tokens: number, messages: number): void {
  getOrCreateUser(userId);
  stmts.addHistory.run(tokens, messages, tokens, messages, userId);
}

/**
 * Доступ, по которому работает пользователь.
 *
 * Сперва свой: у каждого свой Claude Code, это основной режим. Если своего нет,
 * берётся ключ того, кто пригласил — в этом и смысл приглашения. Не «владельца
 * бота», а именно пригласившего: приглашать может каждый, у кого есть свой
 * доступ, и подписки при этом не смешиваются.
 *
 * Расход при этом всё равно пишется на того, кто работает: кот в мини-аппе у
 * каждого свой, и приглашённый видит только то, что потратил сам.
 */
export function credentialFor(userId: number): Credential | null {
  const own = getCredential(userId);
  if (own) return own;
  const inviter = inviterOf(userId);
  if (inviter === null || inviter === userId) return null;
  return getCredential(inviter);
}

/**
 * Имя для таблицы коопа. Обновляется на каждом сообщении: человек может его
 * сменить, и держать в базе прошлогоднее — значит показывать соседям не того.
 */
export function setDisplayName(userId: number, name: string | null): void {
  stmts.setDisplayName.run(name, userId);
}

/**
 * Кто платит за работу этого человека: он сам, если ключ свой, иначе тот, кто
 * позвал. Вокруг плательщика и собирается кооп.
 */
export function payerFor(userId: number): number {
  if (getCredential(userId)) return userId;
  return inviterOf(userId) ?? userId;
}

/** Все, кто работает на одной подписке: плательщик и позванные им. */
export function coopMembers(userId: number): UserRow[] {
  const payer = payerFor(userId);
  const ids = [payer, ...listAllowedUsers(payer).map((r) => r.user_id)];
  const rows: UserRow[] = [];
  for (const id of ids) {
    const row = stmts.getUser.get(id) as unknown as UserRow | undefined;
    if (row) rows.push(row);
  }
  return rows;
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
  // Ноль писать незачем: событий и так по одному на задачу.
  if (tokens > 0 || costUsd > 0) stmts.addEvent.run(userId, Date.now(), tokens, costUsd);
}

export function getUsageToday(userId: number): { tokens: number; cost_usd: number } {
  const row = stmts.getDayUsage.get(userId, today()) as
    { tokens: number; cost_usd: number } | undefined;
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
  limit: { limitType: string; status?: string; utilization?: number; resetsAt?: number },
): void {
  if (limit.status === undefined) {
    stmts.upsertLimitUsage.run(
      userId,
      limit.limitType,
      limit.utilization ?? null,
      limit.resetsAt ?? null,
      Date.now(),
    );
    return;
  }
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

/**
 * Расход по дням за последние N суток — для графика в мини-аппе.
 *
 * Дни без работы в usage_daily просто отсутствуют. Возвращать их пропусками
 * нельзя: график сжался бы, и неделя простоя выглядела бы как неделя работы.
 * Поэтому ряд достраивается нулями здесь, а не во фронте.
 */
export function usageByDay(
  userId: number,
  days: number,
): { day: string; tokens: number; costUsd: number }[] {
  const rows = stmts.listDayUsage.all(userId, days) as unknown as {
    day: string;
    tokens: number;
    cost_usd: number;
  }[];
  const known = new Map(rows.map((r) => [r.day, r]));

  const result: { day: string; tokens: number; costUsd: number }[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const at = new Date();
    at.setUTCDate(at.getUTCDate() - i);
    const day = at.toISOString().slice(0, 10);
    const row = known.get(day);
    result.push({ day, tokens: row?.tokens ?? 0, costUsd: row?.cost_usd ?? 0 });
  }
  return result;
}

/** Расход за скользящее окно: сколько ушло за последние N миллисекунд. */
export function usageSince(userId: number, windowMs: number): { tokens: number; costUsd: number } {
  const row = stmts.sumSince.get(userId, Date.now() - windowMs) as unknown as {
    tokens: number;
    cost: number;
  };
  return { tokens: row?.tokens ?? 0, costUsd: row?.cost ?? 0 };
}

/**
 * Чистка старых событий. Восемь суток: недельное окно длиннее не бывает, а
 * запас в сутки покрывает разницу часовых поясов и задержку чистки.
 */
export function pruneUsageEvents(): number {
  const edge = Date.now() - 8 * 24 * 60 * 60 * 1000;
  const result = stmts.prunEvents.run(edge);
  return Number(result.changes ?? 0);
}

/**
 * Кому разрешено пользоваться ботом сверх списка из .env.
 *
 * Живёт в базе, а не в переменной окружения: добавлять человека перезапуском
 * контейнера — не дело. Список из .env остаётся главным и всегда действует,
 * даже если базу потерять; отсюда же его нельзя отозвать.
 */
export interface AllowedUserRow {
  user_id: number;
  note: string | null;
  added_by: number;
  added_at: number;
}

/** Кого пустил конкретный человек. Без аргумента — весь список, для владельца. */
export function listAllowedUsers(invitedBy?: number): AllowedUserRow[] {
  const rows = stmts.listAllowed.all() as unknown as AllowedUserRow[];
  return invitedBy === undefined ? rows : rows.filter((r) => r.added_by === invitedBy);
}

/** Кто пригласил этого человека. null — он сам по себе. */
export function inviterOf(userId: number): number | null {
  const row = stmts.getAllowed.get(userId) as unknown as AllowedUserRow | undefined;
  return row?.added_by ?? null;
}

export function allowUser(userId: number, addedBy: number, note: string | null): void {
  stmts.allowUser.run(userId, note, addedBy, Date.now());
}

export function disallowUser(userId: number): boolean {
  const result = stmts.disallowUser.run(userId);
  return Number(result.changes ?? 0) > 0;
}

export function isUserAllowedInDb(userId: number): boolean {
  return stmts.isAllowed.get(userId) !== undefined;
}
