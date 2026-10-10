// Режим «без вопросов»: ни карточек про необратимое (если DANGER_GUARD не включён), ни уточнений кнопками.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const child = String.raw`
const { createDangerGuard } = await import(new URL(process.env.DIST + "/agent/guard.js", "file://").href);
const asked = [];
const hooks = { onAsk: async (p) => { asked.push(p.toolName); }, onQuestion: async () => {}, onTimeout: () => {} };
const make = (mode, askOnDanger) => createDangerGuard({ chatId: 1, timeoutMs: 50, hooks, currentMode: () => mode, askOnDanger });
const signal = new AbortController().signal;
const rm = { tool_name: "Bash", tool_input: { command: "rm -rf /opt/project" } };
const question = { tool_name: "AskUserQuestion", tool_input: { questions: [] } };
const r = {};
r.bypassRm = await make("bypassPermissions", false)(rm, "t1", { signal });
r.bypassQuestion = await make("bypassPermissions", false)(question, "t2", { signal });
r.defaultQuestion = await make("default", false)(question, "t3", { signal });
r.asked = asked;
console.log(JSON.stringify(r));
`;

test("без вопросов: опасное не спрашивает, уточнение запрещено; в обычном режиме вопросы можно", () => {
  const dir = mkdtempSync(join(tmpdir(), "noq-"));
  try {
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", child], {
      env: { ...process.env, DIST: new URL("../dist", import.meta.url).pathname, BOT_TOKEN: "1:t", ENCRYPTION_KEY: randomBytes(32).toString("base64"), DATA_DIR: dir, WORKSPACE_ROOT: join(dir, "w") },
      encoding: "utf8", timeout: 20000,
    });
    assert.equal(run.status, 0, run.stderr);
    const r = JSON.parse(run.stdout.trim().split("\n").pop());
    assert.deepEqual(r.bypassRm, {});
    assert.equal(r.bypassQuestion.hookSpecificOutput.permissionDecision, "deny");
    assert.match(r.bypassQuestion.hookSpecificOutput.permissionDecisionReason, /без вопросов/);
    assert.deepEqual(r.defaultQuestion, {});
    assert.deepEqual(r.asked, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
