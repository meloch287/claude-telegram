import { ensureReadWorker, docker, startTurn } from "./worker.mjs";
import { createInterface } from "node:readline";
import assert from "node:assert/strict";
const uid = 1057399602;
const name = await ensureReadWorker(uid);
try {
  const probe = await docker([
    "exec",
    name,
    "python3",
    "-c",
    `import pathlib,os
assert os.getuid()==1000
for p in ['/app/workspaces/${uid}/default/.read-check','/home/agent/.read-check']:
 try: pathlib.Path(p).write_text('fail');raise AssertionError('Writable: '+p)
 except OSError as e: assert e.errno==30,e
assert not pathlib.Path('/app/workspaces/482961058').exists()
print('PASS read-only project/home, no other tenant')`,
  ]);
  console.log(probe.stdout.trim());
} finally {
  await docker(["rm", "-f", name]);
}
const child = await startTurn(
  uid,
  "default",
  "gpt-6-luna",
  null,
  "Проверка режима: выполни команду pwd и ответь READ_MODE_OK. Больше ничего не делай.",
  "read",
);
const closed = new Promise((r) => child.on("close", r));
let command = false,
  answer = false;
child.stderr.on("data", () => {});
for await (const line of createInterface({ input: child.stdout })) {
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    continue;
  }
  if (e.type === "item.completed") {
    if (e.item.type === "command_execution" && e.item.exit_code === 0) command = true;
    if (e.item.type === "agent_message" && e.item.text.includes("READ_MODE_OK")) answer = true;
  }
}
assert.equal(await closed, 0);
assert.ok(command);
assert.ok(answer);
console.log("PASS Codex read mode executes commands inside read-only container");
