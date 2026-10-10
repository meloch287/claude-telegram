import { renderAccounting, renderClaudeAccounting, quotaCaption } from "./accounting.js?v=20261009-unified1";
import { revealPage } from "./loading.js?v=20261009-state9";
import { rememberSection, prepareNavigation } from "./navigation.js?v=20261009-unified1";
import { fetchJson } from "./network.js?v=20261002-access8";
const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();
const initData = tg?.initData || "";
const restoringCats = prepareNavigation("chats");

function syncTheme() {
  if (initData && tg?.themeParams?.bg_color)
    document.documentElement.dataset.theme = tg.colorScheme;
  const background = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue("--paper")
    .trim();
  if (initData && tg?.isVersionAtLeast?.("6.1")) {
    tg.setHeaderColor(background);
    tg.setBackgroundColor(background);
  }
}
syncTheme();
tg?.onEvent?.("themeChanged", syncTheme);

const el = (id) => document.getElementById(id);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const openDialog = dialog => window.aiMotion.openDialog(dialog);
const closeDialog = dialog => window.aiMotion.closeDialog(dialog);
const toast = (message) => {
  el("toast").textContent = message;
  el("toast").hidden = false;
  setTimeout(() => (el("toast").hidden = true), 4500);
};
async function api(path, body) {
  return fetchJson(`./api/gpt/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "x-telegram-init-data": initData,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
let users = [],
  editingUser = null;
function displayName(user) {
  return /[\p{L}]/u.test(user.name || "") ? user.name : user.owner ? "Владелец" : "Пользователь";
}
function isLimited(user) {
  return (
    (user.quota
      ? user.quota.exceeded
      : user.tokenLimit !== null && user.tokensToday >= user.tokenLimit) ||
    (user.dialogLimit !== null && user.dialogs > user.dialogLimit)
  );
}
const formatNumber = (value) => Number(value).toLocaleString("ru-RU");
function node(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function quota(value, limit, label, exceeded, isDialog = false) {
  const cell = node("span", `user-quota${exceeded ? " exceeded" : ""}`);
  const number = node("span", "quota-value", formatNumber(value));
  if (limit !== null) number.append(node("small", "", ` / ${formatNumber(limit)}`));
  cell.append(node("span", "quota-label", label), number);
  if (exceeded)
    cell.append(
      node("span", "quota-caption", isDialog ? "Нужно удалить лишние" : "Задачи приостановлены"),
    );
  else if (limit === null) cell.append(node("span", "quota-caption", "без лимита"));
  return cell;
}
const percent = (value) => value === null || value === undefined || !Number.isFinite(Number(value)) ? "—" : `${(Math.round(Number(value) * 10) / 10).toLocaleString("ru-RU")}%`;
/** Доля человека в недельном лимите общих подписок: GPT и Claude в одной ячейке. */
function weekShares(user) {
  const gpt = user.quota?.subscription, claude = user.claude?.subscription;
  const exceeded = !!(gpt?.exceeded || user.quota?.exceeded || claude?.exceeded || user.claude?.exceeded);
  const cell = node("span", `user-quota${exceeded ? " exceeded" : ""}`);
  cell.append(node("span", "quota-label", "Неделя подписки"));
  for (const [name, share] of [["GPT", gpt], ["Claude", claude]]) {
    const line = node("span", "quota-value", `${name} ${percent(share?.used)}`);
    line.append(node("small", "", share?.limit === null || share?.limit === undefined ? " · без лимита" : ` / ${percent(share.limit)}`));
    cell.append(line);
  }
  if (exceeded) cell.append(node("span", "quota-caption", "Задачи приостановлены"));
  return cell;
}
function renderUsers() {
  const search = el("user-search").value.trim().toLocaleLowerCase("ru-RU");
  const filter = el("user-filter").value;
  const rows = users.filter(
    (user) =>
      `${user.name} ${user.username || ""} ${user.id}`
        .toLocaleLowerCase("ru-RU")
        .includes(search) &&
      (filter === "all" ||
        (filter === "allowed" && user.allowed) ||
        (filter === "blocked" && !user.allowed) ||
        (filter === "limited" && isLimited(user))),
  );
  el("stat-active").textContent = formatNumber(users.filter((user) => user.allowed).length);
  el("stat-tokens").textContent = new Intl.NumberFormat("ru-RU", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(users.reduce((sum, user) => sum + user.tokensToday, 0));
  el("stat-tokens").title = formatNumber(users.reduce((sum, user) => sum + user.tokensToday, 0));
  const unverified = users.reduce((sum, user) => sum + (user.tokensUnverified || 0), 0);
  el("token-accounting-note").hidden = !unverified;
  el("token-accounting-note").textContent = unverified
    ? `Не подтверждено: ${formatNumber(unverified)} токенов — исключены.`
    : "";
  el("stat-tokens").title += " · Вход и выход с кешем, сутки UTC";
  el("users-total").textContent = users.length;
  el("admin-status").textContent =
    rows.length === users.length ? "" : `Найдено ${rows.length} из ${users.length}`;
  el("users-list").replaceChildren();
  for (const user of rows) {
    const name = displayName(user);
    const button = node("button", "user-row");
    button.type = "button";
    button.setAttribute("aria-label", `Настроить: ${name}, ID ${user.id}`);
    const identity = node("span", "user-identity");
    const initials = name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => [...part][0])
      .join("")
      .toLocaleUpperCase("ru-RU");
    const avatar = node("span", "user-avatar", initials);
    avatar.setAttribute("aria-hidden", "true");
    const info = node("span", "chat-body");
    info.append(
      node("span", "user-name", name),
      node("span", "user-id", `${user.username ? "@" + user.username + " · " : ""}ID ${user.id}`),
      node(
        "span",
        `user-status ${user.owner ? "owner" : user.allowed ? "active" : "blocked"}`,
        user.deletionState === "failed"
          ? "Удаление требует повтора"
          : user.deletionState
            ? "Данные удаляются…"
            : user.owner
              ? "Твой аккаунт · владелец"
              : user.allowed
                ? "Доступ открыт"
                : "Без доступа",
      ),
    );
    identity.append(avatar, info);
    const arrow = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    arrow.setAttribute("viewBox", "0 0 24 24");
    arrow.setAttribute("class", "user-chevron");
    arrow.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "m9 6 6 6-6 6");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.6");
    arrow.append(path);
    button.append(
      identity,
      weekShares(user),
      quota(
        user.dialogs,
        user.dialogLimit,
        "Диалоги",
        user.dialogLimit !== null && user.dialogs > user.dialogLimit,
        true,
      ),
      arrow,
    );
    button.onclick = () => editUser(user);
    el("users-list").append(button);
  }
  if (!rows.length) {
    const empty = node("div", "empty-users");
    empty.append(
      node("strong", "", "Никого не нашли"),
      node("p", "", "Проверь имя, ID или выбранный фильтр."),
    );
    el("users-list").append(empty);
  }
}
async function loadUsers() {
  let ready=false;
  el("admin-status").textContent = "Загружаю пользователей…";
  el("admin-retry").hidden = true;
  el("users-list").setAttribute("aria-busy", "true");
  try {
    ({ users } = await api("admin/users"));
    rememberSection("admin");
    renderUsers();
    ready=true;
  } catch (e) {
    if (e.code === "MINIAPP_CATS_ONLY") {
      rememberSection("cats");
      window.gptNavigation.redirecting = true;
      location.replace("./index.html?section=cats&engine="+window.gptNavigation.engine + location.hash);
      return;
    }
    el("admin-status").textContent = e.message;
    el("admin-retry").hidden = false;
  } finally {
    el("users-list").setAttribute("aria-busy", "false");
    if (!window.gptNavigation.redirecting) window.gptNavigation.reveal(ready);
  }
}
const savedAdmin=window.gptNavigation.ui();
el("user-search").value=typeof savedAdmin.search==='string'?savedAdmin.search.slice(0,120):'';
if(['all','allowed','blocked','limited'].includes(savedAdmin.filter))el("user-filter").value=savedAdmin.filter;
function filterUsers(){window.gptNavigation.updateUI({search:el("user-search").value.slice(0,120),filter:el("user-filter").value});renderUsers()}
el("user-search").oninput = filterUsers;
el("user-filter").onchange = filterUsers;
el("admin-retry").onclick = loadUsers;
let limitEngine=(new URLSearchParams(location.search).get('limits')||savedAdmin.limitEngine)==='claude'?'claude':'gpt';
let limitsAnimation;
function selectLimitEngine(engine,animate=true){
 limitEngine=engine;window.gptNavigation.updateUI({limitEngine:engine});
 const box=document.querySelector('.limit-pages');
 const height=box.getBoundingClientRect().height;
 limitsAnimation?.cancel();
 for(const mode of ['gpt','claude']){el('limits-'+mode).setAttribute('aria-selected',String(mode===engine));el(mode+'-limits').hidden=mode!==engine;}
 if(animate&&!matchMedia('(prefers-reduced-motion: reduce)').matches){const target=box.getBoundingClientRect().height;limitsAnimation=box.animate([{height:height+'px',opacity:.5,transform:'translateY(5px)'},{height:target+'px',opacity:1,transform:'translateY(0)'}],{duration:260,easing:'cubic-bezier(.22,1,.36,1)'});}
}
for(const mode of ['gpt','claude'])el('limits-'+mode).onclick=()=>selectLimitEngine(mode);
function editUser(user = null) {
  editingUser = user;
  el('claude-percent').value=user?.owner?'':user?(user.claude?.subscription?.limit??''):10;
  el('claude-percent').disabled=!!user?.owner;
  el('claude-percent').placeholder=user?.owner?'Без личного лимита':'Без ограничения';
  const share=user?.claude?.subscription;
  el('claude-quota-usage').textContent=share?`Claude за неделю: ≈${percent(share.used)} / ${share.limit===null?'без личного ограничения':percent(share.limit)} · ${new Intl.NumberFormat("ru-RU").format(share.tokens)} токенов`:'';
  selectLimitEngine(limitEngine,false);
  el("user-heading").textContent = user ? displayName(user) : "Новый пользователь";
  el("user-subtitle").textContent = user?.owner
    ? "Твой аккаунт · права владельца"
    : user && !user.allowed
      ? "Доступ отключён"
      : "Доступ и личные лимиты";
  el("user-form-status").hidden = true;
  el("user-id").value = user?.id || "";
  el("user-id").readOnly = !!user;
  el("user-name").value = user?.name || "";
  el("user-percent").value = user?.owner ? "" : (user?.percentLimit ?? 10);
  el("user-percent").disabled = !!user?.owner;
  el("user-percent").placeholder = user?.owner ? "Без личного лимита" : "10";
  el("user-usage").textContent = user?.quota ? quotaCaption(user.quota) : "";
  el("user-storage").textContent = user?.storage
    ? `Диск: ${(user.storage.bytes / 1e9).toFixed(2)} ГБ. ${user.storage.blocked ? "Очистить до 10 ГБ." : "Лимит: 30 ГБ."} Очистка в боте: /storage.`
    : "";
  el("user-dialogs").value = user?.owner ? "" : (user?.dialogLimit ?? 5);
  el("user-dialogs").disabled = !!user?.owner;
  el("user-dialogs").placeholder = user?.owner ? "Без ограничений" : "5";
  el("dialog-unit").hidden = !!user?.owner;
  el("dialog-hint").textContent = user?.owner
    ? "Без ограничений."
    : "Пустое поле — 5. Лишние удаляются через /delete.";
  el("user-id-hint").textContent = user
    ? "ID нельзя изменить."
    : "Числовой ID аккаунта, не @username.";
  el("user-access-section").hidden = !user || user.owner || !user.allowed;
  el("user-remove").hidden = !user || user.owner || !user.allowed;
  el("user-delete-section").hidden = !user || user.owner;
  el("user-delete").textContent =
    user?.deletionState === "failed"
      ? "Повторить удаление"
      : user?.deletionState
        ? "Статус удаления"
        : "Удалить все данные";
  el("user-save").disabled = !!user?.deletionState;
  el("user-save").textContent =
    user && !user.allowed ? "Вернуть доступ" : user ? "Сохранить" : "Добавить пользователя";
  openDialog(el("user-detail"));
}
el("add-user").onclick = () => editUser();
el("user-close").onclick = el("user-cancel").onclick = () => closeDialog(el("user-detail"));
function userError(message) {
  el("user-form-status").textContent = message;
  el("user-form-status").hidden = false;
  el("user-form-status").scrollIntoView({ block: "nearest" });
}
el("user-form").onsubmit = async (event) => {
  event.preventDefault();
  el("user-save").disabled = true;
  el("user-form-status").hidden = true;
  const limit = (id) => (el(id).value === "" ? null : Number(el(id).value));
  try {
    await api("admin/user", {
      id: Number(el("user-id").value),
      note: el("user-name").value,
      ...(editingUser?.owner ? {} : { percentLimit: Number(el("user-percent").value) }),
      dialogLimit: limit("user-dialogs"),
      ...(editingUser?.owner ? {} : { claude: { percent: limit("claude-percent"), daily: null, weekly: null } }),
      allowed: true,
    });
    await closeDialog(el("user-detail"));
    await loadUsers();
    toast("Доступ и лимиты сохранены");
  } catch (e) {
    userError(e.message);
  } finally {
    el("user-save").disabled = false;
  }
};
el("user-remove").onclick = async () => {
  if (
    !editingUser ||
    !window.confirm(`Отключить доступ у ${displayName(editingUser)}? История и файлы сохранятся.`)
  )
    return;
  el("user-remove").disabled = true;
  try {
    await api("admin/user", { id: editingUser.id, allowed: false });
    await closeDialog(el("user-detail"));
    await loadUsers();
    toast("Доступ отключён");
  } catch (e) {
    userError(e.message);
  } finally {
    el("user-remove").disabled = false;
  }
};

let deletingUser = null;
let deletionPolling = null;
function syncDeleteConfirmation() {
  el("delete-submit").disabled =
    !deletingUser ||
    el("delete-confirmation").disabled ||
    el("delete-confirmation").value !== String(deletingUser.id);
}
function finishDeleteUI(state) {
  const pending = ["pending", "purging"].includes(state);
  el("delete-confirmation").disabled = pending;
  el("delete-close").textContent = pending ? "Закрыть" : "Отмена";
  el("delete-submit").textContent = state === "failed" ? "Повторить удаление" : "Удалить навсегда";
  el("delete-status").textContent = pending
    ? "Удаляем данные. Можно закрыть окно — удаление продолжится на сервере."
    : state === "failed"
      ? "Не удалось удалить всё. Доступ закрыт. Повтори удаление, чтобы завершить очистку."
      : "";
  syncDeleteConfirmation();
}
async function trackDeletion(uid) {
  clearTimeout(deletionPolling);
  if (!el("user-delete-detail").open || deletingUser?.id !== uid) return;
  try {
    const { state } = await api(`admin/user-delete?id=${uid}`);
    if (deletingUser?.id !== uid || !el("user-delete-detail").open) return;
    if (state === "complete") {
      await closeDialog(el("user-delete-detail"));
      await loadUsers();
      toast("Все данные пользователя удалены. Доступ закрыт.");
      return;
    }
    finishDeleteUI(state);
    if (state === "failed") {
      await loadUsers();
      return;
    }
  } catch {
    el("delete-status").textContent = "Проверяем статус. Удаление на сервере продолжается.";
  }
  deletionPolling = setTimeout(() => trackDeletion(uid), 1500);
}
el("user-delete").onclick = async () => {
  if (!editingUser || editingUser.owner) return;
  deletingUser = { ...editingUser };
  await closeDialog(el("user-detail"));
  el("delete-person").textContent = `${displayName(deletingUser)} · ID ${deletingUser.id}`;
  el("delete-confirmation").value = "";
  finishDeleteUI(deletingUser.deletionState);
  openDialog(el("user-delete-detail"));
  if (["pending", "purging"].includes(deletingUser.deletionState))
    void trackDeletion(deletingUser.id);
};
el("delete-confirmation").oninput = syncDeleteConfirmation;
el("delete-close").onclick = () => closeDialog(el("user-delete-detail"));
el("user-delete-detail").addEventListener("close", () => {
  clearTimeout(deletionPolling);
  void loadUsers();
});
el("user-delete-form").onsubmit = async (event) => {
  event.preventDefault();
  if (el("delete-submit").disabled || !deletingUser) return;
  const uid = deletingUser.id;
  finishDeleteUI("pending");
  try {
    await api("admin/user-delete", { id: uid, confirmation: el("delete-confirmation").value });
    void trackDeletion(uid);
  } catch (error) {
    finishDeleteUI("failed");
    el("delete-status").textContent = `${error.message}. Можно повторить запрос.`;
  }
};

el("invite-user").onclick = async () => {
  el("invite-user").disabled = true;
  try {
    const invite = await api("admin/invite", {});
    el("invite-url").value = invite.url;
    el("invite-status").textContent = "Скопируй ссылку или выбери получателя в Telegram.";
    openDialog(el("invite-detail"));
  } catch (error) {
    toast(error.message);
  } finally {
    el("invite-user").disabled = false;
  }
};
el("invite-close").onclick = async () => {
  await closeDialog(el("invite-detail"));
  await loadUsers();
};
el("invite-copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText(el("invite-url").value);
    el("invite-status").textContent = "✅ Ссылка скопирована";
  } catch {
    el("invite-url").focus();
    el("invite-url").select();
    el("invite-status").textContent = "Ссылка выделена — скопируй её вручную.";
  }
};
el("invite-share").onclick = () => {
  const url =
    "https://t.me/share/url?" +
    new URLSearchParams({
      url: el("invite-url").value,
      text: "Приглашение в GPT-бот. Открой ссылку и нажми «Запустить».",
    });
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, "_blank", "noopener");
};

let accountingLoading = false;
function replaceAccounting(id, render) {
  const container = el(id);
  void window.aiMotion.change(render, {
    layout: container,
    target: () => container.firstElementChild,
  });
  container.dataset.loaded = "true";
}
function accountingFailure(id, title, message) {
  const container = el(id);
  if (container.dataset.loaded === "true") return;
  replaceAccounting(id, () => {
    const card = node("section", "account-card");
    card.append(node("h3", "", title), node("p", "note", message));
    container.replaceChildren(card);
  });
}
async function loadAccounting() {
  if (accountingLoading) return;
  accountingLoading = true;
  let gptNotice = "", claudeNotice = "";
  const showNotices = () => { el("accounting-status").textContent = [gptNotice, claudeNotice].filter(Boolean).join(" "); };
  el("accounting-refresh").disabled = true;
  el("accounting-status").textContent = "";
  el("accounting").setAttribute("aria-busy", "true");
  el("claude-accounting").setAttribute("aria-busy", "true");
  try {
    await Promise.all([
      api("admin/accounting").then(view => {
        replaceAccounting("accounting", () => renderAccounting(el("accounting"), view));
        gptNotice = view.subscription?.stale ? "Данные OpenAI устарели." : "";
        showNotices();
      }).catch(() => {
        accountingFailure("accounting", "GPT · подписка", "Не удалось загрузить статистику GPT. Нажми «Обновить».");
        gptNotice = "Не удалось обновить GPT.";
        showNotices();
      }).finally(() => el("accounting").setAttribute("aria-busy", "false")),
      fetchJson("./api/miniapp/claude-admin", { headers: { "x-telegram-init-data": initData } })
        .then(view => replaceAccounting("claude-accounting", () => renderClaudeAccounting(el("claude-accounting"), view.usage)))
        .catch(() => {
          accountingFailure("claude-accounting", "Claude Code", "Не удалось загрузить статистику Claude. Нажми «Обновить».");
          claudeNotice = "Не удалось обновить Claude.";
          showNotices();
        })
        .finally(() => el("claude-accounting").setAttribute("aria-busy", "false")),
    ]);
  } finally {
    accountingLoading = false;
    el("accounting-refresh").disabled = false;
  }
}
el("accounting-refresh").onclick = loadAccounting;
setInterval(() => {
  if (!document.hidden && !el("panel-admin").hidden) {
    void loadUsers();
    void loadAccounting();
  }
}, 60000);

// Доступ к движкам: выключенный закрыт для всех, кроме владельца.
const ENGINE_NAMES = { gpt: "GPT", claude: "Claude" };
function showEngines(state) {
  for (const engine of ["gpt", "claude"]) {
    const row = el(`engine-${engine}`);
    row.setAttribute("aria-checked", String(state[engine] !== false));
    row.disabled = false;
  }
}
async function loadEngines() {
  try { showEngines(await api("admin/engines")); }
  catch { toast("Не удалось загрузить доступ к движкам"); }
}
for (const engine of ["gpt", "claude"]) {
  el(`engine-${engine}`)?.addEventListener("click", async (event) => {
    const row = event.currentTarget;
    const enabled = row.getAttribute("aria-checked") !== "true";
    row.setAttribute("aria-checked", String(enabled));
    row.disabled = true;
    window.Telegram?.WebApp?.HapticFeedback?.selectionChanged?.();
    try {
      showEngines(await api("admin/engines", { engine, enabled }));
      toast(enabled ? `${ENGINE_NAMES[engine]} снова доступен всем` : `${ENGINE_NAMES[engine]} выключен для всех, кроме тебя`);
    } catch (error) {
      row.setAttribute("aria-checked", String(!enabled));
      row.disabled = false;
      toast(error?.message || "Не удалось переключить");
    }
  });
}

if (!restoringCats) {
  void loadEngines();
  void loadUsers();
  void loadAccounting();
}
