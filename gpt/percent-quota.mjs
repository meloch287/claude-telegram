// Доля человека в недельном лимите общей подписки OpenAI.
// OpenAI сообщает только общий процент, поэтому доля = текущий процент недели ×
// токены (ticks) человека / токены всех с начала окна — как у Claude. Сумма долей
// всегда равна реальному проценту. Прежний учёт по приросту процента во время
// задачи терял всё, что OpenAI досчитывал после неё, и обнулял доли при сдвиге
// даты сброса: при 85% подписки людям было записано 11%.
const WEEK = 7 * 86400000;
// Provider reset timestamps can drift by a second between otherwise identical reads.
const RESET_TOLERANCE = 60000;
const sameWindow = (a, b) =>
  Number.isSafeInteger(a) && Number.isSafeInteger(b) && Math.abs(a - b) <= RESET_TOLERANCE;
const unavailable = (reason = "snapshot_unavailable") =>
  Object.assign(new Error("Не удалось проверить недельный лимит OpenAI. Повтори позже."), {
    code: "WEEKLY_OBSERVATION_UNAVAILABLE",
    reason,
  });
export function weeklyObservation(snapshot, now = Date.now()) {
  const codex = snapshot?.buckets?.find((b) => b.id === "codex");
  const w = [codex?.primary, codex?.secondary].find((w) => w?.windowDurationMins === 10080);
  if (
    snapshot?.stale ||
    !w ||
    !Number.isFinite(w.usedPercent) ||
    w.usedPercent < 0 ||
    !Number.isSafeInteger(w.resetsAt) ||
    w.resetsAt <= now
  )
    throw unavailable();
  return w;
}
const meterTicks = (db) => (uid, since) => {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='gpt_meter_events'").get()) return 0;
  return Number(
    (uid === null
      ? db.prepare("SELECT COALESCE(SUM(ticks),0) n FROM gpt_meter_events WHERE at>=?").get(since)
      : db.prepare("SELECT COALESCE(SUM(ticks),0) n FROM gpt_meter_events WHERE user_id=? AND at>=?").get(uid, since)
    ).n,
  );
};
export function createPercentLedger(db, owner, now = Date.now, limitFor = () => 10, ticksSince = meterTicks(db)) {
  db.exec(`CREATE TABLE IF NOT EXISTS gpt_percent_meta(id INTEGER PRIMARY KEY CHECK(id=1),started_at INTEGER NOT NULL,reset_at INTEGER);
    CREATE TABLE IF NOT EXISTS gpt_percent_usage(user_id INTEGER NOT NULL,reset_at INTEGER NOT NULL,used REAL NOT NULL,PRIMARY KEY(user_id,reset_at));
    CREATE TABLE IF NOT EXISTS gpt_percent_active(id INTEGER PRIMARY KEY CHECK(id=1),user_id INTEGER NOT NULL,job_id TEXT NOT NULL,reset_at INTEGER NOT NULL,last_percent REAL NOT NULL,observed_at INTEGER NOT NULL);`);
  db.prepare("INSERT OR IGNORE INTO gpt_percent_meta(id,started_at) VALUES(1,?)").run(now());
  db.exec(`CREATE TABLE IF NOT EXISTS gpt_percent_jobs(job_id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,weight REAL NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS gpt_percent_sample(id INTEGER PRIMARY KEY CHECK(id=1),reset_at INTEGER NOT NULL,last_percent REAL NOT NULL,observed_at INTEGER NOT NULL);`);
  // Несколько задач одного человека одновременно (параллельные диалоги bb, Telegram + bb):
  // раньше user_id был UNIQUE, и вторая задача получала «Учёт предыдущей задачи ещё не завершён».
  if (/user_id INTEGER UNIQUE/.test(db.prepare("SELECT sql FROM sqlite_master WHERE name='gpt_percent_jobs'").get()?.sql ?? ""))
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE gpt_percent_jobs_new(job_id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,weight REAL NOT NULL DEFAULT 0);
      INSERT INTO gpt_percent_jobs_new SELECT job_id,user_id,weight FROM gpt_percent_jobs;
      DROP TABLE gpt_percent_jobs;
      ALTER TABLE gpt_percent_jobs_new RENAME TO gpt_percent_jobs;
      COMMIT;`);
  if (!db.prepare("PRAGMA table_info(gpt_percent_sample)").all().some((c) => c.name === "window_start"))
    db.exec("ALTER TABLE gpt_percent_sample ADD COLUMN window_start INTEGER");
  // Preserve an interrupted pre-parallel task and its observation across upgrades.
  db.exec(`BEGIN IMMEDIATE;
    INSERT OR IGNORE INTO gpt_percent_jobs(job_id,user_id) SELECT job_id,user_id FROM gpt_percent_active;
    INSERT OR IGNORE INTO gpt_percent_sample(id,reset_at,last_percent,observed_at) SELECT id,reset_at,last_percent,observed_at FROM gpt_percent_active;
    DELETE FROM gpt_percent_active;
    COMMIT;`);
  const activeJobs = () => db.prepare("SELECT * FROM gpt_percent_jobs").all();
  const active = (jobId) =>
    jobId === undefined
      ? activeJobs()[0]
      : db.prepare("SELECT * FROM gpt_percent_jobs WHERE job_id=?").get(jobId);
  function normalized(w) {
    const reset = db.prepare("SELECT reset_at FROM gpt_percent_meta WHERE id=1").get().reset_at;
    return sameWindow(w.resetsAt, reset) ? { ...w, resetsAt: reset } : w;
  }
  // Caller owns the transaction; coalesce rows written by the old exact-timestamp logic.
  function persistWindow(w) {
    const split = db
      .prepare(
        "SELECT user_id,reset_at,used FROM gpt_percent_usage WHERE reset_at BETWEEN ? AND ? AND reset_at<>?",
      )
      .all(w.resetsAt - RESET_TOLERANCE, w.resetsAt + RESET_TOLERANCE, w.resetsAt);
    for (const row of split) {
      db.prepare(
        `INSERT INTO gpt_percent_usage VALUES(?,?,?) ON CONFLICT(user_id,reset_at) DO UPDATE SET used=used+excluded.used`,
      ).run(row.user_id, w.resetsAt, row.used);
      db.prepare("DELETE FROM gpt_percent_usage WHERE user_id=? AND reset_at=?").run(
        row.user_id,
        row.reset_at,
      );
    }
    db.prepare("UPDATE gpt_percent_sample SET reset_at=? WHERE reset_at BETWEEN ? AND ?").run(
      w.resetsAt,
      w.resetsAt - RESET_TOLERANCE,
      w.resetsAt + RESET_TOLERANCE,
    );
    db.prepare("UPDATE gpt_percent_meta SET reset_at=? WHERE id=1").run(w.resetsAt);
  }
  /**
   * Запомнить замер и начало текущего окна. Дата сброса у OpenAI «плавает»
   * (пока окно не начато, это «сейчас + 7 дней»; бывает и перенос), поэтому
   * начало окна двигаем только при настоящем сбросе: процент упал или старое
   * окно истекло.
   */
  function remember(w, prev = db.prepare("SELECT * FROM gpt_percent_sample WHERE id=1").get()) {
    const at = now();
    const kept = prev ? prev.window_start ?? prev.reset_at - WEEK : null;
    let start;
    if (!prev) start = w.resetsAt - WEEK;
    else if (w.usedPercent < prev.last_percent - 0.5) start = w.usedPercent === 0 ? at : prev.observed_at;
    else if (!sameWindow(w.resetsAt, prev.reset_at) && prev.reset_at <= at) start = Math.max(prev.reset_at, w.resetsAt - WEEK);
    else start = kept;
    db.prepare(
      `INSERT INTO gpt_percent_sample(id,reset_at,last_percent,observed_at,window_start) VALUES(1,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET reset_at=excluded.reset_at,last_percent=excluded.last_percent,observed_at=excluded.observed_at,window_start=excluded.window_start`,
    ).run(w.resetsAt, w.usedPercent, at, Math.min(start, at));
  }
  function sync(value) {
    const w = normalized(value);
    db.exec("BEGIN IMMEDIATE");
    try {
      persistWindow(w);
      // Пока идут задачи, замеры пишет observe (там проверка «процент не убывает»).
      if (!activeJobs().length && Number.isFinite(w.usedPercent) && w.usedPercent >= 0) remember(w);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return w.resetsAt;
  }
  function observe(value) {
    const w = normalized(value);
    const jobs = activeJobs();
    const previous = db.prepare("SELECT * FROM gpt_percent_sample WHERE id=1").get();
    const same = previous && sameWindow(w.resetsAt, previous.reset_at);
    if (jobs.length && previous) {
      if (!same && w.resetsAt < previous.reset_at) throw unavailable("reset_moved_backwards");
      if (same && w.usedPercent < previous.last_percent) throw unavailable("usage_moved_backwards");
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      persistWindow(w);
      remember(w, previous);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  function quota(uid, at = now()) {
    const meta = db.prepare("SELECT * FROM gpt_percent_meta WHERE id=1").get();
    const sample = db.prepare("SELECT * FROM gpt_percent_sample WHERE id=1").get();
    let reset = sample?.reset_at ?? meta.reset_at;
    const live = !!sample && sample.reset_at + RESET_TOLERANCE > at;
    if (reset && reset + RESET_TOLERANCE <= at)
      reset += (Math.floor((at - reset) / WEEK) + 1) * WEEK;
    let used = 0;
    if (live && sample.last_percent > 0) {
      const since = sample.window_start ?? sample.reset_at - WEEK;
      const all = ticksSince(null, since);
      used = all > 0 ? Math.round(((sample.last_percent * ticksSince(uid, since)) / all) * 100) / 100 : 0;
    }
    const limit = uid === owner ? null : limitFor(uid);
    return {
      used,
      limit,
      remaining: limit === null ? null : Math.max(0, limit - used),
      percent: limit === null ? null : limit === 0 ? 100 : Math.min(100, (used / limit) * 100),
      exceeded: limit !== null && used >= limit,
      resetsAt: reset,
      startedAt: meta.started_at,
      measured: false,
      estimated: true,
      pending: activeJobs().some((j) => j.user_id === uid),
    };
  }
  function assertBudget(uid) {
    const q = quota(uid);
    if (q.exceeded)
      throw new Error(
        `Достигнут недельный лимит: ${q.used}% из ${q.limit}% подписки. Сброс: ${new Date(q.resetsAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК.`,
      );
  }
  return {
    active,
    activeJobs,
    observe,
    quota,
    assertBudget,
    sync,
    weight(uid, jobId, ticks) {
      if (!Number.isFinite(ticks) || ticks < 0) throw new Error("Invalid usage weight");
      if (jobId)
        db.prepare("UPDATE gpt_percent_jobs SET weight=weight+? WHERE user_id=? AND job_id=?").run(
          ticks,
          uid,
          jobId,
        );
    },
    begin(uid, jobId, w) {
      observe(w);
      assertBudget(uid);
      db.prepare("INSERT INTO gpt_percent_jobs(job_id,user_id) VALUES(?,?)").run(jobId, uid);
    },
    close(jobId) {
      db.prepare("DELETE FROM gpt_percent_jobs WHERE job_id=?").run(jobId);
    },
  };
}

export function createPercentController(ledger, monitor, syncReset = () => {}, now = Date.now) {
  let chain = Promise.resolve();
  const live = new Set();
  function serial(fn) {
    const work = chain.then(fn);
    chain = work.catch(() => {});
    return work;
  }
  async function sample() {
    const snapshot = await monitor.get({ force: true });
    const w = weeklyObservation(snapshot, now());
    syncReset(snapshot);
    return w;
  }
  return {
    begin: (uid, jobId) =>
      serial(async () => {
        const w = await sample();
        const orphans = ledger.activeJobs().filter((j) => !live.has(j.job_id));
        if (orphans.length) {
          ledger.observe(w);
          for (const old of orphans) ledger.close(old.job_id);
        }
        ledger.begin(uid, jobId, w);
        live.add(jobId);
      }),
    before: (uid, jobId) =>
      serial(async () => {
        const a = ledger.active(jobId);
        if (!live.has(jobId) || !a || a.user_id !== uid || a.job_id !== jobId)
          throw new Error("Доступ этой задачи завершён");
        ledger.observe(await sample());
        ledger.assertBudget(uid);
      }),
    finish: (jobId) =>
      serial(async () => {
        if (!ledger.active(jobId)) return;
        live.delete(jobId);
        ledger.observe(await sample());
        ledger.close(jobId);
      }),
  };
}
