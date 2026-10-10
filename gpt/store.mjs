import { ADMIN_ID } from "../dist/admin.js";
import { initializeModeData, createModeData } from "../dist/mode-data.js";
import { createStorageLedger } from "./storage.mjs";
import { createPercentLedger } from "./percent-quota.mjs";
import {
  priceUsage,
  quotaPeriods,
  POINT_SCALE,
  RATE_VERSION,
  QUOTA_RATES,
} from "./quota-rates.mjs";
import { effortId, effectiveEffort } from "./reasoning.mjs";
import { DatabaseSync } from "node:sqlite";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { config } from "../dist/config.js";
import { projectName, userId } from "./policy.mjs";
import path from "node:path";

const db = new DatabaseSync(path.join(config.dataDir, "bot.db"));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON;
CREATE TABLE IF NOT EXISTS gpt_meter_events (
 event_key TEXT PRIMARY KEY,user_id INTEGER NOT NULL,model TEXT NOT NULL,input_tokens INTEGER NOT NULL,cached_input_tokens INTEGER NOT NULL,output_tokens INTEGER NOT NULL,ticks INTEGER NOT NULL,rate_version TEXT NOT NULL,at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS gpt_meter_user_time ON gpt_meter_events(user_id,at);
CREATE TABLE IF NOT EXISTS gpt_meter_meta (id INTEGER PRIMARY KEY CHECK(id=1),started_at INTEGER NOT NULL);
INSERT OR IGNORE INTO gpt_meter_meta(id,started_at) VALUES(1,unixepoch()*1000);
CREATE TABLE IF NOT EXISTS gpt_restart_notices (user_id INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS gpt_invites (token_hash TEXT PRIMARY KEY,user_id INTEGER,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,used_at INTEGER);
CREATE TABLE IF NOT EXISTS gpt_preferences (user_id INTEGER PRIMARY KEY, effort TEXT NOT NULL DEFAULT 'medium');
CREATE TABLE IF NOT EXISTS gpt_ui_messages (user_id INTEGER PRIMARY KEY, message_id INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS gpt_user_policy (
 user_id INTEGER PRIMARY KEY, allowed INTEGER, token_limit INTEGER, dialog_limit INTEGER, note TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS gpt_token_daily (user_id INTEGER NOT NULL, day TEXT NOT NULL, tokens INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id,day));
CREATE TABLE IF NOT EXISTS gpt_threads (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, project TEXT NOT NULL, title TEXT NOT NULL,
 codex_id TEXT, summary TEXT, legacy_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS gpt_threads_owner ON gpt_threads(user_id,updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS gpt_threads_legacy ON gpt_threads(user_id,legacy_id) WHERE legacy_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS gpt_active (user_id INTEGER PRIMARY KEY, thread_id TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'auto');
CREATE TABLE IF NOT EXISTS gpt_messages (id INTEGER PRIMARY KEY, thread_id TEXT NOT NULL, user_id INTEGER NOT NULL, role TEXT NOT NULL, body TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS gpt_messages_recap ON gpt_messages(user_id,thread_id,id);
CREATE INDEX IF NOT EXISTS gpt_messages_answer ON gpt_messages(user_id,thread_id) WHERE role='assistant';
CREATE TABLE IF NOT EXISTS gpt_deletions (user_id INTEGER NOT NULL,thread_id TEXT NOT NULL,legacy_id TEXT,state TEXT NOT NULL DEFAULT 'pending',error TEXT,at INTEGER NOT NULL,PRIMARY KEY(user_id,thread_id));
CREATE TABLE IF NOT EXISTS gpt_user_deletions (user_id INTEGER PRIMARY KEY,state TEXT NOT NULL,error TEXT,at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS gpt_jobs (id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,thread_id TEXT NOT NULL,state TEXT NOT NULL,started_at INTEGER NOT NULL,finished_at INTEGER,error TEXT);
UPDATE gpt_jobs SET state='interrupted',finished_at=unixepoch()*1000 WHERE state='running';`);
if (
  !db
    .prepare("PRAGMA table_info(gpt_jobs)")
    .all()
    .some((c) => c.name === "usage_json")
)
  db.exec("ALTER TABLE gpt_jobs ADD COLUMN usage_json TEXT");
if (
  !db
    .prepare("PRAGMA table_info(gpt_token_daily)")
    .all()
    .some((c) => c.name === "unverified_tokens")
)
  db.exec("ALTER TABLE gpt_token_daily ADD COLUMN unverified_tokens INTEGER NOT NULL DEFAULT 0");
for (const [name, type] of [
  ["quota_mode", "TEXT NOT NULL DEFAULT 'weighted'"],
  ["weekly_limit", "INTEGER"],
  ["percent_limit", "REAL NOT NULL DEFAULT 10"],
]) {
  if (
    !db
      .prepare("PRAGMA table_info(gpt_user_policy)")
      .all()
      .some((c) => c.name === name)
  )
    db.exec(`ALTER TABLE gpt_user_policy ADD COLUMN ${name} ${type}`);
}
if (
  !db
    .prepare("PRAGMA table_info(gpt_meter_events)")
    .all()
    .some((c) => c.name === "job_id")
)
  db.exec("ALTER TABLE gpt_meter_events ADD COLUMN job_id TEXT");
if (
  !db
    .prepare("PRAGMA table_info(gpt_meter_meta)")
    .all()
    .some((c) => c.name === "weekly_reset_at")
)
  db.exec("ALTER TABLE gpt_meter_meta ADD COLUMN weekly_reset_at INTEGER");
initializeModeData(db);
const modeGpt = createModeData(db,"gpt");
export function syncQuotaReset(subscription) {
  if (subscription.stale) return;
  const codex = subscription.buckets?.find((b) => b.id === "codex");
  const weekly = [codex?.primary, codex?.secondary].find(
    (w) =>
      w?.windowDurationMins === 10080 &&
      Number.isSafeInteger(w.resetsAt) &&
      w.resetsAt > Date.now(),
  );
  if (weekly) {
    const reset = percentLedger.sync(weekly);
    db.prepare("UPDATE gpt_meter_meta SET weekly_reset_at=? WHERE id=1").run(reset);
  }
}
function accountPeriods(now) {
  return quotaPeriods(
    now,
    db.prepare("SELECT weekly_reset_at FROM gpt_meter_meta WHERE id=1").get().weekly_reset_at,
  );
}
export function jobUnits(uid, id) {
  return (
    db
      .prepare("SELECT COALESCE(SUM(ticks),0) n FROM gpt_meter_events WHERE user_id=? AND job_id=?")
      .get(uid, id).n / POINT_SCALE
  );
}
export function unverifiedTokens(uid, day = new Date().toISOString().slice(0, 10)) {
  return (
    db
      .prepare("SELECT unverified_tokens FROM gpt_token_daily WHERE user_id=? AND day=?")
      .get(uid, day)?.unverified_tokens || 0
  );
}
export function recordJobUsage(uid, jobId, usage) {
  db.prepare("UPDATE gpt_jobs SET usage_json=? WHERE user_id=? AND id=?").run(
    JSON.stringify(usage),
    uid,
    jobId,
  );
}
// Preserve migration history, but stop advertising it after GPT has replied.
const migrationBadge = `CASE WHEN legacy_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM gpt_messages m WHERE m.user_id=gpt_threads.user_id
  AND m.thread_id=gpt_threads.id AND m.role='assistant'
) THEN 1 ELSE 0 END AS show_imported`;
export function getThread(uid, id) {
  userId(uid);
  return db
    .prepare(`SELECT *,${migrationBadge} FROM gpt_threads WHERE user_id=? AND id=?`)
    .get(uid, id);
}
export function listThreads(uid, offset = 0) {
  userId(uid);
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid pagination");
  return db
    .prepare(
      `SELECT id,title,project,legacy_id,codex_id,updated_at,${migrationBadge} FROM gpt_threads WHERE user_id=? ORDER BY updated_at DESC LIMIT 11 OFFSET ?`,
    )
    .all(uid, offset);
}
export function allThreads(uid) {
  userId(uid);
  return db
    .prepare(
      `SELECT id,title,project,legacy_id,updated_at,${migrationBadge},CASE WHEN legacy_id IS NOT NULL AND summary IS NULL THEN 1 ELSE 0 END AS pending FROM gpt_threads WHERE user_id=? ORDER BY updated_at DESC`,
    )
    .all(uid);
}
export function createThread(uid, project = "default", title = "Новый диалог") {
  userId(uid);
  assertDialogBudget(uid);
  const id = randomUUID(),
    at = Date.now();
  db.prepare(
    "INSERT INTO gpt_threads(id,user_id,project,title,created_at,updated_at) VALUES(?,?,?,?,?,?)",
  ).run(id, uid, projectName(project), title.slice(0, 100), at, at);
  modeGpt.bump(uid,"total_sessions");
  selectThread(uid, id);
  return getThread(uid, id);
}
export function selectThread(uid, id) {
  if (!getThread(uid, id)) throw new Error("Диалог не найден");
  if (isThreadDeleting(uid, id)) throw new Error("Диалог удаляется; дождись завершения");
  db.prepare(
    "INSERT INTO gpt_active(user_id,thread_id) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET thread_id=excluded.thread_id",
  ).run(uid, id);
}
export function activeThread(uid) {
  userId(uid);
  const active = db.prepare("SELECT thread_id,mode FROM gpt_active WHERE user_id=?").get(uid);
  return (active && getThread(uid, active.thread_id)) || createThread(uid);
}
export function modeFor(uid) {
  return db.prepare("SELECT mode FROM gpt_active WHERE user_id=?").get(uid)?.mode || "auto";
}
export function setMode(uid, mode) {
  if (!["auto", "read"].includes(mode)) throw new Error("Режимы: auto, read");
  userId(uid);
  db.prepare(
    "INSERT INTO gpt_active(user_id,thread_id,mode) VALUES(?,'',?) ON CONFLICT(user_id) DO UPDATE SET mode=excluded.mode",
  ).run(uid, mode);
}
export function bindCodex(uid, id, codexId) {
  if (!/^[a-z0-9-]{20,64}$/i.test(codexId)) throw new Error("Invalid Codex thread ID");
  db.prepare("UPDATE gpt_threads SET codex_id=?,updated_at=? WHERE user_id=? AND id=?").run(
    codexId,
    Date.now(),
    uid,
    id,
  );
}
export function renameThread(uid, id, title) {
  db.prepare("UPDATE gpt_threads SET title=? WHERE user_id=? AND id=?").run(
    Array.from(title).slice(0, 100).join(""),
    uid,
    id,
  );
}
export function addMessage(uid, id, role, text) {
  if (!getThread(uid, id)) throw new Error("Диалог не найден");
  db.prepare("INSERT INTO gpt_messages(thread_id,user_id,role,body,at) VALUES(?,?,?,?,?)").run(
    id,
    uid,
    role,
    text,
    Date.now(),
  );
  db.prepare("UPDATE gpt_threads SET updated_at=? WHERE user_id=? AND id=?").run(
    Date.now(),
    uid,
    id,
  );
}
if (
  !db
    .prepare("PRAGMA table_info(gpt_messages)")
    .all()
    .some((c) => c.name === "web_event_id")
)
  db.exec("ALTER TABLE gpt_messages ADD COLUMN web_event_id TEXT");
db.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS gpt_messages_web_source ON gpt_messages(user_id,web_event_id) WHERE web_event_id IS NOT NULL",
);
if (
  !db
    .prepare("PRAGMA table_info(gpt_threads)")
    .all()
    .some((c) => c.name === "web_bb_id")
)
  db.exec("ALTER TABLE gpt_threads ADD COLUMN web_bb_id TEXT");
db.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS gpt_threads_web_bb ON gpt_threads(user_id,web_bb_id) WHERE web_bb_id IS NOT NULL",
);
/**
 * GPT-диалоги, созданные прямо в bb, становятся диалогами бота: с историей и
 * сессией Codex. Активный диалог не меняется, лимит проверяет вызывающий
 * (adoptBudget), повторно один тред bb не импортируется (уникальный индекс).
 */
export function importWebThreads(uid, natives = []) {
  let imported = 0;
  for (const t of natives) {
    if (typeof t?.bb_id !== "string" || !/^[A-Za-z0-9_-]{6,80}$/.test(t.bb_id) || t.bb_id.startsWith("thr_tg")) continue;
    if (db.prepare("SELECT 1 FROM gpt_threads WHERE user_id=? AND web_bb_id=?").get(uid, t.bb_id)) continue;
    const id = randomUUID(),
      created = Number.isSafeInteger(t.created_at) ? t.created_at : Date.now(),
      updated = Number.isSafeInteger(t.updated_at) ? t.updated_at : created,
      codex = typeof t.codex_id === "string" && /^[a-z0-9-]{20,64}$/i.test(t.codex_id) ? t.codex_id : null;
    db.prepare(
      "INSERT INTO gpt_threads(id,user_id,project,title,created_at,updated_at,codex_id,web_bb_id) VALUES(?,?,?,?,?,?,?,?)",
    ).run(id, uid, "default", Array.from(String(t.title || "Диалог из bb")).slice(0, 100).join(""), created, updated, codex, t.bb_id);
    for (const m of t.messages || []) {
      if (!["user", "assistant"].includes(m.role) || typeof m.body !== "string" || typeof m.source_id !== "string") continue;
      db.prepare(
        "INSERT OR IGNORE INTO gpt_messages(thread_id,user_id,role,body,at,web_event_id) VALUES(?,?,?,?,?,?)",
      ).run(id, uid, m.role, m.body, Number.isSafeInteger(m.at) ? m.at : updated, m.source_id);
    }
    modeGpt.bump(uid, "total_sessions");
    imported++;
  }
  return imported;
}
export function webSnapshot(uid) {
  userId(uid);
  return db
    .prepare("SELECT * FROM gpt_threads WHERE user_id=? ORDER BY created_at")
    .all(uid)
    .filter((row) => !isThreadDeleting(uid, row.id))
    .map((row) => ({ ...row, messages: messages(uid, row.id) }));
}
export function applyWebSync(uid, result) {
  userId(uid);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const thread of result.threads || []) {
      const current = getThread(uid, thread.id);
      if (!current || isThreadDeleting(uid, thread.id)) continue;
      if (thread.title && current.title !== thread.title)
        renameThread(uid, thread.id, thread.title);
      if (thread.codex_id && current.codex_id !== thread.codex_id)
        bindCodex(uid, thread.id, thread.codex_id);
    }
    importWebThreads(uid, result.native);
    for (const message of result.messages || []) {
      if (
        !getThread(uid, message.thread_id) ||
        isThreadDeleting(uid, message.thread_id) ||
        !["user", "assistant"].includes(message.role)
      )
        continue;
      const at = Number.isSafeInteger(message.at) ? message.at : Date.now();
      const inserted = db
        .prepare(
          "INSERT OR IGNORE INTO gpt_messages(thread_id,user_id,role,body,at,web_event_id) VALUES(?,?,?,?,?,?)",
        )
        .run(message.thread_id, uid, message.role, message.body, at, message.source_id);
      if (inserted.changes)
        db.prepare(
          "UPDATE gpt_threads SET updated_at=max(updated_at,?) WHERE user_id=? AND id=?",
        ).run(at, uid, message.thread_id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function messages(uid, id) {
  return db
    .prepare(
      "SELECT id,role,body,at,web_event_id AS source_id FROM gpt_messages WHERE user_id=? AND thread_id=? ORDER BY id",
    )
    .all(uid, id);
}
export function threadRecap(uid, id) {
  const thread = getThread(uid, id);
  if (!thread) return null;
  const firstPrompt =
    db
      .prepare(
        "SELECT substr(body,1,16000) AS body FROM gpt_messages WHERE user_id=? AND thread_id=? AND role='user' AND trim(body)<>'' ORDER BY id LIMIT 1",
      )
      .get(uid, id)?.body || "";
  const recent = db
    .prepare(
      "SELECT role,substr(body,1,16000) AS body FROM gpt_messages WHERE user_id=? AND thread_id=? AND role IN ('user','assistant') ORDER BY id DESC LIMIT 8",
    )
    .all(uid, id)
    .reverse();
  return { thread, firstPrompt, recent };
}
export function startJob(uid, thread) {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO gpt_jobs(id,user_id,thread_id,state,started_at) VALUES(?,?,?,'running',?)",
  ).run(id, uid, thread, Date.now());
  return id;
}
export function finishJob(id, ok, error = "") {
  db.prepare("UPDATE gpt_jobs SET state=?,finished_at=?,error=? WHERE id=?").run(
    ok ? "completed" : "failed",
    Date.now(),
    error.slice(0, 2000),
    id,
  );
}

export { ADMIN_ID };
const hadPercentLedger = db
  .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='gpt_percent_meta'")
  .get();
export const percentLedger = createPercentLedger(
  db,
  ADMIN_ID,
  Date.now,
  (uid) => userPolicy(uid).percent_limit,
);
export const storageLedger = createStorageLedger(db);
/** Для модулей с собственными таблицами в той же базе (limit-warnings). */
export const database = db;
if (
  !db
    .prepare("PRAGMA table_info(gpt_percent_meta)")
    .all()
    .some((c) => c.name === "percent_limits_migrated")
) {
  db.exec(
    "BEGIN IMMEDIATE; ALTER TABLE gpt_percent_meta ADD COLUMN percent_limits_migrated INTEGER DEFAULT 1; UPDATE gpt_user_policy SET token_limit=NULL,weekly_limit=NULL; COMMIT;",
  );
}
// Retire the previous invite default once; explicit custom secondary caps stay intact.
if (!hadPercentLedger)
  db.prepare("UPDATE gpt_user_policy SET token_limit=NULL WHERE token_limit=1000000").run();
export function userPolicy(uid) {
  userId(uid);
  const policy = db.prepare("SELECT * FROM gpt_user_policy WHERE user_id=?").get(uid) || {
    user_id: uid,
    allowed: null,
    token_limit: null,
    dialog_limit: null,
    note: "",
    quota_mode: "weighted",
    weekly_limit: null,
    percent_limit: 10,
  };
  policy.dialog_limit = uid === ADMIN_ID ? null : (policy.dialog_limit ?? 5);
  if (uid === ADMIN_ID) {
    policy.weekly_limit = null;
    policy.token_limit = null;
  }
  return policy;
}
export function setUserPolicy(actor, uid, patch) {
  if (actor !== ADMIN_ID) throw new Error("Админка доступна только владельцу");
  userId(uid);
  if (uid === ADMIN_ID && patch.allowed === false) throw new Error("Нельзя удалить владельца");
  const deletion = userDeletion(uid);
  if (deletion && deletion.state !== "complete")
    throw new Error("Сначала заверши удаление данных пользователя");
  const previous = userPolicy(uid);
  for (const key of ["tokenLimit", "dialogLimit", "weeklyLimit"]) {
    if (
      patch[key] !== undefined &&
      patch[key] !== null &&
      (!Number.isSafeInteger(patch[key]) || patch[key] < 0)
    )
      throw new Error("Лимит должен быть целым неотрицательным числом или пустым");
  }
  if (
    patch.percentLimit !== undefined &&
    (typeof patch.percentLimit !== "number" ||
      !Number.isFinite(patch.percentLimit) ||
      patch.percentLimit < 0 ||
      patch.percentLimit > 100)
  )
    throw new Error("Недельный лимит: число от 0 до 100 процентов");
  if (patch.quotaMode !== undefined && !["weighted", "tokens"].includes(patch.quotaMode))
    throw new Error("Некорректный режим квоты");
  if (patch.allowed !== undefined && typeof patch.allowed !== "boolean")
    throw new Error("Некорректный доступ");
  if (patch.note !== undefined && (typeof patch.note !== "string" || patch.note.length > 120))
    throw new Error("Имя: до 120 символов");
  db.prepare(
    `INSERT INTO gpt_user_policy(user_id,allowed,token_limit,dialog_limit,note,updated_at,quota_mode,weekly_limit,percent_limit) VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET allowed=excluded.allowed,token_limit=excluded.token_limit,dialog_limit=excluded.dialog_limit,note=excluded.note,updated_at=excluded.updated_at,quota_mode=excluded.quota_mode,weekly_limit=excluded.weekly_limit,percent_limit=excluded.percent_limit`,
  ).run(
    uid,
    patch.allowed === undefined ? previous.allowed : Number(patch.allowed),
    patch.tokenLimit === undefined ? previous.token_limit : patch.tokenLimit,
    patch.dialogLimit === undefined ? previous.dialog_limit : patch.dialogLimit,
    patch.note === undefined ? previous.note : patch.note,
    Date.now(),
    patch.quotaMode ?? previous.quota_mode,
    patch.weeklyLimit === undefined ? previous.weekly_limit : patch.weeklyLimit,
    patch.percentLimit === undefined ? previous.percent_limit : patch.percentLimit,
  );
  if (deletion?.state === "complete" && patch.allowed === true)
    db.prepare("DELETE FROM gpt_user_deletions WHERE user_id=?").run(uid);
  return userPolicy(uid);
}
export function managedUserIds() {
  return db
    .prepare(
      "SELECT user_id FROM users UNION SELECT user_id FROM allowed_users UNION SELECT user_id FROM gpt_user_policy",
    )
    .all()
    .map((r) => r.user_id);
}
export function threadCount(uid) {
  return db.prepare("SELECT COUNT(*) AS n FROM gpt_threads WHERE user_id=?").get(uid).n;
}
export function assertDialogBudget(uid) {
  if (userDeletion(uid)) throw new Error("Данные пользователя удаляются или удалены");
  if (pendingDeletions(uid).length)
    throw new Error("Заверши удаление через /delete перед созданием нового диалога");
  const limit = userPolicy(uid).dialog_limit;
  if (limit !== null && threadCount(uid) >= limit)
    throw new Error(
      `Достигнут лимит диалогов: ${threadCount(uid)}/${limit}. Сначала удали лишние через /delete, затем создай новый.`,
    );
}
export function tokensToday(uid, day = new Date().toISOString().slice(0, 10)) {
  return (
    db.prepare("SELECT tokens FROM gpt_token_daily WHERE user_id=? AND day=?").get(uid, day)
      ?.tokens || 0
  );
}
export function assertTokenBudget(uid) {
  percentLedger.assertBudget(uid);
  const q = quotaUsage(uid);
  if (q.exceeded)
    throw new Error(
      `Достигнут ${q.daily.exceeded ? "суточный" : "недельный"} лимит ${q.mode === "weighted" ? "единиц" : "токенов"}. Сброс: ${new Date(q.daily.exceeded ? q.daily.resetsAt : q.weekly.resetsAt).toISOString().replace("T", " ").slice(0, 16)} UTC. Лимит может изменить администратор.`,
    );
}
export function meteredUsage(uid, since = 0) {
  const rows = db
    .prepare(
      `SELECT model,SUM(input_tokens) input,SUM(cached_input_tokens) cached,SUM(output_tokens) output,SUM(ticks) ticks,COUNT(*) requests FROM gpt_meter_events WHERE at>=? ${uid == null ? "" : "AND user_id=?"} GROUP BY model`,
    )
    .all(...(uid == null ? [since] : [since, uid]));
  const total = rows.reduce(
    (a, r) => ({
      input: a.input + r.input,
      cached: a.cached + r.cached,
      output: a.output + r.output,
      ticks: a.ticks + r.ticks,
      requests: a.requests + r.requests,
    }),
    { input: 0, cached: 0, output: 0, ticks: 0, requests: 0 },
  );
  return {
    ...total,
    units: total.ticks / POINT_SCALE,
    tokens: total.input + total.output,
    cachePercent: total.input ? (total.cached / total.input) * 100 : 0,
    models: rows.map((r) => ({ ...r, units: r.ticks / POINT_SCALE })),
  };
}
export function quotaUsage(uid, now = Date.now()) {
  const p = userPolicy(uid),
    periods = accountPeriods(now),
    daily = meteredUsage(uid, periods.day),
    weekly = meteredUsage(uid, periods.week);
  const rawWeek = db
    .prepare("SELECT COALESCE(SUM(tokens),0) n FROM gpt_token_daily WHERE user_id=? AND day>=?")
    .get(uid, new Date(periods.week).toISOString().slice(0, 10)).n;
  const window = (used, limit, resetsAt) => ({
    used,
    limit,
    remaining: limit === null ? null : Math.max(0, limit - used),
    percent: limit === null ? null : limit === 0 ? 100 : Math.min(100, (used / limit) * 100),
    exceeded: limit !== null && used >= limit,
    resetsAt,
  });
  const d = window(
    p.quota_mode === "weighted"
      ? daily.units
      : tokensToday(uid, new Date(now).toISOString().slice(0, 10)),
    p.token_limit,
    periods.dayReset,
  );
  const w = window(
    p.quota_mode === "weighted" ? weekly.units : rawWeek,
    p.weekly_limit,
    periods.weekReset,
  );
  return {
    mode: p.quota_mode,
    daily: d,
    weekly: w,
    exceeded: d.exceeded || w.exceeded || percentLedger.quota(uid, now).exceeded,
    subscription: percentLedger.quota(uid, now),
    usage: daily,
    startedAt: db.prepare("SELECT started_at FROM gpt_meter_meta WHERE id=1").get().started_at,
  };
}
export function accountingOverview(now = Date.now()) {
  const p = accountPeriods(now);
  return {
    today: meteredUsage(null, p.day),
    week: meteredUsage(null, p.week),
    days: db
      .prepare(
        "SELECT strftime('%Y-%m-%d',at/1000,'unixepoch') day,SUM(ticks)*1.0/? units,SUM(input_tokens+output_tokens) tokens FROM gpt_meter_events WHERE at>=? GROUP BY day ORDER BY day",
      )
      .all(POINT_SCALE, p.day - 13 * 86400000),
    rates: QUOTA_RATES,
    scale: POINT_SCALE,
    version: RATE_VERSION,
    startedAt: db.prepare("SELECT started_at FROM gpt_meter_meta WHERE id=1").get().started_at,
  };
}
export function recordMeteredUsage(uid, usage, model, eventKey, at = Date.now(), jobId = null) {
  userId(uid);
  const priced = priceUsage(model, usage);
  if (typeof eventKey !== "string" || !eventKey || eventKey.length > 300)
    throw new Error("Некорректный идентификатор расхода");
  db.exec("BEGIN IMMEDIATE");
  try {
    const inserted = db
      .prepare(
        "INSERT OR IGNORE INTO gpt_meter_events(event_key,user_id,model,input_tokens,cached_input_tokens,output_tokens,ticks,rate_version,at,job_id) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        eventKey,
        uid,
        model,
        priced.input_tokens,
        priced.cached_input_tokens,
        priced.output_tokens,
        priced.ticks,
        RATE_VERSION,
        at,
        jobId,
      ).changes;
    if (inserted) {
      percentLedger.weight(uid, jobId, priced.ticks);
      recordTokens(uid, usage, at);
      const tokens = priced.input_tokens + priced.output_tokens;
      modeGpt.usage(uid,tokens,0,at);
      db.prepare("INSERT OR IGNORE INTO users(user_id,created_at) VALUES(?,?)").run(uid, at);
      db.prepare("UPDATE users SET total_tokens=total_tokens+? WHERE user_id=?").run(tokens, uid);
      db.prepare(
        "INSERT INTO usage_daily(user_id,day,tokens,cost_usd) VALUES(?,?,?,0) ON CONFLICT(user_id,day) DO UPDATE SET tokens=tokens+excluded.tokens",
      ).run(uid, new Date(at).toISOString().slice(0, 10), tokens);
      if (tokens > 0)
        db.prepare("INSERT INTO usage_events(user_id,at,tokens,cost_usd) VALUES(?,?,?,0)").run(
          uid,
          at,
          tokens,
        );
    }
    db.exec("COMMIT");
    return !!inserted;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function recordTokens(uid, usage, at = Date.now()) {
  const tokens =
    Math.max(0, Math.floor(Number(usage.input_tokens) || 0)) +
    Math.max(0, Math.floor(Number(usage.output_tokens) || 0));
  if (!Number.isSafeInteger(tokens)) throw new Error("Invalid token usage");
  db.prepare(
    "INSERT INTO gpt_token_daily(user_id,day,tokens) VALUES(?,?,?) ON CONFLICT(user_id,day) DO UPDATE SET tokens=tokens+excluded.tokens",
  ).run(uid, new Date(at).toISOString().slice(0, 10), tokens);
}
export function peekActiveThread(uid) {
  const row = db.prepare("SELECT thread_id FROM gpt_active WHERE user_id=?").get(uid);
  return row ? getThread(uid, row.thread_id) : undefined;
}
export function projectThreads(uid, project) {
  return db
    .prepare(
      "SELECT id,title,project,updated_at FROM gpt_threads WHERE user_id=? AND project=? ORDER BY updated_at DESC",
    )
    .all(uid, projectName(project));
}

export function assertDialogCount(uid) {
  const limit = userPolicy(uid).dialog_limit;
  if (limit !== null && threadCount(uid) > limit)
    throw new Error(
      `У тебя ${threadCount(uid)} диалогов, лимит ${limit}. Сначала удали лишние через /delete.`,
    );
}

export function isThreadDeleting(uid, id) {
  return !!db
    .prepare("SELECT 1 FROM gpt_deletions WHERE user_id=? AND thread_id=? AND state!='complete'")
    .get(uid, id);
}
export function pendingDeletions(uid) {
  return uid === undefined
    ? db.prepare("SELECT * FROM gpt_deletions WHERE state!='complete'").all()
    : db.prepare("SELECT * FROM gpt_deletions WHERE user_id=? AND state!='complete'").all(uid);
}
export function validateDeletion(uid, ids) {
  userId(uid);
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 1000 ||
    ids.some((id) => typeof id !== "string")
  )
    throw new Error("Выбери диалоги для удаления");
  return [...new Set(ids)].map((id) => {
    const row = getThread(uid, id);
    if (!row) throw new Error("Диалог не найден или уже удалён");
    return row;
  });
}
export function beginDeletion(uid, ids) {
  const rows = validateDeletion(uid, ids);
  db.exec("BEGIN IMMEDIATE");
  try {
    const insert = db.prepare(
      "INSERT INTO gpt_deletions(user_id,thread_id,legacy_id,state,at) VALUES(?,?,?,'pending',?) ON CONFLICT(user_id,thread_id) DO UPDATE SET state='pending',error=NULL",
    );
    for (const row of rows) insert.run(uid, row.id, row.legacy_id, Date.now());
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return rows;
}
export function purgeDialogRecords(target, uid, id, legacyId) {
  const exists = (table) =>
    !!target.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
  if (exists("gpt_messages"))
    target.prepare("DELETE FROM gpt_messages WHERE user_id=? AND thread_id=?").run(uid, id);
  if (exists("gpt_jobs"))
    target.prepare("DELETE FROM gpt_jobs WHERE user_id=? AND thread_id=?").run(uid, id);
  if (exists("gpt_active"))
    target
      .prepare("UPDATE gpt_active SET thread_id='' WHERE user_id=? AND thread_id=?")
      .run(uid, id);
  if (exists("gpt_threads"))
    target.prepare("DELETE FROM gpt_threads WHERE user_id=? AND id=?").run(uid, id);
  if (legacyId && exists("chats"))
    target.prepare("DELETE FROM chats WHERE user_id=? AND session_id=?").run(uid, legacyId);
}
export function finishDeletion(uid, id, complete = true) {
  const deletion = db
    .prepare("SELECT * FROM gpt_deletions WHERE user_id=? AND thread_id=?")
    .get(uid, id);
  if (!deletion) throw new Error("Удаление не было начато");
  db.exec("BEGIN IMMEDIATE");
  try {
    purgeDialogRecords(db, uid, id, deletion.legacy_id);
    db.prepare("UPDATE gpt_deletions SET state=?,error=NULL WHERE user_id=? AND thread_id=?").run(
      complete ? "complete" : "purging",
      uid,
      id,
    );
    const active = peekActiveThread(uid);
    if (!active) {
      const next = db
        .prepare(
          "SELECT id FROM gpt_threads WHERE user_id=? AND id NOT IN (SELECT thread_id FROM gpt_deletions WHERE user_id=? AND state!='complete') ORDER BY updated_at DESC LIMIT 1",
        )
        .get(uid, uid);
      if (next) selectThread(uid, next.id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function failDeletion(uid, id, error) {
  db.prepare("UPDATE gpt_deletions SET state='failed',error=? WHERE user_id=? AND thread_id=?").run(
    String(error).slice(0, 300),
    uid,
    id,
  );
}
export function compactDatabase() {
  db.exec("PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE)");
}

export function completeDeletion(uid, id) {
  db.prepare(
    "UPDATE gpt_deletions SET state='complete',error=NULL WHERE user_id=? AND thread_id=?",
  ).run(uid, id);
}

export function userDeletion(uid) {
  userId(uid);
  return db.prepare("SELECT * FROM gpt_user_deletions WHERE user_id=?").get(uid);
}
export function pendingUserDeletions() {
  return db.prepare("SELECT * FROM gpt_user_deletions WHERE state!='complete'").all();
}
export function beginUserDeletion(actor, uid, confirmation) {
  if (actor !== ADMIN_ID) throw new Error("Админка доступна только владельцу");
  userId(uid);
  if (uid === ADMIN_ID) throw new Error("Нельзя удалить данные владельца");
  if (confirmation !== String(uid))
    throw new Error("Введи Telegram ID пользователя для подтверждения");
  if (["pending", "purging", "complete"].includes(userDeletion(uid)?.state)) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      "INSERT INTO gpt_user_policy(user_id,allowed) VALUES(?,0) ON CONFLICT(user_id) DO UPDATE SET allowed=0",
    ).run(uid);
    db.prepare(
      "INSERT INTO gpt_user_deletions(user_id,state,at) VALUES(?,'pending',?) ON CONFLICT(user_id) DO UPDATE SET state='pending',error=NULL,at=excluded.at",
    ).run(uid, Date.now());
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function setUserDeletionState(uid, state, error = null) {
  if (!["pending", "purging", "failed", "complete"].includes(state))
    throw new Error("Invalid deletion state");
  db.prepare("UPDATE gpt_user_deletions SET state=?,error=?,at=? WHERE user_id=?").run(
    state,
    error?.slice(0, 300) || null,
    Date.now(),
    uid,
  );
}
export function purgeUserRecords(target, uid, complete = false) {
  userId(uid);
  if (uid === ADMIN_ID) throw new Error("Cannot purge owner");
  const tables = target
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((row) => row.name);
  const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
  if (tables.includes("running_tasks")) {
    if (tables.includes("chats"))
      target
        .prepare(
          "DELETE FROM running_tasks WHERE chat_id=? OR chat_id IN (SELECT chat_id FROM chats WHERE user_id=?)",
        )
        .run(uid, uid);
    else target.prepare("DELETE FROM running_tasks WHERE chat_id=?").run(uid);
  }
  for (const table of tables) {
    if (["gpt_user_policy", "gpt_user_deletions"].includes(table)) continue;
    const columns = target
      .prepare(`PRAGMA table_info(${quote(table)})`)
      .all()
      .map((row) => row.name);
    const owned = ["user_id", "from_user", "to_user"].filter((column) => columns.includes(column));
    if (owned.length)
      target
        .prepare(
          `DELETE FROM ${quote(table)} WHERE ${owned.map((column) => quote(column) + "=?").join(" OR ")}`,
        )
        .run(...owned.map(() => uid));
  }
  if (tables.includes("gpt_user_policy"))
    target
      .prepare(
        "INSERT INTO gpt_user_policy(user_id,allowed,note) VALUES(?,0,'') ON CONFLICT(user_id) DO UPDATE SET allowed=0,note='',token_limit=NULL,dialog_limit=NULL",
      )
      .run(uid);
  if (tables.includes("gpt_user_deletions"))
    target
      .prepare(
        "INSERT INTO gpt_user_deletions(user_id,state,at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET state=excluded.state,error=NULL,at=excluded.at",
      )
      .run(uid, complete ? "complete" : "purging", Date.now());
}
export function purgeUserLive(uid) {
  db.exec("BEGIN IMMEDIATE");
  try {
    purgeUserRecords(db, uid);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function effortFor(uid, model) {
  userId(uid);
  return effectiveEffort(
    db.prepare("SELECT effort FROM gpt_preferences WHERE user_id=?").get(uid)?.effort,
    model,
  );
}
export function setEffort(uid, value, model) {
  userId(uid);
  effortId(value, model);
  db.prepare(
    "INSERT INTO gpt_preferences(user_id,effort) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET effort=excluded.effort",
  ).run(uid, value);
}
export function controlMessage(uid) {
  return db.prepare("SELECT message_id FROM gpt_ui_messages WHERE user_id=?").get(uid)?.message_id;
}
export function setControlMessage(uid, id) {
  if (id)
    db.prepare(
      "INSERT INTO gpt_ui_messages(user_id,message_id) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET message_id=excluded.message_id",
    ).run(uid, id);
  else db.prepare("DELETE FROM gpt_ui_messages WHERE user_id=?").run(uid);
}

const inviteHash = (token) => createHash("sha256").update(token).digest("hex");
export function queueRestartNotice(uid) {
  userId(uid);
  db.prepare("INSERT OR IGNORE INTO gpt_restart_notices(user_id) VALUES(?)").run(uid);
}
export function pendingRestartNotices() {
  return db
    .prepare("SELECT user_id FROM gpt_restart_notices")
    .all()
    .map((row) => row.user_id);
}
export function clearRestartNotice(uid) {
  db.prepare("DELETE FROM gpt_restart_notices WHERE user_id=?").run(uid);
}
export function createInvite(actor) {
  if (actor !== ADMIN_ID) throw new Error("Приглашения создаёт только владелец");
  const token = randomBytes(24).toString("base64url"),
    expiresAt = Date.now() + 7 * 86400000;
  db.prepare("INSERT INTO gpt_invites(token_hash,created_at,expires_at) VALUES(?,?,?)").run(
    inviteHash(token),
    Date.now(),
    expiresAt,
  );
  return { token, expiresAt };
}
export function redeemInvite(uid, token, alreadyAllowed = false) {
  userId(uid);
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(token))
    throw new Error("Неверная ссылка приглашения");
  db.exec("BEGIN IMMEDIATE");
  try {
    const invite = db
      .prepare("SELECT * FROM gpt_invites WHERE token_hash=?")
      .get(inviteHash(token));
    if (!invite || invite.expires_at <= Date.now())
      throw new Error("Приглашение недействительно или истекло. Попроси новую ссылку.");
    if (invite.used_at && !(invite.user_id === uid && alreadyAllowed))
      throw new Error("Эта ссылка уже использована. Попроси новое приглашение.");
    if (alreadyAllowed) {
      db.exec("COMMIT");
      return false;
    }
    setUserPolicy(ADMIN_ID, uid, { allowed: true, tokenLimit: null, dialogLimit: 5 });
    db.prepare("UPDATE gpt_invites SET user_id=?,used_at=? WHERE token_hash=?").run(
      uid,
      Date.now(),
      inviteHash(token),
    );
    db.exec("COMMIT");
    return true;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
