// Мост bb: список моделей для меню, выбор из bb сохраняется ходом, пустые пробные диалоги не множатся.
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
const { createBbBridgeHandler } = await import(dist + "/bb-bridge.js");
const db = await import(dist + "/db.js");
const settings = await import(dist + "/claude-settings.js");
const { createServer } = await import("node:http");
const uid = 4243, spare = "aaaaaaaa-0000-4000-8000-000000000001", open = "bbbbbbbb-0000-4000-8000-000000000002", started = "cccccccc-0000-4000-8000-000000000003";
db.getOrCreateUser(uid); db.setCredential(uid, { kind: "api", secret: "sk-test-123456789" });
mkdirSync(join(process.env.DATA_DIR, "claude-dialogs"), { recursive: true });
writeFileSync(join(process.env.DATA_DIR, "claude-dialogs", uid + ".json"), JSON.stringify([
  { id: spare, project: "default", title: "Новый диалог", started: false },
  { id: open, project: "default", title: "Новый диалог", started: false },
  { id: started, project: "default", title: "Курсовая", started: true },
]));
db.saveChat({ chatId: uid, userId: uid, project: "default", sessionId: open, permissionMode: "default" });
let created = 0;
const conv = (o) => ({ get busy() { return false; }, get closed() { return false; }, sessionId: null, async send() {}, async interrupt() {}, async close() {} });
const server = createServer(createBbBridgeHandler({ api: {}, createConversation: conv, prepare: () => "/tmp/d",
  create: () => ({ id: "dddddddd-0000-4000-8000-00000000000" + (++created), project: "default", title: "Новый диалог", started: false }) }));
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const call = (path, body) => new Promise((resolve) => {
  const req = request({ host: "127.0.0.1", port: server.address().port, path, method: "POST", headers: { "content-type": "application/json" } }, (res) => {
    let data = ""; res.on("data", (c) => (data += c)); res.on("end", () => resolve(data));
  });
  req.end(JSON.stringify(body ?? {}));
});
const r = {};
r.settings = JSON.parse(await call("/v1/" + uid + "/settings"));
r.first = JSON.parse(await call("/v1/" + uid + "/new")).sessionId;
r.second = JSON.parse(await call("/v1/" + uid + "/new")).sessionId;
const target = r.settings.models.find((m) => m.value !== r.settings.model && m.efforts.includes("high"));
await call("/v1/" + uid + "/" + started + "/turn", { text: "привет", model: target.value, effort: "high" });
r.prefs = settings.claudePreferences(uid);
r.target = target.value;
server.close();
console.log(JSON.stringify(r));
`;

test("мост: модели для bb, пустые диалоги переиспользуются, выбор сохраняется ходом", () => {
  const dir = mkdtempSync(join(tmpdir(), "bb-models-"));
  try {
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", child], {
      env: { ...process.env, DIST: new URL("../dist", import.meta.url).pathname, BOT_TOKEN: "1:t", ENCRYPTION_KEY: randomBytes(32).toString("base64"), DATA_DIR: dir, WORKSPACE_ROOT: join(dir, "w") },
      encoding: "utf8", timeout: 20000,
    });
    assert.equal(run.status, 0, run.stderr);
    const r = JSON.parse(run.stdout.trim().split("\n").pop());
    assert.ok(r.settings.models.length >= 2);
    assert.ok(r.settings.models.every((m) => !m.efforts.includes("max")), "Max скрыт и в bb");
    assert.equal(r.first, "aaaaaaaa-0000-4000-8000-000000000001", "пустой пробный диалог отдаётся снова");
    assert.notEqual(r.second, r.first, "только что выданный не отдаётся второй ветке");
    assert.notEqual(r.second, "bbbbbbbb-0000-4000-8000-000000000002", "открытый в Telegram не трогаем");
    assert.equal(r.prefs.model, r.target, "модель из bb сохранилась");
    assert.equal(r.prefs.effort, "high");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
