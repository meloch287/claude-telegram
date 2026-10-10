// bb шлёт Claude бота режим «auto», запомненный от Claude Code, — шлюз меняет его на full,
// иначе bb отклоняет сообщение. Ветки GPT не трогаем.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { bridgeTurnBody, fitBridgePermission, BRIDGE_TURN } from "./web-gateway.mjs";

const reqOf = (value) => Readable.from([Buffer.from(JSON.stringify(value))]);

test("неподходящий режим для Claude бота становится full, остальное не трогаем", async () => {
  const bb = createServer((req, res) => res.end(JSON.stringify({ providerId: req.url.includes("thr_claude") ? "acp-tgclaude" : "codex" })));
  await new Promise((r) => bb.listen(0, "127.0.0.1", r));
  const target = `http://127.0.0.1:${bb.address().port}`;
  try {
    const send = { input: [{ type: "text", text: "привет" }], permissionMode: "auto", reasoningLevel: "high" };
    const claude = JSON.parse(await bridgeTurnBody(reqOf(send), "/api/v1/threads/thr_claude/send", target));
    assert.equal(claude.permissionMode, "full");
    assert.equal(claude.reasoningLevel, "high");
    const gpt = JSON.parse(await bridgeTurnBody(reqOf(send), "/api/v1/threads/thr_gpt/send", target));
    assert.equal(gpt.permissionMode, "auto", "GPT-ветку не трогаем");
    const created = JSON.parse(await bridgeTurnBody(reqOf({ execution: { providerId: "acp-tgclaude", permissionMode: "plan" } }), "/api/v1/threads", target));
    assert.equal(created.execution.permissionMode, "full", "новая ветка Claude бота");
    const ok = { execution: { providerId: "acp-tgclaude", permissionMode: "accept-edits" } };
    assert.deepEqual(JSON.parse(await bridgeTurnBody(reqOf(ok), "/api/v1/threads", target)), ok);
    const bare = JSON.parse(await bridgeTurnBody(reqOf({ input: [{ type: "text", text: "без режима" }] }), "/api/v1/threads/thr_claude/send", target));
    assert.equal(bare.permissionMode, "full", "режима нет — явный full, иначе bb возьмёт auto из прошлого хода");
    const bareGpt = JSON.parse(await bridgeTurnBody(reqOf({ input: [] }), "/api/v1/threads/thr_gpt/send", target));
    assert.equal(bareGpt.permissionMode, undefined);
    assert.ok(BRIDGE_TURN.test("/api/v1/threads/thr_x/retry"));
    assert.ok(!BRIDGE_TURN.test("/api/v1/threads/thr_x/archive"));
    assert.equal(fitBridgePermission({ a: [{ permissionMode: "full" }] }), false);
  } finally {
    bb.close();
  }
});
