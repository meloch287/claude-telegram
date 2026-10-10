// Уровни Claude в боте: Max скрыт, сохранённый Max становится «Авто»; субагенты держат кэш час.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const child = String.raw`
const dist = new URL(process.env.DIST, "file://").href;
const s = await import(dist + "/claude-settings.js");
const uid = 777;
const r = {};
r.levels = [...new Set(s.claudeModels(uid).flatMap(m => m.supportedEffortLevels ?? []))];
r.saved = s.claudePreferences(uid).effort;
try { s.saveClaudePreferences(uid, { effort: "max" }); r.saveMax = "ok"; } catch (e) { r.saveMax = "rejected"; }
r.plain = s.claudeRuntimeOptions(uid).settings;
s.saveClaudePreferences(uid, { effort: "xhigh", orchestration: true });
r.orch = s.claudeRuntimeOptions(uid);
console.log(JSON.stringify(r));
`;

test("Max скрыт, кэш субагентов — час", () => {
  const dir = mkdtempSync(join(tmpdir(), "claude-effort-"));
  try {
    // старый выбор человека — Max
    writeFileSync(join(dir, "claude-preferences.json"), JSON.stringify({ 777: { model: "default", effort: "max", thinking: "auto", orchestration: false } }));
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", child], {
      env: { ...process.env, DIST: new URL("../dist", import.meta.url).pathname, BOT_TOKEN: "1:test", ENCRYPTION_KEY: randomBytes(32).toString("base64"), DATA_DIR: dir, WORKSPACE_ROOT: join(dir, "ws") },
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    const r = JSON.parse(run.stdout.trim().split("\n").pop());
    assert.ok(r.levels.includes("xhigh"));
    assert.ok(!r.levels.includes("max"));
    assert.equal(r.saved, null);
    assert.equal(r.saveMax, "rejected");
    assert.deepEqual(r.plain, { subagentPromptCacheTtl: "1h" });
    assert.equal(r.orch.effort, "xhigh");
    assert.deepEqual(r.orch.settings, { subagentPromptCacheTtl: "1h", ultracode: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
