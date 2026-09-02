import { catSvg } from "./cat-art.js";
import { achievementSvg } from "./achievement-art.js";
import { createWorld, RACES } from "./world.js";

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
  const { cat, cats, achievements, totals, today, model, bot } = profile;

  el("plan-line").textContent = `Модель ${model.label}`;

  // Герой
  el("hero-cat").innerHTML = catSvg(cat, 148, { animated: true });
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
  renderChart(profile.usageByDay ?? []);
  renderCoop(profile.coop ?? []);
  renderQuota(profile.quota ?? null);

  // Статистика бота. Денег и отказов здесь нет: сумма «по API» пугала и ничего
  // не решала, а число отклонённых инструментов — служебное.
  const stats = [
    [nf.format(bot.tokens), "токенов в боте"],
    [nf.format(bot.messages), "сообщений"],
    [nf.format(totals.sessions), "сессий"],
    [nf.format(totals.toolsAllowed), "инструментов разрешено"],
    [nf.format(totals.streakDays), "дней подряд"],
    [nf.format(today.tokens), "токенов сегодня"],
  ];
  // Импортированная история и оговорка про кэш убраны из интерфейса: числа
  // важнее объяснений, а объяснения живут в README.
  el("history-note").hidden = true;
  el("cache-note").hidden = true;

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
  el("cats-note").textContent =
    `Открыто ${openCount} из ${cats.length}. Уровень растёт от потраченных токенов.`;

  const grid = el("cat-grid");
  grid.replaceChildren();
  cats.forEach((item, index) => {
    const li = document.createElement("li");
    li.className = `cat-card${item.unlocked ? "" : " cat-card--locked"}`;

    const art = document.createElement("div");
    art.className = "cat-art";
    // Открытые коты в сетке тоже живые, но вразнобой: одинаковый такт у десяти
    // штук сразу читается как дребезг экрана, а не как жизнь.
    art.innerHTML = catSvg(item, 76, { animated: item.unlocked });
    // Сдвиг фазы вешаем на сам рисунок: анимация живёт на нём, а не на обёртке.
    const sprite = art.firstElementChild;
    if (sprite) sprite.style.animationDelay = -(index % 5) * 0.9 + "s";

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
  });

  // Достижения
  const gotCount = achievements.filter((a) => a.unlocked).length;
  el("ach-note").textContent = `Получено ${gotCount} из ${achievements.length}.`;

  const list = el("achievements");
  list.replaceChildren();
  for (const item of achievements) {
    const li = document.createElement("li");
    li.className = `achievement${item.unlocked ? "" : " achievement--locked"}`;

    // Свой пиксельный значок вместо эмодзи: системные рисуются по-разному на
    // каждом телефоне и рядом с котами выглядят чужеродно. Закрытые не прячем
    // и не подменяем заглушкой — видно, что именно предстоит получить.
    const icon = document.createElement("span");
    icon.className = "achievement-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = achievementSvg(item.id, 28);

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
  setupTabs();
  setupCity(profile);
}

/* ── Вкладки ──────────────────────────────────────────────────────────────
   Переключение по клику и стрелками, как положено role="tablist". Панель
   города при этом не пересоздаётся: мир продолжает жить, просто не рисуется,
   пока его не видно, — и не жжёт батарею. */

let world = null;

function setupTabs() {
  const tabs = [el("tab-cat"), el("tab-city")];
  const panels = [el("main"), el("panel-city")];
  const title = el("page-title");

  const select = (index) => {
    tabs.forEach((tab, i) => {
      const on = i === index;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      panels[i].hidden = !on;
    });
    title.textContent = index === 0 ? "Мой Claude-кот" : "Мой город";
    if (index === 1) world?.start();
    else world?.stop();
    // Кнопка «поделиться» — про кота: на карте она сбивает с толку.
    if (tg?.MainButton) {
      if (index === 0) tg.MainButton.show();
      else tg.MainButton.hide();
    }
    try {
      localStorage.setItem("tab", String(index));
    } catch {
      /* ничего */
    }
  };

  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => select(i));
    tab.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const next = (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      select(next);
      tabs[next].focus();
    });
  });

  let remembered = 0;
  try {
    remembered = Number(localStorage.getItem("tab") || 0);
  } catch {
    /* ничего */
  }
  select(remembered === 1 ? 1 : 0);
}

/* ── Мой город ────────────────────────────────────────────────────────── */

