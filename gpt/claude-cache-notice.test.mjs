// Смена модели/глубины посреди диалога: предупреждаем, только пока кэш тёплый.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const child = String.raw`
const dist = new URL(process.env.DIST, "file://").href;
const db = await import(dist + "/db.js");
const s = await import(dist + "/bot/session.js");
const r = {};
r.empty = s.claudeCacheWarm(1);
db.saveChat({ chatId: 2, userId: 2, project: "default", sessionId: null, permissionMode: "default" });
r.noSession = s.claudeCacheWarm(2);
db.saveChat({ chatId: 3, userId: 3, project: "default", sessionId: "11111111-1111-1111-1111-111111111111", permissionMode: "default" });
r.recent = s.claudeCacheWarm(3);
r.old = s.claudeCacheWarm(3, Date.now() + 2 * 3600_000);
r.text = s.CACHE_RESET_NOTICE.length;
console.log(JSON.stringify(r));
`;

test("предупреждение о кэше — только для идущего диалога", () => {
  const dir = mkdtempSync(join(tmpdir(), "cache-notice-"));
  try {
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", child], {
      env: { ...process.env, DIST: new URL("../dist", import.meta.url).pathname, BOT_TOKEN: "1:test", ENCRYPTION_KEY: randomBytes(32).toString("base64"), DATA_DIR: dir, WORKSPACE_ROOT: join(dir, "ws") },
      encoding: "utf8", timeout: 20000,
    });
    assert.equal(run.status, 0, run.stderr);
    const r = JSON.parse(run.stdout.trim().split("\n").pop());
    assert.deepEqual([r.empty, r.noSession, r.recent, r.old], [false, false, true, false]);
    assert.ok(r.text <= 200, "влезает во всплывающее окно Telegram (200 символов)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
