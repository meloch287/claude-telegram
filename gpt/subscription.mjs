import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { OWNER_ID } from "./owner-auth.mjs";
const windowValue = (v) => {
  if (!v || !Number.isFinite(v.usedPercent) || v.usedPercent < 0) return null;
  return {
    usedPercent: v.usedPercent,
    remainingPercent: Math.max(0, 100 - v.usedPercent),
    windowDurationMins: Number.isFinite(v.windowDurationMins) ? v.windowDurationMins : null,
    resetsAt: Number.isFinite(v.resetsAt) ? v.resetsAt * 1000 : null,
  };
};
export function sanitizeLimits(value) {
  const buckets = { ...(value.rateLimitsByLimitId || {}) };
  if (value.rateLimits) buckets[value.rateLimits.limitId || "codex"] = value.rateLimits;
  return {
    ordinaryUsageAllowed:
      typeof value.ordinaryUsageAllowed === "boolean" ? value.ordinaryUsageAllowed : null,
    buckets: Object.entries(buckets).map(([id, v]) => ({
      id,
      name: v.limitName || id,
      plan: v.planType || null,
      primary: windowValue(v.primary),
      secondary: windowValue(v.secondary),
      reached: v.rateLimitReachedType || null,
      credits: v.credits
        ? {
            hasCredits: v.credits.hasCredits === true,
            unlimited: v.credits.unlimited === true,
            balance:
              typeof v.credits.balance === "string" && /^\d+(\.\d+)?$/.test(v.credits.balance)
                ? v.credits.balance
                : null,
          }
        : null,
    })),
  };
}
// Read-only documented app-server method. No threads, inference, emails or credit purchases.
export function readAccountLimits() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "docker",
      ["exec", "-i", `ai-user-${OWNER_ID}`, "codex", "app-server", "--listen", "stdio://"],
      { stdio: ["pipe", "pipe", "ignore"] },
    );
    let settled = false;
    const lines = createInterface({ input: child.stdout });
    const timeout = setTimeout(() => finish(new Error("Не удалось обновить лимиты OpenAI")), 15000);
    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      lines.close();
      child.stdin.end();
      const kill = setTimeout(() => child.kill("SIGTERM"), 1500);
      kill.unref();
      child.once("exit", () => clearTimeout(kill));
      if (error) reject(error);
      else {
        try {
          resolve(sanitizeLimits(result));
        } catch {
          reject(new Error("Некорректный ответ сервиса лимитов"));
        }
      }
    }
    function send(body) {
      child.stdin.write(JSON.stringify(body) + "\n");
    }
    child.once("error", () => finish(new Error("Сервис лимитов недоступен")));
    child.stdin.on("error", () => finish(new Error("Соединение с Codex закрыто")));
    child.once("exit", () => finish(new Error("Сервис лимитов завершился")));
    lines.on("line", (line) => {
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        return;
      }
      if (m.id === 1) {
        if (m.error) return finish(new Error("Codex не готов"));
        send({ method: "initialized" });
        send({ id: 2, method: "account/rateLimits/read" });
      }
      if (m.id === 2)
        finish(
          m.error ? new Error("OpenAI не вернул лимиты. Проверь подключение аккаунта.") : null,
          m.result,
        );
    });
    send({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "gpt_bot_limits", version: "1.0.0" },
        capabilities: { experimentalApi: true },
      },
    });
  });
}
export function createSubscriptionMonitor(read = readAccountLimits, now = Date.now) {
  let snapshot = null,
    inFlight = null,
    attempted = 0,
    error = null;
  return {
    async get({ force = false } = {}) {
      if (inFlight) {
        if (!force) return inFlight;
        await inFlight;
        return this.get({ force: true });
      }
      if (!force && attempted && now() - attempted < 60000) return view();
      attempted = now();
      inFlight = Promise.resolve()
        .then(read)
        .then((result) => {
          snapshot = { ...result, fetchedAt: now() };
          error = null;
        })
        .catch(() => {
          error = "Не удалось обновить данные OpenAI";
        })
        .finally(() => {
          inFlight = null;
        })
        .then(view);
      return inFlight;
    },
  };
  function view() {
    return {
      ...(snapshot || { buckets: [], fetchedAt: null }),
      source: "OpenAI · Codex",
      stale: !snapshot || !!error || now() - snapshot.fetchedAt > 120000,
      error,
    };
  }
}
export const subscriptionMonitor = createSubscriptionMonitor();
