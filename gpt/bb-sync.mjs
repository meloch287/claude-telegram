import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { ensureWorker } from "./worker.mjs";
const script = await readFile(new URL("./bb-sync.py", import.meta.url), "utf8");
export const bbThreadId = (id) => "thr_tg" + id.replaceAll("-", "");
export function telegramThreadId(id) {
  const m = /^thr_tg([a-f0-9]{8})([a-f0-9]{4})([a-f0-9]{4})([a-f0-9]{4})([a-f0-9]{12})$/.exec(id);
  return m ? m.slice(1).join("-") : null;
}
async function run(uid, payload) {
  const name = await ensureWorker(uid);
  return new Promise((resolve, reject) => {
    const child = spawn("docker", [
      "exec",
      "-i",
      name,
      "python3",
      "-c",
      script,
      String(uid),
      "/home/agent",
      `/app/workspaces/${uid}`,
    ]);
    let output = "",
      size = 0;
    const timeout = setTimeout(() => child.kill("SIGTERM"), 60000);
    timeout.unref();
    child.stderr.on("data", () => {});
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > 32 * 1024 * 1024) child.kill("SIGTERM");
      else output += chunk;
    });
    child.once("error", reject);
    child.stdin.on("error", () => {});
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) return reject(Error("Не удалось синхронизировать диалоги с bb."));
      try {
        resolve(JSON.parse(output));
      } catch {
        reject(Error("Не удалось прочитать диалоги bb."));
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}
export function createDialogSync({
  snapshot,
  apply,
  settings,
  runningTelegram,
  endpoint,
  execute = run,
}) {
  const active = new Map(),
    cache = new Map(),
    webReservations = new Map();
  async function sync(uid, { force = false, ignoreBusy = null } = {}) {
    if (active.has(uid)) {
      await active.get(uid);
      if (force) return sync(uid, { force, ignoreBusy });
      return cache.get(uid)?.result;
    }
    if (!force && Date.now() - (cache.get(uid)?.at || 0) < 3000) return cache.get(uid).result;
    const task = (async () => {
      const threads = snapshot(uid).map((row) => ({
        ...row,
        busy: row.id !== ignoreBusy && runningTelegram(uid, row.id),
      }));
      const result = await execute(uid, {
        threads,
        complete: true,
        model: settings(uid).model || "gpt-6-sol",
      });
      apply(uid, result);
      cache.set(uid, { at: Date.now(), result });
      // Web archiving/deletion never destroys Telegram data implicitly.
      return result;
    })();
    active.set(uid, task);
    try {
      return await task;
    } finally {
      active.delete(uid);
    }
  }
  async function api(uid, path, method = "POST") {
    const target = await endpoint(uid);
    if (!target) return;
    const r = await fetch(target + "/api/v1" + path, {
      method,
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok && r.status !== 404)
      throw Error("Не удалось освободить веб-диалог. Повтори через несколько секунд.");
  }
  return {
    sync,
    async prepareTelegram(uid, id) {
      const key = `${uid}:${id}`;
      if (webReservations.has(key))
        throw Error("Этот диалог сейчас запускается в bb. Дождись ответа в браузере.");
      const result = await sync(uid, { force: true, ignoreBusy: id });
      const row = result.threads?.find((t) => t.id === id);
      if (row && !["idle", "errored", "error", "telegram_busy"].includes(row.status))
        throw Error(
          "Этот диалог сейчас работает в bb. Дождись ответа или останови задачу в браузере.",
        );
      if (row && result.ready) {
        await api(uid, `/threads/${row.bb_id}/stop`);
        await sync(uid, { force: true, ignoreBusy: id });
      }
    },
    async beforeWeb(uid, path) {
      const match = /^\/api\/v1\/threads\/([^/]+)\/(?:send|retry|compact|edit-message)$/.exec(path);
      const id = match && telegramThreadId(match[1]);
      if (!id) return;
      if (runningTelegram(uid, id))
        throw Error(
          "⛔ Этот диалог сейчас работает в Telegram. Уточнение отправь туда или дождись ответа.",
        );
      const key = `${uid}:${id}`;
      webReservations.set(key, (webReservations.get(key) || 0) + 1);
      const release = () => {
        const n = webReservations.get(key) || 0;
        if (n <= 1) webReservations.delete(key);
        else webReservations.set(key, n - 1);
      };
      try {
        await sync(uid, { force: true });
        return release;
      } catch (error) {
        release();
        throw error;
      }
    },
    async beforeDelete(uid, ids) {
      const result = await sync(uid, { force: true });
      if (
        result?.threads?.some(
          (t) =>
            !ids.includes(t.id) &&
            !["idle", "errored", "error", "telegram_busy"].includes(t.status),
        )
      )
        throw Error("В bb работает другой диалог. Сначала останови его.");
      for (const id of ids) await api(uid, `/threads/${bbThreadId(id)}/stop`);
    },
    nativeCount: (uid) => cache.get(uid)?.result?.native_count,
  };
}
