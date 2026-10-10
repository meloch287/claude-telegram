// Лимиты Claude: событие без процента не затирает известный, запросы к Anthropic
// общие и редкие, пауза из 429 соблюдается.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const child = String.raw`
const db = await import(new URL(process.env.DIST + "/db.js", "file://").href);
const r = {}, uid = 5;
db.getOrCreateUser(uid);
db.recordRateLimit(uid, { limitType: "five_hour", utilization: 41, resetsAt: 2000000000000 });
db.recordRateLimit(uid, { limitType: "five_hour", status: "allowed" });
r.kept = db.listRateLimits(uid).find((x) => x.limit_type === "five_hour");
const t = 1_000_000;
r.first = db.claimUsageFetch(uid, t);
r.again = db.claimUsageFetch(uid, t + 60_000);
r.after = db.claimUsageFetch(uid, t + 5 * 60_000 + 1);
db.delayUsageFetch(uid, 368, t + 5 * 60_000 + 2);
r.duringPause = db.claimUsageFetch(uid, t + 5 * 60_000 + 9 * 60_000);
r.afterPause = db.claimUsageFetch(uid, t + 5 * 60_000 + 11 * 60_000);
process.stdout.write(JSON.stringify(r));
`;

test("Claude limits keep known values and fetch rarely", () => {
  const dir = mkdtempSync(join(tmpdir(), "limits-"));
  try {
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", child], {
      env: { ...process.env, DIST: new URL("../dist", import.meta.url).pathname, BOT_TOKEN: "1:t", ENCRYPTION_KEY: randomBytes(32).toString("base64"), DATA_DIR: dir, WORKSPACE_ROOT: join(dir, "w") },
      encoding: "utf8", timeout: 20000,
    });
    assert.equal(run.status, 0, run.stderr);
    const r = JSON.parse(run.stdout);
    assert.equal(r.kept.utilization, 41, "событие без процента не стирает известный процент");
    assert.equal(r.kept.status, "allowed");
    assert.deepEqual([r.first, r.again, r.after], [true, false, true], "не чаще раза в 5 минут");
    assert.deepEqual([r.duringPause, r.afterPause], [false, true], "пауза после 429 — минимум 10 минут");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
