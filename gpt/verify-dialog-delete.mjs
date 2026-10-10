// Run during maintenance only. Real Docker/files/DB/backup lifecycle; no Telegram messages.
import assert from "node:assert/strict";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { config } from "../dist/config.js";
import * as store from "./store.mjs";
import * as worker from "./worker.mjs";
import { deleteDialogs } from "./deletion.mjs";
assert.ok(existsSync(`${config.dataDir}/maintenance`));
const uid = 1057399602,
  previous = store.peekActiveThread(uid)?.id;
const marker = `DELETE_SMOKE_${randomUUID()}`;
const a = store.createThread(uid, "verification", marker),
  b = store.createThread(uid, "verification", "Sibling verification");
const backup = `${config.dataDir}/backups/bot-2099-12-31.db`;
assert.ok(!existsSync(backup));
const raw = new DatabaseSync(`${config.dataDir}/bot.db`);
const activePath = `/opt/ai-bot/tenants/${uid}/home/.codex/auth.json`;
let modelSession;
try {
  await worker.writeUpload(uid, a.project, "selected.txt", Buffer.from(marker), a.id);
  const otherFile = await worker.writeUpload(
    uid,
    b.project,
    "sibling.txt",
    Buffer.from("KEEP_SIBLING"),
    b.id,
  );
  const paths = worker.dialogPaths(uid, a.id);
  await worker.runInWorker(uid, [
    "python3",
    "-c",
    `from pathlib import Path; p=Path(${JSON.stringify(paths.home)});(p/'.codex'/'test-session').write_text(${JSON.stringify(marker)});(p/'legacy-history').mkdir();(p/'legacy-history'/'raw.jsonl').write_text(${JSON.stringify(marker)});(Path(${JSON.stringify(paths.workspace)})/'sibling-link').symlink_to(${JSON.stringify(worker.dialogPaths(uid, b.id).workspace)})`,
  ]);
  store.addMessage(uid, a.id, "user", marker);
  store.startJob(uid, a.id);
  raw.prepare("UPDATE gpt_threads SET summary=? WHERE id=?").run(marker, a.id);
  raw.exec(`VACUUM INTO '${backup}'`);
  const run = async (prompt, resume = null, mode = "auto") => {
    const child = await worker.startTurn(uid, a.project, "gpt-6-luna", resume, prompt, mode, a.id);
    const done = new Promise((resolve, reject) => {
      child.on("close", resolve);
      child.on("error", reject);
    });
    let completed = false,
      answer = "",
      command = false,
      stderr = "";
    child.stderr.on("data", (c) => {
      stderr = (stderr + c).slice(-1200);
    });
    for await (const line of createInterface({ input: child.stdout })) {
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (e.type === "thread.started") modelSession = e.thread_id;
      if (e.type === "turn.completed") completed = true;
      if (e.type === "item.completed" && e.item.type === "agent_message") answer += e.item.text;
      if (
        e.type === "item.completed" &&
        e.item.type === "command_execution" &&
        e.item.exit_code === 0
      )
        command = true;
    }
    assert.equal(await done, 0, stderr);
    assert.ok(completed);
    await worker.dialogAction(uid, a.id, "auth-sync");
    return { answer, command };
  };
  const result = await run(
    "Проверка: создай в текущей папке файл scoped.txt с текстом SCOPED_OK_7819 и проверь содержимое командой. Другие папки не трогай. Ответь SCOPED_OK.",
  );
  assert.ok(result.command);
  assert.equal(
    (await worker.readFile(uid, a.project, "scoped.txt", a.id)).toString().trim(),
    "SCOPED_OK_7819",
  );
  const resumed = await run(
    "Без инструментов: какой точный текст записал в scoped.txt? Ответь только им.",
    modelSession,
  );
  assert.ok(resumed.answer.includes("SCOPED_OK_7819"));
  console.log("PASS scoped Codex file, command, resume");
  await worker.ensureReadWorker(uid, a.id);
  const ro = await worker.docker([
    "exec",
    `ai-read-${uid}`,
    "python3",
    "-c",
    `from pathlib import Path\nfor p in [${JSON.stringify(paths.workspace + "/forbidden")},${JSON.stringify(paths.home + "/forbidden")},${JSON.stringify(worker.dialogPaths(uid, b.id).codex + "/forbidden")}]:\n try:Path(p).write_text('bad');raise AssertionError(p)\n except OSError as e:assert e.errno==30,e\nprint('PASS read-only dialog, HOME, sibling runtime')`,
  ]);
  console.log(ro.stdout.trim());
  await worker.docker(["rm", "-f", `ai-read-${uid}`]);
  const read = await run(
    "Выполни pwd и прочитай scoped.txt. Ответь SCOPED_OK_7819. Ничего не меняй.",
    null,
    "read",
  );
  assert.ok(read.answer.includes("SCOPED_OK_7819"));
  console.log("PASS scoped Codex read mode");
  const auth = readFileSync(activePath);
  const deleted = await deleteDialogs(uid, [a.id]);
  assert.deepEqual(deleted.failed, []);
  assert.deepEqual(deleted.deleted, [a.id]);
  assert.equal(store.getThread(uid, a.id), undefined);
  assert.deepEqual(store.messages(uid, a.id), []);
  assert.equal((await worker.readFile(uid, b.project, otherFile, b.id)).toString(), "KEEP_SIBLING");
  assert.deepEqual(readFileSync(activePath), auth);
  for (const p of [
    `/opt/ai-bot/tenants/${uid}/workspace/.dialogs/${a.id}`,
    `/opt/ai-bot/tenants/${uid}/home/dialogs/${a.id}`,
  ])
    assert.ok(!existsSync(p));
  for (const path of [`${config.dataDir}/bot.db`, backup])
    assert.equal(readFileSync(path).includes(Buffer.from(marker)), false);
  const db = new DatabaseSync(backup, { readOnly: true });
  assert.equal(db.prepare("SELECT count(*) n FROM gpt_threads WHERE id=?").get(a.id).n, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM gpt_threads WHERE id=?").get(b.id).n, 1);
  db.close();
  console.log(
    "PASS full deletion: files, history, runtime, messages, jobs, backups; sibling and account preserved",
  );
} finally {
  for (const row of [a, b])
    if (store.getThread(uid, row.id)) {
      const r = await deleteDialogs(uid, [row.id]);
      assert.deepEqual(r.failed, []);
    }
  if (previous) store.selectThread(uid, previous);
  raw.close();
  if (existsSync(backup)) unlinkSync(backup);
}
