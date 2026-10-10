import { readFileSync, renameSync, writeFileSync, chmodSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { config } from "./config.js";

export type Engine = "claude" | "gpt";
const path = join(config.dataDir, "engine-modes.json");
const socketPath = process.env.GPT_DISPATCH_SOCKET || "/run/ai-bot/gpt.sock";
let choices: Record<string, Engine> = {};
try {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [id, engine] of Object.entries(value)) {
      if (engine === "claude" || engine === "gpt") choices[id] = engine;
    }
  }
} catch {
  // No choices exist on the first start.
}

export function engineFor(userId: number): Engine {
  return choices[String(userId)] ?? "claude";
}

export function setEngine(userId: number, engine: Engine): void {
  choices[String(userId)] = engine;
  const temp = path + ".tmp";
  writeFileSync(temp, JSON.stringify(choices) + "\n", { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, path);
}

function callBackend(method: "GET" | "POST", path: string, body?: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request({
      socketPath,
      path,
      method,
      headers: body ? { "Content-Type": "application/json", "Content-Length": body.length } : {},
      timeout: path.startsWith("/storage/") ? 210000 : 60_000,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const result = Buffer.concat(chunks).toString("utf8");
        if ((res.statusCode ?? 500) >= 300) reject(new Error(result || "GPT backend error"));
        else resolve(result);
      });
    });
    req.on("timeout", () => req.destroy(new Error("GPT backend timeout")));
    req.on("error", reject);
    req.end(body);
  });
}

export async function gptReady(): Promise<boolean> {
  try {
    return (await callBackend("GET", "/health")) === "ok";
  } catch {
    return false;
  }
}

export async function forwardToGpt(update: unknown): Promise<void> {
  await callBackend("POST", "/update", Buffer.from(JSON.stringify(update)));
}

/** Private UNIX socket; uid comes only from a verified Telegram identity. */
export async function libraryCall(uid: number, action: string, body: unknown = {}): Promise<any> {
  if (!Number.isSafeInteger(uid) || uid <= 0 || !/^[a-z-]+$/.test(action)) throw Error("Недопустимый запрос");
  return JSON.parse(await callBackend("POST", `/library/${uid}/${action}`, Buffer.from(JSON.stringify(body))));
}

export function gptApi(path: string, initData: string, method: "GET" | "POST" = "GET", body?: string): Promise<{ status: number; body: string }> {
  if (!path.startsWith("/api/gpt/")) throw Error("Недопустимый адрес API");
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, path, method, headers: {
      "x-telegram-init-data": initData,
      ...(body !== undefined ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}),
    }, timeout: 12000 }, res => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 2 * 1024 * 1024) req.destroy(Error("Слишком большой ответ")); else chunks.push(chunk); });
      res.on("end", () => resolve({ status: res.statusCode ?? 502, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(Error("GPT временно недоступен")));
    req.on("error", reject);
    req.end(body);
  });
}

export interface StorageReport { bytes: number; warning: boolean; blocked: boolean; checkedAt: number; categories: Record<string, number>; dialogs: Record<string, number> }
export async function gptStorage(uid: number, action: "scan" | "admit" | "cache" = "scan"): Promise<StorageReport> {
  if (!Number.isSafeInteger(uid) || uid <= 0) throw Error("Недоступный профиль");
  try { return JSON.parse(await callBackend("POST", `/storage/${uid}/${action}`)) as StorageReport; }
  catch (e) { throw new Error(e instanceof Error ? e.message : "Не удалось проверить место на диске. Открой /storage."); }
}
