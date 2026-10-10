let teamHandler;
export function configureTeam(handler){teamHandler=handler;}
let claudeBridge;
export function configureClaudeBridge(handler){claudeBridge=handler;}
/* global AbortController */
// Only inference crosses this private interface. Account credentials never enter a guest container.
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { StringDecoder } from "node:string_decoder";
import { ownerCredentials } from "./owner-auth.mjs";
import { modelId, userId } from "./policy.mjs";
import { effortId } from "./reasoning.mjs";
const tickets = new Map();
let hooks = {
  allowed: () => false,
  budget: () => {},
  charge: () => {},
  webBegin: async () => {
    throw Error("Web inference is disabled");
  },
  webFinish: async () => {},
  credentials: ownerCredentials,
  fetch: (...args) => fetch(...args),
};
export function configureInference(patch) {
  hooks = { ...hooks, ...patch };
}
export function issueInference(uid, model, effort, jobId = null, webToken = null) {
  userId(uid);
  modelId(model);
  effortId(effort, model);
  if (webToken !== null && !/^[a-f0-9]{64}$/.test(webToken)) throw Error("Invalid web ticket");
  const token = webToken || randomBytes(32).toString("hex");
  tickets.set(token, {
    uid,
    jobId,
    model,
    effort,
    expires: webToken ? Number.MAX_SAFE_INTEGER : Date.now() + 12 * 3600000,
    web: !!webToken,
    id: randomUUID(),
    active: 0,
    aborts: new Set(),
  });
  return {
    token,
    release: () => {
      for (const abort of tickets.get(token)?.aborts || []) abort.abort();
      tickets.delete(token);
    },
  };
}
export function revokeInference(uid) {
  for (const [token, ticket] of tickets)
    if (ticket.uid === uid) {
      for (const abort of ticket.aborts) abort.abort();
      tickets.delete(token);
    }
}
function json(res, status, message) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { message, type: "access_error" } }));
}
function containsRemoteReference(value) {
  if (!value || typeof value !== "object") return false;
  for (const [key, item] of Object.entries(value)) {
    if (
      ["previous_response_id", "conversation", "file_id", "vector_store_ids"].includes(key) &&
      item
    )
      return true;
    if (containsRemoteReference(item)) return true;
  }
  return false;
}
export function inferenceHandler() {
  return async (req, res) => {
    if(req.url==="/team"&&teamHandler)return teamHandler(req,res);
    if(req.url?.startsWith("/claude-bb/")&&claudeBridge)return claudeBridge(req,res);
    const bearer = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1],
      ticket = tickets.get(bearer);
    if (!ticket || ticket.expires < Date.now() || !hooks.allowed(ticket.uid))
      return json(res, 401, "Доступ к модели закрыт");
    if (req.method !== "POST" || !["/v1/responses", "/v1/responses/compact"].includes(req.url))
      return json(res, 404, "Endpoint unavailable");
    // Telegram has one ticket per task. bb has one scoped credential per user,
    // so distinct threads/tool continuations must not lock one another out.
    if (!ticket.web && ticket.active >= 1)
      return json(res, 429, "Предыдущий запрос ещё выполняется");
    const abort = new AbortController();
    const jobId = ticket.web ? `web:${randomUUID()}` : ticket.jobId;
    let webStarted = false,
      requestModel = ticket.model;
    ticket.active++;
    ticket.aborts.add(abort);
    res.on("close", () => {
      if (!res.writableFinished) abort.abort();
    });
    try {
      try {
        if (ticket.web) {
          await hooks.webBegin(ticket.uid, jobId);
          webStarted = true;
        }
        await hooks.budget(ticket.uid, jobId);
      } catch (error) {
        return json(res, 429, error.message);
      }
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 32 * 1024 * 1024) throw Error("Слишком большой запрос");
        chunks.push(chunk);
      }
      if (!tickets.has(bearer) || !hooks.allowed(ticket.uid))
        return json(res, 401, "Доступ закрыт");
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (containsRemoteReference(body))
        return json(res, 400, "Разрешён только контекст своего локального диалога");
      body.model = ticket.web ? modelId(body.model || ticket.model) : ticket.model;
      requestModel = body.model;
      // Quota rates are Standard; tenant requests cannot turn on paid speed tiers.
      delete body.service_tier;
      const isStream = req.url === "/v1/responses";
      if (isStream) {
        body.reasoning = {
          ...body.reasoning,
          effort: ticket.web
            ? effortId(body.reasoning?.effort || ticket.effort, body.model)
            : ticket.effort,
        };
        body.store = false;
        body.prompt_cache_key = ticket.id;
        body.stream = true;
      }
      if (
        body.tools?.some(
          (tool) =>
            !["function", "custom", "namespace", "web_search", "web_search_preview", "image_generation"].includes(
              tool.type,
            ),
        )
      )
        return json(res, 400, "Этот серверный инструмент недоступен в общем аккаунте");
      const payload = JSON.stringify(body);
      const upstream = async (force = false) => {
        const auth = await hooks.credentials(force);
        return hooks.fetch("https://chatgpt.com/backend-api/codex" + req.url.slice(3), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer " + auth.accessToken,
            "chatgpt-account-id": auth.accountId,
            originator: "codex_cli_rs",
            "user-agent": "codex_cli_rs/0.159.3",
            session_id: ticket.id,
          },
          body: payload,
          signal: abort.signal,
        });
      };
      let response = await upstream();
      if (response.status === 401) {
        await response.body?.cancel();
        response = await upstream(true);
      }
      if (!response.ok) {
        await response.body?.cancel();
        return json(
          res,
          response.status === 429 ? 429 : 502,
          response.status === 429
            ? "Лимит подписки владельца. Повтори позже."
            : "Не удалось выполнить запрос через аккаунт владельца",
        );
      }
      res.writeHead(200, {
        "content-type": isStream ? "text/event-stream" : "application/json",
        "cache-control": "no-store",
      });
      const decoder = new StringDecoder("utf8");
      let pending = "";
      const seen = new Set();
      const requestId = randomUUID();
      function usage(event) {
        const result = event.response || event;
        if (!result.usage) return;
        const id = result.id || "compact";
        if (seen.has(id)) return;
        seen.add(id);
        hooks.charge(
          ticket.uid,
          {
            input_tokens: result.usage.input_tokens || 0,
            output_tokens: result.usage.output_tokens || 0,
            cached_input_tokens: result.usage.input_tokens_details?.cached_tokens || 0,
          },
          {
            model: requestModel,
            jobId,
            eventKey: "response:" + (result.id || requestId),
          },
        );
      }
      const sse = isStream;
      function lineUsage(line) {
        if (!line.startsWith("data:") || line.slice(5).trim() === "[DONE]") return;
        let value;
        try {
          value = JSON.parse(line.slice(5).trim());
        } catch {
          return;
        }
        if (["response.completed", "response.incomplete"].includes(value.type)) usage(value);
      }
      const meter = new Transform({
        transform(chunk, encoding, callback) {
          try {
            pending += decoder.write(chunk);
            if (pending.length > 32 * 1024 * 1024)
              return callback(Error("Oversized inference event"));
            if (sse) {
              let split;
              while ((split = pending.indexOf("\n")) >= 0) {
                const line = pending.slice(0, split).trim();
                pending = pending.slice(split + 1);
                lineUsage(line);
              }
            }
            callback(null, chunk);
          } catch (error) {
            callback(error);
          }
        },
        flush(callback) {
          try {
            pending += decoder.end();
            if (sse) lineUsage(pending.trim());
            else usage(JSON.parse(pending));
            callback();
          } catch (error) {
            callback(error);
          }
        },
      });
      await pipeline(Readable.fromWeb(response.body), meter, res);
    } catch (error) {
      if (!res.headersSent)
        json(
          res,
          502,
          error.message.startsWith("Лимит") ? error.message : "Запрос не выполнен. Повтори позже.",
        );
      else res.destroy();
    } finally {
      if (webStarted)
        await hooks
          .webFinish(jobId)
          .catch((error) => console.warn("Web quota settlement pending:", error.message));
      ticket.active--;
      ticket.aborts.delete(abort);
    }
  };
}
export function startInferenceGateway(port = 8790, host = "172.30.0.1") {
  const server = createServer(inferenceHandler());
  server.requestTimeout = 120000;
  server.listen(port, host);
  return server;
}
