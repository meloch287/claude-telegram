import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchJson } from "../src/miniapp/public/network.js";

test("a stalled response body ends with a useful timeout", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, { signal }) => ({
    ok: true,
    json: () =>
      new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
  });
  try {
    await assert.rejects(fetchJson("/stalled", {}, 15), /Сервер не ответил/);
  } finally {
    globalThis.fetch = original;
  }
});

test("authentication failure asks the user to reopen through Telegram", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 401 });
  try {
    await assert.rejects(fetchJson("/private"), /Открой мини-апп заново из бота/);
  } finally {
    globalThis.fetch = original;
  }
});
