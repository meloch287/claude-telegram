import { catSvg } from "./cat-art.js";

const tg = window.Telegram?.WebApp;
const nf = new Intl.NumberFormat("ru-RU");

/* ────────────────────────────────────────────────────────────────────────── */

function el(id) {
  return document.getElementById(id);
}

function text(value) {
  return document.createTextNode(String(value));
}

function render(profile) {
  const { cat, cats, achievements, totals, today, model } = profile;

  el("plan-line").textContent = `Модель ${model.label}`;

  // Герой
  el("hero-cat").innerHTML = catSvg(cat, 148);
  el("hero-level").textContent = `Уровень ${cat.level} из ${cats.length}`;
  el("hero-name").textContent = cat.name;
  el("hero-title").textContent = cat.title;
  el("hero-quote").textContent = `«${cat.quote}»`;

  // Прогресс. aria-valuetext даёт скринридеру осмысленную фразу вместо «47 процентов».
  const percent = Math.round(cat.progress * 100);
  const bar = el("progress-bar");
  bar.setAttribute("aria-valuenow", String(percent));
  el("progress-fill").style.width = `${percent}%`;
  el("progress-percent").textContent = `${percent}%`;

  if (cat.nextThreshold === null) {
    el("progress-label").textContent = "Максимальный уровень";
    bar.setAttribute("aria-valuetext", "Максимальный уровень достигнут");
    el("progress-caption").textContent = `Потрачено ${nf.format(totals.tokens)} токенов.`;
  } else {
    const left = cat.nextThreshold - totals.tokens;
    el("progress-label").textContent = `До уровня «${cat.nextName}»`;
    bar.setAttribute(
      "aria-valuetext",
      `${percent} процентов до уровня ${cat.nextName}: осталось ${nf.format(left)} токенов`,
    );
    el("progress-caption").textContent =
      `Потрачено ${nf.format(totals.tokens)} из ${nf.format(cat.nextThreshold)} токенов. Осталось ${nf.format(left)}.`;
  }

  renderLimits(profile.limits ?? []);

  // Статистика
  const stats = [
    [nf.format(totals.tokens), "токенов всего"],
    [`$${totals.costUsd.toFixed(2)}`, "потрачено"],
    [nf.format(totals.messages), "сообщений"],
    [nf.format(totals.sessions), "сессий"],
    [nf.format(totals.toolsAllowed), "инструментов разрешено"],
    [nf.format(totals.toolsDenied), "отклонено"],
    [nf.format(totals.streakDays), "дней подряд"],
    [nf.format(today.tokens), "токенов сегодня"],
  ];
  const statsList = el("stats");
  statsList.replaceChildren();
  for (const [value, label] of stats) {
    const li = document.createElement("li");
    li.className = "stat";
    const v = document.createElement("span");
    v.className = "stat-value";
    v.append(text(value));
    const l = document.createElement("span");
    l.className = "stat-label";
    l.append(text(label));
    li.append(v, l);
    statsList.append(li);
  }

  // Коты
  const openCount = cats.filter((c) => c.unlocked).length;
  el("cats-note").textContent = `Открыто ${openCount} из ${cats.length}. Уровень растёт от потраченных токенов.`;

  const grid = el("cat-grid");
  grid.replaceChildren();
  for (const item of cats) {
    const li = document.createElement("li");
    li.className = `cat-card${item.unlocked ? "" : " cat-card--locked"}`;

    const art = document.createElement("div");
    art.className = "cat-art";
    art.innerHTML = catSvg(item, 76);

    const level = document.createElement("span");
    level.className = "cat-card-level";
    level.append(text(`Уровень ${item.level}`));

    const name = document.createElement("span");
    name.className = "cat-card-name";
    name.append(text(item.name));

    const threshold = document.createElement("span");
    threshold.className = "cat-card-threshold";
    threshold.append(text(`от ${nf.format(item.threshold)} токенов`));

    // Статус словом: затемнение и пунктир — подсказка, а не носитель смысла.
    // Значок отдельным aria-hidden узлом, иначе скринридер прочитает
    // «закрытый замок Закрыт» — название эмодзи плюс само слово.
    const badge = document.createElement("span");
    badge.className = `badge ${item.unlocked ? "badge--open" : "badge--locked"}`;
    const badgeIcon = document.createElement("span");
    badgeIcon.setAttribute("aria-hidden", "true");
    badgeIcon.append(text(item.unlocked ? "✓" : "🔒"));
    badge.append(badgeIcon, text(item.unlocked ? " Открыт" : " Закрыт"));

    li.append(art, level, name, threshold, badge);
    grid.append(li);
  }

  // Достижения
  const gotCount = achievements.filter((a) => a.unlocked).length;
  el("ach-note").textContent = `Получено ${gotCount} из ${achievements.length}.`;

  const list = el("achievements");
  list.replaceChildren();
  for (const item of achievements) {
    const li = document.createElement("li");
    li.className = `achievement${item.unlocked ? "" : " achievement--locked"}`;

    const icon = document.createElement("span");
    icon.className = "achievement-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.append(text(item.unlocked ? item.icon : "▫️"));

    const body = document.createElement("div");
    const name = document.createElement("p");
    name.className = "achievement-name";
    name.style.margin = "0";
    name.append(text(item.name));

    const status = document.createElement("span");
    status.className = "visually-hidden";
    status.append(text(item.unlocked ? ". Получено. " : ". Ещё не получено. "));

    const desc = document.createElement("p");
    desc.className = "achievement-desc";
    desc.append(text(item.description));

    name.append(status);
    body.append(name, desc);
    li.append(icon, body);
    list.append(li);
  }

  setupShare(profile);
}

