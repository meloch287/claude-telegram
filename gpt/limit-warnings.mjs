// Предупреждение о личном недельном лимите: на 80% — один раз за неделю подписки
// на каждый движок. Узнать о лимите заранее лучше, чем когда задачу уже остановили.
export const WARN_AT = 0.8;

const percent = (value) => `${(Math.round(value * 10) / 10).toLocaleString("ru-RU")}%`;
const when = (ms) =>
  new Date(ms).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) + " МСК";

export function warningText(engine, share) {
  const name = engine === "claude" ? "Claude" : "GPT";
  return (
    `⚠️ ${name}: потрачено ${percent((share.used / share.limit) * 100)} твоего недельного лимита ` +
    `(${percent(share.used)} из ${percent(share.limit)} подписки).` +
    (share.resetsAt ? `\n\nСброс: ${when(share.resetsAt)}.` : "") +
    `\n\nКогда лимит кончится, задачи ${name} остановятся до сброса. Можно переключиться на ${engine === "claude" ? "GPT" : "Claude"}.`
  );
}

/**
 * users() — кому проверять; shares(uid) — {gpt, claude}: {used, limit, resetsAt};
 * send(uid, text) — отправить. Отметки «уже предупредил» — в таблице gpt_limit_warnings.
 */
export function createLimitWarnings({ db, users, shares, send }) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS gpt_limit_warnings(user_id INTEGER NOT NULL,engine TEXT NOT NULL,window TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(user_id,engine,window))",
  );
  const warned = db.prepare("SELECT 1 FROM gpt_limit_warnings WHERE user_id=? AND engine=? AND window=?");
  const mark = db.prepare("INSERT OR IGNORE INTO gpt_limit_warnings VALUES(?,?,?,?)");
  return async function check() {
    let sent = 0;
    for (const uid of users()) {
      let all;
      try {
        all = shares(uid);
      } catch {
        continue;
      }
      for (const engine of ["gpt", "claude"]) {
        const share = all?.[engine];
        if (!share || !Number.isFinite(share.used) || !Number.isFinite(share.limit) || share.limit <= 0) continue;
        if (share.used / share.limit < WARN_AT || share.used >= share.limit) continue;
        // Окно — неделя подписки; без сброса — календарная неделя.
        const window = String(share.resetsAt ?? Math.floor(Date.now() / (7 * 86400000)));
        if (warned.get(uid, engine, window)) continue;
        try {
          await send(uid, warningText(engine, share));
          mark.run(uid, engine, window, Date.now());
          sent++;
        } catch (error) {
          console.error(`[limit-warnings] ${uid}:`, error?.message || error);
        }
      }
    }
    return sent;
  };
}
