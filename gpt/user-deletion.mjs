import { taskState } from "../dist/bot/task-state.js";
import { DatabaseSync } from "node:sqlite";
import { readdir, lstat, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../dist/config.js";
import * as store from "./store.mjs";
import * as workers from "./worker.mjs";
const tasks = new Map();
let hooks = { prepare: async () => {}, erase: workers.removeTenant };
export function configureUserDeletion(patch) {
  hooks = { ...hooks, ...patch };
}
async function purgeBackups(uid) {
  const dir = join(config.dataDir, "backups");
  let names;
  try {
    names = await readdir(dir);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const name of names) {
    if (!/^bot-\d{4}-\d{2}-\d{2}(?:-pre-token-audit)?\.db$/.test(name)) continue;
    const file = join(dir, name),
      stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unsafe backup");
    const db = new DatabaseSync(file);
    try {
      db.exec("PRAGMA secure_delete=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE");
      store.purgeUserRecords(db, uid, true);
      db.exec("COMMIT; VACUUM; PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      db.close();
    }
  }
}
let manifestTask = Promise.resolve();
function purgeManifests(uid) {
  // Whole-file manifests require serialization across concurrent user deletions.
  const task = manifestTask.then(async () => {
    for (const path of [
      join(config.dataDir, "dialog-layout-v2.json"),
      join(process.env.TENANT_ROOT || "/opt/ai-bot/tenants", "dialog-layout-manifest.json"),
    ]) {
      let stat;
      try {
        stat = await lstat(path);
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unsafe manifest");
      const data = JSON.parse(await readFile(path, "utf8"));
      if (!Array.isArray(data.dialogs)) throw new Error("Invalid manifest");
      data.dialogs = data.dialogs.filter((row) => Number(row.user_id) !== uid);
      await writeFile(path + ".next", JSON.stringify(data), { mode: 0o600 });
      await rename(path + ".next", path);
    }
  });
  manifestTask = task.catch(() => {});
  return task;
}
async function run(uid) {
  try {
    await hooks.prepare(uid);
    await hooks.erase(uid);
    taskState.purge(uid, "gpt");
    taskState.purge(uid, "claude");
    taskState.setVoice(uid, false);
    store.purgeUserLive(uid);
    await purgeManifests(uid);
    await purgeBackups(uid);
    store.compactDatabase();
    store.setUserDeletionState(uid, "complete");
  } catch (error) {
    store.setUserDeletionState(uid, "failed", error.message);
  } finally {
    tasks.delete(uid);
  }
  return store.userDeletion(uid);
}
export function startUserDeletion(actor, uid, confirmation) {
  store.beginUserDeletion(actor, uid, confirmation);
  if (store.userDeletion(uid)?.state !== "complete" && !tasks.has(uid)) tasks.set(uid, run(uid));
  return store.userDeletion(uid);
}
export async function waitForUserDeletion(uid) {
  await tasks.get(uid);
  return store.userDeletion(uid);
}
export function resumeUserDeletions() {
  for (const row of store.pendingUserDeletions())
    startUserDeletion(store.ADMIN_ID, row.user_id, String(row.user_id));
}
