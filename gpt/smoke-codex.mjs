import { createInterface } from "node:readline";
import assert from "node:assert/strict";
import { startTurn, readFile, runInWorker } from "./worker.mjs";
const uid = 1057399602,
  project = "migration-check-20261002";
async function run(model, prompt, resume = null) {
  const p = await startTurn(uid, project, model, resume, prompt);
  const done = new Promise((resolve, reject) => {
    p.on("error", reject);
    p.on("close", resolve);
  });
  let thread,
    completed = false,
    answers = [],
    commands = 0,
    stderr = "";
  p.stderr.on("data", (c) => {
    stderr = (stderr + c).slice(-2000);
  });
  for await (const line of createInterface({ input: p.stdout })) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type === "thread.started") thread = e.thread_id;
    if (e.type === "turn.completed") completed = true;
    if (e.type === "item.completed" && e.item?.type === "agent_message") answers.push(e.item.text);
    if (e.type === "item.completed" && e.item?.type === "command_execution") commands++;
    if (e.type === "error" || e.type === "turn.failed")
      console.log("Model error", e.message || e.error?.message);
  }
  assert.equal(await done, 0, stderr);
  assert.ok(completed);
  return { thread, answers: answers.join("\n"), commands };
}
const first = await run(
  "gpt-6-sol",
  "Это проверка нового Telegram-бота. Создай файл check.txt с точным текстом GPT_AGENT_OK_7319, выполни команду проверки содержимого и ответь GPT_AGENT_OK. Не меняй другие файлы.",
);
assert.equal((await readFile(uid, project, "check.txt")).toString().trim(), "GPT_AGENT_OK_7319");
assert.ok(first.commands > 0, "Agent must execute a real verification command");
console.log("PASS Sol: actual file and command execution");
const resumed = await run(
  "gpt-6-sol",
  "Не используй инструменты. Какой точный текст ты записал в файл в предыдущем сообщении? Ответь только этим текстом.",
  first.thread,
);
assert.ok(resumed.answers.includes("GPT_AGENT_OK_7319"));
console.log("PASS persistent conversation resume");
for (const model of ["gpt-6-luna", "gpt-6-astra"]) {
  const answer = await run(model, "Не используй инструменты. Ответь только MODEL_OK.");
  assert.ok(answer.answers.includes("MODEL_OK"));
  console.log(`PASS ${model}`);
}
await runInWorker(uid, [
  "python3",
  "-c",
  `from pathlib import Path;Path('/app/workspaces/${uid}/${project}/check.txt').unlink(missing_ok=True)`,
]);
