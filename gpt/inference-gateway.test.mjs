/* global Response */
import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import {
  configureInference,
  issueInference,
  revokeInference,
  startInferenceGateway,
} from "./inference-gateway.mjs";
test("inference tickets scope requests, hide owner credentials, meter usage and revoke access", async () => {
  let allowed = true;
  const charges = [],
    upstream = [];
  configureInference({
    allowed: (uid) => allowed && uid === 202,
    budget: () => {},
    credentials: async () => ({
      accessToken: "OWNER_SECRET_NEVER_IN_WORKER",
      accountId: "owner-account",
    }),
    charge: (uid, u, meta) => {
      charges.push({ uid, ...u });
      assert.equal(meta.model, "gpt-6-luna");
      assert.equal(meta.eventKey, "response:one");
    },
    fetch: async (url, options) => {
      upstream.push({ url, ...options });
      return new Response(
        "data:" +
          JSON.stringify({
            type: "response.completed",
            response: {
              id: "one",
              usage: {
                input_tokens: 12,
                output_tokens: 3,
                input_tokens_details: { cached_tokens: 2 },
              },
            },
          }) +
          "\n\ndata: [DONE]\n\n",
        { headers: {} },
      );
    },
  });
  const server = startInferenceGateway(0, "127.0.0.1");
  await once(server, "listening");
  const url = "http://127.0.0.1:" + server.address().port;
  const ticket = issueInference(202, "gpt-6-luna", "high");
  const call = (path, body = {}, token = ticket.token) =>
    fetch(url + path, {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    assert.equal((await call("/v1/responses", {}, "bad")).status, 401);
    assert.equal((await call("/v1/files")).status, 404);
    assert.equal((await call("/v1/responses", { previous_response_id: "foreign" })).status, 400);
    assert.equal((await call("/v1/responses", { input: [{ file_id: "foreign" }] })).status, 400);
    const r = await call("/v1/responses", {
      model: "gpt-6-astra",
      service_tier: "priority",
      reasoning: { effort: "ultra" },
      input: "hi",
    });
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(upstream[0].body).service_tier, undefined);
    assert.ok(!(await r.text()).includes("OWNER_SECRET"));
    assert.equal(upstream[0].url, "https://chatgpt.com/backend-api/codex/responses");
    assert.equal(upstream[0].headers.authorization, "Bearer OWNER_SECRET_NEVER_IN_WORKER");
    assert.equal(JSON.parse(upstream[0].body).model, "gpt-6-luna");
    assert.equal(JSON.parse(upstream[0].body).reasoning.effort, "high");
    assert.deepEqual(charges, [
      { uid: 202, input_tokens: 12, output_tokens: 3, cached_input_tokens: 2 },
    ]);
    allowed = false;
    assert.equal((await call("/v1/responses")).status, 401);
    allowed = true;
    revokeInference(202);
    assert.equal((await call("/v1/responses")).status, 401);
    const next = issueInference(202, "gpt-6-sol", "low");
    next.release();
    assert.equal((await call("/v1/responses", {}, next.token)).status, 401);
  } finally {
    ticket.release();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("revoking access cancels an in-flight request at the provider", async () => {
  let began;
  const started = new Promise((resolve) => {
    began = resolve;
  });
  let aborted = false;
  configureInference({
    allowed: () => true,
    budget: () => {},
    credentials: async () => ({ accessToken: "secret", accountId: "owner" }),
    fetch: async (_url, options) => {
      began();
      return new Promise((_resolve, reject) =>
        options.signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(Error("aborted"));
          },
          { once: true },
        ),
      );
    },
  });
  const server = startInferenceGateway(0, "127.0.0.1");
  await once(server, "listening");
  const ticket = issueInference(202, "gpt-6-sol", "low");
  const call = () =>
    fetch(`http://127.0.0.1:${server.address().port}/v1/responses`, {
      method: "POST",
      headers: { authorization: "Bearer " + ticket.token, "content-type": "application/json" },
      body: "{}",
    });
  try {
    const pending = call();
    await started;
    revokeInference(202);
    const result = await pending;
    await result.text();
    assert.equal(aborted, true);
    assert.equal((await call()).status, 401);
    const capped = issueInference(202, "gpt-6-sol", "low");
    configureInference({
      budget: () => {
        throw Error("Лимит токенов");
      },
    });
    const r = await fetch(`http://127.0.0.1:${server.address().port}/v1/responses`, {
      method: "POST",
      headers: { authorization: "Bearer " + capped.token, "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(r.status, 429);
    capped.release();
  } finally {
    ticket.release();
    await new Promise((resolve) => server.close(resolve));
  }
});
