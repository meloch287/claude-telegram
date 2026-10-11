import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { userId } from "./policy.mjs";
const exec = promisify(execFile);
export const GB = 1e9;
const WEEK = 7 * 86400000;
export function createStorageLedger(db, now = Date.now) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS gpt_storage(user_id INTEGER PRIMARY KEY,bytes INTEGER NOT NULL,blocked INTEGER NOT NULL DEFAULT 0,warning INTEGER NOT NULL DEFAULT 0,checked_at INTEGER NOT NULL,report TEXT NOT NULL,notified_at INTEGER,notified_blocked INTEGER NOT NULL DEFAULT 0);`,
  );
  function get(uid) {
    const row = db.prepare("SELECT * FROM gpt_storage WHERE user_id=?").get(uid);
    return row
      ? {
          ...JSON.parse(row.report),
          bytes: row.bytes,
          blocked: !!row.blocked,
          warning: !!row.warning,
          checkedAt: row.checked_at,
          notifiedAt: row.notified_at,
          notifiedBlocked: !!row.notified_blocked,
        }
      : null;
  }
  return {
    get,
    update(uid, report) {
      userId(uid);
      if (!Number.isSafeInteger(report.bytes) || report.bytes < 0)
        throw Error("Некорректный размер хранилища");
      const old = get(uid),
        blocked = report.bytes > 30 * GB || (!!old?.blocked && report.bytes > 10 * GB);
      db.prepare(
        `INSERT INTO gpt_storage(user_id,bytes,blocked,warning,checked_at,report) VALUES(?,?,?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET bytes=excluded.bytes,blocked=excluded.blocked,warning=excluded.warning,checked_at=excluded.checked_at,report=excluded.report,notified_blocked=CASE WHEN excluded.blocked=0 THEN 0 ELSE gpt_storage.notified_blocked END`,
      ).run(uid, report.bytes, +blocked, +(report.bytes > 20 * GB), now(), JSON.stringify(report));
      return get(uid);
    },
    assertBudget(uid) {
      if (get(uid)?.blocked)
        throw Error(
          "⛔ Место закончилось: очисти данные до 10 ГБ через /storage. После проверки доступ восстановится.",
        );
    },
    needsNotice(uid) {
      const s = get(uid);
      return (
        !!s &&
        ((s.blocked && !s.notifiedBlocked) ||
          ((s.warning || s.blocked) && (!s.notifiedAt || now() - s.notifiedAt >= WEEK)))
      );
    },
    notified(uid) {
      db.prepare(
        "UPDATE gpt_storage SET notified_at=?,notified_blocked=blocked WHERE user_id=?",
      ).run(now(), uid);
    },
  };
}
/**
 * Что умеет storage-files.py. «other» (удалить «прочие файлы» целиком) убран: он сносил
 * базу bb и проекты рабочей зоны. Вместо него — понятные части с предпросмотром:
 * bb_copies — копии проектов, сделанные bb для тредов; claude_env — окружения Claude.
 */
export const STORAGE_ACTIONS = ["scan", "cache", "bb_copies", "claude_env", "preview"];
export const CLEAN_ACTIONS = ["cache", "bb_copies", "claude_env"];
export function createStorageRunner(execute = exec) {
  let chain = Promise.resolve();
  return async (uid, action = "scan") => {
    userId(uid);
    if (!STORAGE_ACTIONS.includes(action)) throw Error("Invalid storage action");
    const work = chain.then(async () => {
      const root = process.env.TENANT_ROOT || "/opt/ai-bot/tenants";
      const claudeWork = process.env.WORKSPACE_ROOT || "/opt/ai-bot/unused-controller-workspaces";
      const claudeHome = "/var/lib/ai-claude";
      // Btrfs metadata/slab counts toward cgroup memory too. A subprocess in the
      // bot's cgroup can OOM the controller even with a small Python/Node RSS.
      const { stdout } = await execute(
        "systemd-run",
        [
          "--quiet",
          "--pipe",
          "--wait",
          "--collect",
          "--service-type=exec",
          `--unit=ai-storage-${randomUUID()}`,
          "--property=MemoryHigh=512M",
          "--property=MemoryMax=768M",
          "--property=MemorySwapMax=256M",
          "--property=OOMPolicy=stop",
          "--property=RuntimeMaxSec=180",
          "--property=TimeoutStopSec=5",
          "--property=BindsTo=ai-bot.service",
          "--property=TasksMax=16",
          "--property=UMask=0077",
          "--property=NoNewPrivileges=yes",
          "--property=PrivateTmp=yes",
          "--property=ProtectHome=yes",
          "--property=ProtectSystem=strict",
          `--property=ReadWritePaths=${root} ${claudeWork} ${claudeHome}`,
          "--",
          "/usr/bin/python3",
          fileURLToPath(new URL("./storage-files.py", import.meta.url)),
          root,
          String(uid),
          action, claudeWork, claudeHome,
        ],
        { timeout: 195000, maxBuffer: 4 * 1024 * 1024 },
      );
      return JSON.parse(stdout);
    });
    // Bound total scanner memory across users; a failed scan must not stall the queue.
    chain = work.catch(() => {});
    return work;
  };
}
export const storageAction = createStorageRunner();
export function createStorageGuard({ ledger, scan = storageAction, stop, notify, now = Date.now }) {
  const inFlight = new Map(),
    cleaning = new Set(),
    stopped = new Set();
  async function refresh(uid) {
    if (inFlight.has(uid)) return inFlight.get(uid);
    const work = (async () => {
      const report = ledger.update(uid, await scan(uid));
      // Stop once per blocked period; the in-memory set resets on service restart.
      if (report.blocked && !stopped.has(uid)) {
        await stop(uid);
        stopped.add(uid);
      }
      if (!report.blocked) stopped.delete(uid);
      if (ledger.needsNotice(uid)) {
        await notify(uid, report);
        ledger.notified(uid);
      }
      return report;
    })().finally(() => inFlight.delete(uid));
    inFlight.set(uid, work);
    return work;
  }
  return {
    refresh,
    async admit(uid) {
      if (cleaning.has(uid)) throw Error("Дождись завершения очистки /storage.");
      let s = ledger.get(uid);
      if (!s || now() - s.checkedAt > 60000) {
        try {
          s = await refresh(uid);
        } catch {
          throw Error("Не удалось проверить место на диске. Повтори позже или открой /storage.");
        }
      }
      ledger.assertBudget(uid);
    },
    async clean(uid, action, erase = storageAction) {
      if (cleaning.has(uid)) throw Error("Очистка уже выполняется");
      cleaning.add(uid);
      try {
        await inFlight.get(uid)?.catch(() => {});
        await stop(uid);
        await erase(uid, action);
        return await refresh(uid);
      } finally {
        cleaning.delete(uid);
      }
    },
    cleaning: (uid) => cleaning.has(uid),
  };
}
