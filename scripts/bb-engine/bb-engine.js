// Переключатель движка Claude | GPT над списком диалогов bb.
//
// Что делает:
// - список диалогов показывает только выбранный движок (ветки-потомки идут за корнем);
// - переключатель и выбор движка в самом чате — одно и то же: на «Новом диалоге»
//   он меняет движок, внутри диалога включает встроенную передачу в новый диалог;
// - когда сообщение ссылается на другой диалог (@thread, в том числе при передаче),
//   агент получает скрытую сводку того диалога: запросы, итоги, изменённые файлы.
//
// Подключается из index.html раньше приложения. React и хуки bb берёт из
// globalThis.__bbPluginRuntime — того же рантайма, что у плагинов, — поэтому сам
// ничего не импортирует и не зависит от имён внутри сборки.

const ENGINES = {
  claude: { providerId: "claude-code", label: "Claude" },
  gpt: { providerId: "codex", label: "GPT" },
};
const ORDER = ["claude", "gpt"];
const ENGINE_KEY = "bb.engine";
const BOTH_KEY = "bb.engine.both";
const MARK = "Справка о другом диалоге";
const WORKING = new Set(["runtime", "workflow", "background-agent", "background-command", "working-draft", "plan-mode", "goal"]);
const ATTENTION = new Set(["waiting-for-input", "unread-error", "unread-success", "queued-failed"]);

// Claude бота (мост acp-tgclaude) главнее Claude Code в контейнере: вкладка Claude ведёт в него.
const BRIDGE = "acp-tgclaude";
const engineOf = (providerId) => (providerId === "claude-code" || providerId === BRIDGE ? "claude" : providerId === "codex" ? "gpt" : null);
const providerFor = (engine) => (engine === "claude" && state.bridge ? BRIDGE : ENGINES[engine].providerId);
const runtime = () => globalThis.__bbPluginRuntime;

function load(key) {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function save(key, value) {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Приватный режим без хранилища: выбор живёт до перезагрузки.
  }
}

// ---------- общее состояние ----------

const state = {
  engine: ENGINES[load(ENGINE_KEY)] ? load(ENGINE_KEY) : null,
  // Оба движка есть у человека — только тогда список делится. Запоминаем, чтобы
  // при следующем открытии не мигал полный список, пока грузятся провайдеры.
  both: load(BOTH_KEY) === "1",
  bridge: false, // у человека есть Claude бота в bb
};
const listeners = new Set();
let snapshot = `${state.engine}|${state.both}`;
function emit() {
  snapshot = `${state.engine}|${state.both}`;
  for (const listener of listeners) listener();
}
const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const getSnapshot = () => snapshot;

function setEngine(engine) {
  if (!ENGINES[engine] || state.engine === engine) return;
  state.engine = engine;
  save(ENGINE_KEY, engine);
  emit();
}
function setBoth(both) {
  if (state.both === both) return;
  state.both = both;
  save(BOTH_KEY, both ? "1" : "0");
  emit();
}
if (typeof addEventListener === "function") {
  addEventListener("storage", (event) => {
    if (event.key === ENGINE_KEY && ENGINES[event.newValue] && event.newValue !== state.engine) {
      state.engine = event.newValue;
      emit();
    }
  });
}

// ---------- список диалогов ----------

function rootEngine(thread, byId) {
  let current = thread;
  for (let depth = 0; current.parentThreadId && depth < 32; depth += 1) {
    const parent = byId.get(current.parentThreadId);
    if (!parent) break;
    current = parent;
  }
  return engineOf(current.providerId) ?? engineOf(thread.providerId);
}

function threadsOf(threads, engine) {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const kept = threads.filter((thread) => {
    const owner = rootEngine(thread, byId);
    return owner === null || owner === engine;
  });
  return kept.length === threads.length ? threads : kept;
}

// Обёртка над experimental_useSidebarThreads. Делит только основной список
// (его плагин списка запрашивает с experimental_lifecycles); остальным
// потребителям, включая сам переключатель, отдаём всё как есть.
function useSidebar(sidebarState, options) {
  const React = runtime().react;
  const current = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const main = options != null && Object.prototype.hasOwnProperty.call(options, "experimental_lifecycles");
  return React.useMemo(() => {
    if (!main || !state.both || !state.engine || !sidebarState?.threads) return sidebarState;
    const threads = threadsOf(sidebarState.threads, state.engine);
    return threads === sidebarState.threads ? sidebarState : { ...sidebarState, threads };
  }, [sidebarState, current, main]);
}

