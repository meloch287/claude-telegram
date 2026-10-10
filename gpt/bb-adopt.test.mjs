// GPT-диалоги, созданные в bb, становятся диалогами бота: один раз, с историей, без смены активного.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const child = String.raw`
const gpt = process.env.GPT;
const store = await import(gpt + "store.mjs");
const { createDialogSync } = await import(gpt + "bb-sync.mjs");
const uid = 1057399602;
const own = store.createThread(uid, "default", "Свой");
const native = { bb_id: "thr_native1", title: "Из bb", created_at: 1000, updated_at: 2000, codex_id: "019a0000-0000-7000-8000-000000000001",
  messages: [{ source_id: "ev1", role: "user", body: "привет", at: 1500 }, { source_id: "ev2", role: "assistant", body: "здравствуй", at: 1600 }] };
let calls = 0, budgetSeen = [];
const dialogs = createDialogSync({
  snapshot: store.webSnapshot, apply: store.applyWebSync, settings: () => ({}), runningTelegram: (u, id) => id === running,
  endpoint: async () => null, adoptBudget: () => 3,
  execute: async (u, payload) => {
    calls++; budgetSeen.push(payload.adopt);
    const adopted = payload.threads.find((t) => t.web_bb_id === "thr_native1");
    return { ready: true, messages: [], native: adopted ? [] : [native],
      threads: payload.threads.map((t) => ({ id: t.id, bb_id: t.web_bb_id || "thr_tg" + t.id.replaceAll("-", ""), status: "idle" })) };
  },
});
let running = null;
await dialogs.sync(uid, { force: true });
await dialogs.sync(uid, { force: true });
store.importWebThreads(uid, [native]); // повтор — без дублей
const rows = store.webSnapshot(uid);
const adopted = rows.find((r) => r.web_bb_id === "thr_native1");
const r = { count: rows.length, title: adopted?.title, codex: adopted?.codex_id, messages: adopted?.messages.map((m) => m.body + ":" + m.source_id),
  active: store.activeThread(uid).id === own.id, budget: budgetSeen };
running = adopted.id;
try { await dialogs.beforeWeb(uid, "/api/v1/threads/thr_native1/send"); r.blocked = false; } catch (e) { r.blocked = /работает в Telegram/.test(e.message); }
console.log(JSON.stringify(r));
`;

test("усыновление GPT-диалога из bb", () => {
  const dir = mkdtempSync(join(tmpdir(), "bb-adopt-"));
  try {
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", child], {
      env: { ...process.env, GPT: new URL("./", import.meta.url).href, BOT_TOKEN: "1:t", ENCRYPTION_KEY: randomBytes(32).toString("base64"), DATA_DIR: dir, WORKSPACE_ROOT: join(dir, "w") },
      encoding: "utf8", timeout: 30000,
    });
    assert.equal(run.status, 0, run.stderr);
    const r = JSON.parse(run.stdout.trim().split("\n").pop());
    assert.equal(r.count, 2, "свой + усыновлённый, без дублей");
    assert.equal(r.title, "Из bb");
    assert.equal(r.codex, "019a0000-0000-7000-8000-000000000001");
    assert.deepEqual(r.messages, ["привет:ev1", "здравствуй:ev2"]);
    assert.equal(r.active, true, "активный диалог не меняется");
    assert.deepEqual(r.budget.slice(0, 2), [3, 3]);
    assert.equal(r.blocked, true, "занятый в Telegram усыновлённый диалог bb не трогает");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
