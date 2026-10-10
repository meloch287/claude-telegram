// Исполнители Claude: карта из .env и файла службы, запрос на создание, холостой прогон службы.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const child = String.raw`
const dist = new URL(process.env.DIST, "file://").href;
const w = await import(dist + "/claude-workers.js");
const iso = await import(dist + "/agent/isolation.js");
const r = {};
r.map = Object.fromEntries(w.workerMap());
r.fromFile = iso.workerFor(7).uid;
try { iso.workerFor(9); } catch (e) { r.missing = e.message; }
console.log(JSON.stringify(r));
`;

test("карта исполнителей: .env главнее файла, нет исполнителя — запрос службе", () => {
  const dir = mkdtempSync(join(tmpdir(), "workers-"));
  try {
    writeFileSync(join(dir, "claude-workers.json"), JSON.stringify({ 7: 61010, 5: 61099, bad: 1, 8: 12 }));
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", child], {
      env: { ...process.env, DIST: new URL("../dist", import.meta.url).pathname, BOT_TOKEN: "1:test", ENCRYPTION_KEY: randomBytes(32).toString("base64"), DATA_DIR: dir, WORKSPACE_ROOT: join(dir, "ws"), CLAUDE_WORKER_UID_MAP: "5:61005" },
      encoding: "utf8", timeout: 20000,
    });
    assert.equal(run.status, 0, run.stderr);
    const r = JSON.parse(run.stdout.trim().split("\n").pop());
    assert.deepEqual(r.map, { 5: 61005, 7: 61010 });
    assert.equal(r.fromFile, 61010);
    assert.match(r.missing, /готовится/);
    assert.match(readFileSync(join(dir, "claude-workers.request"), "utf8"), /^9 /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("служба: холостой прогон находит, кому не хватает исполнителя", () => {
  const dir = mkdtempSync(join(tmpdir(), "workers-py-"));
  try {
    const data = join(dir, "data"), app = join(dir, "app");
    mkdirSync(data); mkdirSync(app);
    writeFileSync(join(app, ".env"), "BOT_TOKEN=x\nCLAUDE_WORKER_UID_MAP=5:61005\n");
    writeFileSync(join(data, "claude-workers.json"), JSON.stringify({ 6: 61006 }));
    writeFileSync(join(data, "claude-workers.request"), "7 1\n");
    const db = new DatabaseSync(join(data, "bot.db"));
    db.exec("create table allowed_users (user_id integer primary key)");
    db.exec("insert into allowed_users values (5),(6),(7)");
    db.close();
    const run = spawnSync("python3", [new URL("../scripts/claude-workers.py", import.meta.url).pathname, "--check"], {
      env: { ...process.env, AI_BOT_DATA: data, AI_BOT_APP: app, CLAUDE_HOMES: join(dir, "homes") }, encoding: "utf8", timeout: 20000,
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /создал бы claude-7 с uid \d+/);
    assert.doesNotMatch(run.stdout, /claude-5|claude-6/);
    assert.ok(!existsSync(join(data, "claude-workers.request")), "запрос снят");
    assert.deepEqual(JSON.parse(readFileSync(join(data, "claude-workers.json"), "utf8")), { 6: 61006 }, "в --check файл не меняется");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