const LIMIT_NAMES = {
  five_hour: "Пятичасовое окно",
  seven_day: "Недельный лимит",
  seven_day_opus: "Недельный лимит Opus",
  seven_day_sonnet: "Недельный лимит Sonnet",
  seven_day_overage_included: "Недельный лимит с перерасходом",
  overage: "Перерасход",
};

const LIMIT_STATUSES = {
  allowed: { icon: "✓", word: "Норма" },
  allowed_warning: { icon: "⚠️", word: "На исходе" },
  rejected: { icon: "🚫", word: "Исчерпан" },
};

const timeFormat = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });

/** «через 2 ч 14 мин» — относительное время понятнее абсолютного для короткого окна. */
function untilReset(resetsAt) {
  const left = resetsAt - Date.now();
  if (left <= 0) return "уже обнулился";
  const minutes = Math.round(left / 60000);
  if (minutes < 60) return `через ${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `через ${hours} ч ${minutes % 60} мин`;
  return `через ${Math.round(hours / 24)} дн`;
}

/**
 * Лимиты подписки.
 *
 * Данные приходят агенту событием по ходу работы, а мини-апп читает снимок из
 * базы при открытии. Значит они всегда чуть устаревшие — и отметка возраста
 * стоит у каждой строки отдельно: окна обновляются в разное время, и одна
 * метка на всю секцию соврала бы про то, что обновилось раньше.
 */
function renderLimits(limits) {
  const list = el("limits");
  const note = el("limits-note");

  if (limits.length === 0) {
    note.textContent = "Данных пока нет — они приходят по ходу работы агента.";
    note.hidden = false;
    list.hidden = true;
    list.replaceChildren();
    return;
  }

  note.hidden = true;
  list.hidden = false;
  list.replaceChildren();

  for (const limit of limits) {
    // Ключ берём из типа окна, а не из индекса: число строк меняется, и на
    // индексах id разъехались бы между отрисовками.
    const key = limit.type;
    const name = LIMIT_NAMES[limit.type] ?? limit.type;
    const status = LIMIT_STATUSES[limit.status] ?? LIMIT_STATUSES.allowed;
    // utilization и resetsAt приходят не всегда — считать их обязательными нельзя.
    const percent = limit.utilization === null ? null : Math.round(limit.utilization);
    const seen = timeFormat.format(new Date(limit.seenAt));

    const li = document.createElement("li");
    li.className = "limit";

    const head = document.createElement("div");
    head.className = "limit-head";
    const nameEl = document.createElement("span");
    nameEl.className = "limit-name";
    nameEl.id = `limit-name-${key}`;
    nameEl.append(text(name));
    const percentEl = document.createElement("span");
    percentEl.className = "limit-percent";
    percentEl.append(text(percent === null ? "—" : `${percent}%`));
    head.append(nameEl, percentEl);

    const track = document.createElement("div");
    track.className = "progress-track";
    track.id = `limit-bar-${key}`;
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    track.setAttribute("aria-valuenow", String(percent ?? 0));
    track.setAttribute("aria-labelledby", nameEl.id);
    track.setAttribute("aria-describedby", `limit-seen-${key}`);
    // Статус дублируется в valuetext: попав сразу на полосу мимо подписи,
    // пользователь всё равно узнает состояние, не полагаясь на цвет.
    const reset = limit.resetsAt === null ? "" : `, сброс ${untilReset(limit.resetsAt)}`;
    track.setAttribute(
      "aria-valuetext",
      percent === null
        ? `${status.word}${reset}`
        : `${percent} процентов, ${status.word.toLowerCase()}${reset}`,
    );

    const fill = document.createElement("div");
    fill.className = `progress-fill progress-fill--${limit.status}`;
    fill.style.width = `${percent ?? 0}%`;
    track.append(fill);

    const foot = document.createElement("p");
    foot.className = "limit-foot";

    const badge = document.createElement("span");
    badge.className = `badge badge--${limit.status}`;
    const badgeIcon = document.createElement("span");
    badgeIcon.setAttribute("aria-hidden", "true");
    badgeIcon.append(text(status.icon));
    badge.append(badgeIcon, text(` ${status.word}`));

    const when = document.createElement("span");
    if (limit.resetsAt !== null) {
      const time = document.createElement("time");
      time.dateTime = new Date(limit.resetsAt).toISOString();
      time.append(text(untilReset(limit.resetsAt)));
      when.append(text("Сброс "), time);
    }

    const seenEl = document.createElement("span");
    seenEl.id = `limit-seen-${key}`;
    seenEl.append(text(`данные на ${seen}`));

    foot.append(badge, when, seenEl);
    li.append(head, track, foot);
    list.append(li);
  }
}

function setupShare(profile) {
  const line = `Мой Claude-кот: ${profile.cat.name} (уровень ${profile.cat.level}/10), ${nf.format(profile.totals.tokens)} токенов`;

  const share = () => {
    if (tg?.switchInlineQuery) {
      tg.switchInlineQuery(line, ["users", "groups"]);
    } else if (tg?.sendData) {
      tg.sendData(JSON.stringify({ share: line }));
    } else if (navigator.share) {
      void navigator.share({ text: line }).catch(() => undefined);
    } else {
      void navigator.clipboard?.writeText(line);
    }
  };

  // Наличия tg.MainButton недостаточно: telegram-web-app.js создаёт объект и
  // вне Telegram, где MainButton — заглушка, которая ничего не показывает.
  // Признак настоящего клиента — заполненные initData или известная платформа
  // (вне Telegram platform === "unknown").
  const inTelegram = Boolean(tg?.initData) || (tg?.platform && tg.platform !== "unknown");

  if (inTelegram && tg.MainButton) {
    tg.MainButton.setText("Поделиться результатом");
    tg.MainButton.show();
    tg.MainButton.onClick(share);
    return;
  }

  // На десктопе и в демо-режиме без запасной кнопки поделиться нечем —
  // ни мышью, ни с клавиатуры.
  const button = el("share-fallback");
  button.hidden = false;
  button.addEventListener("click", share);
}

function fail(message) {
  el("loading").hidden = true;
  const box = el("error");
  box.hidden = false;
  box.textContent = message;
}

/**
 * Демо-режим (?demo=1) рисует страницу на выдуманных данных.
 * Нужен, чтобы разрабатывать и проверять вёрстку в обычном браузере:
 * настоящий профиль требует подписанных initData от Telegram.
 */
async function loadDemo() {
  const response = await fetch("/demo-profile.json");
  return response.json();
}

async function main() {
  tg?.ready();
  tg?.expand();

  if (new URLSearchParams(location.search).has("demo")) {
    render(await loadDemo());
    el("loading").hidden = true;
    el("app").hidden = false;
    return;
  }

  const initData = tg?.initData;
  if (!initData) {
    fail("Открой эту страницу из бота — здесь нужны данные Telegram.");
    return;
  }

  try {
    const response = await fetch("/api/profile", {
      headers: { "X-Telegram-Init-Data": initData },
    });
    if (!response.ok) {
      fail(
        response.status === 401
          ? "Telegram не подтвердил, что это ты. Открой мини-апп заново из бота."
          : `Сервер ответил ошибкой ${response.status}.`,
      );
      return;
    }
    const profile = await response.json();
    render(profile);
    el("loading").hidden = true;
    el("app").hidden = false;
  } catch (error) {
    fail("Не получилось загрузить профиль. Проверь соединение и попробуй ещё раз.");
    console.error(error);
  }
}

void main();
