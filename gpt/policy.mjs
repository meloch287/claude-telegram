import path from "node:path";

// Живой список: обновляется из каталога Codex (gpt-models.mjs). Массив меняется на
// месте, поэтому все, кто его импортировал, сразу видят новые модели.
export const MODELS = [
  ["gpt-6-sol", "☀️ GPT-6 Sol"],
  ["gpt-6-luna", "🌙 GPT-6 Luna"],
  ["gpt-6-astra", "✨ GPT-6 Astra"],
];
export function setModels(list) {
  const valid = list.filter(([id, label]) => typeof id === "string" && typeof label === "string");
  if (!valid.length) return;
  MODELS.splice(0, MODELS.length, ...valid);
}
export function userId(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid Telegram user ID");
  return String(value);
}
export function projectName(value = "default") {
  const s = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё._-]+/giu, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 48);
  return s || "default";
}
export function modelId(value) {
  if (!MODELS.some(([id]) => id === value)) throw new Error("Выбери модель через /model");
  return value;
}
export function workspace(uid, project) {
  return `/app/workspaces/${userId(uid)}/${projectName(project)}`;
}
export function relativeFile(value) {
  if (typeof value !== "string" || !value || value.includes("\0") || path.posix.isAbsolute(value))
    throw new Error("Нужен относительный путь внутри проекта");
  const p = path.posix.normalize(value);
  if (p === ".." || p.startsWith("../")) throw new Error("Путь выходит за пределы проекта");
  return p;
}
export function workerArgs(uid, base, image = "ai-worker:0.162.1-bb0.45.0-r33-claude") {
  const id = userId(uid);
  if (!path.isAbsolute(base)) throw new Error("Tenant root must be absolute");
  return [
    "run",
    "-d",
    "--name",
    `ai-user-${id}`,
    "--label",
    "ai-bot.managed=v1",
    "--label",
    `ai-bot.user=${id}`,
    "--init",
    "--restart",
    "unless-stopped",
    "--user",
    "1000:1000",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges:true",
    "--pids-limit=512",
    "--cpus=1",
    "--network=ai-workers",
    "--ipc=private",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,size=256m,mode=1777",
    "--env",
    "HOME=/home/agent",
    "--env",
    "CODEX_HOME=/home/agent/.codex",
    "--env",
    "TERM=xterm-256color",
    "--env",
    "NPM_CONFIG_PREFIX=/home/agent/.local",
    "--env",
    "PIP_CACHE_DIR=/home/agent/.cache/pip",
    "--mount",
    `type=bind,src=${base}/${id}/home,dst=/home/agent`,
    "--mount",
    `type=bind,src=${base}/${id}/workspace,dst=/app/workspaces/${id}`,
    "--workdir",
    `/app/workspaces/${id}`,
    "--log-opt",
    "max-size=5m",
    "--log-opt",
    "max-file=2",
    image,
    "sleep",
    "infinity",
  ];
}

export function readWorkerArgs(uid, base, dialogId) {
  if (dialogId && !/^[0-9a-f-]{36}$/.test(dialogId)) throw new Error("Invalid dialog ID");
  const id = userId(uid),
    args = workerArgs(uid, base);
  args[args.indexOf("--name") + 1] = `ai-read-${id}`;
  args[args.indexOf("--restart") + 1] = "no";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--mount") args[i + 1] += ",readonly";
  }
  args.splice(
    args.indexOf("--workdir"),
    0,
    "--mount",
    dialogId
      ? `type=bind,src=${base}/${id}/home/dialogs/${dialogId}/.codex,dst=/home/agent/dialogs/${dialogId}/.codex`
      : `type=bind,src=${base}/${id}/home/.codex,dst=/home/agent/.codex`,
  );
  return args;
}
