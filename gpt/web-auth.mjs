import { randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { userId } from "./policy.mjs";

const hash = (token) => createHash("sha256").update(token).digest("hex");
const secret = () => randomBytes(32).toString("hex");
export const WEB_COOKIE = "__Host-gpt_bb";
export function createWebAuth({ file, domain, allowed, now = Date.now }) {
  if (!/^[a-z0-9.-]+$/.test(domain)) throw Error("Invalid web domain");
  let state = { users: {}, links: {}, sessions: {}, devices: {} };
  if (file) {
    try {
      state = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  state.devices ||= {};
  function save() {
    for (const list of [state.links, state.sessions, state.devices])
      for (const [key, entry] of Object.entries(list)) if (entry.expires <= now()) delete list[key];
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file + ".next", JSON.stringify(state), { mode: 0o600 });
    renameSync(file + ".next", file);
  }
  const origin = (uid) => `https://u${userId(uid)}.${domain}`;
  function ensure(uid) {
    userId(uid);
    if (!allowed(uid)) throw Error("Нет доступа");
    if (!state.users[uid]) {
      state.users[uid] = { token: secret() };
      save();
    }
    return state.users[uid];
  }
  function hostUser(host) {
    const uid = Number(/^u([1-9][0-9]*)\./.exec(host || "")?.[1]);
    return Number.isSafeInteger(uid) &&
      uid > 0 &&
      host === new URL(origin(uid)).host &&
      state.users[uid] &&
      allowed(uid)
      ? uid
      : null;
  }
  function sessionEntry(cookie, host) {
    const token = (cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(WEB_COOKIE + "="))
      ?.slice(WEB_COOKIE.length + 1);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const entry = state.sessions[hash(token)];
    if (!entry || entry.expires <= now() || hostUser(host) !== entry.uid) return null;
    if (entry.deviceKey) {
      const device = state.devices[entry.deviceKey];
      if (!device || device.uid !== entry.uid || device.expires <= now()) return null;
    }
    return entry;
  }
  return {
    origin,
    hostUser,
    ensure,
    users: () =>
      Object.entries(state.users)
        .filter(([uid]) => allowed(Number(uid)))
        .map(([uid, data]) => ({ uid: Number(uid), ...data })),
    issue(uid) {
      ensure(uid);
      // A fresh command replaces unused login links, but keeps existing browser sessions.
      for (const [key, entry] of Object.entries(state.links))
        if (entry.uid === uid) delete state.links[key];
      const token = secret();
      state.links[hash(token)] = { uid, expires: now() + 10 * 60_000 };
      save();
      return origin(uid) + "/__web/login#" + token;
    },
    redeem(token, host) {
      if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return null;
      const key = hash(token),
        link = state.links[key];
      if (!link || link.expires <= now() || hostUser(host) !== link.uid) return null;
      delete state.links[key];
      const session = secret();
      state.sessions[hash(session)] = { uid: link.uid, expires: now() + 30 * 86400_000 };
      save();
      return session;
    },
    authenticate(cookie, host) {
      return sessionEntry(cookie, host)?.uid ?? null;
    },
    logout(cookie, host) {
      if (!sessionEntry(cookie, host)) return;
      const token = cookie.split(";").map((s) => s.trim())
        .find((s) => s.startsWith(WEB_COOKIE + "=")).slice(WEB_COOKIE.length + 1);
      delete state.sessions[hash(token)];
      save();
    },
    issueDevice(uid, label = "Приложение bb") {
      ensure(uid);
      const active = Object.values(state.devices).filter((d) => d.uid === uid && d.expires > now());
      if (active.length >= 12) throw Error("Сначала отключи одно из устройств в своём профиле.");
      const token = secret();
      const device = {
        id: randomBytes(12).toString("hex"), uid,
        label: String(label).trim().slice(0, 60) || "Приложение bb",
        createdAt: now(), expires: now() + 365 * 86400_000,
      };
      state.devices[hash(token)] = device;
      save();
      return { ...device, url: origin(uid) + "/__app/" + token };
    },
    devices(uid) {
      if (!allowed(uid)) return [];
      return Object.values(state.devices)
        .filter((d) => d.uid === uid && d.expires > now())
        .map(({ id, label, createdAt, expires }) => ({ id, label, createdAt, expires }));
    },
    device(path, host) {
      const match = /^\/__app\/([a-f0-9]{64})(?=\/|$)/.exec(path);
      if (!match) return null;
      const key = hash(match[1]), entry = state.devices[key];
      if (!entry || entry.expires <= now() || hostUser(host) !== entry.uid) return null;
      return { uid: entry.uid, id: entry.id, key, prefix: match[0] };
    },
    deviceSession(device) {
      const entry = state.devices[device.key];
      if (!entry || entry.uid !== device.uid || !allowed(entry.uid) || entry.expires <= now()) return null;
      const token = secret();
      state.sessions[hash(token)] = {
        uid: entry.uid, deviceKey: device.key,
        expires: Math.min(entry.expires, now() + 30 * 86400_000),
      };
      save();
      return token;
    },
    revokeDevice(uid, id) {
      const found = Object.entries(state.devices).find(([, d]) => d.uid === uid && d.id === id);
      if (!found) return false;
      delete state.devices[found[0]];
      for (const [key, entry] of Object.entries(state.sessions))
        if (entry.deviceKey === found[0]) delete state.sessions[key];
      save();
      return true;
    },
    revoke(uid) {
      delete state.users[uid];
      for (const list of [state.links, state.sessions, state.devices])
        for (const [key, entry] of Object.entries(list)) if (entry.uid === uid) delete list[key];
      save();
    },
  };
}
