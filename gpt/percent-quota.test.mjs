import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import * as percent from "./percent-quota.mjs";
const owner = 1057399602;
const DAY = 86400000;
function fixture() {
  const db = new DatabaseSync(":memory:");
  let now = 1791000000000;
  const reset = now + DAY;
  const meter = []; // [uid, at, ticks] — как gpt_meter_events
  const ticks = (uid, since) => meter.filter(([u, at]) => (uid === null || u === uid) && at >= since).reduce((n, [, , t]) => n + t, 0);
  const ledger = percent.createPercentLedger(db, owner, () => now, () => 10, ticks);
  let value = 3,
    end = reset,
    stale = false;
  const snapshot = () => ({ stale, buckets: [{ id: "codex", primary: { usedPercent: value, resetsAt: end, windowDurationMins: 10080 } }] });
  const monitor = { get: async () => snapshot() };
  const controller = percent.createPercentController(ledger, monitor, () => {}, () => now);
  return {
    db, ledger, controller, reset,
    use: (uid, t, at = now) => meter.push([uid, at, t]),
    sync: () => ledger.sync(snapshot().buckets[0].primary),
    value: (v) => (value = v),
    stale: (v) => (stale = v),
    time: (v) => (now = v),
    get now() { return now; },
    resetAt: (v) => (end = v),
  };
}

test("доля = процент подписки × токены человека / токены всех; сумма равна проценту; владелец без лимита", async () => {
  const f = fixture();
  assert.equal(f.ledger.quota(202).limit, 10);
  assert.equal(f.ledger.quota(owner).limit, null);
  await f.controller.begin(202, "a");
  f.use(202, 300);
  f.use(303, 100);
  f.value(7);
  await f.controller.finish("a");
  assert.equal(f.ledger.quota(202).used, 5.25);
  assert.equal(f.ledger.quota(303).used, 1.75);
  // OpenAI досчитал после задачи — раньше это терялось как «простой»
  f.value(23);
  f.sync();
  assert.equal(f.ledger.quota(202).used, 17.25);
  assert.equal(f.ledger.quota(303).used, 5.75);
  assert.equal(f.ledger.quota(202).exceeded, true);
  await assert.rejects(f.controller.begin(202, "b"), /недельный/);
  await f.controller.begin(303, "c");
  await f.controller.finish("c");
});

test("перенос даты сброса без обнуления не теряет прошлый расход; настоящий сброс начинает окно заново", async () => {
  const f = fixture();
  f.use(202, 100, f.now - 3 * DAY);
  f.value(10);
  f.sync();
  assert.equal(f.ledger.quota(202).used, 10);
  // OpenAI перенёс сброс на сутки вперёд, процент тот же — доля Али не пропадает
  f.resetAt(f.reset + DAY);
  f.sync();
  assert.equal(f.ledger.quota(202).used, 10);
  // досрочный сброс: процент упал до нуля
  f.time(f.now + 3600000);
  f.resetAt(f.now + 7 * DAY);
  f.value(0);
  f.sync();
  assert.equal(f.ledger.quota(202).used, 0);
  f.time(f.now + 60000);
  f.use(303, 50);
  f.value(4);
  f.sync();
  assert.equal(f.ledger.quota(303).used, 4);
  assert.equal(f.ledger.quota(202).used, 0, "старый расход в новое окно не переносится");
  // пока окно не начато, OpenAI отдаёт «сейчас + 7 дней» — начало окна от этого не едет
  const before = f.ledger.quota(303).used;
  f.resetAt(f.now + 7 * DAY + 600000);
  f.sync();
  assert.equal(f.ledger.quota(303).used, before);
});

test("истёкшее окно без нового замера — ноль; нет замера — ноль", async () => {
  const f = fixture();
  assert.equal(f.ledger.quota(202).used, 0);
  f.use(202, 10);
  f.value(30);
  f.sync();
  assert.equal(f.ledger.quota(202).used, 30);
  f.time(f.reset + 120000); // за пределами минутного допуска на дрожание даты сброса
  assert.equal(f.ledger.quota(202).used, 0);
  assert.ok(f.ledger.quota(202).resetsAt > f.reset);
});

test("нет данных OpenAI или процент пошёл назад во время задачи — задача не стартует/останавливается", async () => {
  const f = fixture();
  f.stale(true);
  await assert.rejects(f.controller.begin(202, "a"), /OpenAI/);
  f.stale(false);
  await f.controller.begin(202, "a");
  f.value(2);
  await assert.rejects(f.controller.before(202, "a"), /OpenAI/);
  f.value(8);
  await f.controller.before(202, "a");
  await f.controller.finish("a");
  assert.equal(f.ledger.active(), undefined);
});