function setupCity(profile) {
  const canvas = el("city-map");
  const seed = profile.world?.seed ?? 1;
  const chronicleList = el("chronicle");
  const racesList = el("races");

  const renderChronicle = (items) => {
    chronicleList.replaceChildren();
    if (!items.length) {
      const li = document.createElement("li");
      li.className = "chronicle-empty";
      li.append(text("Пока тихо. Ткни в карту — и что-нибудь случится."));
      chronicleList.append(li);
      return;
    }
    for (const item of items) {
      const li = document.createElement("li");
      li.append(text(item.text));
      chronicleList.append(li);
    }
  };

  let selectedRace = 0;
  const renderRaces = (races) => {
    racesList.replaceChildren();
    races.forEach((race, r) => {
      const li = document.createElement("li");
      li.className = `race${r === selectedRace ? " race--on" : ""}`;
      li.style.setProperty("--race-color", race.fur === "#e8e2cf" ? race.hat : race.fur);
      li.setAttribute("role", "button");
      li.tabIndex = 0;
      li.setAttribute("aria-pressed", String(r === selectedRace));

      const name = document.createElement("span");
      name.className = "race-name";
      name.append(text(race.name));
      const pop = document.createElement("span");
      pop.className = "race-pop";
      pop.append(text(nf.format(race.pop)));
      const sub = document.createElement("span");
      sub.className = "race-sub";
      sub.append(text(`${race.houses} дом${plural(race.houses)} · ${race.mood}`));
      li.append(name, pop, sub);

      const choose = () => {
        selectedRace = r;
        world?.setRace(r);
        for (const node of racesList.children) {
          const on = Number(node.dataset.race) === r;
          node.classList.toggle("race--on", on);
          node.setAttribute("aria-pressed", String(on));
        }
        el("city-hint").textContent = `Выбраны ${race.name.toLowerCase()}: коты и дома будут их.`;
      };
      li.dataset.race = String(r);
      li.addEventListener("click", choose);
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          choose();
        }
      });
      racesList.append(li);
    });
  };

  world = createWorld({
    seed,
    stats: {
      tokens: profile.totals?.tokens ?? 0,
      sessions: profile.totals?.sessions ?? 0,
      streakDays: profile.totals?.streakDays ?? 0,
    },
    canvas,
    onEvent: renderChronicle,
    onRaces: renderRaces,
  });
  renderChronicle(world.chronicle);

  el("city-caption").textContent =
    `Остров №${seed % 10000}. На нём ${nf.format(world.population)} кот${plural(world.population)} четырёх народов. ` +
    `Остров растёт от твоей работы с ботом.`;

  // Силы бога.
  const powers = document.querySelectorAll(".power");
  const hints = {
    cat: "Ткни в сушу — там появится кот выбранного народа.",
    house: "Ткни в сушу — там встанет дом. Гномы строят в горах.",
    tree: "Ткни в сушу — вырастет дерево. Эльфы будут рады.",
    fire: "Ткни в дерево или дом. Осторожно: огонь перекидывается.",
    meteor: "Ткни куда угодно. Будет кратер.",
  };
  powers.forEach((button) => {
    button.addEventListener("click", () => {
      powers.forEach((b) => {
        const on = b === button;
        b.classList.toggle("power--on", on);
        b.setAttribute("aria-pressed", String(on));
      });
      world.setPower(button.dataset.power);
      el("city-hint").textContent = hints[button.dataset.power] ?? "";
      tg?.HapticFeedback?.selectionChanged?.();
    });
  });

  // click, а не pointerdown: при приближенной карте палец сперва скроллит,
  // и «тык» с началом прокрутки — разные жесты. click срабатывает только на
  // настоящее касание без движения.
  canvas.addEventListener("click", (e) => {
    world.tapAt(e.clientX, e.clientY);
    tg?.HapticFeedback?.impactOccurred?.("light");
  });

  // Зум ×2: карта шире экрана, вьюпорт прокручивается. Центрируем на том же
  // месте, куда смотрели, — иначе после нажатия остров уезжает в угол.
  const zoomButton = el("city-zoom");
  const frame = zoomButton.closest(".city-frame");
  const viewport = el("city-viewport");
  zoomButton.addEventListener("click", () => {
    const on = !frame.classList.contains("city-frame--zoom");
    const ratioX = (viewport.scrollLeft + viewport.clientWidth / 2) / viewport.scrollWidth;
    const ratioY = (viewport.scrollTop + viewport.clientHeight / 2) / viewport.scrollHeight;
    frame.classList.toggle("city-frame--zoom", on);
    zoomButton.setAttribute("aria-pressed", String(on));
    zoomButton.setAttribute("aria-label", on ? "Отдалить карту" : "Приблизить карту");
    zoomButton.textContent = on ? "🔎" : "🔍";
    requestAnimationFrame(() => {
      viewport.scrollLeft = ratioX * viewport.scrollWidth - viewport.clientWidth / 2;
      viewport.scrollTop = ratioY * viewport.scrollHeight - viewport.clientHeight / 2;
    });
  });

  el("city-reset").addEventListener("click", () => {
    const go = () => {
      world.reset();
      location.reload();
    };
    if (tg?.showConfirm) tg.showConfirm("Стереть все вмешательства и вырастить остров заново?", (ok) => ok && go());
    else if (confirm("Стереть все вмешательства и вырастить остров заново?")) go();
  });
}