// ---------- переключатель ----------

const STYLE = `
.bbe{position:sticky;top:0;z-index:3;padding:2px 8px 6px;background:var(--sidebar)}
.bbe-seg{position:relative;display:grid;grid-template-columns:1fr 1fr;padding:2px;border-radius:10px;background:var(--sidebar-accent)}
.bbe-thumb{position:absolute;top:2px;bottom:2px;left:2px;width:calc(50% - 2px);border-radius:8px;background:var(--background);box-shadow:0 1px 2px rgb(0 0 0/.1),0 0 0 .5px var(--border);transition:transform .28s cubic-bezier(.2,.8,.2,1)}
.dark .bbe-thumb{background:color-mix(in oklch,var(--ink) 17%,var(--canvas));box-shadow:0 1px 2px rgb(0 0 0/.35)}
.bbe-seg[data-engine=gpt] .bbe-thumb{transform:translateX(100%)}
.bbe-tab{position:relative;z-index:1;display:flex;align-items:center;justify-content:center;gap:6px;height:28px;min-width:0;padding:0 8px;border:0;border-radius:8px;background:none;color:var(--muted-foreground);font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:color .2s ease}
.bbe-tab:hover,.bbe-tab[aria-selected=true]{color:var(--foreground)}
.bbe-tab:focus-visible{outline:2px solid var(--sidebar-ring,var(--ring));outline-offset:1px}
.bbe-ico{display:inline-flex;width:14px;height:14px;flex:none}
.bbe-ico>*{width:100%;height:100%}
.bbe-dot{width:6px;height:6px;margin-left:-2px;border-radius:50%;background:currentColor;opacity:.75;flex:none}
.bbe-dot[data-kind=working]{animation:bbe-pulse 1.4s ease-in-out infinite}
@keyframes bbe-pulse{50%{opacity:.2}}
@media (max-width:767px){.bbe{padding:4px 12px 8px}.bbe-tab{height:36px;font-size:15px}.bbe-ico{width:16px;height:16px}.bbe-dot{width:7px;height:7px}}
@media (prefers-reduced-motion:reduce){.bbe-thumb,.bbe-tab{transition:none}.bbe-dot{animation:none}}
`;
function injectStyle() {
  if (typeof document === "undefined" || document.getElementById("bb-engine-style")) return;
  const style = document.createElement("style");
  style.id = "bb-engine-style";
  style.textContent = STYLE;
  document.head.append(style);
}

function pickComposer(composers, threadId) {
  if (threadId) return composers.find((c) => c.scope?.kind === "thread" && c.scope.threadId === threadId) ?? null;
  return composers.find((c) => c.scope?.kind === "new-thread") ?? null;
}

function applyToComposer(composer, engine) {
  const providerId = providerFor(engine);
  if (!composer || typeof composer.setSelection !== "function" || composer.selection?.providerId === providerId) return;
  composer.setSelection({ providerId }).catch((error) => {
    console.warn("[bb-engine] не удалось сменить движок в чате:", error?.message ?? error);
  });
}

// Выход из передачи — та же кнопка «×», что в шапке поля ввода.
function exitHandoff() {
  const buttons = document.querySelectorAll('button[aria-label="Отменить передачу"],button[aria-label="Exit handoff"]');
  for (const button of buttons) {
    if (button.offsetParent !== null) {
      button.click();
      return;
    }
  }
}

