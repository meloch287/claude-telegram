// Claude бота в bb выглядит как Claude: логотип и цвет вместо портфеля, без Max;
// агент показывает модели бота, а выбор в меню уходит в бота только с ходом.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brandBridgeProviders, BRIDGE_LOGO_PATH } from "./web-gateway.mjs";

test("провайдер acp-tgclaude получает логотип Claude", () => {
  const [codex, bridge] = brandBridgeProviders([
    { id: "codex", logoUrl: null },
    { id: "acp-tgclaude", logoUrl: null, icon: { glyph: "Toolbox" }, strings: { installUrl: "x" }, reasoningLevels: [{ id: "high" }, { id: "max" }] },
  ]);
  assert.deepEqual(codex, { id: "codex", logoUrl: null });
  assert.ok(bridge.logoUrl.startsWith(BRIDGE_LOGO_PATH));
  assert.equal(bridge.icon, undefined);
  assert.equal(bridge.strings.brandPrefix, "Claude ");
  assert.equal(bridge.strings.installUrl, "x");
  assert.deepEqual(bridge.reasoningLevels, [{ id: "high" }]);
  assert.equal(brandBridgeProviders("нет"), "нет");
});

test("агент: модели бота в меню, выбор — только с ходом", async () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-"));
  const turns = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url.endsWith("/new")) return res.end(JSON.stringify({ sessionId: "11111111-1111-1111-1111-111111111111" }));
      if (req.url.endsWith("/settings")) return res.end(JSON.stringify({ models: [{ value: "default", name: "Sonnet 5", efforts: ["low", "high", "xhigh"] }, { value: "opus", name: "Opus 5.5", efforts: ["low", "medium", "high", "xhigh"] }], model: "default", effort: null }));
      if (req.url.endsWith("/turn")) { turns.push(JSON.parse(body)); res.write(JSON.stringify({ type: "text", text: "ok" }) + "\n"); return res.end(JSON.stringify({ type: "done", stopReason: "end_turn" }) + "\n"); }
      res.end("{}");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const cfg = join(dir, "team.json");
  writeFileSync(cfg, JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/team`, token: "t" }));
  const agent = spawn(process.execPath, [new URL("./tg-claude-acp.mjs", import.meta.url).pathname], { env: { ...process.env, TG_CLAUDE_CONFIG: cfg } });
  const replies = new Map();
  let buffer = "";
  agent.stdout.on("data", (c) => { buffer += c; let i; while ((i = buffer.indexOf("\n")) >= 0) { const m = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1); if (m.id !== undefined) replies.get(m.id)?.(m); } });
  let id = 0;
  const call = (method, params = {}) => new Promise((resolve) => { const n = ++id; replies.set(n, resolve); agent.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n"); });
  try {
    const created = (await call("session/new", { cwd: "/tmp", mcpServers: [] })).result;
    const sid = created.sessionId;
    const model = created.configOptions.find((o) => o.category === "model");
    assert.deepEqual(model.options.map((o) => o.value), ["default", "opus"]);
    assert.equal(created.configOptions.find((o) => o.category === "thought_level").currentValue, "auto");
    assert.equal(created.models.currentModelId, "default");
    // bb перебирает модели на пробной сессии — бот при этом не трогается
    const probe = (await call("session/set_config_option", { sessionId: sid, configId: "model", value: "opus" })).result;
    assert.deepEqual(probe.configOptions.find((o) => o.id === "effort").options.map((o) => o.value), ["auto", "low", "medium", "high", "xhigh"]);
    await call("session/set_config_option", { sessionId: sid, configId: "effort", value: "high" });
    const unknown = (await call("session/set_config_option", { sessionId: sid, configId: "model", value: "claude-sonnet-5" })).result;
    assert.equal(unknown.models.currentModelId, "opus", "неизвестная модель не ломает выбор");
    assert.equal(turns.length, 0);
    await call("session/prompt", { sessionId: sid, prompt: [{ type: "text", text: "привет" }] });
    assert.deepEqual(turns, [{ text: "привет", model: "opus", effort: "high" }]);
  } finally {
    agent.kill();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
