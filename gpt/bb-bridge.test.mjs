// Мост «bb → Claude бота»: маршруты, поток хода, блокировка Telegram, отмена.
// Запускается отдельным процессом со своим DATA_DIR: config читается при импорте.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const child = String.raw`
import { request } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const dist = new URL(process.env.DIST, "file://").href;
const { createBbBridgeHandler, plainText, BbOutput } = await import(dist + "/bb-bridge.js");
const { bbHolds, bbAcquire, bbRelease } = await import(dist + "/bb-locks.js");
const db = await import(dist + "/db.js");
const { createServer } = await import("node:http");
const results = {};
const uid = 4242, sid = "11111111-2222-4333-8444-555555555555";
db.getOrCreateUser(uid); db.setCredential(uid, { kind: "api", secret: "sk-test-123456789" });
mkdirSync(join(process.env.DATA_DIR, "claude-dialogs"), { recursive: true });
writeFileSync(join(process.env.DATA_DIR, "claude-dialogs", uid + ".json"), JSON.stringify([{ id: sid, project: "default", title: "Т", started: true }]));

results.plain = plainText("<b>Шаг</b> &lt;1&gt;<br>дальше &amp; ещё");
const events = []; let active = true;
const out = new BbOutput((e) => events.push(e), { onAsk: async () => 7, onQuestion: async () => 8, onTimeout: async () => {} }, () => active);
await out.sendRich("ответ"); active = false; await out.sendRich("✅ Готово · журнал"); await out.status("<b>Работаю</b>\n\n• Читаю файл");
results.permission = await out.permissionHooks.onAsk({});
results.output = events;

