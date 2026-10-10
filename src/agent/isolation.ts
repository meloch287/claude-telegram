import { spawn } from "node:child_process";
import { constants, openSync, closeSync, fstatSync, fchownSync, fchmodSync, realpathSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import type { SpawnOptions, SpawnedProcess } from "@anthropic-ai/claude-agent-sdk";
import { requestWorker, workerMap } from "../claude-workers.js";

export interface WorkerIdentity {
  uid: number;
  gid: number;
  home: string;
  name: string;
}

export function workerFor(userId: number): WorkerIdentity {
  const uid = workerMap().get(userId);
  if (uid === undefined) {
    // Служба ai-bot-claude-workers создаст исполнителя за несколько секунд.
    requestWorker(userId);
    throw new Error("Claude Code для тебя ещё готовится. Попробуй через минуту.");
  }
  return {
    uid,
    gid: uid,
    home: `/var/lib/ai-claude/${userId}`,
    name: `claude-${userId}`,
  };
}

export function prepareWorkspace(userId: number, userRoot: string, projectDir: string): void {
  const worker = workerFor(userId);
  const root = resolve(userRoot);
  const dir = resolve(projectDir);
  if (dirname(dir) !== root || realpathSync(dirname(root)) !== dirname(root))
    throw new Error("Workspace escaped its user directory");
  const flags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
  const rootFd = openSync(root, flags);
  try {
    const owner = fstatSync(rootFd).uid;
    if (owner !== 0 && owner !== worker.uid) throw new Error("Workspace belongs to another user");
    const projectFd = openSync(`/proc/self/fd/${rootFd}/${basename(dir)}`, flags);
    try {
      const projectOwner = fstatSync(projectFd).uid;
      if (projectOwner !== 0 && projectOwner !== worker.uid)
        throw new Error("Project belongs to another user");
      fchownSync(projectFd, worker.uid, worker.gid);
      fchmodSync(projectFd, 0o700);
      fchownSync(rootFd, worker.uid, worker.gid);
      fchmodSync(rootFd, 0o700);
    } finally { closeSync(projectFd); }
  } finally {
    closeSync(rootFd);
  }
}

export function spawnWorker(userId: number, options: SpawnOptions): SpawnedProcess {
  const worker = workerFor(userId);
  return spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    signal: options.signal,
    uid: worker.uid,
    gid: worker.gid,
    stdio: ["pipe", "pipe", "pipe"],
  });
}
