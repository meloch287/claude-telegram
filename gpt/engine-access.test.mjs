// Выключатель движков: флаги, исключение для админа, bb (провайдеры и отправка).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const child = String.raw`
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const dist = new URL(process.env.DIST, "file://").href;
const { engineAccess, setEngineAccess, engineAllowed, engineClosedText } = await import(dist + "/engine-access.js");
const { createEngineWeb, webClosedText } = await import(new URL("./engine-web.mjs", process.env.GPT).href);
const r = {};
const ADMIN = 1057399602, USER = 777;
r.default = engineAccess();
setEngineAccess("gpt", false);
r.afterOff = { user: engineAllowed("gpt", USER), admin: engineAllowed("gpt", ADMIN), claude: engineAllowed("claude", USER) };
r.text = engineClosedText("gpt");
const calls = [];
// у человека Claude Code был выключен ещё до нас — открывать его нельзя
let enabled = new Set(["codex", "acp-tgclaude"]);
const request = async (url, init) => {
  if (!init?.method) return { ok: true, json: async () => [...enabled].map((id) => ({ id })) };
  const id = url.split("/").at(-2), on = JSON.parse(init.body).enabled;
  calls.push([id, on]); if (on) enabled.add(id); else enabled.delete(id);
  return { ok: true };
};
const memory = new Map();
const ledger = { get: (uid) => new Set(memory.get(uid) ?? []), set: (uid, ids) => memory.set(uid, [...ids]) };
let web = createEngineWeb({ endpoint: async (uid) => (uid === USER ? "http://bb" : null), request, ledger });
await web.apply(USER); await web.apply(USER); await web.apply(ADMIN);
r.closeCalls = [...calls]; calls.length = 0;
setEngineAccess("claude", false);
web = createEngineWeb({ endpoint: async () => "http://bb", request, ledger });
await web.apply(USER);
r.claudeCloseCalls = [...calls]; calls.length = 0;
setEngineAccess("claude", true); setEngineAccess("gpt", true);
await web.apply(USER);
r.reopenCalls = [...calls];
r.enabledAfter = [...enabled].sort();
setEngineAccess("gpt", false);
r.turn = {};
for (const [name, claude] of [["gptThread", false], ["claudeThread", true], ["create", null]]) {
  try { web.assertTurn(USER, claude); r.turn[name] = "ok"; } catch (e) { r.turn[name] = e.message; }
}
try { web.assertTurn(ADMIN, false); r.turn.admin = "ok"; } catch (e) { r.turn.admin = e.message; }
setEngineAccess("gpt", true);
writeFileSync(join(process.env.DATA_DIR, "engine-access.json"), "{не json");
r.corrupt = engineAccess();
process.stdout.write(JSON.stringify(r));
`;

test("engine switches close GPT/Claude for everyone except the admin", () => {
  const dir = mkdtempSync(join(tmpdir(), "engines-"));
  try {
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", child], {
      env: { ...process.env, DIST: new URL("../dist", import.meta.url).pathname, GPT: new URL("./", import.meta.url).href, BOT_TOKEN: "1:test", ENCRYPTION_KEY: randomBytes(32).toString("base64"), DATA_DIR: dir, WORKSPACE_ROOT: join(dir, "ws") },
      encoding: "utf8", timeout: 20000,
    });
    assert.equal(run.status, 0, run.stderr);
    const r = JSON.parse(run.stdout);
    assert.deepEqual({ gpt: r.default.gpt, claude: r.default.claude }, { gpt: true, claude: true });
    assert.deepEqual(r.afterOff, { user: false, admin: true, claude: true });
    assert.equal(r.text, "⏸ GPT временно ограничен. Попробуй позже.");
    assert.deepEqual(r.closeCalls, [["codex", false]], "одно применение на состояние, админа не трогаем");
    assert.deepEqual(r.claudeCloseCalls, [["acp-tgclaude", false]], "выключаем только включённое");
    assert.deepEqual(r.reopenCalls.sort(), [["acp-tgclaude", true], ["codex", true]], "возвращаем только своё");
    assert.deepEqual(r.enabledAfter, ["acp-tgclaude", "codex"], "Claude Code, выключенный до нас, остался выключен");
    assert.equal(r.turn.gptThread, "⛔ GPT временно ограничен. Попробуй позже.");
    assert.equal(r.turn.claudeThread, "ok");
    assert.equal(r.turn.create, "ok", "создание с открытым Claude не блокируем — GPT скрыт из выбора");
    assert.equal(r.turn.admin, "ok");
    assert.deepEqual({ gpt: r.corrupt.gpt, claude: r.corrupt.claude }, { gpt: true, claude: true }, "испорченный файл не закрывает доступ");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
