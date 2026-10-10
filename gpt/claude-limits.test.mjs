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
const usage = await import(new URL(process.env.DIST + "/claude-usage.js", "file://").href);
const h = new Map(Object.entries({ "anthropic-ratelimit-unified-5h-utilization": "0.7", "anthropic-ratelimit-unified-5h-reset": "1791637200", "anthropic-ratelimit-unified-7d-utilization": "0.26", "anthropic-ratelimit-unified-7d-reset": "1791957600" }));
r.headers = usage.limitsFromHeaders({ get: (k) => h.get(k) ?? null });
// событие Claude Code несёт долю, в таблице — проценты
db.recordRateLimit(uid, { limitType: "seven_day", status: "allowed", utilization: 0.86, resetsAt: 1791957600 });
r.event = db.listRateLimits(uid).find((x) => x.limit_type === "seven_day").utilization;
// перебор окна: больше 100% не показываем; сброс — по Москве
db.recordRateLimit(uid, { limitType: "five_hour", utilization: 116, resetsAt: 4102488000000 });
r.text = await usage.claudeUsageText(uid);
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
    assert.deepEqual(r.headers, [
      { limitType: "five_hour", utilization: 70, resetsAt: 1791637200000 },
      { limitType: "seven_day", utilization: 26, resetsAt: 1791957600000 },
    ], "проценты и сброс из заголовков ответа");
    assert.equal(r.event, 86, "доля из события переводится в проценты");
    assert.match(r.text, /Пятичасовое окно: исчерпано · сброс 01\.01, 15:00 МСК/);
    assert.match(r.text, /Недельный лимит: 86% использовано · сброс 14\.10, 09:00 МСК/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
