/* global Response */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
const dir = mkdtempSync(join(tmpdir(), "gpt-quota-gateway-"));
Object.assign(process.env, {
  DATA_DIR: dir,
  BOT_TOKEN: "test",
  ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  ALLOWED_USER_IDS: "1057399602",
});
const legacy = await import("../dist/db.js"),
  store = await import("./store.mjs");
const gateway = await import("./inference-gateway.mjs");
test("gateway charges exact model/cache/task usage once; next request is blocked at personal quota", async () => {
  store.setUserPolicy(1057399602, 202, { allowed: true, tokenLimit: 10, weeklyLimit: 100 });
  let calls = 0;
  gateway.configureInference({
    allowed: () => true,
    budget: store.assertTokenBudget,
    charge: (uid, u, m) =>
      store.recordMeteredUsage(uid, u, m.model, m.eventKey, Date.now(), m.jobId),
    credentials: async () => ({ accessToken: "fixture", accountId: "fixture" }),
    fetch: async () => {
      calls++;
      const e = {
        type: "response.completed",
        response: {
          id: "same-retry-response",
          usage: {
            input_tokens: 100,
            input_tokens_details: { cached_tokens: 100 },
            output_tokens: 0,
          },
        },
      };
      return new Response("data: " + JSON.stringify(e) + "\n\ndata: " + JSON.stringify(e) + "\n\n");
    },
  });
  const server = gateway.startInferenceGateway(0, "127.0.0.1");
  await once(server, "listening");
  const ticket = gateway.issueInference(202, "gpt-6-sol", "medium", "fixture-job");
  const call = () =>
    fetch(`http://127.0.0.1:${server.address().port}/v1/responses`, {
      method: "POST",
      headers: { authorization: "Bearer " + ticket.token, "content-type": "application/json" },
      body: "{}",
    });
  try {
    const r = await call();
    assert.equal(r.status, 200);
    await r.text();
    assert.equal(store.quotaUsage(202).daily.used, 10);
    assert.equal(store.jobUnits(202, "fixture-job"), 10);
    assert.equal(store.tokensToday(202), 100);
    assert.equal(legacy.getUsageToday(202).tokens, 100);
    assert.equal((await call()).status, 429);
    assert.equal(calls, 1);
    store.setUserPolicy(1057399602, 202, { tokenLimit: 100 });
    await (await call()).text();
    assert.equal(store.quotaUsage(202).daily.used, 10);
    assert.equal(legacy.getUsageToday(202).tokens, 100);
  } finally {
    ticket.release();
    await new Promise((resolve) => server.close(resolve));
  }
});
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));

test("gateway awaits fresh async quota admission before any inference", async () => {
  let calls = 0;
  gateway.configureInference({
    allowed: () => true,
    budget: async () => {
      await new Promise((r) => setTimeout(r, 10));
      throw Error("недельный лимит");
    },
    fetch: async () => {
      calls++;
      return new Response("{}");
    },
  });
  const server = gateway.startInferenceGateway(0, "127.0.0.1");
  await once(server, "listening");
  const ticket = gateway.issueInference(202, "gpt-6-sol", "medium", "async-job");
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/responses`, {
      method: "POST",
      headers: { authorization: "Bearer " + ticket.token },
      body: "{}",
    });
    await response.text();
    assert.equal(response.status, 429);
    assert.equal(calls, 0);
  } finally {
    ticket.release();
    await new Promise((r) => server.close(r));
  }
});

test("only one request can pass admission at a time per task", async () => {
  let release,
    calls = 0;
  const gate = new Promise((r) => {
    release = r;
  });
  gateway.configureInference({
    allowed: () => true,
    budget: async () => {
      await gate;
    },
    charge: () => {},
    credentials: async () => ({ accessToken: "fixture", accountId: "fixture" }),
    fetch: async () => {
      calls++;
      return new Response("data: [DONE]\n\n");
    },
  });
  const server = gateway.startInferenceGateway(0, "127.0.0.1");
  await once(server, "listening");
  const ticket = gateway.issueInference(202, "gpt-6-sol", "medium", "serial-job");
  const call = () =>
    fetch(`http://127.0.0.1:${server.address().port}/v1/responses`, {
      method: "POST",
      headers: { authorization: "Bearer " + ticket.token },
      body: "{}",
    });
  try {
    const first = call();
    await new Promise((r) => setTimeout(r, 20));
    const second = await call();
    assert.equal(second.status, 429);
    await second.text();
    release();
    assert.equal((await first).status, 200);
    await (await first).text();
    assert.equal(calls, 1);
  } finally {
    release();
    ticket.release();
    await new Promise((r) => server.close(r));
  }
});
