// Агент ACP «Claude бота» для bb: протокол и пересылка в мост (подменный шлюз).
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const TOKEN = "a".repeat(64), SID = "11111111-2222-4333-8444-555555555555";

test("ACP agent speaks to bb and forwards turns to the bot bridge", async () => {
  const calls = [];
  const server = createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    calls.push({ url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
    if (req.url === "/claude-bb/new") return res.end(JSON.stringify({ sessionId: SID }));
    if (req.url === `/claude-bb/${SID}/check`) return res.end(JSON.stringify({ ok: true, context: { used: 866000, size: 1000000 } }));
    if (req.url === `/claude-bb/${"9".repeat(8)}-2222-4333-8444-555555555555/check`) return res.end(JSON.stringify({ ok: false }));
    if (req.url === `/claude-bb/${SID}/turn`) {
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.write(JSON.stringify({ type: "status", text: "Работаю · 3 с\n\n• Читаю README\n• Правлю код" }) + "\n");
      res.write(JSON.stringify({ type: "status", text: "Работаю · 8 с\n\n• Правлю код\n• Запускаю тесты" }) + "\n");
      res.write(JSON.stringify({ type: "text", text: "Готово, тесты зелёные" }) + "\n");
      res.write(JSON.stringify({ type: "note", text: "📎 Файл: a.txt" }) + "\n");
      res.write(JSON.stringify({ type: "context", used: 120000, size: 1000000 }) + "\n");
      return res.end(JSON.stringify({ type: "done", stopReason: "end_turn" }) + "\n");
    }
    res.writeHead(409); res.end(JSON.stringify({ error: "Этот диалог сейчас работает в Telegram." }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const dir = mkdtempSync(join(tmpdir(), "acp-"));
  writeFileSync(join(dir, "team.json"), JSON.stringify({ token: TOKEN, url: `http://127.0.0.1:${server.address().port}/team` }));
  const agent = spawn(process.execPath, [new URL("./tg-claude-acp.mjs", import.meta.url).pathname], { env: { ...process.env, TG_CLAUDE_CONFIG: join(dir, "team.json") } });
  const lines = createInterface({ input: agent.stdout });
  const inbox = [], waiters = [];
  lines.on("line", (l) => { const m = JSON.parse(l); const w = waiters.findIndex((x) => x.match(m)); if (w >= 0) waiters.splice(w, 1)[0].resolve(m); else inbox.push(m); });
  let id = 0;
  const rpc = (method, params) => new Promise((resolve) => {
    const myId = ++id; waiters.push({ match: (m) => m.id === myId, resolve });
    agent.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n");
  });
  try {
    const init = await rpc("initialize", { protocolVersion: 1 });
    assert.equal(init.result.protocolVersion, 1);
    assert.equal(init.result.agentCapabilities.loadSession, true);
    assert.equal((await rpc("session/new", { cwd: "/w", mcpServers: [] })).result.sessionId, SID);
    // Без списка моделей от моста — пустое состояние, история уже в bb.
    assert.deepEqual((await rpc("session/load", { sessionId: SID, cwd: "/w", mcpServers: [] })).result, {});
    // Индикатор контекста bb: последняя известная цифра приходит при открытии треда.
    assert.deepEqual(inbox.filter((m) => m.method === "session/update").map((m) => m.params.update), [{ sessionUpdate: "usage_update", used: 866000, size: 1000000 }]);
    inbox.length = 0;
    assert.ok((await rpc("session/load", { sessionId: "99999999-2222-4333-8444-555555555555", cwd: "/w" })).error, "неизвестный диалог — ошибка, bb начнёт новый");
    const done = await rpc("session/prompt", { sessionId: SID, prompt: [{ type: "text", text: "Почини тесты" }] });
    assert.equal(done.result.stopReason, "end_turn");
    const updates = inbox.filter((m) => m.method === "session/update").map((m) => m.params.update);
    const tools = updates.filter((u) => u.sessionUpdate === "tool_call").map((u) => u.title);
    assert.deepEqual(tools, ["• Читаю README", "• Правлю код", "• Запускаю тесты"], "каждый шаг один раз");
    const text = updates.filter((u) => u.sessionUpdate === "agent_message_chunk").map((u) => u.content.text).join("");
    assert.equal(text, "Готово, тесты зелёные\n\n_📎 Файл: a.txt_");
    assert.deepEqual(updates.filter((u) => u.sessionUpdate === "usage_update"), [{ sessionUpdate: "usage_update", used: 120000, size: 1000000 }], "после хода — свежая заполненность");
    const turn = calls.find((c) => c.url.endsWith("/turn"));
    assert.equal(turn.auth, `Bearer ${TOKEN}`);
    assert.deepEqual(turn.body, { text: "Почини тесты" });
    inbox.length = 0;
    const busy = await rpc("session/prompt", { sessionId: "33333333-2222-4333-8444-555555555555", prompt: [{ type: "text", text: "ещё" }] });
    assert.equal(busy.result.stopReason, "end_turn");
    assert.match(inbox.find((m) => m.method === "session/update").params.update.content.text, /работает в Telegram/);
    assert.equal((await rpc("session/unknown", {})).error.code, -32601);
  } finally {
    agent.kill(); server.close(); rmSync(dir, { recursive: true, force: true });
  }
});