function EngineSwitch({ activeThreadId }) {
  const { react: React, pluginSdkApp: sdk } = runtime();
  const h = React.createElement;
  React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  React.useLayoutEffect(injectStyle, []);
  const sidebar = sdk.experimental_useSidebarThreads();
  const providers = sdk.experimental_useProviders();
  const composers = sdk.useComposers();

  const infos = {};
  for (const provider of providers.providers ?? []) {
    const engine = engineOf(provider.id);
    if (engine && provider.available !== false && (!infos[engine] || provider.id === BRIDGE)) infos[engine] = provider;
  }
  state.bridge = Boolean(infos.claude && infos.claude.id === BRIDGE);
  const ready = providers.status === "ready";
  const both = ready ? Boolean(infos.claude && infos.gpt) : state.both;
  React.useEffect(() => {
    if (ready) setBoth(Boolean(infos.claude && infos.gpt));
  }, [ready, Boolean(infos.claude), Boolean(infos.gpt)]);

  const byId = React.useMemo(() => new Map(sidebar.threads.map((t) => [t.id, t])), [sidebar.threads]);
  const visible = React.useMemo(() => sidebar.threads.filter((t) => !t.isHidden && !t.isArchived), [sidebar.threads]);
  const active = activeThreadId ? (byId.get(activeThreadId) ?? null) : null;
  const activeOwner = active ? rootEngine(active, byId) : null;

  // Первое открытие: движок самого свежего диалога, иначе тот, что стоял в чате.
  React.useEffect(() => {
    if (state.engine || sidebar.status !== "ready") return;
    const latest = visible.reduce((best, t) => (!best || t.updatedAt > best.updatedAt ? t : best), null);
    let initial = latest ? rootEngine(latest, byId) : null;
    if (!initial) {
      const stored = load("bb.promptbox.provider");
      initial = engineOf(stored);
      if (!initial && stored) {
        try {
          initial = engineOf(JSON.parse(stored));
        } catch {
          initial = null;
        }
      }
    }
    setEngine(initial ?? "gpt");
  }, [sidebar.status]);

  // Открыли диалог другого движка (поиск, ссылка, уведомление) — список идёт следом.
  const followed = React.useRef(null);
  React.useEffect(() => {
    if (!activeThreadId) {
      followed.current = null;
      return;
    }
    if (followed.current === activeThreadId || !activeOwner) return;
    followed.current = activeThreadId;
    if (both && activeOwner !== state.engine) setEngine(activeOwner);
  }, [activeThreadId, activeOwner, both]);

  // Связь с выбором движка в самом чате.
  const composer = pickComposer(composers, activeThreadId);
  const composerKey = composer?.key ?? null;
  const composerEngine = engineOf(composer?.selection?.providerId ?? null);
  const seen = React.useRef({ key: null, engine: null });
  React.useEffect(() => {
    const before = seen.current;
    seen.current = { key: composerKey, engine: composerEngine };
    if (!composer || !composerEngine || !both || !state.engine) return;
    if (before.key !== composerKey || before.engine === null) {
      // Новый экран. На «Новом диалоге» движок задаёт переключатель.
      if (composer.scope?.kind === "new-thread" && composerEngine !== state.engine) applyToComposer(composer, state.engine);
      return;
    }
    // Человек сменил движок в самом чате — список идёт следом.
    if (before.engine !== composerEngine && composerEngine !== state.engine) setEngine(composerEngine);
  }, [composerKey, composerEngine, both]);

  const choose = React.useCallback(
    (next) => {
      if (next === state.engine) return;
      setEngine(next);
      if (!composer) return;
      const own = active ? engineOf(active.providerId) : null;
      if (composer.scope?.kind === "thread" && next === own) {
        // Вернулись к движку самого диалога — отменяем начатую передачу.
        if (composerEngine !== own) exitHandoff();
        return;
      }
      applyToComposer(composer, next);
    },
    [composer, composerEngine, active],
  );

  if (!both || !state.engine) return null;

  const activity = { claude: null, gpt: null };
  for (const thread of visible) {
    const owner = rootEngine(thread, byId);
    if (!owner || owner === state.engine || activity[owner] === "attention") continue;
    if (ATTENTION.has(thread.indicator)) activity[owner] = "attention";
    else if (WORKING.has(thread.indicator)) activity[owner] = "working";
  }
  const Icon = sdk.experimental_ProviderIcon;

  return h(
    "div",
    { className: "bbe", "data-bb-engine": state.engine },
    h(
      "div",
      { className: "bbe-seg", role: "tablist", "aria-label": "Движок диалогов", "data-engine": state.engine },
      h("span", { className: "bbe-thumb", "aria-hidden": true }),
      ORDER.map((engine) =>
        h(
          "button",
          {
            key: engine,
            type: "button",
            role: "tab",
            className: "bbe-tab",
            "aria-selected": engine === state.engine,
            title: engine === state.engine ? `Диалоги ${ENGINES[engine].label}` : `Показать диалоги ${ENGINES[engine].label}`,
            onClick: () => choose(engine),
          },
          Icon && infos[engine]
            ? h("span", { className: "bbe-ico", "aria-hidden": true }, h(Icon, { providerKind: "agent", provider: infos[engine] }))
            : null,
          ENGINES[engine].label,
          activity[engine] ? h("span", { className: "bbe-dot", "data-kind": activity[engine], "aria-label": activity[engine] === "attention" ? "есть новое" : "идёт работа" }) : null,
        ),
      ),
    ),
  );
}

