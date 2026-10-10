// Шлюз моста Claude и настройка агента в bb.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClaudeBridgeHandler } from "./claude-bb-bridge.mjs";
import { agentEntry, mergeCustomAgents } from "./claude-bb.mjs";

test("custom agent entry merges without touching other agents", () => {
  const entry = agentEntry(42);
  assert.equal(entry.id, "tgclaude");
  assert.equal(entry.env.TG_CLAUDE_CONFIG, "/app/workspaces/42/AI-bot/User42/.ai-team.json");
  const first = mergeCustomAgents("", entry);
  assert.deepEqual(JSON.parse(first), [entry]);
  assert.equal(mergeCustomAgents(first, entry), null, "без изменений — не сохраняем");
  const mine = JSON.stringify([{ id: "other", displayName: "X", command: "x" }]);
  assert.deepEqual(JSON.parse(mergeCustomAgents(mine, entry)).map((a) => a.id), ["other", "tgclaude"]);
  assert.deepEqual(JSON.parse(mergeCustomAgents("не json", entry)), [entry]);
});

test("gateway checks the token and forwards to the bot socket with uid from the token", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cbb-"));
  const socket = join(dir, "s.sock");
  const seen = [];
  const bot = createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    seen.push({ url: req.url, body });
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    res.end('{"type":"done","stopReason":"end_turn"}\n');
  });
  await new Promise((r) => bot.listen(socket, r));
  const gateway = createServer(createClaudeBridgeHandler({ identify: async (t) => (t === "b".repeat(64) ? 77 : null), socket }));
  await new Promise((r) => gateway.listen(0, "127.0.0.1", r));
  const call = (path, token, body = "{}") => new Promise((resolve) => {
    const req = request({ host: "127.0.0.1", port: gateway.address().port, path, method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {} }, (res) => {
      let data = ""; res.on("data", (c) => (data += c)); res.on("end", () => resolve({ status: res.statusCode, data }));
    });
    req.end(body);
  });
  try {
    assert.equal((await call("/claude-bb/new", null)).status, 401);
    assert.equal((await call("/claude-bb/new", "c".repeat(64))).status, 401);
    assert.equal((await call("/claude-bb/../../etc", "b".repeat(64))).status, 404);
    const ok = await call("/claude-bb/11111111-2222-4333-8444-555555555555/turn", "b".repeat(64), '{"text":"hi"}');
    assert.equal(ok.status, 200);
    assert.match(ok.data, /end_turn/);
    assert.deepEqual(seen.at(-1), { url: "/v1/77/11111111-2222-4333-8444-555555555555/turn", body: '{"text":"hi"}' });
  } finally {
    gateway.close(); bot.close(); rmSync(dir, { recursive: true, force: true });
  }
});