function plural(n) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "а";
  return "ов";
}

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

  list.hidden = false;
  list.replaceChildren();

  // Объяснений тут не место: человек открыл посмотреть числа. Подсказка
  // остаётся одна и короткая — и только когда потолок не задан, то есть когда
  // шкале и правда не от чего считаться.
  const безПотолка = limits.some((l) => l.utilization === null && !l.ceiling);
  note.hidden = !безПотолка;
  if (безПотолка) note.textContent = "Потолок окна не задан — процент показать не от чего.";

  for (const limit of limits) {
    // Ключ берём из типа окна, а не из индекса: число строк меняется, и на
    // индексах id разъехались бы между отрисовками.
    const key = limit.type;
    const name = limit.title ?? limit.type;
    const status = limit.status ? (LIMIT_STATUSES[limit.status] ?? null) : null;
    // Сперва число от Anthropic. Его этим токеном не получить, поэтому
    // запасной путь — доля от потолка, заданного владельцем.
    const fromAnthropic = limit.utilization === null ? null : Math.round(limit.utilization);
    const percent = fromAnthropic ?? limit.ownPercent ?? null;
    const ownScale = fromAnthropic === null && percent !== null;
    const own = limit.own;

    const li = document.createElement("li");
    li.className = "limit";

    const head = document.createElement("div");
    head.className = "limit-head";
    const nameEl = document.createElement("span");
    nameEl.className = "limit-name";
    nameEl.id = `limit-name-${key}`;
    nameEl.append(text(name));

    const valueEl = document.createElement("span");
    valueEl.className = ownScale ? "limit-percent limit-percent--own" : "limit-percent";
    valueEl.append(text(percent === null ? formatOwn(own?.subscription?.tokens) : `${percent}%`));
    head.append(nameEl, valueEl);

    const track = document.createElement("div");
    track.className =
      percent === null ? "progress-track progress-track--unknown" : "progress-track";
    track.id = `limit-bar-${key}`;
    track.setAttribute("aria-labelledby", nameEl.id);
    track.setAttribute("aria-describedby", `limit-foot-${key}`);

    if (percent === null) {
      // Полосу без числа не изображаем: нарисованный «примерно столько» врал бы
      // ровно там, где человек ищет точность. Пустая дорожка честнее.
      track.setAttribute("role", "img");
      track.setAttribute(
        "aria-label",
        `Процент недоступен. Замер за окно: ${nf.format(own?.subscription?.tokens ?? 0)} токенов`,
      );
    } else {
      track.setAttribute("role", "progressbar");
      track.setAttribute("aria-valuemin", "0");
      track.setAttribute("aria-valuemax", "100");
      track.setAttribute("aria-valuenow", String(percent));
      const reset = limit.resetsAt === null ? "" : `, сброс ${untilReset(limit.resetsAt)}`;
      // Статус дублируется словом: попав сразу на полосу мимо подписи,
      // пользователь всё равно узнает состояние, не полагаясь на цвет.
      track.setAttribute(
        "aria-valuetext",
        `${percent} процентов${ownScale ? " от своего потолка" : ""}${status ? `, ${status.word.toLowerCase()}` : ""}${reset}`,
      );
      const fill = document.createElement("div");
      fill.className = `progress-fill progress-fill--${limit.status ?? "allowed"}`;
      fill.style.width = `${percent}%`;
      track.append(fill);
    }

    const foot = document.createElement("p");
    foot.className = "limit-foot";
    foot.id = `limit-foot-${key}`;

    if (status) {
      const badge = document.createElement("span");
      badge.className = `badge badge--${limit.status}`;
      const badgeIcon = document.createElement("span");
      badgeIcon.setAttribute("aria-hidden", "true");
      badgeIcon.append(text(status.icon));
      badge.append(badgeIcon, text(` ${status.word}`));
      foot.append(badge);
    }

    if (limit.resetsAt !== null) {
      const when = document.createElement("span");
      const time = document.createElement("time");
      time.dateTime = new Date(limit.resetsAt).toISOString();
      time.append(text(untilReset(limit.resetsAt)));
      when.append(text("Сброс "), time);
      foot.append(when);
    }

    if (own) {
      // Полное число — то, что списывается с подписки, вместе с кэшем.
      // Рядом доля бота: остальное — работа Claude Code мимо чата.
      const ownEl = document.createElement("span");
      const из = limit.ceiling ? ` из ${formatOwn(limit.ceiling)}` : "";
      ownEl.append(
        text(
          `${nf.format(own.subscription.tokens)}${из} токенов, через бота ${nf.format(own.bot.tokens)}`,
        ),
      );
      foot.append(ownEl);
    }

    if (limit.seenAt) {
      const seenEl = document.createElement("span");
      seenEl.append(text(`данные на ${timeFormat.format(new Date(limit.seenAt))}`));
      foot.append(seenEl);
    }

    li.append(head, track, foot);
    list.append(li);
  }
}