let Boundary = null;
function Switch(props) {
  const React = runtime()?.react;
  if (!React) return null;
  if (!Boundary) {
    // Сбой переключателя не должен ронять список диалогов: прячем только его.
    Boundary = class EngineSwitchBoundary extends React.Component {
      constructor(boundaryProps) {
        super(boundaryProps);
        this.state = { failed: false };
      }
      static getDerivedStateFromError() {
        return { failed: true };
      }
      componentDidCatch(error) {
        console.warn("[bb-engine] переключатель отключён:", error);
      }
      render() {
        return this.state.failed ? null : this.props.children;
      }
    };
  }
  return React.createElement(Boundary, null, React.createElement(EngineSwitch, props));
}

// ---------- сводка другого диалога ----------

const clip = (text, max) => {
  const clean = String(text ?? "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
};

function segmentsOf(rows) {
  const segments = [];
  let current = null;
  const open = () => {
    if (!current) {
      current = { user: "", answers: [], files: new Set(), commands: 0 };
      segments.push(current);
    }
    return current;
  };
  const visit = (row) => {
    if (!row || typeof row !== "object") return;
    if (row.kind === "conversation" && row.role === "user") {
      current = { user: row.text ?? "", answers: [], files: new Set(), commands: 0 };
      segments.push(current);
    } else if (row.kind === "conversation" && row.role === "assistant") {
      if (String(row.text ?? "").trim()) open().answers.push(row.text);
    } else if (row.kind === "work" && row.workKind === "file-change") {
      const path = row.change?.path;
      if (path) open().files.add(row.change.movePath || path);
    } else if (row.kind === "work" && row.workKind === "command") {
      open().commands += 1;
    } else if (row.kind === "turn" && Array.isArray(row.children)) {
      row.children.forEach(visit);
    }
  };
  (rows ?? []).forEach(visit);
  return segments.filter((s) => s.user.trim() || s.answers.length);
}

function buildDigest(thread, timeline, budget = 12000) {
  const owner = engineOf(thread.providerId);
  const who = owner ? ENGINES[owner].label : thread.providerId || "агент";
  const title = String(thread.title || thread.titleFallback || "без названия").trim();
  const segments = segmentsOf(timeline?.rows);
  const head =
    `[${MARK}. Человек этот текст не видит — это справка для тебя.]\n` +
    `Сообщение ссылается на диалог @thread:${thread.id} «${title}», его вёл ${who}. ` +
    "Ниже — запросы человека и итоги ответов оттуда, старые сверху.";
  const tail =
    `Полная история: \`bb thread log ${thread.id} --limit 50\`. ` +
    "Не переделывай сделанное и не считай обещанное сделанным — сверяйся с файлами. Отвечай на текущее сообщение человека.";
  if (!segments.length) return `${head}\n\n(В том диалоге пока нет сообщений.)\n\n${tail}`;
  const blocks = [];
  let used = head.length + tail.length + 120;
  let omitted = timeline?.timelinePage?.hasOlderRows ? 1 : 0;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    const last = index === segments.length - 1;
    const answer = segment.answers[segment.answers.length - 1] ?? "";
    const files = [...segment.files];
    let block = `— Запрос: ${clip(segment.user || "(без текста)", last ? 1500 : 500)}`;
    if (answer) block += `\n  Итог ${who}: ${clip(answer, last ? 3000 : 900)}`;
    if (files.length) block += `\n  Файлы: ${files.slice(0, 8).join(", ")}${files.length > 8 ? ` и ещё ${files.length - 8}` : ""}`;
    if (used + block.length > budget && blocks.length) {
      omitted += index + 1;
      break;
    }
    blocks.unshift(block);
    used += block.length + 1;
  }
  const older = omitted ? "\n(Более ранние обмены не показаны.)" : "";
  return `${head}${older}\n\n${blocks.join("\n")}\n\n${tail}`;
}

