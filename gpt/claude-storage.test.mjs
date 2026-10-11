// /storage в режиме Claude: видно, из чего складывается место, и всё видимое можно удалить кнопкой.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const child = String.raw`
import { createServer } from "node:http";
const calls = [];
const report = { bytes: 7.56e9, warning: false, blocked: false, checkedAt: 1, categories: { projects: 6.18e9, claude_env: 1.1e9, service: 0.91e9, bb_copies: 0 }, dialogs: {} };
const server = createServer((req, res) => { calls.push(req.url); res.setHeader("content-type", "application/json");
  if (req.url.endsWith("/preview")) return res.end(JSON.stringify({ bb_copies: [], claude_env: [{ name: ".mamba", bytes: 1.52e9 }, { name: ".local", bytes: 0.17e9 }] }));
  res.end(JSON.stringify(req.url.endsWith("/claude_env") ? { ...report, bytes: 6.4e9, categories: { projects: 6.18e9, service: 0.91e9 } } : report)); });
await new Promise((r) => server.listen(process.env.GPT_DISPATCH_SOCKET, r));
const dist = new URL(process.env.DIST, "file://").href;
const { registerClaudeStorage } = await import(dist + "/bot/claude-storage.js");
let command, callback, pattern; const shown = [];
registerClaudeStorage({ command: (_n, fn) => (command = fn), callbackQuery: (p, fn) => { pattern = p; callback = fn; } }, async () => {});
const msg = { message_id: 5 };
const ctx = (data) => ({ chat: { id: 77, type: "private" }, from: { id: 77 }, callbackQuery: { message: msg }, match: data && data.match(pattern),
  answerCallbackQuery: async () => {}, reply: async (t) => { shown.push(t); return msg; },
  api: { editMessageText: async (_c, _m, t, o) => shown.push([t, o]) }, editMessageText: async (t, o) => shown.push([t, o]) });
await command(ctx());
const keys = (o) => o.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
const r = { report: shown.at(-1)[0], buttons: keys(shown.at(-1)[1]) };
await callback(ctx("cdisk:ask:bb_copies")); r.nothing = shown.at(-1)[0];
await callback(ctx("cdisk:ask:claude_env")); r.ask = shown.at(-1)[0]; const run = keys(shown.at(-1)[1])[0];
await callback(ctx(run)); r.after = shown.at(-1)[0]; r.calls = calls;
console.log(JSON.stringify(r)); server.close(); process.exit(0);
`;

test("Claude /storage: разбивка, предпросмотр и удаление программ Claude", () => {
  const dir = mkdtempSync(join(tmpdir(), "cstorage-"));
  try {
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", child], {
      env: { ...process.env, DIST: new URL("../dist", import.meta.url).pathname, GPT_DISPATCH_SOCKET: join(dir, "gpt.sock"), BOT_TOKEN: "1:t", ENCRYPTION_KEY: randomBytes(32).toString("base64"), DATA_DIR: dir, WORKSPACE_ROOT: join(dir, "w"), CLAUDE_WORKER_UID_MAP: "" },
      encoding: "utf8", timeout: 30000,
    });
    assert.equal(run.status, 0, run.stderr);
    const r = JSON.parse(run.stdout.trim().split("\n").pop());
    assert.match(r.report, /Занято: 7\.56 ГБ/);
    assert.match(r.report, /Файлы проектов: 6\.18 ГБ/);
    assert.match(r.report, /Программы Claude: 1\.10 ГБ/);
    assert.match(r.report, /Служебное bb \(не в счёт\): 0\.91 ГБ/);
    assert.doesNotMatch(r.report, /Копии проектов bb/, "пустые части не показываем");
    assert.ok(r.buttons.includes("cdisk:ask:bb_copies") && r.buttons.includes("cdisk:ask:claude_env"), "у каждой части — своя кнопка");
    assert.match(r.nothing, /удалять нечего/);
    assert.match(r.ask, /\.mamba — 1\.52 ГБ/);
    assert.match(r.ask, /Всего: 1\.69 ГБ/);
    assert.match(r.after, /Занято: 6\.40 ГБ/);
    assert.ok(r.calls.includes("/storage/77/claude_env"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
