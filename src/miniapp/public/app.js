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
  const { cat, cats, achievements, totals, today, tier } = profile;

  el("plan-line").textContent = `План ${tier.emoji} ${tier.title} · модель ${tier.model}`;

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

  // Статистика
  const stats = [
    [nf.format(totals.tokens), "токенов всего"],
    [`$${totals.costUsd.toFixed(2)}`, "потрачено"],
    [nf.format(totals.messages), "сообщений"],
    [nf.format(totals.sessions), "сессий"],
    [nf.format(totals.toolsAllowed), "инструментов разрешено"],
    [nf.format(totals.toolsDenied), "отклонено"],
    [nf.format(totals.streakDays), "дней подряд"],
    [`${nf.format(today.tokens)} / ${nf.format(today.limit)}`, "сегодня из лимита"],
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