const nativeFetch = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null;

async function getJson(path, signal) {
  const response = await nativeFetch(path, { credentials: "same-origin", headers: { accept: "application/json" }, signal });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

async function digestFor(threadId, budget, signal) {
  const id = encodeURIComponent(threadId);
  const [thread, timeline] = await Promise.all([
    getJson(`/api/v1/threads/${id}`, signal),
    getJson(`/api/v1/threads/${id}/timeline?segmentLimit=12&includeNestedRows=true`, signal),
  ]);
  return buildDigest(thread, timeline, budget);
}

function mentionedThreads(input, currentThreadId) {
  const ids = [];
  for (const part of input) {
    if (part?.type !== "text" || part.visibility === "agent-only" || !Array.isArray(part.mentions)) continue;
    for (const mention of part.mentions) {
      const id = mention?.resource?.kind === "thread" ? mention.resource.threadId : null;
      if (typeof id === "string" && id && id !== currentThreadId && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

// Добавляет к сообщению скрытые сводки упомянутых диалогов. Любая ошибка —
// сообщение уходит как было: ссылка @thread остаётся, агент дочитает сам.
async function withThreadContext(bodyText, currentThreadId, fetchDigest = digestFor) {
  let request;
  try {
    request = JSON.parse(bodyText);
  } catch {
    return bodyText;
  }
  const input = Array.isArray(request?.input) ? request.input : null;
  if (!input) return bodyText;
  if (input.some((part) => part?.visibility === "agent-only" && String(part.text ?? "").startsWith(`[${MARK}`))) return bodyText;
  const ids = mentionedThreads(input, currentThreadId).slice(0, 2);
  if (!ids.length) return bodyText;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), 6000);
  try {
    const budget = ids.length > 1 ? 7000 : 12000;
    const digests = await Promise.all(
      ids.map((id) =>
        fetchDigest(id, budget, controller?.signal).catch((error) => {
          console.warn("[bb-engine] сводка диалога не собрана:", id, error?.message ?? error);
          return null;
        }),
      ),
    );
    const parts = digests.filter(Boolean).map((text) => ({ type: "text", text, mentions: [], visibility: "agent-only" }));
    if (!parts.length) return bodyText;
    return JSON.stringify({ ...request, input: [...input, ...parts] });
  } finally {
    clearTimeout(timer);
  }
}

const SEND_PATH = /^\/api\/v1\/threads(?:\/([^/]+)\/(?:send|queued-messages))?$/;
if (nativeFetch && typeof location !== "undefined" && !globalThis.__bbEngine) {
  globalThis.fetch = function bbEngineFetch(input, init) {
    try {
      if (init && typeof init.body === "string" && String(init.method ?? "GET").toUpperCase() === "POST") {
        const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
        const url = new URL(raw, location.href);
        const match = url.origin === location.origin ? SEND_PATH.exec(url.pathname) : null;
        if (match) {
          const threadId = match[1] ? decodeURIComponent(match[1]) : null;
          return withThreadContext(init.body, threadId).then(
            (body) => nativeFetch(input, body === init.body ? init : { ...init, body }),
            () => nativeFetch(input, init),
          );
        }
      }
    } catch (error) {
      console.warn("[bb-engine]", error);
    }
    return nativeFetch(input, init);
  };
}

globalThis.__bbEngine ??= {
  version: 1,
  Switch,
  useSidebar,
  getEngine: () => state.engine,
  setEngine,
  _test: { engineOf, threadsOf, segmentsOf, buildDigest, withThreadContext, mentionedThreads, state },
};
