import { taskState } from "../dist/bot/task-state.js";
import { DatabaseSync } from "node:sqlite";
import { readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../dist/config.js";
import * as store from "./store.mjs";
import * as workers from "./worker.mjs";

const locks = new Set();
let prepare = async (uid) => workers.stopWorkerTasks(uid),
  finished = () => {};
export function configureDeletion(before, after) {
  prepare = before;
  finished = after;
}
export function isDeleting(uid) {
  return !!store.userDeletion(uid) || locks.has(uid) || store.pendingDeletions(uid).length > 0;
}
async function purgeBackups(uid, row) {
  const dir = join(config.dataDir, "backups");
  let names;
  try {
    names = await readdir(dir);
  } catch (e) {
    if (e.code === "ENOENT") return;
    throw e;
  }
  for (const name of names) {
    if (!/^bot-\d{4}-\d{2}-\d{2}\.db$/.test(name)) continue;
    const path = join(dir, name),
      stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unsafe backup path");
    const db = new DatabaseSync(path);
    try {
      db.exec("PRAGMA secure_delete=ON; PRAGMA busy_timeout=5000");
      store.purgeDialogRecords(db, uid, row.thread_id, row.legacy_id);
      db.exec("VACUUM; PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      db.close();
    }
  }
}
async function erase(uid, row) {
  await workers.dialogAction(uid, row.thread_id, "erase");
  taskState.purge(uid, "gpt", row.thread_id);
  store.finishDeletion(uid, row.thread_id, false);
  // Backups created after the live purge cannot contain this dialog.
  await purgeBackups(uid, row);
  store.compactDatabase();
  store.completeDeletion(uid, row.thread_id);
}
export async function deleteDialogs(uid, ids) {
  if (locks.has(uid)) throw new Error("Удаление уже выполняется");
  const selected = store.validateDeletion(uid, ids);
  locks.add(uid);
  try {
    await prepare(
      uid,
      selected.map((r) => r.id),
    );
    store.beginDeletion(uid, ids);
    const deleted = [],
      failed = [];
    for (const row of selected) {
      try {
        await erase(uid, { thread_id: row.id, legacy_id: row.legacy_id });
        deleted.push(row.id);
      } catch (error) {
        store.failDeletion(uid, row.id, error.message);
        failed.push(row.id);
      }
    }
    return { deleted, failed };
  } finally {
    locks.delete(uid);
    finished();
  }
}
export async function retryDeletions(uid) {
  const rows = store.pendingDeletions(uid);
  if (!rows.length) return { deleted: [], failed: [] };
  if (locks.has(uid)) throw new Error("Удаление уже выполняется");
  locks.add(uid);
  try {
    await prepare(
      uid,
      rows.map((r) => r.thread_id),
    );
    const deleted = [],
      failed = [];
    for (const row of rows) {
      try {
        await erase(uid, row);
        deleted.push(row.thread_id);
      } catch (error) {
        store.failDeletion(uid, row.thread_id, error.message);
        failed.push(row.thread_id);
      }
    }
    return { deleted, failed };
  } finally {
    locks.delete(uid);
    finished();
  }
}