/** Короткая запись расхода за окно: 14 402 → «14,4 тыс.». */
function formatOwn(value = 0) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(".", ",")} млн`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(".", ",")} тыс.`;
  return String(value);
}
/**
 * Короткое сообщение поверх страницы. Нужно там, где действие само по себе
 * невидимо: скопировали в буфер — человек нажал и должен увидеть, что вышло.
 */
function сообщить(текст) {
  if (tg?.showPopup) {
    tg.showPopup({ message: текст });
    return;
  }
  const toast = el("toast");
  toast.textContent = текст;
  toast.hidden = false;
  clearTimeout(сообщить.таймер);
  сообщить.таймер = setTimeout(() => {
    toast.hidden = true;
  }, 2500);
}

function setupShare(profile) {
  const line = `Мой Claude-кот: ${profile.cat.name} (уровень ${profile.cat.level}/10), ${nf.format(profile.totals.tokens)} токенов`;

  const share = () => {
    // Через обычную ссылку «поделиться», а не switchInlineQuery: тот требует
    // включённого инлайн-режима в BotFather, а без него молча не делает ничего.
    // Ссылка открывает штатный выбор чата в любом клиенте.
    const кудаВедёт = profile.botUsername ? `https://t.me/${profile.botUsername}` : "https://t.me";
    const адрес = `https://t.me/share/url?url=${encodeURIComponent(кудаВедёт)}&text=${encodeURIComponent(line)}`;

    if (tg?.openTelegramLink) {
      tg.openTelegramLink(адрес);
      return;
    }
    if (navigator.share) {
      void navigator.share({ text: line, url: кудаВедёт }).catch(() => undefined);
      return;
    }
    // Последний рубеж — буфер обмена. Молча копировать нельзя: человек нажал
    // и должен видеть, что что-то произошло.
    void navigator.clipboard
      ?.writeText(`${line} ${кудаВедёт}`)
      .then(() => сообщить("Скопировано в буфер обмена"))
      .catch(() => сообщить("Не вышло поделиться"));
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

/* ── График расхода по дням ───────────────────────────────────────────────
   Форма выбрана по задаче: расход за сутки — величина за дискретный период,
   это столбцы, а не линия. Серия одна, поэтому легенды нет — её роль играет
   заголовок раздела.

   Геометрия считается в настоящих пикселях по ширине контейнера, а не
   растягивается через preserveAspectRatio: растяжение размазало бы скругления
   и толщину линий вместе с картинкой. */

const SVG_NS = "http://www.w3.org/2000/svg";
const PLOT_HEIGHT = 88;
const BAR_GAP = 2;
const CORNER = 4;
/** Высота засечки для дня без работы. */
const EMPTY_STUB = 2;

let chartDays = [];

function svgEl(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function dayLabel(iso) {
  const [, month, day] = iso.split("-");
  return `${day}.${month}`;
}

function dayFull(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

function renderChart(days) {
  chartDays = days ?? [];
  const box = el("chart");
  const note = el("chart-note");
  const tbody = el("chart-table").querySelector("tbody");

  const total = chartDays.reduce((sum, d) => sum + d.tokens, 0);
  if (chartDays.length === 0 || total === 0) {
    box.hidden = true;
    note.textContent =
      "Пока пусто: график наполнится, когда агент поработает. Импортированная история сюда не попадает — в ней нет разбивки по дням.";
    tbody.replaceChildren();
    return;
  }

  box.hidden = false;
  note.textContent = `За две недели — ${nf.format(total)} токенов.`;

  drawChart();
  fillChartTable(tbody);
}

function drawChart() {
  const svg = el("chart-svg");
  const width = el("chart").clientWidth || 320;
  const count = chartDays.length;
  const barWidth = Math.max(3, (width - BAR_GAP * (count - 1)) / count);
  const peak = Math.max(...chartDays.map((d) => d.tokens));
  const peakIndex = chartDays.findIndex((d) => d.tokens === peak);
  // Место под подпись пика: без запаса она вылезала бы за верх картинки.
  const barsTop = 16;
  const usable = PLOT_HEIGHT - barsTop;

  svg.setAttribute("viewBox", `0 0 ${width} ${PLOT_HEIGHT}`);
  svg.setAttribute("width", width);
  svg.setAttribute("height", PLOT_HEIGHT);

  const title = svg.querySelector("title");
  svg.replaceChildren(title);
  title.textContent =
    `Столбчатый график расхода за ${count} дней. ` +
    `Больше всего ${dayFull(chartDays[peakIndex].day)} — ${nf.format(peak)} токенов. ` +
    `Точные числа по дням есть в таблице ниже.`;

  chartDays.forEach((day, index) => {
    const x = index * (barWidth + BAR_GAP);
    const isEmpty = day.tokens === 0;
    // Минимум три пикселя у непустого дня: иначе слабый день неотличим от нуля.
    const height = isEmpty ? EMPTY_STUB : Math.max(3, Math.round((day.tokens / peak) * usable));
    const y = PLOT_HEIGHT - height;

    svg.append(
      svgEl("rect", {
        class: isEmpty ? "bar-empty" : "bar",
        x: x.toFixed(2),
        y,
        width: barWidth.toFixed(2),
        height,
        rx: Math.min(CORNER, barWidth / 2, height / 2),
      }),
    );

    const hit = svgEl("rect", {
      class: "hit",
      x: x.toFixed(2),
      y: 0,
      width: (barWidth + BAR_GAP).toFixed(2),
      height: PLOT_HEIGHT,
      tabindex: "-1",
    });
    hit.addEventListener("pointerenter", () => showTip(index, x + barWidth / 2, width));
    hit.addEventListener("pointerdown", () => showTip(index, x + barWidth / 2, width));
    hit.addEventListener("pointerleave", hideTip);
    svg.append(hit);

    if (index === peakIndex) {
      svg.append(
        Object.assign(
          svgEl("text", {
            class: "peak-label",
            x: (x + barWidth / 2).toFixed(2),
            y: Math.max(11, y - 5),
          }),
          { textContent: compactTokens(day.tokens) },
        ),
      );
    }
  });

  svg.append(
    svgEl("line", {
      class: "baseline",
      x1: 0,
      y1: PLOT_HEIGHT + 0.5,
      x2: width,
      y2: PLOT_HEIGHT + 0.5,
    }),
  );

  // По краям — только первая и последняя дата: четырнадцать подписей на
  // телефоне налезают друг на друга и не читаются вовсе.
  const axis = el("chart-axis");
  axis.replaceChildren();
  const first = document.createElement("span");
  first.append(text(dayLabel(chartDays[0].day)));
  const last = document.createElement("span");
  last.append(text("сегодня"));
  axis.append(first, last);
}

/** Короткая запись для подписи над столбцом: 12 300 → «12,3К». */
function compactTokens(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(".", ",")}М`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(".", ",")}К`;
  return String(value);
}

function showTip(index, centerX, width) {
  const day = chartDays[index];
  const tip = el("chart-tip");
  tip.textContent = `${dayFull(day.day)} · ${nf.format(day.tokens)} токенов`;
  tip.hidden = false;
  // Не даём подсказке уехать за край экрана — на узком телефоне это заметно.
  const half = tip.offsetWidth / 2;
  const clamped = Math.min(Math.max(centerX, half), width - half);
  tip.style.left = `${clamped}px`;
}

function hideTip() {
  el("chart-tip").hidden = true;
}

function fillChartTable(tbody) {
  tbody.replaceChildren();
  for (const day of chartDays) {
    const row = document.createElement("tr");
    const head = document.createElement("th");
    head.setAttribute("scope", "row");
    head.append(text(dayFull(day.day)));
    const value = document.createElement("td");
    value.append(text(nf.format(day.tokens)));
    row.append(head, value);
    tbody.append(row);
  }
}

// Поворот телефона меняет ширину: геометрия в пикселях, поэтому пересчитываем.
let resizeTimer = null;
window.addEventListener("resize", () => {
  if (chartDays.length === 0) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(drawChart, 150);
});

/* ── Кооп ─────────────────────────────────────────────────────────────────
   Таблица тех, кто работает на одной подписке. Сортируется по расходу в боте,
   а не по общему: у владельца обычно есть импортированная история, и сравнивать
   с ней тех, кто пришёл вчера, бессмысленно. */

function renderCoop(members) {
  const section = el("coop-section");
  // Одному таблица не нужна: он и так знает, сколько потратил.
  if (!members || members.length < 2) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  const total = members.reduce((sum, m) => sum + m.tokensInBot, 0);
  el("coop-note").textContent =
    `${members.length} на одной подписке, вместе ${nf.format(total)} токенов через бота. ` +
    `Кот у каждого свой — он растёт от собственного расхода.`;

  const list = el("coop");
  list.replaceChildren();

  const порядок = [...members].sort((a, b) => b.tokensInBot - a.tokensInBot);
  for (const member of порядок) {
    const li = document.createElement("li");
    li.className = `coop-row${member.isYou ? " coop-row--you" : ""}`;

    const art = document.createElement("div");
    art.className = "coop-cat";
    art.innerHTML = catSvg(member.cat, 44);

    const body = document.createElement("div");
    body.className = "coop-body";

    const name = document.createElement("span");
    name.className = "coop-name";
    name.append(text(member.name || `id ${member.id}`));
    if (member.isYou) {
      const you = document.createElement("span");
      you.className = "coop-tag";
      you.append(text("ты"));
      name.append(you);
    }
    if (member.isPayer) {
      // Кто платит — видно словом, а не только порядком в списке.
      const payer = document.createElement("span");
      payer.className = "coop-tag coop-tag--payer";
      payer.append(text("подписка"));
      name.append(payer);
    }

    const under = document.createElement("span");
    under.className = "coop-sub";
    // Квота идёт сразу под именем: она важнее уровня кота, когда упираешься.
    const квота = member.quota
      ? ` · сегодня ${nf.format(member.quota.used)} из ${nf.format(member.quota.limit)}`
      : "";
    under.append(text(`${member.cat.name} · уровень ${member.cat.level}${квота}`));

    body.append(name, under);

    const value = document.createElement("div");
    value.className = "coop-value";
    const tokens = document.createElement("span");
    tokens.className = "coop-tokens";
    tokens.append(text(nf.format(member.tokensInBot)));
    const label = document.createElement("span");
    label.className = "coop-label";
    label.append(text("токенов"));
    value.append(tokens, label);

    li.append(art, body, value);
    list.append(li);
  }
}

/**
 * Своя суточная квота. Показывается только тем, кому её поставили: у
 * большинства ограничения нет, и пустая шкала «0 из ∞» была бы шумом.
 */
function renderQuota(quota) {
  const box = el("quota");
  if (!quota) {
    box.hidden = true;
    return;
  }
  box.hidden = false;

  const percent = Math.min(100, Math.round((quota.used / quota.limit) * 100));
  el("quota-value").textContent = `${nf.format(quota.used)} из ${nf.format(quota.limit)}`;

  const track = el("quota-track");
  track.setAttribute("role", "progressbar");
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", "100");
  track.setAttribute("aria-valuenow", String(percent));
  track.setAttribute(
    "aria-valuetext",
    quota.left > 0
      ? `${percent} процентов суточной квоты, осталось ${nf.format(quota.left)} токенов`
      : "суточная квота исчерпана",
  );

  const fill = el("quota-fill");
  fill.style.width = `${percent}%`;
  // Состояние передаётся словом ниже, а цвет только поддерживает его.
  fill.className = `progress-fill progress-fill--${quota.left > 0 ? "allowed" : "rejected"}`;

  el("quota-left").textContent =
    quota.left > 0
      ? `Осталось ${nf.format(quota.left)} токенов до конца суток.`
      : "Квота на сегодня исчерпана — обнулится завтра.";
}
