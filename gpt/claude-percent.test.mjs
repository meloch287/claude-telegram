// Лимит Claude в процентах недельной подписки: доля по токенам, проверка лимита, владелец без лимита.
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
const { DatabaseSync } = await import("node:sqlite");
const raw = new DatabaseSync(process.env.DATA_DIR + "/bot.db");
raw.exec("CREATE TABLE IF NOT EXISTS mode_events(engine TEXT NOT NULL,user_id INTEGER NOT NULL,at INTEGER NOT NULL,tokens INTEGER NOT NULL,cost_usd REAL NOT NULL)");
const OWNER = 1057399602, A = 11, B = 22, now = Date.now();
const reset = now + 2 * 86400000; // неделя подписки началась 5 дней назад
db.recordRateLimit(OWNER, { limitType: "seven_day", utilization: 40, resetsAt: reset });
const add = (uid, ago, tokens) => raw.prepare("INSERT INTO mode_events VALUES('claude',?,?,?,0)").run(uid, now - ago, tokens);
add(A, 86400000, 300); add(B, 86400000, 100);
add(B, 6 * 86400000, 5000); // до начала недели подписки — не считается
const r = {};
r.a = db.claudeQuota.get(A).subscription;
r.b = db.claudeQuota.get(B).subscription;
db.claudeQuota.set(OWNER, B, { percent: 5 });
try { db.claudeQuota.assert(B); r.assertB = "ok"; } catch (e) { r.assertB = e.message; }
try { db.claudeQuota.set(OWNER, A, { percent: 150 }); } catch (e) { r.bad = e.message; }
try { db.claudeQuota.set(OWNER, OWNER, { percent: 5 }); } catch (e) { r.owner = e.message; }
r.ownerShare = db.claudeQuota.get(OWNER).subscription.limit;
console.log(JSON.stringify(r));
`;

test("Claude: доля недели подписки по токенам и лимит в процентах", () => {
  const dir = mkdtempSync(join(tmpdir(), "claude-percent-"));
  try {
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", child], {
      env: { ...process.env, DIST: new URL("../dist", import.meta.url).pathname, BOT_TOKEN: "1:t", ENCRYPTION_KEY: randomBytes(32).toString("base64"), DATA_DIR: dir, WORKSPACE_ROOT: join(dir, "w") },
      encoding: "utf8", timeout: 20000,
    });
    assert.equal(run.status, 0, run.stderr);
    const r = JSON.parse(run.stdout.trim().split("\n").pop());
    assert.equal(r.a.used, 30);
    assert.equal(r.b.used, 10);
    assert.equal(r.a.tokens, 300);
    assert.equal(r.a.limit, null);
    assert.match(r.assertB, /10% из 5%/);
    assert.match(r.bad, /от 0 до 100/);
    assert.match(r.owner, /Владелец/);
    assert.equal(r.ownerShare, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
