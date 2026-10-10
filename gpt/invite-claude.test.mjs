// Приглашение: доступ к GPT и Claude (на подписке владельца), повторная ссылка не срабатывает.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const child = String.raw`
const gpt = process.env.GPT;
const store = await import(gpt + "store.mjs");
const { redeemInvitation } = await import(gpt + "invites.mjs");
const db = await import(new URL(process.env.DIST + "/db.js", "file://").href);
const invite = store.createInvite(store.ADMIN_ID);
const replies = [];
const ctx = (uid) => ({ from: { id: uid }, chat: { type: "private" }, message: { text: "/start invite_" + invite.token }, reply: async (t) => replies.push(t) });
const first = ctx(777);
let passed = 0;
await redeemInvitation(first, async () => { passed++; });
const r = { granted: first.inviteGranted, passed, gpt: db.isGptUserAllowed(777), claude: db.isUserAllowedInDb(777), inviter: db.inviterOf(777), percent: db.claudeQuota.get(777).subscription.limit };
db.claudeQuota.set(store.ADMIN_ID, 777, { percent: 25 });
r.kept = db.claudeQuota.applyDefault(777);
r.after = db.claudeQuota.get(777).subscription.limit;
await redeemInvitation(ctx(888), async () => {});
r.second = replies.at(-1);
r.other = db.isGptUserAllowed(888);
console.log(JSON.stringify(r));
`;

test("приглашение открывает GPT и Claude", () => {
  const dir = mkdtempSync(join(tmpdir(), "invite-"));
  try {
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", child], {
      env: { ...process.env, DIST: new URL("../dist", import.meta.url).pathname, GPT: new URL("./", import.meta.url).href, BOT_TOKEN: "1:t", ENCRYPTION_KEY: randomBytes(32).toString("base64"), DATA_DIR: dir, WORKSPACE_ROOT: join(dir, "w") },
      encoding: "utf8", timeout: 30000,
    });
    assert.equal(run.status, 0, run.stderr);
    const r = JSON.parse(run.stdout.trim().split("\n").pop());
    assert.deepEqual([r.granted, r.passed, r.gpt, r.claude, r.inviter], [true, 1, true, true, 1057399602]);
    assert.equal(r.percent, 10, "Claude по умолчанию — 10%");
    assert.deepEqual([r.kept, r.after], [false, 25], "настроенный лимит не перетирается");
    assert.match(r.second, /уже использована/);
    assert.equal(r.other, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
