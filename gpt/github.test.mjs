import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, symlink, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const script = new URL("./github-keys.py", import.meta.url).pathname;
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "gpt-github-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function action(root, uid, kind = "key", data = {}) {
  return JSON.parse(
    (await exec("python3", [script, kind, String(uid), root, JSON.stringify(data)])).stdout,
  );
}
test("each user gets a stable unique public key, private key never appears in output", async (t) => {
  const a = await fixture(t),
    b = await fixture(t);
  const [x, y] = await Promise.all([action(a, 11), action(b, 22)]);
  assert.match(x.publicKey, /^ssh-ed25519 /);
  assert.notEqual(x.publicKey, y.publicKey);
  assert.equal((await action(a, 11)).publicKey, x.publicKey);
  const key = join(a, ".ssh/gpt-github/id_ed25519");
  assert.equal((await stat(key)).mode & 0o777, 0o600);
  assert.match(await readFile(key, "utf8"), /BEGIN OPENSSH PRIVATE KEY/);
  assert.ok(!JSON.stringify(x).includes("PRIVATE KEY"));
});
test("parallel setup requests retain one key and preserve unrelated git settings", async (t) => {
  const a = await fixture(t);
  await writeFile(
    join(a, ".gitconfig"),
    "[pull]\n rebase = true\n[user]\n name = Existing Author\n email = old@example.com\n",
  );
  const out = await Promise.all(Array.from({ length: 4 }, () => action(a, 11)));
  assert.equal(new Set(out.map((x) => x.publicKey)).size, 1);
  assert.equal(out[0].author.name, "Existing Author");
  assert.equal(
    (await exec("git", ["config", "--file", join(a, ".gitconfig"), "pull.rebase"])).stdout.trim(),
    "true",
  );
});
test("ssh host verification is pinned and https github URLs use the personal key", async (t) => {
  const a = await fixture(t);
  await action(a, 11);
  const config = join(a, ".ssh/gpt-github/config");
  const ssh = (await exec("ssh", ["-G", "-F", config, "git@github.com"])).stdout;
  assert.match(ssh, /hostname ssh.github.com/);
  assert.match(ssh, /port 443/);
  assert.match(ssh, /stricthostkeychecking true/);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: join(a, ".gitconfig") };
  const repo = join(a, "repo");
  await exec("git", ["init", "-q", repo]);
  await exec(
    "git",
    ["-C", repo, "remote", "add", "origin", "https://github.com/example/project.git"],
    { env },
  );
  assert.equal(
    (await exec("git", ["-C", repo, "remote", "get-url", "origin"], { env })).stdout.trim(),
    "git@github.com:example/project.git",
  );
});
test("commit identity is usable from a dialog HOME and auto identity preserves choices", async (t) => {
  const a = await fixture(t);
  await action(a, 11);
  await action(a, 11, "author", { name: "Тест User", email: "11+tester@users.noreply.github.com" });
  await action(a, 11, "autoauthor", { name: "Other", email: "other@example.com" });
  const repo = join(a, "repo");
  await exec("git", ["init", "-q", repo]);
  const dialog = join(a, "dialog");
  await mkdir(dialog);
  const env = { ...process.env, HOME: dialog, GIT_CONFIG_GLOBAL: join(a, ".gitconfig") };
  await exec(
    "git",
    ["-C", repo, "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "test"],
    { env },
  );
  assert.equal(
    (await exec("git", ["-C", repo, "log", "-1", "--format=%an <%ae>"], { env })).stdout.trim(),
    "Тест User <11+tester@users.noreply.github.com>",
  );
});
test("setup refuses symlink destinations", async (t) => {
  const a = await fixture(t),
    b = await fixture(t);
  await symlink(b, join(a, ".ssh"));
  await assert.rejects(action(a, 11));
});
test("author input cannot inject git configuration", async (t) => {
  const a = await fixture(t);
  await action(a, 11);
  await assert.rejects(action(a, 11, "author", { name: "Name\n[core]", email: "x@example.com" }));
});

test("service uses the calling user and sets a GitHub noreply identity only after authenticated check", async () => {
  const { createGitHubService } = await import("./github.mjs");
  const calls = [];
  const service = createGitHubService({
    run: async (uid, args) => {
      calls.push({ uid, kind: args[3], data: JSON.parse(args[6]) });
      return {
        stdout: JSON.stringify({
          publicKey: `ssh-ed25519 AAAA ai-bot-${uid}`,
          connection: "connected",
          login: "octocat",
          author: args[3] === "autoauthor" ? JSON.parse(args[6]) : { name: "", email: "" },
        }),
      };
    },
    profile: async () => ({ login: "octocat", id: 123 }),
  });
  const result = await service.check(222);
  assert.deepEqual(
    calls.map((c) => [c.uid, c.kind]),
    [
      [222, "check"],
      [222, "autoauthor"],
    ],
  );
  assert.equal(result.author.email, "123+octocat@users.noreply.github.com");
});
test("author parser rejects injection and key screen contains only the public key", async () => {
  const { parseGitAuthor, githubView } = await import("./github.mjs");
  assert.deepEqual(parseGitAuthor("Name User | me@example.com"), {
    name: "Name User",
    email: "me@example.com",
  });
  assert.throws(() => parseGitAuthor("Name\n[core] | me@example.com"));
  const view = githubView({ publicKey: "ssh-ed25519 AAAA ai-bot-222", connection: "not_added" });
  assert.match(view.text, /Authentication Key/);
  assert.match(view.text, /ssh-ed25519 AAAA/);
  assert.equal(
    view.keyboard.inline_keyboard.flat().find((b) => b.callback_data === "github:check").text,
    "✅ Я добавил — проверить",
  );
});
test("access failures do not expose worker command arguments", async () => {
  const { createGitHubService } = await import("./github.mjs");
  const service = createGitHubService({
    run: async () => {
      throw Error("PRIVATE KEY secret docker args");
    },
  });
  await assert.rejects(
    service.key(222),
    (e) => !e.message.includes("secret") && e.message.includes("Не удалось"),
  );
});
