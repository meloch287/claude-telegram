// Лимиты Claude общие на подписку: упор позванного в окно (ход из bb) видят все на этой подписке.
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
const OWNER = 1057399602, ALI = 11, OWN_KEY = 33, now = Date.now();
for (const id of [OWNER, ALI, OWN_KEY]) db.getOrCreateUser(id);
db.setCredential(OWNER, { kind: "subscription", secret: "sk-ant-oat-owner" });
db.allowUser(ALI, OWNER, null);
db.allowUser(OWN_KEY, OWNER, null);
db.setCredential(OWN_KEY, { kind: "api", secret: "sk-ant-api-own" });
const r = {};
// утром владелец видел 53%, вечером Али через bb упёрся в пятичасовое окно
db.recordRateLimit(OWNER, { limitType: "five_hour", utilization: 53, resetsAt: now + 3600e3 });
db.recordRateLimit(OWNER, { limitType: "seven_day", utilization: 40, resetsAt: now + 2 * 86400e3 });
db.recordRateLimit(ALI, { limitType: "five_hour", status: "rejected", utilization: 1.0, resetsAt: Math.floor(now / 1000) + 3600 });
db.recordRateLimit(ALI, { limitType: "seven_day", status: "allowed", utilization: 0.55, resetsAt: Math.floor(now / 1000) + 2 * 86400 });
db.recordRateLimit(OWN_KEY, { limitType: "five_hour", utilization: 5, resetsAt: now + 3600e3 });
const pick = (uid) => Object.fromEntries(db.listRateLimits(uid).map((x) => [x.limit_type, [x.status, x.utilization]]));
r.owner = pick(OWNER); r.ali = pick(ALI); r.own = pick(OWN_KEY);
r.week = db.claudeQuota.get(ALI).subscription.used;
console.log(JSON.stringify(r));
`;

test("Claude: лимиты подписки общие для плательщика и позванных", () => {
  const dir = mkdtempSync(join(tmpdir(), "claude-limits-"));
  try {
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", child], {
      env: { ...process.env, DIST: new URL("../dist", import.meta.url).pathname, BOT_TOKEN: "1:t", ENCRYPTION_KEY: randomBytes(32).toString("base64"), DATA_DIR: dir, WORKSPACE_ROOT: join(dir, "w") },
      encoding: "utf8", timeout: 20000,
    });
    assert.equal(run.status, 0, run.stderr);
    const r = JSON.parse(run.stdout.trim().split("\n").pop());
    assert.deepEqual(r.owner.five_hour, ["rejected", 100], "владелец видит упор Али в окно");
    assert.deepEqual(r.owner.seven_day, ["allowed", 55]);
    assert.deepEqual(r.ali, r.owner, "Али видит то же, что владелец");
    assert.deepEqual(r.own.five_hour, ["allowed", 5], "своя подписка — свои лимиты");
    assert.equal(r.week, 0, "доля недели считается от свежего процента подписки (токенов нет — 0)");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
