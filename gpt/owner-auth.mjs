import { readFile, realpath, writeFile, rename, stat, chown } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
export const OWNER_ID = 1057399602;
export function sharedAccountEnabled() {
  return process.env.SHARED_OWNER_ACCOUNT === "true";
}
const authPath = () =>
  join(
    process.env.TENANT_ROOT || "/opt/ai-bot/tenants",
    String(OWNER_ID),
    "home",
    ".codex",
    "auth.json",
  );
async function readAuth() {
  const file = authPath();
  if ((await realpath(file)) !== file) throw Error("Unsafe account path");
  return JSON.parse(await readFile(file, "utf8"));
}
export async function ownerConnected() {
  try {
    return !!(await readAuth()).tokens?.access_token;
  } catch {
    return false;
  }
}
let refreshTask;
export async function ownerCredentials(force = false) {
  let auth = await readAuth();
  const token = auth.tokens?.access_token;
  if (!token) throw Error("Владелец должен подключить ChatGPT");
  const decode = (value) => {
    try {
      return JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString());
    } catch {
      return {};
    }
  };
  if (force || (decode(token).exp || 0) * 1000 < Date.now() + 60000) {
    if (!refreshTask)
      refreshTask = (async () => {
        const current = await readAuth();
        if (force && current.tokens.access_token !== token) return current;
        const aud = decode(current.tokens.id_token || "").aud;
        const clientId = Array.isArray(aud) ? aud[0] : aud;
        if (
          typeof clientId !== "string" ||
          !clientId.startsWith("app_") ||
          !current.tokens.refresh_token
        )
          throw Error("Владельцу нужно повторно подключить ChatGPT");
        const response = await fetch("https://auth.openai.com/oauth/token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            grant_type: "refresh_token",
            client_id: clientId,
            refresh_token: current.tokens.refresh_token,
          }),
          signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) throw Error("Подключение владельца истекло. Нужен повторный вход");
        const next = await response.json();
        if (!next.access_token) throw Error("Не удалось обновить подключение владельца");
        for (const k of ["access_token", "refresh_token", "id_token"])
          if (next[k]) current.tokens[k] = next[k];
        current.last_refresh = new Date().toISOString();
        const file = authPath(),
          tmp = file + "." + randomUUID(),
          meta = await stat(file);
        await writeFile(tmp, JSON.stringify(current), { mode: 0o600 });
        await chown(tmp, meta.uid, meta.gid);
        await rename(tmp, file);
        return current;
      })().finally(() => {
        refreshTask = null;
      });
    auth = await refreshTask;
  }
  return { accessToken: auth.tokens.access_token, accountId: auth.tokens.account_id };
}
