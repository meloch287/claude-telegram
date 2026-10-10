import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, constants, openSync, fchownSync, closeSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import { prepareWorkspace, workerFor } from "./isolation.js";
export interface DialogRecord { id: string; project: string; title: string; started: boolean; deleted?: boolean; /** тред bb, из которого перенесён диалог */ origin?: string }
function file(uid: number) {
  if (!Number.isSafeInteger(uid) || uid <= 0) throw Error("Недоступный профиль");
  const root = join(config.dataDir, "claude-dialogs"); mkdirSync(root, { recursive: true, mode: 0o700 });
  return join(root, `${uid}.json`);
}
export function dialogRecords(uid: number): DialogRecord[] {
  const path = file(uid); return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
}
export function dialogRecord(uid: number, id: string): DialogRecord | undefined { return dialogRecords(uid).find(r => r.id === id && !r.deleted); }
export function updateDialog(uid: number, id: string, patch: Partial<Pick<DialogRecord, "started" | "title" | "deleted" | "origin">>): void {
  const rows = dialogRecords(uid), row = rows.find(r => r.id === id);
  if (!row) throw Error("Диалог не найден"); Object.assign(row, patch); save(uid, rows);
}
function save(uid: number, rows: DialogRecord[]) {
  const path = file(uid), temp = `${path}.${randomUUID()}`;
  writeFileSync(temp, JSON.stringify(rows), { mode: 0o600 }); renameSync(temp, path);
}
export function dialogPath(uid: number, id: string): string {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) throw Error("Некорректный диалог");
  return join(config.workspaceRoot, String(uid), `dialog-${id}`);
}
export function prepareDialog(uid: number, record: DialogRecord): string {
  const root = join(config.workspaceRoot, String(uid)), dir = dialogPath(uid, record.id);
  mkdirSync(dir, { recursive: true, mode: 0o700 }); prepareWorkspace(uid, root, dir);
  const worker = workerFor(uid);
  for (const name of [".cache", ".npm", ".tmp"]) {
    const path = join(dir, name);
    try { mkdirSync(path, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
    const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fchownSync(fd, worker.uid, worker.gid); } finally { closeSync(fd); }
  }
  return dir;
}
export function createDialog(uid: number, project: string): DialogRecord {
  const record = { id: randomUUID(), project, title: "Новый диалог", started: false };
  prepareDialog(uid, record); save(uid, [...dialogRecords(uid), record]); return record;
}
