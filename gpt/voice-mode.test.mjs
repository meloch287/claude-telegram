// Ответ голосом: выкл / на голосовые (один ответ на одно голосовое) / всегда; старый /voice совместим.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const child = String.raw`
const { taskState } = await import(new URL(process.env.DIST + "/bot/task-state.js", "file://").href);
const { voiceModeKeyboard, voiceModeText } = await import(new URL(process.env.DIST + "/bot/tools-menu.js", "file://").href);
const u = 5, r = {};
r.default = [taskState.voiceMode(u), taskState.replyByVoice(u)];
taskState.setVoiceMode(u, "voice");
r.textTurn = taskState.replyByVoice(u);
taskState.markVoiceTurn(u);
r.voiceTurn = taskState.replyByVoice(u);
r.nextText = taskState.replyByVoice(u);
taskState.markVoiceTurn(u);
r.stale = taskState.replyByVoice(u, Date.now() + 20 * 60_000);
taskState.setVoiceMode(u, "always");
r.always = [taskState.replyByVoice(u), taskState.replyByVoice(u), taskState.voice(u)];
taskState.setVoice(u, false);
r.legacyOff = taskState.voiceMode(u);
try { taskState.setVoiceMode(u, "loud"); } catch (e) { r.bad = true; }
r.keyboard = JSON.stringify(voiceModeKeyboard("voice"));
r.text = voiceModeText("off");
console.log(JSON.stringify(r));
`;

test("режимы ответа голосом", () => {
  const dir = mkdtempSync(join(tmpdir(), "voice-mode-"));
  try {
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", child], {
      env: { ...process.env, DIST: new URL("../dist", import.meta.url).pathname, BOT_TOKEN: "1:t", ENCRYPTION_KEY: randomBytes(32).toString("base64"), DATA_DIR: dir, WORKSPACE_ROOT: join(dir, "w") },
      encoding: "utf8", timeout: 20000,
    });
    assert.equal(run.status, 0, run.stderr);
    const r = JSON.parse(run.stdout.trim().split("\n").pop());
    assert.deepEqual(r.default, ["off", false]);
    assert.equal(r.textTurn, false, "на текст в режиме «на голосовые» — текстом");
    assert.equal(r.voiceTurn, true, "на голосовое — голосом");
    assert.equal(r.nextText, false, "отметка голосового одноразовая");
    assert.equal(r.stale, false, "старая отметка не срабатывает");
    assert.deepEqual(r.always, [true, true, true]);
    assert.equal(r.legacyOff, "off");
    assert.equal(r.bad, true);
    assert.match(r.keyboard, /✓ На голосовые/);
    assert.match(r.text, /текстом/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
