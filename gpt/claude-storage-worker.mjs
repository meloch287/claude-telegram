import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { workerFor } from "../dist/agent/isolation.js";
const execute = promisify(execFile);
export function createClaudeStorageStopper({ identity = workerFor, exec = execute, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  return async uid => {
    if (!Number.isSafeInteger(uid) || uid <= 0) throw Error("Invalid user");
    let worker;
    try { worker = identity(uid); } catch { return; } // GPT-only profile.
    if (!Number.isSafeInteger(worker.uid) || worker.uid < 1000 || worker.uid === process.getuid()) throw Error("Unsafe worker identity");
    const args = ["-u", String(worker.uid)];
    async function run(command, params) {
      try { await exec(command, params, { timeout: 5000 }); return true; }
      catch (error) { if (error.code === 1) return false; throw error; }
    }
    if (!await run("/usr/bin/pkill", ["-TERM", ...args])) return;
    for (let i = 0; i < 20; i++) {
      if (!await run("/usr/bin/pgrep", args)) return;
      await wait(100);
    }
    await run("/usr/bin/pkill", ["-KILL", ...args]);
    for (let i = 0; i < 20; i++) {
      if (!await run("/usr/bin/pgrep", args)) return;
      await wait(100);
    }
    throw Error("Claude ещё завершает работу. Повтори очистку позже.");
  };
}
export const stopClaudeStorageWorker = createClaudeStorageStopper();
