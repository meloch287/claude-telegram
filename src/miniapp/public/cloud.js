/**
 * Облачная копия мира.
 *
 * Мир по-прежнему живёт в localStorage: он пишет туда снимки часто и
 * синхронно, и переделывать это под сеть незачем. Этот модуль лишь держит
 * копию всех ключей world:* на сервере: при открытии забирает её до того, как
 * мир создан, а дальше раз в 15 секунд и при сворачивании отправляет то, что
 * изменилось. Новый телефон или очищенный Telegram получают остров обратно.
 *
 * Кто прав при расхождении, решает серверная метка времени, а не часы
 * телефонов: у каждого ключа запомнена метка последней общей версии. Сервер
 * её не сменил — значит, менялись только мы, и отправляем своё. Сменил —
 * остров правили на другом устройстве, и берём серверный.
 */

export const CLOUD_PREFIX = "world:";
const STAMPS_KEY = "cloud:stamps";
const SYNC_EVERY_MS = 15_000;
// fetch с keepalive переживает закрытие страницы, но только до 64 КБ на всех.
const KEEPALIVE_LIMIT = 60_000;

/** Когда снимок сохранён по часам устройства; 0 — не снимок мира или без метки. */
function savedAt(raw) {
  try {
    const value = JSON.parse(raw);
    return typeof value?.savedAt === "number" ? value.savedAt : 0;
  } catch {
    return 0;
  }
}

/**
 * Что делать с каждым ключом после загрузки копии с сервера. Чистая функция:
 * local — { ключ: строка } из localStorage, remote — [{ key, data, updatedAt }],
 * stamps — { ключ: метка последней общей версии }.
 *
 * take — записать серверное к себе, drop — стереть у себя (стёрли на другом
 * устройстве), upload — отправить своё, synced — новые общие метки.
 */
export function planMerge(local, remote, stamps) {
  const take = [];
  const drop = [];
  const upload = [];
  const synced = {};
  const onServer = new Set();
  for (const item of remote) {
    onServer.add(item.key);
    const mine = local[item.key];
    if (mine === undefined || mine === item.data) {
      if (mine === undefined) take.push(item);
      synced[item.key] = item.updatedAt;
    } else if (stamps[item.key] === item.updatedAt) {
      upload.push(item.key);
    } else if (stamps[item.key] === undefined && savedAt(mine) > savedAt(item.data)) {
      // Оба острова ещё ни разу не сверялись (первое открытие после появления
      // копии на двух устройствах сразу) — оставляем тот, что сохранён позже.
      upload.push(item.key);
    } else {
      take.push(item);
      synced[item.key] = item.updatedAt;
    }
  }
  // Пустой ответ при известных метках — скорее потерянная база, чем стёртый
  // везде остров. Стирать у себя по такому ответу нельзя: отправляем своё.
  const serverLost = remote.length === 0;
  for (const key of Object.keys(local)) {
    if (onServer.has(key)) continue;
    if (stamps[key] !== undefined && !serverLost) drop.push(key);
    else upload.push(key);
  }
  return { take, drop, upload, synced };
}

const NOOP = {
  enabled: false,
  pull: async () => false,
  start() {},
  flush: async () => {},
};

/**
 * initData нет (демо, обычный браузер) — копия выключена: серверу не
 * доказать, чей это остров.
 */
export function createCloud(initData, storage = window.localStorage) {
  if (!initData) return NOOP;
  const headers = { "X-Telegram-Init-Data": initData };
  let stamps = {};
  try {
    stamps = JSON.parse(storage.getItem(STAMPS_KEY) || "{}") || {};
  } catch {
    stamps = {};
  }
  // Что лежит на сервере по каждому ключу — отправлять только отличия.
  const sent = new Map();
  let pulled = false;
  let queue = Promise.resolve();

  const saveStamps = () => {
    try {
      storage.setItem(STAMPS_KEY, JSON.stringify(stamps));
    } catch {
      /* переполнен — метки восстановятся при следующей сверке */
    }
  };

  function localSnapshot() {
    const out = {};
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key?.startsWith(CLOUD_PREFIX)) out[key] = storage.getItem(key);
    }
    return out;
  }

  async function pull(timeoutMs = 3000) {
    const abort = new window.AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const response = await fetch("/api/world-save", { headers, signal: abort.signal });
      if (!response.ok) return false;
      const { items } = await response.json();
      const plan = planMerge(localSnapshot(), items, stamps);
      for (const item of plan.take) storage.setItem(item.key, item.data);
      for (const key of plan.drop) {
        storage.removeItem(key);
        delete stamps[key];
      }
      Object.assign(stamps, plan.synced);
      sent.clear();
      for (const item of items) if (!plan.drop.includes(item.key)) sent.set(item.key, item.data);
      saveStamps();
      pulled = true;
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async function push(keepalive) {
    // Не сверились — не знаем, что на сервере, и своё поверх не кладём:
    // так остров с другого устройства не затрётся старым снимком.
    if (!pulled && !(await pull())) return;
    const local = localSnapshot();
    for (const [key, data] of Object.entries(local)) {
      if (sent.get(key) === data) continue;
      const body = JSON.stringify({ key, data });
      const response = await fetch("/api/world-save", {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body,
        keepalive: keepalive && body.length < KEEPALIVE_LIMIT,
      });
      if (!response.ok) continue;
      const { updatedAt } = await response.json();
      sent.set(key, data);
      stamps[key] = updatedAt;
    }
    // Пропали сразу все ключи — это очищенное хранилище, а не стёртый остров:
    // «вырастить заново» убирает только сам снимок. Копию на сервере не трогаем,
    // при следующем открытии она вернётся.
    const wiped = Object.keys(local).length === 0;
    for (const key of wiped ? [] : [...sent.keys()]) {
      if (key in local) continue;
      const response = await fetch(`/api/world-save?key=${encodeURIComponent(key)}`, {
        method: "DELETE",
        headers,
        keepalive,
      });
      if (!response.ok) continue;
      sent.delete(key);
      delete stamps[key];
    }
    saveStamps();
  }

  // По одной отправке за раз: таймер и сворачивание могли бы слать одно и то
  // же параллельно и спорить, чья метка последняя.
  const sync = (keepalive = false) => {
    queue = queue.then(() => push(keepalive)).catch(() => undefined);
    return queue;
  };

  return {
    enabled: true,
    pull,
    start() {
      window.setInterval(() => void sync(), SYNC_EVERY_MS);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") void sync(true);
      });
      window.addEventListener("pagehide", () => void sync(true));
    },
    /** Отправить сейчас и дождаться, но не дольше timeoutMs: перед перезагрузкой. */
    flush(timeoutMs = 3000) {
      return Promise.race([sync(), new Promise((r) => setTimeout(r, timeoutMs))]);
    },
  };
}
