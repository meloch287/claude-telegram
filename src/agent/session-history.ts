import { dialogRecord, dialogPath } from "./dialog-workspace.js";
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { SDKSessionInfo, SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import { config } from "../config.js";
import { workerFor } from "./isolation.js";

const exec = promisify(execFile);

export function validateHistoryDirectory(userId: number, path: string): string {
  const root = resolve(config.workspaceRoot, String(userId));
  const dir = resolve(path);
  if (dirname(dir) !== root || realpathSync(dir) !== dir) throw new Error("Недоступная папка истории");
  return dir;
}

async function history<T>(userId: number, request: Record<string, unknown>): Promise<T> {
  if (request.dir) request.dir = validateHistoryDirectory(userId, String(request.dir));
  if (request.id && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(request.id))) throw new Error("Некорректный номер диалога");
  const worker = workerFor(userId);
  const { stdout } = await exec(process.execPath, [fileURLToPath(new URL("./session-history-worker.js", import.meta.url)), JSON.stringify(request)], {
    uid: worker.uid,
    gid: worker.gid,
    cwd: worker.home,
    env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: worker.home, CLAUDE_CONFIG_DIR: `${worker.home}/.claude`, LANG: "C.UTF-8" },
    timeout: 15000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout) as T;
}

export const listUserSessions = (userId: number, dir: string) => history<SDKSessionInfo[]>(userId, { action: "list", dir });
export const userSessionMessages = (userId: number, id: string, dir: string) => history<SessionMessage[]>(userId, { action: "messages", id, dir });
export const renameUserSession = (userId: number, id: string, title: string, dir: string) => history<boolean>(userId, { action: "rename", id, title, dir });
export async function userSessionInfo(userId: number, id: string): Promise<SDKSessionInfo | null> {
  const dir = dialogRecord(userId, id) ? dialogPath(userId, id) : undefined;
  let info: SDKSessionInfo | null;
  try { info = await history<SDKSessionInfo | null>(userId, { action: "info", id, ...(dir ? { dir } : {}) }); }
  catch (e) {
    // A crash can occur between removing the folder and marking its record deleted.
    // Keep that record retryable so the remaining native files can still be purged.
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  if (!info?.cwd) return null;
  validateHistoryDirectory(userId, info.cwd);
  return info;
}

export async function listAllUserSessions(userId: number): Promise<SDKSessionInfo[]> {
  const rows = await history<SDKSessionInfo[]>(userId, { action: "listAll" });
  // A long first message can fill the SDK header buffer before a complete cwd
  // record. Resolve those sessions using the controller-owned folder registry.
  const resolved = await Promise.all(rows.map(async row => row.cwd ? row : await userSessionInfo(userId, row.sessionId) ?? row));
  return resolved.filter(row => {
    if (!row.cwd) return false;
    try { validateHistoryDirectory(userId, row.cwd); return true; } catch { return false; }
  });
}

export async function deleteUserSession(userId: number, id: string): Promise<void> {
  const info = await userSessionInfo(userId, id);
  if (!info?.cwd) throw new Error("Диалог недоступен. Открой /delete заново.");
  await history<boolean>(userId, { action: "delete", id, dir: info.cwd });
}
