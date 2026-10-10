import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {fileURLToPath} from "node:url";

export function isGitHubUpdate(text: string, callback?: string): boolean {
  return /^\/github(?:@\w+)?(?:\s|$)/i.test(text) || /^(?:github|гитхаб)$/i.test(text) || /^github:(?:key|check|author)$/.test(callback ?? "");
}

export async function syncClaudeGitHub(userId: number): Promise<void> {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw Error("Invalid user");
  try {
    await promisify(execFile)("python3", [fileURLToPath(new URL("../gpt/github-sync.py", import.meta.url)), String(userId)], {timeout: 15000, maxBuffer: 2048});
  } catch {
    throw Error("Не удалось подключить личный GitHub к Claude. Повтори /github.");
  }
}
