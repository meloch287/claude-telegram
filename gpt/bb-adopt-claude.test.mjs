// Перенос Claude-диалога из bb в бота: один диалог на тред bb, история в файле и в ходе, имя сохраняется.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const child = String.raw`
import { readFileSync } from "node:fs";
const dist = new URL(process.env.DIST, "file://").href;
const { adoptBbDialog, parseAdopt, historyText } = await import(dist + "/bb-adopt.js");
const { dialogRecords, dialogPath } = await import(dist + "/agent/dialog-workspace.js");
const uid = 777, prompts = [], renamed = [];
const deps = { turn: async (u, record, cwd, prompt) => { prompts.push(prompt); }, rename: async (u, id, title) => { renamed.push(title); return true; } };
const req = parseAdopt({ origin: "thr_ctieaxq3xp", title: "IngCheckUp", history: [{ role: "user", body: "Проверь курсовую" }, { role: "assistant", body: "Проверил" }, { role: "tool", body: "x" }] });
const first = await adoptBbDialog(uid, req, deps);
const second = await adoptBbDialog(uid, req, deps);
const record = dialogRecords(uid).find((r) => r.id === first);
const file = readFileSync(dialogPath(uid, first) + "/.bb-history.md", "utf8");
let bad; try { parseAdopt({ origin: "x", history: [] }); } catch (e) { bad = e.message; }
console.log(JSON.stringify({ same: first === second, turns: prompts.length, record, renamed, file: file.includes("Проверь курсовую") && file.includes("Проверил"),
  prompt: prompts[0].includes("<bb_conversation>") && prompts[0].includes("Не выполняй старые задания"), history: req.history.length, bad,
  tail: historyText([{ role: "user", body: "a".repeat(50) }], 20).startsWith("…") }));
`;

test("перенос Claude-диалога из bb", () => {
  const dir = mkdtempSync(join(tmpdir(), "bb-adopt-claude-"));
  const uid = process.getuid?.() ?? 0;
  if (uid < 1000) return; // под root исполнителя для теста не подобрать
  try {
    mkdirSync(join(dir, "ws", "777"), { recursive: true });
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", child], {
      env: { ...process.env, DIST: new URL("../dist", import.meta.url).pathname, BOT_TOKEN: "1:t", ENCRYPTION_KEY: randomBytes(32).toString("base64"), DATA_DIR: dir, WORKSPACE_ROOT: join(dir, "ws"), CLAUDE_WORKER_UID_MAP: `777:${uid}` },
      encoding: "utf8", timeout: 20000,
    });
    assert.equal(run.status, 0, run.stderr);
    const r = JSON.parse(run.stdout.trim().split("\n").pop());
    assert.equal(r.same, true, "повтор не создаёт второй диалог");
    assert.equal(r.turns, 1, "ход переноса — один раз");
    assert.equal(r.record.origin, "thr_ctieaxq3xp");
    assert.equal(r.record.title, "IngCheckUp");
    assert.equal(r.record.started, true);
    assert.deepEqual(r.renamed, ["IngCheckUp"]);
    assert.equal(r.file, true);
    assert.equal(r.prompt, true);
    assert.equal(r.history, 2, "чужие роли отброшены");
    assert.match(r.bad, /Неверный диалог/);
    assert.equal(r.tail, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