let seen = null, holdsDuring = null;
function fakeConversation(options) {
  let busy = false;
  return {
    get busy() { return busy; }, get closed() { return false; }, sessionId: null,
    async send(text, images = []) { seen = { text, images, resume: options.resumeSessionId, cwd: options.cwd }; busy = true;
      holdsDuring = bbHolds(uid, sid);
      await options.output.status("<b>Работаю</b>\n\n• Читаю README");
      await options.output.sendRich("Привет из бота");
      setTimeout(() => { busy = false; }, 300); },
    async interrupt() { busy = false; }, async close() {},
    // как в жизни: полный пересчёт SDK долгий (~12 с) — мост не должен его ждать
    contextUsage() { return new Promise(() => {}); },
    lastContext() { return { percentage: 12, total: 120000, max: 1000000 }; },
  };
}
const savedFiles = [];
const server = createServer(createBbBridgeHandler({ api: {}, createConversation: fakeConversation, saveAttachment: (uid, cwd, name, bytes) => { savedFiles.push([uid, cwd, name, bytes.length]); return { path: cwd + "/вложения/x-" + name, name }; }, prepare: () => "/tmp/dialog", create: () => ({ id: "22222222-3333-4444-8555-666666666666", project: "default", title: "Новый диалог", started: false }) }));
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const call = (path, body) => new Promise((resolve) => {
  const req = request({ host: "127.0.0.1", port, path, method: "POST", headers: { "content-type": "application/json" } }, (res) => {
    let data = ""; res.on("data", (c) => (data += c)); res.on("end", () => resolve({ status: res.statusCode, body: data }));
  });
  req.end(JSON.stringify(body ?? {}));
});
results.unknown = (await call("/v1/4242/99999999-2222-4333-8444-555555555555/turn", { text: "x" })).status;
results.badPath = (await call("/v1/abc/new")).status;
results.empty = (await call("/v1/4242/" + sid + "/turn", { text: " " })).status;
results.check = JSON.parse((await call("/v1/4242/" + sid + "/check")).body);
const turn = await call("/v1/4242/" + sid + "/turn", { text: "Привет" });
results.turn = { status: turn.status, events: turn.body.trim().split("\n").map((l) => JSON.parse(l)), seen, holdsDuring, holdsAfter: bbHolds(uid, sid) };
const withFiles = await call("/v1/4242/" + sid + "/turn", { text: "", attachments: [{ name: "скрин.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0]).toString("base64") }, { name: "план.pdf", data: Buffer.from("%PDF-1").toString("base64") }] });
results.files = { status: withFiles.status, seen, savedFiles };
results.tooMany = (await call("/v1/4242/" + sid + "/turn", { text: "x", attachments: Array.from({ length: 11 }, () => ({ name: "a", data: "" })) })).status;
bbAcquire(uid, sid, async () => {});
results.checkAfter = JSON.parse((await call("/v1/4242/" + sid + "/check")).body);
results.busy = (await call("/v1/4242/" + sid + "/turn", { text: "ещё" })).status;
bbRelease(uid, sid);
const created = await call("/v1/4242/new");
results.created = { status: created.status, ok: /^[0-9a-f-]{36}$/.test(JSON.parse(created.body).sessionId ?? "") };
server.close();
process.stdout.write(JSON.stringify(results));
process.exit(0);
`;

test("bridge routes, streaming turn, locks and new dialogs", () => {
  const dir = mkdtempSync(join(tmpdir(), "bb-bridge-"));
  try {
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", child], {
      env: { ...process.env, DIST: new URL("../dist", import.meta.url).pathname, BOT_TOKEN: "1:test", ENCRYPTION_KEY: randomBytes(32).toString("base64"), DATA_DIR: dir, WORKSPACE_ROOT: join(dir, "ws"), CLAUDE_WORKER_UID_MAP: "" },
      encoding: "utf8", timeout: 30000,
    });
    assert.equal(run.status, 0, run.stderr);
    const r = JSON.parse(run.stdout);
    assert.equal(r.plain, "Шаг <1>\nдальше & ещё");
    assert.deepEqual(r.output.map((e) => e.type), ["text", "status", "note"], "журнал после результата в bb не идёт");
    assert.equal(r.permission, 7, "карточка разрешения уходит в Telegram");
    assert.equal(r.unknown, 404);
    assert.equal(r.badPath, 404);
    assert.equal(r.empty, 400);
    assert.deepEqual(r.check, { ok: true, busy: false, context: null });
    assert.equal(r.turn.status, 200);
    assert.deepEqual(r.turn.events.map((e) => e.type), ["status", "text", "context", "done"]);
    assert.deepEqual(r.turn.events[2], { type: "context", used: 120000, size: 1000000 }, "заполненность контекста — для индикатора bb");
    assert.deepEqual(r.checkAfter.context, { used: 120000, size: 1000000 }, "запомнена у диалога — при открытии треда bb увидит её сразу");
    assert.equal(r.turn.events.at(-1).stopReason, "end_turn");
    assert.equal(r.turn.seen.text, "Привет");
    assert.equal(r.turn.seen.resume, "11111111-2222-4333-8444-555555555555", "начатый диалог продолжается той же сессией");
    assert.equal(r.turn.holdsDuring, true, "пока идёт ход, Telegram диалог не поднимет");
    assert.equal(r.turn.holdsAfter, false);
    assert.equal(r.busy, 409);
    assert.equal(r.files.status, 200);
    assert.deepEqual(r.files.savedFiles.map((f) => f.slice(2)), [["скрин.png", 6], ["план.pdf", 6]], "вложения — в папку диалога, куда Claude бота может заглянуть");
    assert.deepEqual(r.files.seen.images, ["/tmp/dialog/вложения/x-скрин.png"], "картинка уходит Claude как изображение");
    assert.match(r.files.seen.text, /^Посмотри вложения\.\n\nПользователь приложил изображение: \/tmp\/dialog\/вложения\/x-скрин\.png\nПользователь приложил файл «план\.pdf»: \/tmp\/dialog\/вложения\/x-план\.pdf/);
    assert.equal(r.tooMany, 400);
    assert.equal(r.created.status, 200);
    assert.equal(r.created.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
