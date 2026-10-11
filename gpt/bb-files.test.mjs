// Файлы Claude бота в bb: кладутся в рабочую зону bb, в чат — ссылка, которую bb открывает.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, mkdirSync, symlinkSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const child = String.raw`
const dist = new URL(process.env.DIST, "file://").href;
const { BbOutput, bbFileLink, workspaceFileSaver } = await import(dist + "/bb-bridge.js");
const r = {};
r.link = bbFileLink("plan (2).html", "/app/workspaces/7/Файлы Claude/plan (2).html", "");
r.withDownload = bbFileLink("plan (2).html", "/app/workspaces/7/Файлы Claude/plan (2).html", "bb.example.test");
const events = [];
const hooks = { onAsk: async () => 0, onQuestion: async () => 0, onTimeout: async () => {} };
const saved = [];
const out = new BbOutput((e) => events.push(e), hooks, () => true, async (name, bytes) => { saved.push([name, Buffer.from(bytes).toString()]); return "/app/workspaces/7/Файлы Claude/" + name; });
await out.documentBytes(new TextEncoder().encode("<h1>План</h1>"), "plan.html");
await out.documentFromText("print(1)", "a.py");
const off = new BbOutput((e) => events.push(e), hooks, () => true, async () => null);
await off.documentBytes(new Uint8Array([1]), "x.bin");
r.events = events; r.saved = saved;
// настоящая запись помощником (без root — владелец тот же пользователь)
const root = process.env.WS;
r.real = await workspaceFileSaver(7, root)("blok1.html", new TextEncoder().encode("<p>ok</p>"));
r.none = await workspaceFileSaver(7, root + "/нет-такой")("a", new Uint8Array([1]));
console.log(JSON.stringify(r));
`;

test("файл из хода Claude — в рабочую зону bb и ссылкой в чат", () => {
  const dir = mkdtempSync(join(tmpdir(), "bb-files-"));
  const ws = join(dir, "workspace"); mkdirSync(ws);
  try {
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", child], {
      env: { ...process.env, DIST: new URL("../dist", import.meta.url).pathname, WS: ws, BOT_TOKEN: "1:t", ENCRYPTION_KEY: randomBytes(32).toString("base64"), DATA_DIR: dir, WORKSPACE_ROOT: join(dir, "w") },
      encoding: "utf8", timeout: 20000,
    });
    assert.equal(run.status, 0, run.stderr);
    const r = JSON.parse(run.stdout.trim().split("\n").pop());
    assert.equal(r.link, "📎 [plan (2).html](/app/workspaces/7/%D0%A4%D0%B0%D0%B9%D0%BB%D1%8B%20Claude/plan%20%282%29.html)", "скобки и пробелы не ломают markdown-ссылку");
    assert.equal(r.withDownload, r.link + " · [⬇️ Скачать](https://u7.bb.example.test/__web/download?path=%D0%A4%D0%B0%D0%B9%D0%BB%D1%8B%20Claude%2Fplan%20%282%29.html)", "рядом с файлом — «Скачать»");
    assert.deepEqual(r.saved, [["plan.html", "<h1>План</h1>"], ["a.py", "print(1)"]]);
    assert.deepEqual(r.events.map((e) => e.type), ["text", "text", "note"]);
    assert.match(r.events[0].text, /^📎 \[plan\.html\]\(\/app\/workspaces\/7\//);
    assert.match(r.events[2].text, /не сохранился/, "без bb — честно говорим, а не молчим");
    // ownership change needs root; outside root the helper fails → null, under root → the saved path
    if (process.getuid() === 0) {
      assert.equal(r.real, "/app/workspaces/7/Файлы Claude/blok1.html");
      assert.equal(readFileSync(join(ws, "Файлы Claude", "blok1.html"), "utf8"), "<p>ok</p>");
    }
    assert.equal(r.none, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("помощник не ходит по ссылкам: подмена папки на чужую — отказ", () => {
  const dir = mkdtempSync(join(tmpdir(), "bb-files-"));
  try {
    const ws = join(dir, "ws"), evil = join(dir, "evil"); mkdirSync(ws); mkdirSync(evil);
    symlinkSync(evil, join(ws, "Файлы Claude"));
    const run = spawnSync("python3", [new URL("./bb-save-file.py", import.meta.url).pathname, ws, "x.txt"], { input: "data", encoding: "utf8" });
    assert.notEqual(run.status, 0);
    assert.deepEqual(readdirSync(evil), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
