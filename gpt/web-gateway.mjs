import { createServer, request } from "node:http";
import { readFileSync } from "node:fs";
import { WEB_COOKIE } from "./web-auth.mjs";
import { profileHtml } from "./web-profile.mjs";
import { serveRussianAsset, russianIndex, publicAppAsset } from "./web-assets.mjs";

export function loginTarget(params) {
  if (params.get("next") === "profile") return "/__web/profile";
  const engine = params.get("engine");
  if (!["gpt", "claude"].includes(engine)) return "/";
  const query = new URLSearchParams({ engine });
  const model = params.get("model");
  if (model && /^[a-zA-Z0-9._\[\]-]{1,100}$/.test(model)) query.set("model", model);
  const effort = params.get("effort");
  if (["low", "medium", "high", "xhigh", "max", "ultra"].includes(effort)) query.set("effort", effort);
  return "/?" + query.toString();
}

export const LOGIN_HTML = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="light dark"><title>Открыть bb</title><style>
:root{font:16px/1.5 system-ui,sans-serif;color:#e9e9ec;background:#111215;color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px}main{width:min(100%,380px)}small{color:#aaaeb8;letter-spacing:.04em}h1{font-size:28px;line-height:1.2;letter-spacing:-.035em;margin:12px 0}p{color:#aaaeb8;overflow-wrap:anywhere}button{font:inherit;border:0;border-radius:14px;min-height:48px;padding:12px 20px;background:#f0f0f3;color:#15161a;width:100%;cursor:pointer}button:focus-visible{outline:3px solid #8bafff;outline-offset:4px}button:disabled{opacity:.6;cursor:wait}@media(prefers-color-scheme:light){:root{background:#f5f5f7;color:#191a1d;color-scheme:light}p,small{color:#626570}button{background:#202126;color:white}}@media(prefers-reduced-motion:no-preference){main{animation:in .22s ease-out}@keyframes in{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}}</style><main><small>ЛИЧНОЕ ОКРУЖЕНИЕ</small><h1>Твой bb в браузере</h1><p id="status">Твои проекты, файлы, GPT и Claude — в личном пространстве.</p><button id="open">Открыть рабочую зону</button></main><script>
const next=(${loginTarget.toString()})(new URLSearchParams(location.search));const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);const button=document.getElementById('open'),status=document.getElementById('status');if(!token){button.hidden=true;status.textContent='Получить новую ссылку: /web в Telegram-боте.'}button.onclick=async()=>{button.disabled=true;status.textContent='Подключаем твоё окружение…';try{const r=await fetch('/__web/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})});if(!r.ok)throw Error('Ссылка истекла или уже использована. Получи новую через /web.');location.replace(next)}catch(e){status.textContent=e.message;button.disabled=false}};
</script></html>`;

function reply(res, code, error) {
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify({ error }));
}
export function publicWebError(error) {
  return /^(⛔|Лимит|Нет доступа|Окружение|Обновление|Не удалось|bb ещё)/.test(error.message || "")
    ? error.message.slice(0, 300)
    : "Не удалось подключить bb. Повтори /web через минуту.";
}
export function sameOrigin(req, origin, websocket = false) {
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  if (req.headers.origin && req.headers.origin !== origin) return false;
  return (!websocket && ["GET", "HEAD"].includes(req.method)) || req.headers.origin === origin;
}
// Код плагинов адресован хешем содержимого (bb: sha256 кода, стилей и метаданных), и сам bb
// помечает его immutable. Под no-store браузер заново качал ~1,8 МБ плагинов при каждом
// открытии приложения. Остальные ответы /api — личные данные, для них по-прежнему no-store.
const HASHED_PLUGIN_ASSET = /^\/api\/v1\/plugin-app-assets\/[a-f0-9]{16}\/app\.(?:js|css)$/;
export function proxiedCacheControl(pathname, method, status, upstream) {
  const cacheable = (method === "GET" || method === "HEAD") && status === 200 &&
    HASHED_PLUGIN_ASSET.test(pathname) && /\bimmutable\b/.test(String(upstream ?? ""));
  return cacheable ? "private, max-age=31536000, immutable" : "no-store";
}
export function proxyHeaders(req, target) {
  const headers = { ...req.headers, host: new URL(target).host, "accept-encoding": "identity" };
  for (const key of Object.keys(headers))
    if (
      ["cookie", "authorization", "forwarded"].includes(key) ||
      key.startsWith("x-forwarded") ||
      (key.startsWith("x-bb") && !(key === "x-bb-app-surface" && ["mobile", "desktop"].includes(headers[key]))) ||
      key.startsWith("x-telegram")
    )
      delete headers[key];
  return headers;
}
/**
 * Claude бота (агент ACP «acp-tgclaude») bb рисует безликим портфелем, как любой
 * сторонний агент. В ответе списка провайдеров даём ему логотип и цвет Claude —
 * в меню он выглядит как Claude, а не как отдельная непонятная вкладка.
 */
export const BRIDGE_LOGO_PATH = "/api/v1/system/providers/acp-tgclaude/logo";
const bridgeLogo = readFileSync(new URL("./claude-logo.svg", import.meta.url));
export function brandBridgeProviders(list) {
  if (!Array.isArray(list)) return list;
  return list.map((p) => {
    if (p?.id !== "acp-tgclaude") return p;
    const { icon, ...rest } = p;
    return {
      ...rest,
      logoUrl: `${BRIDGE_LOGO_PATH}?h=claude1`,
      strings: { ...(p.strings || {}), brandPrefix: "Claude ", iconTint: { light: "#D97757", dark: "#D97757" } },
      ...(Array.isArray(p.reasoningLevels) ? { reasoningLevels: p.reasoningLevels.filter((l) => l?.id !== "max" && l?.id !== "ultracode") } : {}),
    };
  });
}

/**
 * Режим разрешений для Claude бота. bb пускает к ACP-агенту только accept-edits и
 * full, а интерфейс шлёт режим, запомненный от «Claude Code» (например auto), —
 * и сообщение отклоняется. Для Claude бота этот режим ничего не значит (разрешения
 * ведёт бот), поэтому неподходящий заменяем на full.
 */
const BRIDGE_PERMISSIONS = new Set(["accept-edits", "full"]);
export const BRIDGE_TURN = /^\/api\/v1\/threads(?:\/fork|\/([^/]+)\/(?:send|retry|compact|edit-message))?$/;
export function fitBridgePermission(value) {
  let changed = false;
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (key === "permissionMode" && typeof child === "string" && !BRIDGE_PERMISSIONS.has(child)) { node[key] = "full"; changed = true; }
      else walk(child);
    }
  };
  walk(value);
  return changed;
}
export async function bridgeTurnBody(req, pathname, target) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024 * 1024) throw Object.assign(new Error("Слишком большой запрос"), { status: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks);
  let body;
  try { body = JSON.parse(raw.toString()); } catch { return raw; }
  let bridge = raw.includes('"acp-tgclaude"');
  const thread = BRIDGE_TURN.exec(pathname)?.[1];
  if (!bridge && thread) {
    const info = await fetch(`${target}/api/v1/threads/${encodeURIComponent(thread)}`, { signal: AbortSignal.timeout(5000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    bridge = info?.providerId === "acp-tgclaude";
  }
  return bridge && fitBridgePermission(body) ? Buffer.from(JSON.stringify(body)) : raw;
}

export function createWebGateway({ auth, runtime, allowed, usage, avatar=async()=>null, beforeMutation = async () => {} }) {
  const sockets = new Map();
  function track(uid, socket) {
    const group = sockets.get(uid) || new Set();
    group.add(socket);
    sockets.set(uid, group);
    socket.once("close", () => {
      group.delete(socket);
      if (!group.size) sockets.delete(uid);
    });
  }
  const server = createServer(async (req, res) => {
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("cache-control", "no-store");
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/__web/tls") {
        // Caddy asks over loopback before issuing a certificate. Only provisioned users.
        return reply(res, auth.hostUser(url.searchParams.get("domain")) ? 200 : 403, "");
      }
      const host = req.headers.host,
        hostUid = auth.hostUser(host);
      if (!hostUid) return reply(res, 403, "Нет доступа");
      if(publicAppAsset(url.pathname)&&await serveRussianAsset(req.url,req,res))return;
      const device = auth.device(url.pathname, host);
      if (url.pathname.startsWith("/__app/") && !device)
        return reply(res, 401, "Ссылка приложения отозвана или истекла. Создай новую через /web.");
      const requestPath = device ? (url.pathname.slice(device.prefix.length) || "/") + url.search : req.url;
      const routeUrl = new URL(requestPath, "http://localhost");
      if (routeUrl.pathname === "/__web/login" && req.method === "GET") {
        if (auth.authenticate(req.headers.cookie, host)) {
          res.writeHead(302, { location: loginTarget(url.searchParams) });
          return res.end();
        }
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "x-frame-options": "DENY",
        });
        return res.end(LOGIN_HTML);
      }
      const nativeRequest = device && !req.headers.origin && !req.headers["sec-fetch-site"];
      if (!nativeRequest && !sameOrigin(req, auth.origin(hostUid))) return reply(res, 403, "Недопустимый источник запроса");
      if (routeUrl.pathname === "/__web/session" && req.method === "POST") {
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 2048) return reply(res, 413, "Слишком большой запрос");
        }
        const session = auth.redeem(JSON.parse(body).token, host);
        if (!session) return reply(res, 401, "Получить новую ссылку: /web");
        res.setHeader(
          "set-cookie",
          `${WEB_COOKIE}=${session}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000`,
        );
        return reply(res, 200, null);
      }
      const uid = device?.uid ?? auth.authenticate(req.headers.cookie, host);
      if (!uid) {
        if (req.method === "GET" && (req.headers.accept || "").includes("text/html")) {
          res.writeHead(302, { location: "/__web/login" });
          return res.end();
        }
        return reply(res, 401, "Открой новую ссылку /web из бота");
      }
      if (device && (req.headers.accept || "").includes("text/html") && !auth.authenticate(req.headers.cookie, host)) {
        const token = auth.deviceSession(device);
        res.setHeader("set-cookie", `${WEB_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000`);
      }
      if (routeUrl.pathname === "/__web/logout" && req.method === "POST") {
        auth.logout(req.headers.cookie, host);
        res.setHeader(
          "set-cookie",
          `${WEB_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`,
        );
        return reply(res, 200, null);
      }
      if(routeUrl.pathname==='/__web/avatar'&&req.method==='GET'){
        const photo=await avatar(uid);if(!allowed(uid))return reply(res,403,'Нет доступа');
        res.writeHead(photo?200:204,{'content-type':photo?.type||'image/png','cache-control':'no-store'});res.end(photo?.bytes);return;
      }
      if (routeUrl.pathname === "/__web/profile" && req.method === "GET") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "x-frame-options": "DENY" });
        return res.end(profileHtml(uid, device?.prefix || ""));
      }
      if (routeUrl.pathname === "/__web/devices" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ uid, devices: auth.devices(uid) }));
      }
      if (routeUrl.pathname === "/__web/devices" && req.method === "POST") {
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 2048) return reply(res, 413, "Слишком длинное название");
        }
        const label = JSON.parse(body || "{}").label;
        if (label !== undefined && typeof label !== "string") return reply(res, 400, "Некорректное название");
        const created = auth.issueDevice(uid, label);
        res.writeHead(201, { "content-type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify(created));
      }
      if (/^\/__web\/devices\/[a-f0-9]{24}$/.test(routeUrl.pathname) && req.method === "DELETE") {
        if (!auth.revokeDevice(uid, routeUrl.pathname.split("/").at(-1))) return reply(res, 404, "Устройство не найдено");
        for (const socket of sockets.get(uid) || []) socket.destroy();
        return reply(res, 200, null);
      }
      if (routeUrl.pathname.startsWith("/__web/")) return reply(res, 404, "Не найдено");
      if ((req.method === "POST" && /^\/api\/v1\/hosts(?:\/join-codes)?\/?$/.test(routeUrl.pathname)) || /^\/api\/v1\/hosts\/[^/]+\/(?:enrollment-command|reconnect-commands)\/?$/.test(routeUrl.pathname))
        return reply(res, 403, "В этом приложении задачи выполняются только на нашем сервере. Подключение других компьютеров отключено.");
      if (/^\/api\/v1\/plugins\/connect\/(?:enable|rpc(?:\/|$))/.test(routeUrl.pathname))
        return reply(res, 403, "Доступ разрешён только через наш сервер и личный профиль.");
      if (!allowed(uid)) return reply(res, 403, "Нет доступа");
      if (await serveRussianAsset(requestPath, req, res)) return;
      const shell=["GET","HEAD"].includes(req.method)&&russianIndex(requestPath);
      if(shell){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'SAMEORIGIN','content-security-policy':"connect-src 'self'; form-action 'self'; base-uri 'self'"});res.end(req.method==='HEAD'?undefined:shell);return;}
      const target = await runtime.ensure(uid);
      if (!allowed(uid)) return reply(res, 403, "Нет доступа");
      if (usage && req.method === "POST" && routeUrl.pathname === "/api/v1/plugins/bb--provider-usage/rpc/getUsage") {
        let body = "";
        for await (const chunk of req) { body += chunk; if (body.length > 8192) return reply(res, 413, "Слишком большой запрос"); }
        let filter;
        try { filter = JSON.parse(body); } catch { return reply(res, 400, "Некорректный запрос"); }
        if (!filter || typeof filter !== "object" || (filter.machineIds != null && (!Array.isArray(filter.machineIds) || filter.machineIds.some(id => typeof id !== "string"))) || (filter.providerId != null && typeof filter.providerId !== "string")) return reply(res, 400, "Некорректный запрос");
        const result = await usage(uid, target, filter);
        if (!allowed(uid)) return reply(res, 403, "Нет доступа");
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        return res.end(JSON.stringify({ ok: true, result }));
      }
      if (["GET", "HEAD"].includes(req.method) && routeUrl.pathname === BRIDGE_LOGO_PATH) {
        res.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" });
        return res.end(req.method === "HEAD" ? undefined : bridgeLogo);
      }
      if (!["GET", "HEAD"].includes(req.method)) {
        const release = await beforeMutation(uid, req.method, new URL(requestPath, "http://localhost").pathname);
        if (release) res.once("close", release);
      }
      const body = req.method === "POST" && BRIDGE_TURN.test(routeUrl.pathname) && (req.headers["content-type"] || "").includes("json")
        ? await bridgeTurnBody(req, routeUrl.pathname, target).catch((error) => { reply(res, error.status || 400, error.message); return false; })
        : null;
      if (body === false) return;
      const forwardHeaders = proxyHeaders(req, target);
      if (body) { delete forwardHeaders["transfer-encoding"]; forwardHeaders["content-length"] = String(body.length); }
      const upstream = request(
        target + requestPath,
        { method: req.method, headers: forwardHeaders },
        (response) => {
          const headers = {
            ...response.headers,
            "cache-control": proxiedCacheControl(routeUrl.pathname, req.method, response.statusCode, response.headers["cache-control"]),
            "referrer-policy": "no-referrer",
            "x-frame-options": "SAMEORIGIN",
          };
          delete headers["set-cookie"];
          if (req.method === "GET" && routeUrl.pathname === "/api/v1/system/providers" && response.statusCode === 200 && (response.headers["content-type"] || "").includes("application/json")) {
            const chunks = [];
            let size = 0;
            response.on("data", (chunk) => { size += chunk.length; if (size > 2 * 1024 * 1024) { response.destroy(); res.destroy(); } else chunks.push(chunk); });
            response.on("end", () => {
              let body = Buffer.concat(chunks).toString();
              try { body = JSON.stringify(brandBridgeProviders(JSON.parse(body))); } catch { /* не JSON — отдаём как есть */ }
              delete headers["content-length"];
              delete headers["content-encoding"];
              delete headers.etag;
              res.writeHead(200, headers);
              res.end(body);
            });
            response.on("error", () => res.destroy());
            return;
          }
          if (device && routeUrl.pathname === "/api/v1/system/config" && response.statusCode === 200 && (response.headers["content-type"] || "").includes("application/json")) {
            const chunks = [];
            let size = 0;
            response.on("data", (chunk) => { size += chunk.length; if (size > 2 * 1024 * 1024) { response.destroy(); res.destroy(); } else chunks.push(chunk); });
            response.on("end", () => {
              try {
                const config = JSON.parse(Buffer.concat(chunks).toString());
                config.serverUrl = auth.origin(uid) + device.prefix;
                delete headers["content-length"];
                delete headers["content-encoding"];
                delete headers.etag;
                res.writeHead(200, headers);
                res.end(JSON.stringify(config));
              } catch { if (!res.headersSent) reply(res, 502, "Не удалось прочитать настройки bb"); else res.destroy(); }
            });
            response.on("error", () => res.destroy());
            return;
          }
          if ((response.headers["content-type"] || "").includes("text/html")) {
            headers["content-security-policy"] = "connect-src 'self'; form-action 'self'; base-uri 'self'";
            const index = russianIndex(requestPath);
            if (index) {
              response.resume();
              delete headers["content-encoding"];
              delete headers["content-length"];
              delete headers.etag;
              headers["content-security-policy"] = "connect-src 'self'; form-action 'self'; base-uri 'self'";
              res.writeHead(response.statusCode, headers);
              res.end(req.method === "HEAD" ? undefined : index);
              return;
            }
          }
          res.writeHead(response.statusCode, headers);
          response.pipe(res);
        },
      );
      track(uid, upstream);
      upstream.on("error", () => {
        if (!res.headersSent) reply(res, 502, "Переподключение к bb. Обнови страницу.");
        else res.destroy();
      });
      res.on("close", () => upstream.destroy());
      if (body) upstream.end(body);
      else req.pipe(upstream);
    } catch (error) {
      if (!res.headersSent) reply(res, 503, publicWebError(error));
      else res.destroy();
    }
  });
  server.on("upgrade", async (req, socket, head) => {
    socket.on("error", () => {});
    const url = new URL(req.url, "http://localhost");
    const device = auth.device(url.pathname, req.headers.host);
    if (url.pathname.startsWith("/__app/") && !device) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    const uid = device?.uid ?? auth.authenticate(req.headers.cookie, req.headers.host);
    const nativeRequest = device && !req.headers.origin && !req.headers["sec-fetch-site"];
    if (!uid || (!nativeRequest && !sameOrigin(req, auth.origin(uid), true))) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    track(uid, socket);
    try {
      const target = await runtime.ensure(uid);
      if (!allowed(uid) || socket.destroyed) return socket.destroy();
      const requestPath = device ? (url.pathname.slice(device.prefix.length) || "/") + url.search : req.url;
      const upstream = request(target + requestPath, { headers: proxyHeaders(req, target) });
      upstream.on("error", () => socket.destroy());
      upstream.on("response", () => socket.destroy());
      upstream.on("upgrade", (response, peer, extra) => {
        peer.on("error", () => socket.destroy());
        socket.on("close", () => peer.destroy());
        peer.on("close", () => socket.destroy());
        const headers = Object.entries(response.headers)
          .filter(([k]) => k !== "set-cookie")
          .map(([k, v]) => `${k}: ${v}`)
          .join("\r\n");
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headers}\r\n\r\n`);
        if (head.length) peer.write(head);
        if (extra.length) socket.write(extra);
        socket.pipe(peer).pipe(socket);
      });
      socket.on("close", () => upstream.destroy());
      upstream.end();
    } catch {
      socket.destroy();
    }
  });
  const timer = setInterval(() => {
    for (const [uid, group] of sockets)
      if (!allowed(uid)) for (const socket of group) socket.destroy();
  }, 5000);
  timer.unref();
  server.on("close", () => clearInterval(timer));
  return {
    server,
    closeUser(uid) {
      for (const socket of sockets.get(uid) || []) socket.destroy();
    },
  };
}
