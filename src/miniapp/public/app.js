import { catSvg, claudeStar } from "./cat-art.js";
import { achievementSvg } from "./achievement-art.js";
import { createWorld, RACES, TERRAIN_TOOLS, MAPS, renderPreview, W, H } from "./world.js";
import { icon } from "./icons.js";

const tg = window.Telegram?.WebApp;
const nf = new Intl.NumberFormat("ru-RU");

/*
  Настоящий клиент Telegram узнаётся по initData или известной платформе:
  telegram-web-app.js создаёт объект WebApp и в обычном браузере, где все
  его кнопки — заглушки.
*/
const inTelegram = Boolean(tg?.initData) || Boolean(tg?.platform && tg.platform !== "unknown");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/* Telegram на Android дописывает в User-Agent класс устройства: LOW, AVERAGE, HIGH. */
const perfLow = /Telegram-Android\/[^(]*\([^)]*\bLOW\)/i.test(navigator.userAgent);

/* ────────────────────────────────────────────────────────────────────────── */

function el(id) {
  return document.getElementById(id);
}

function text(value) {
  return document.createTextNode(String(value));
}

function can(version) {
  return Boolean(tg?.isVersionAtLeast?.(version));
}

/** Отклик под пальцем. Вне Telegram и на старых клиентах — молча ничего. */
function haptic(kind) {
  if (!inTelegram || !can("6.1")) return;
  try {
    if (kind === "selection") tg.HapticFeedback.selectionChanged();
    else if (kind === "success") tg.HapticFeedback.notificationOccurred("success");
    else tg.HapticFeedback.impactOccurred(kind);
  } catch {
    /* украшение, не больше */
  }
}

/** 14 402 → «14,4 тыс.» — для подписей, где полное число только мешает. */
function short(value = 0) {
  if (value >= 1_000_000)
    return `${(value / 1_000_000).toFixed(1).replace(".", ",").replace(",0", "")} млн`;
  if (value >= 10_000) return `${Math.round(value / 1000)} тыс.`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(".", ",").replace(",0", "")} тыс.`;
  return nf.format(value);
}

/* ── Тема ──────────────────────────────────────────────────────────────────
   Цвета страницы Telegram отдаёт CSS-переменными сам. Здесь — схема для
   запасных цветов и шапка с нижней панелью в цвет фона: иначе сверху и снизу
   видны полосы другого оттенка, и мини-апп выглядит вставленным, а не своим. */

function applyTheme() {
  const dark = inTelegram
    ? tg.colorScheme === "dark"
    : window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.scheme = dark ? "dark" : "light";
  if (!inTelegram) return;
  try {
    if (can("6.1")) {
      tg.setHeaderColor("secondary_bg_color");
      tg.setBackgroundColor("secondary_bg_color");
    }
    if (can("7.10")) tg.setBottomBarColor("secondary_bg_color");
  } catch {
    /* старый клиент — останется его цвет */
  }
}

/* ── Появление секций ──────────────────────────────────────────────────────
   Секция проявляется, когда до неё долистали. Наблюдатель один на всех и
   отпускает элемент сразу после показа. */

let revealer = null;

function setupReveal() {
  if (reduceMotion || perfLow || !("IntersectionObserver" in window)) return;
  document.documentElement.classList.add("js-reveal");
  revealer = new window.IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-in");
        revealer.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
  );
  document.querySelectorAll(".reveal").forEach((node) => revealer.observe(node));
}

/**
 * Живые коты стоят, пока их не видно: десяток SVG-анимаций за краем ленты
 * тратит батарею впустую. Класс is-visible снимает паузу в CSS.
 */
let visibility = null;

function watchVisible(node, root = null) {
  if (!("IntersectionObserver" in window)) {
    node.classList.add("is-visible");
    return;
  }
  visibility ??= new Map();
  const key = root ?? document;
  let observer = visibility.get(key);
  if (!observer) {
    observer = new window.IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          entry.target.classList.toggle("is-visible", entry.isIntersecting);
      },
      { root, rootMargin: "40px" },
    );
    visibility.set(key, observer);
  }
  observer.observe(node);
}

/** Число набегает от нуля: цифра, которая «доехала», читается как итог. */
function countUp(node, to, format = (v) => nf.format(v)) {
  if (reduceMotion || perfLow || to < 10) {
    node.textContent = format(to);
    return;
  }
  // Итог ставим сразу: если кадры не идут (мини-апп ещё открывается или
  // свёрнут), человек увидит настоящее число, а не застрявший ноль.
  node.textContent = format(to);
  let start = 0;
  const duration = 900;
  const step = (now) => {
    start ||= now;
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    node.textContent = format(Math.round(to * eased));
    if (t < 1) window.requestAnimationFrame(step);
  };
  window.requestAnimationFrame(step);
}

/** Последнее касание было клавишей — значит фокус надо вести явно. */
let keyboardUser = false;
window.addEventListener("keydown", () => (keyboardUser = true), true);
window.addEventListener("pointerdown", () => (keyboardUser = false), true);

/* ── Профиль ───────────────────────────────────────────────────────────── */

const RING = 2 * Math.PI * 54;

function render(profile) {
  const { cat, cats, achievements, totals, today, model, bot } = profile;

  el("plan-line").textContent = model?.label ? `✦ ${model.label.split(" — ")[0]}` : "";

  // Герой
  el("hero-cat").innerHTML = catSvg(cat, 118, { animated: true });
  el("hero-level").textContent = `Уровень ${cat.level} из ${cats.length}`;
  el("hero-name").textContent = cat.name;
  el("hero-title").textContent = cat.title;
  el("hero-quote").textContent = `«${cat.quote}»`;
  watchVisible(document.querySelector(".hero"));

  // Прогресс: кольцо вокруг кота и полоса под ним показывают одно и то же —
  // кольцо ловит взгляд, полоса даёт точные числа. aria-valuetext — фразой.
  const progress = cat.nextThreshold === null ? 1 : Math.max(0, Math.min(1, cat.progress));
  const percent = Math.round(progress * 100);
  const bar = el("progress-bar");
  bar.setAttribute("aria-valuenow", String(percent));
  el("progress-percent").textContent = `${percent}%`;

  if (cat.nextThreshold === null) {
    el("progress-label").textContent = "Максимальный уровень";
    bar.setAttribute("aria-valuetext", "Максимальный уровень достигнут");
    el("progress-caption").textContent =
      `Потрачено ${nf.format(totals.tokens)} токенов — дальше расти некуда.`;
  } else {
    const left = cat.nextThreshold - totals.tokens;
    el("progress-label").textContent = `До «${cat.nextName}»`;
    bar.setAttribute(
      "aria-valuetext",
      `${percent} процентов до уровня ${cat.nextName}: осталось ${nf.format(left)} токенов`,
    );
    el("progress-caption").textContent =
      `${short(totals.tokens)} из ${short(cat.nextThreshold)} · осталось ${short(left)}`;
  }
  // Таймер, а не кадр анимации: кадры в свёрнутом WebView не приходят, а
  // значение должно встать в любом случае. Переход доиграет CSS.
  setTimeout(() => {
    el("hero-ring").style.strokeDashoffset = `${(RING * (1 - progress)).toFixed(1)}px`;
    el("progress-fill").style.transform = `scaleX(${progress})`;
  }, 60);

  renderStats(bot, totals, today);
  renderChart(profile.usageByDay ?? []);
  renderCoop(profile.coop ?? []);
  renderCats(cats, cat);
  renderAchievements(achievements);

  setupShare(profile);
  setupTabs();
  setupCity(profile);
  setupReveal();
}

/* Статистика. Денег и отказов здесь нет: сумма «по API» пугала и ничего не
   решала, а число отклонённых инструментов — служебное. */
function renderStats(bot, totals, today) {
  const items = [
    { icon: "🪙", value: bot.tokens, label: "токенов через бота", wide: true, side: today.tokens },
    {
      icon: "🔥",
      value: totals.streakDays,
      label: plural(totals.streakDays, "день подряд", "дня подряд", "дней подряд"),
    },
    {
      icon: "💬",
      value: bot.messages,
      label: plural(bot.messages, "сообщение", "сообщения", "сообщений"),
    },
    {
      icon: "🗂️",
      value: totals.sessions,
      label: plural(totals.sessions, "сессия", "сессии", "сессий"),
    },
    { icon: "🛠️", value: totals.toolsAllowed, label: "действий агента" },
  ];

  const list = el("stats");
  list.replaceChildren();
  for (const item of items) {
    const li = document.createElement("li");
    li.className = `stat${item.wide ? " stat--wide" : ""}`;

    const badge = document.createElement("span");
    badge.className = "stat-icon";
    badge.setAttribute("aria-hidden", "true");
    // У главной цифры — фирменная звезда Claude, у остальных — эмодзи.
    if (item.wide) badge.innerHTML = claudeStar(24);
    else badge.append(text(item.icon));

    const body = document.createElement("div");
    body.className = "stat-body";
    const value = document.createElement("span");
    value.className = "stat-value";
    const label = document.createElement("span");
    label.className = "stat-label";
    label.append(text(item.label));
    body.append(value, label);
    li.append(badge, body);

    if (item.wide) {
      const side = document.createElement("div");
      side.className = "stat-side";
      const b = document.createElement("b");
      b.append(text(`+${short(item.side)}`));
      const s = document.createElement("span");
      s.append(text("сегодня"));
      side.append(b, s);
      li.append(side);
    }

    list.append(li);
    countUp(value, item.value);
  }
}

/* ── Коты ──────────────────────────────────────────────────────────────── */

function renderCats(cats, current) {
  const open = cats.filter((c) => c.unlocked).length;
  el("cats-count").textContent = `${open} из ${cats.length}`;
  el("cats-note").textContent = "Уровень растёт от потраченных токенов. Листай вбок.";

  const rail = el("cat-grid");
  rail.replaceChildren();
  let currentCard = null;

  cats.forEach((item, index) => {
    const li = document.createElement("li");
    const isCurrent = item.level === current.level;
    li.className = `cat-card${item.unlocked ? "" : " cat-card--locked"}${isCurrent ? " cat-card--current" : ""}`;
    if (isCurrent) {
      li.setAttribute("aria-current", "true");
      currentCard = li;
    }

    const art = document.createElement("div");
    art.className = "cat-art";
    // Живые вразнобой: одинаковый такт у десятка котов читается как дребезг.
    art.innerHTML = catSvg(item, 72, { animated: item.unlocked });
    const sprite = art.firstElementChild;
    if (sprite) sprite.style.animationDelay = -(index % 5) * 0.9 + "s";

    const level = document.createElement("span");
    level.className = "cat-card-level";
    level.append(text(isCurrent ? "Сейчас" : `Уровень ${item.level}`));

    const name = document.createElement("span");
    name.className = "cat-card-name";
    name.append(text(item.name));

    // Статус словом, а не только бледностью: цвет различают не все.
    const threshold = document.createElement("span");
    threshold.className = "cat-card-threshold";
    threshold.append(
      text(item.unlocked ? `✓ от ${short(item.threshold)}` : `🔒 от ${short(item.threshold)}`),
    );

    li.append(art, level, name, threshold);
    rail.append(li);
    watchVisible(li, rail);
  });

  // Текущий кот — в поле зрения, без прокрутки на глазах.
  if (currentCard) {
    setTimeout(() => {
      rail.scrollLeft = Math.max(
        0,
        currentCard.offsetLeft - rail.clientWidth / 2 + currentCard.offsetWidth / 2,
      );
    }, 0);
  }
}

/* ── Достижения ────────────────────────────────────────────────────────────
   Плитки вместо простыни: значок и имя видны сразу, условие — по нажатию,
   в системном окне Telegram. */

function renderAchievements(achievements) {
  const got = achievements.filter((a) => a.unlocked).length;
  el("ach-count").textContent = `${got} из ${achievements.length}`;
  el("ach-note").textContent = "Нажми на значок — расскажу, как его получить.";

  const list = el("achievements");
  list.replaceChildren();
  for (const item of achievements) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = `badge${item.unlocked ? "" : " badge--locked"}`;

    const art = document.createElement("span");
    art.className = "badge-icon";
    art.setAttribute("aria-hidden", "true");
    art.innerHTML = achievementSvg(item.id, 30);
    if (!item.unlocked) art.insertAdjacentHTML("beforeend", '<span class="badge-lock">🔒</span>');

    const name = document.createElement("span");
    name.className = "badge-name";
    name.append(text(item.name));

    const status = document.createElement("span");
    status.className = "visually-hidden";
    status.append(text(item.unlocked ? ". Получено" : ". Ещё не получено"));

    button.append(art, name, status);
    button.addEventListener("click", () => {
      haptic("selection");
      сообщить(`${item.unlocked ? "✅" : "🔒"} ${item.description}`, item.name);
    });
    li.append(button);
    list.append(li);
  }
}

/* ── Вкладки ──────────────────────────────────────────────────────────────
   Переключение кликом и стрелками, как положено role="tablist". Город при
   этом не пересоздаётся: мир живёт, просто не рисуется, пока его не видно. */

let world = null;

function setupTabs() {
  const tabs = [el("tab-cat"), el("tab-city")];
  const panels = [el("main"), el("panel-city")];
  const segmented = document.querySelector(".segmented");
  let current = -1;

  const select = (index, animate = true) => {
    if (index === current) return;
    const from = current;
    current = index;
    tabs.forEach((tab, i) => {
      const on = i === index;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      panels[i].hidden = !on;
    });
    segmented.dataset.active = String(index);
    document.documentElement.classList.toggle("on-city", index === 1);

    const panel = panels[index];
    if (animate && from !== -1 && !reduceMotion) {
      panel.dataset.from = index > from ? "right" : "left";
      panel.classList.remove("is-entering");
      void panel.offsetWidth;
      panel.classList.add("is-entering");
      panel.addEventListener("animationend", () => panel.classList.remove("is-entering"), {
        once: true,
      });
    }
    if (from !== -1) window.scrollTo(0, 0);

    el("page-title").textContent = index === 0 ? "Мой Claude-кот" : "Мой мир";
    if (index === 1) world?.start();
    else world?.stop();

    // На карте палец рисует: жест «вниз» не должен сворачивать мини-апп.
    if (inTelegram && can("7.7")) {
      try {
        if (index === 1) tg.disableVerticalSwipes();
        else tg.enableVerticalSwipes();
      } catch {
        /* старый клиент */
      }
    }
    // Кнопка «поделиться» — про кота: на карте она сбивает с толку.
    if (inTelegram && tg.MainButton) {
      if (index === 0) tg.MainButton.show();
      else tg.MainButton.hide();
    }
    if (from !== -1) haptic("selection");
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
  select(remembered === 1 ? 1 : 0, false);
}

/* ── Мой мир ────────────────────────────────────────────────────────────
   Панель инструментов как в WorldBox: снизу категории, над ними инструменты
   категории, над ними подкатегория — народ для котов и домов или размер
   кисти для природы и ландшафта. Рисуют протяжкой: палец ведёт — по следу
   растёт лес или разливается море. Рука двигает карту. */

/* Камера: масштаб от «весь мир в рамке» до крупного плана. */
const MIN_SCALE = 1;
const MAX_SCALE = 6;
/* Запас за краем мира: видно тёмную пустоту и чёрную линию границы. */
const EDGE = 10;
const JOB_LABEL = {
  fisher: "🎣 Рыбак",
  farmer: "🌾 Фермер",
  smith: "⚒️ Кузнец",
  healer: "🌿 Лекарь",
  priest: "🕯️ Жрец",
};

const BRUSHES = [
  { size: 0, label: "1", px: 8 },
  { size: 1, label: "3", px: 13 },
  { size: 2, label: "5", px: 18 },
];

const CATEGORIES = [
  {
    id: "cats",
    icon: "cat",
    name: "Коты",
    sub: "race",
    tools: [
      {
        id: "cat",
        icon: "cat",
        name: "Кот",
        kind: "cat",
        hint: "Веди пальцем по суше — коты выбранного народа появятся по следу.",
      },
      {
        id: "house",
        icon: "house",
        name: "Дом",
        kind: "house",
        hint: "Дом даром, от бога. Сами коты строят за брёвна: 10 на хижину, лес рубят по минуте на дерево.",
      },
      {
        id: "bless",
        icon: "bless",
        name: "Благословить",
        kind: "bless",
        hint: "Выбранный народ получает удачу на время: котята, сила в бою, покой.",
      },
      {
        id: "curse",
        icon: "curse",
        name: "Проклясть",
        kind: "curse",
        hint: "Выбранный народ на время в беде: пожары, бесплодие, ропот.",
      },
      {
        id: "war",
        icon: "war",
        name: "Война",
        kind: "war",
        hint: "Ткни в чужую территорию — выбранный народ объявит ей войну. Лучники, мечи, поджоги.",
      },
    ],
  },
  {
    id: "nature",
    icon: "tree",
    name: "Природа",
    sub: "brush",
    tools: [
      {
        id: "tree",
        icon: "tree",
        name: "Лес",
        kind: "tree",
        hint: "Веди пальцем — вырастает лес. Эльфы-коты будут рады.",
      },
      {
        id: "flowers",
        icon: "flowers",
        name: "Цветы",
        kind: "flowers",
        hint: "Цветы растут только на земле.",
      },
    ],
  },
  {
    id: "terrain",
    icon: "terrain",
    name: "Ландшафт",
    sub: "brush",
    tools: TERRAIN_TOOLS.map((t) => ({
      id: t.id,
      icon: t.id,
      name: t.name,
      kind: "terrain",
      t: t.t,
      hint:
        t.id === "water" || t.id === "deep"
          ? "Разливай море. Дома смоет, коты уплывут к берегу."
          : t.id === "stone"
            ? "Поднимай горы. Ходить по ним умеют только гномы-коты."
            : `Кисть «${t.name.toLowerCase()}»: веди пальцем по карте.`,
    })),
  },
  {
    id: "disaster",
    icon: "disaster",
    name: "Бедствия",
    sub: null,
    tools: [
      {
        id: "fire",
        icon: "fire",
        name: "Огонь",
        kind: "fire",
        hint: "Ткни в дерево или дом. Огонь перекидывается на соседей.",
      },
      {
        id: "bolt",
        icon: "bolt",
        name: "Молния",
        kind: "bolt",
        hint: "Бьёт в точку. Коты разбегаются, дерево загорается.",
      },
      {
        id: "meteor",
        icon: "meteor",
        name: "Метеорит",
        kind: "meteor",
        hint: "Падает с неба. Остаётся кратер.",
      },
      {
        id: "plague",
        icon: "plague",
        name: "Чума",
        kind: "plague",
        hint: "Ткни в котов — болезнь пойдёт от кота к коту. Лекари лечат, но не всех успевают.",
      },
      {
        id: "quake",
        icon: "quake",
        name: "Землетрясение",
        kind: "quake",
        hint: "Тряхнёт остров: дома рушатся, стены трещат, холмы встают горами.",
      },
      {
        id: "tsunami",
        icon: "tsunami",
        name: "Цунами",
        kind: "tsunami",
        hint: "Ткни в море — волна пойдёт на ближайший берег и смоет всё у воды.",
      },
      {
        id: "volcano",
        icon: "volcano",
        name: "Вулкан",
        kind: "volcano",
        hint: "Ткни в гору (или бог поднимет её сам) — вулкан. Извергается сам, лава течёт вниз и застывает камнем.",
      },
      {
        id: "nuke",
        icon: "nuke",
        name: "Атомная",
        kind: "nuke",
        hint: "Одно касание — гриб на полкарты. Всё живое в округе гибнет, земля выгорает на три минуты.",
      },
    ],
  },
  {
    id: "other",
    icon: "other",
    name: "Прочее",
    sub: "brush",
    tools: [
      {
        id: "hand",
        icon: "hand",
        name: "Рука",
        kind: "hand",
        hint: "Тащи карту пальцем, щипком двумя — приближай. Коснись кота или деревни — расскажу, кто это.",
      },
      {
        id: "erase",
        icon: "erase",
        name: "Стереть",
        kind: "erase",
        hint: "Убирает лес, цветы и дома.",
      },
      {
        id: "era",
        icon: "era",
        name: "Эра",
        kind: "era",
        hint: "Ткни в карту — все народы шагнут в следующую эру: Начало → Средневековье → Будущее.",
      },
    ],
  },
];

/* ── Задания бога ─────────────────────────────────────────────────────────
   Песочница без цели быстро надоедает, пустой остров пугает. Цепочка
   заданий ведёт от первого кота до эры Будущего: каждое подсказывает, что
   попробовать дальше, а выполненные растят звание бога. Считаются по тому,
   что мир и так сообщает наружу, — в симуляцию задания не вмешиваются. */

const QUESTS = [
  {
    id: "cats5",
    title: "Первые жители",
    hint: "Выбери народ в «Коты» и проведи пальцем по суше.",
    goal: 5,
    of: (s) => s.pop,
  },
  {
    id: "village",
    title: "Своя деревня",
    hint: "Коты сами основывают поселение, когда их становится больше.",
    goal: 1,
    of: (s) => s.villages,
  },
  {
    id: "houses3",
    title: "Крыша над головой",
    hint: "Дома строят за брёвна — нужен лес рядом. Или поставь дом сам.",
    goal: 3,
    of: (s) => s.houses,
  },
  {
    id: "races2",
    title: "Мы не одни",
    hint: "Посели второй народ в другом углу мира.",
    goal: 2,
    of: (s) => s.races,
  },
  {
    id: "cats25",
    title: "Растущий народ",
    hint: "Каждый дом кормит четверых — котята рождаются, пока есть место.",
    goal: 25,
    of: (s) => s.pop,
  },
  {
    id: "king",
    title: "Да здравствует король",
    hint: "Когда народ окрепнет, у него появится правитель.",
    goal: 1,
    of: (s) => s.kings,
  },
  {
    id: "villages4",
    title: "Мир тесен",
    hint: "Разросшаяся деревня отселяет котов на новое место.",
    goal: 4,
    of: (s) => s.villages,
  },
  {
    id: "medieval",
    title: "Средневековье",
    hint: "Эра приходит со временем и домами. Или ткни «Эрой» из «Прочее».",
    goal: 1,
    of: (s) => s.era,
  },
  {
    id: "war",
    title: "Первая война",
    hint: "Соседи ссорятся сами. Или выбери народ и ткни «Войной» в чужую землю.",
    goal: 1,
    of: (s) => s.wars,
  },
  {
    id: "cats100",
    title: "Сотня хвостов",
    hint: "Больше домов — больше котят. Не жги всё подряд.",
    goal: 100,
    of: (s) => s.pop,
  },
  {
    id: "chronicler",
    title: "Летописец",
    hint: "Мир запоминает события: храмы, бури, пережитые бедствия.",
    goal: 3,
    of: (s) => s.ach,
  },
  {
    id: "future",
    title: "Будущее",
    hint: "Дойди до третьей эры: бластеры и летучие лодки.",
    goal: 2,
    of: (s) => s.era,
  },
];

const RANKS = [
  "Дух без имени",
  "Младший бог",
  "Хранитель",
  "Покровитель",
  "Творец миров",
  "Демиург",
];

function rankFor(done) {
  return RANKS[
    Math.min(RANKS.length - 1, Math.floor((done / QUESTS.length) * (RANKS.length - 1) + 0.0001))
  ];
}

function createQuests(storeKey, onDone) {
  let done = new Set();
  try {
    done = new Set(JSON.parse(localStorage.getItem(storeKey) || "[]"));
  } catch {
    /* начнём с нуля */
  }
  const snapshot = { pop: 0, houses: 0, villages: 0, races: 0, kings: 0, wars: 0, era: 0, ach: 0 };
  let ready = false;

  const render = () => {
    const current = QUESTS.find((q) => !done.has(q.id));
    el("quest-rank").textContent = `✦ ${rankFor(done.size)}`;
    el("quest-count").textContent = `${done.size} из ${QUESTS.length}`;
    const dots = el("quest-dots");
    dots.replaceChildren(
      ...QUESTS.map((q) => {
        const li = document.createElement("li");
        li.className = done.has(q.id) ? "is-done" : q === current ? "is-now" : "";
        return li;
      }),
    );
    if (!current) {
      el("quest-title").textContent = "Все задания выполнены";
      el("quest-hint").textContent =
        "Мир твой. Смотри, как он живёт сам, или переверни его бедствиями.";
      el("quest-fill").style.transform = "scaleX(1)";
      el("quest-progress").textContent = "";
      return;
    }
    const value = Math.min(current.goal, current.of(snapshot));
    el("quest-title").textContent = current.title;
    el("quest-hint").textContent = current.hint;
    el("quest-fill").style.transform = `scaleX(${value / current.goal})`;
    el("quest-progress").textContent = current.goal > 1 ? `${value} из ${current.goal}` : "";
  };

  const check = () => {
    let changed = false;
    for (const q of QUESTS) {
      if (done.has(q.id) || q.of(snapshot) < q.goal) continue;
      done.add(q.id);
      changed = true;
      // При первой загрузке старые успехи засчитываем молча.
      if (ready) onDone(q, rankFor(done.size));
    }
    if (changed) {
      try {
        localStorage.setItem(storeKey, JSON.stringify([...done]));
      } catch {
        /* не сохранилось — пересчитаем */
      }
    }
    render();
  };

  return {
    update(part) {
      Object.assign(snapshot, part);
      check();
    },
    arm() {
      ready = true;
    },
  };
}

function setupCity(profile) {
  const canvas = el("city-map");
  const viewport = el("city-viewport");
  const stage = el("city-stage");
  const wb = document.querySelector(".wb");
  const seed = profile.world?.seed ?? 1;
  let mapId = "island";
  try {
    mapId = localStorage.getItem(`world:map:${seed}`) || "island";
  } catch {
    /* ничего */
  }
  if (!MAPS.some((m) => m.id === mapId)) mapId = "island";

  // Элементы панели — до создания мира: он сразу зовёт колбэки, которые
  // рисуют панель, и константы ниже по коду были бы ещё не объявлены.
  const catsRow = el("wb-cats");
  const toolsRow = el("wb-tools");
  const subRow = el("wb-sub");
  const hint = el("city-hint");

  // Стартовый инструмент — рука: первое движение пальцем должно двигать
  // карту, а не рисовать землю. Кисть выбирают осознанно.
  const HAND_TOOL = CATEGORIES.flatMap((c) => c.tools).find((t) => t.kind === "hand");
  const ui = {
    category: CATEGORIES[0],
    tool: HAND_TOOL,
    race: 0,
    brush: 0,
    pops: [0, 0, 0, 0],
  };

  /* Летопись и народы. */
  const chronicleList = el("chronicle");
  const renderChronicle = (items) => {
    chronicleList.replaceChildren();
    if (!items.length) {
      const li = document.createElement("li");
      li.className = "chronicle-empty";
      li.append(text("Пока тихо. Проведи пальцем по карте — и что-нибудь случится."));
      chronicleList.append(li);
      return;
    }
    for (const item of items.slice(0, 40)) {
      const li = document.createElement("li");
      const day = document.createElement("span");
      day.className = "chronicle-day";
      day.append(text(`Д${item.day ?? 1}`));
      const body = document.createElement("span");
      body.append(text(item.text));
      li.append(day, body);
      chronicleList.append(li);
    }
  };

  // Численность народов держим при себе и показываем прямо в кнопках выбора
  // народа: отдельные карточки внизу дублировали панель.
  const labels = el("city-labels");
  const renderRaces = (races) => {
    ui.pops = races.map((r) => r.pop);
    quests?.update({ races: races.filter((r) => r.pop > 0).length });
    if (ui.category.sub === "race") renderSub();
  };
  // Подпись у каждой деревни: название и сколько в ней котов, как у
  // поселений в WorldBox. Цвет рамки — народа.
  const renderVillages = ({ villages, wars, allies, atWar, capitals }) => {
    quests?.update({ villages: villages.length, wars: wars.length });
    labels.replaceChildren();
    // Мечи между столицами воюющих, рукопожатие — между союзниками.
    const mid = (r1, r2) => {
      const c1 = capitals[r1];
      const c2 = capitals[r2];
      if (!c1 || !c2) return null;
      return { x: (c1.x + c2.x) / 2 + 0.5, y: (c1.y + c2.y) / 2 + 0.5 };
    };
    for (const w of wars) {
      const m = mid(w.a, w.b);
      if (!m) continue;
      const tag = document.createElement("div");
      tag.className = "wb-mark wb-mark--war";
      tag.style.left = `${(m.x / W) * 100}%`;
      tag.style.top = `${(m.y / H) * 100}%`;
      tag.innerHTML = icon("war", 18);
      tag.title = `Война: ${RACES[w.a].name} и ${RACES[w.b].name}`;
      labels.append(tag);
    }
    for (const al of allies) {
      const m = mid(al.a, al.b);
      if (!m) continue;
      const tag = document.createElement("div");
      tag.className = "wb-mark wb-mark--ally";
      tag.style.left = `${(m.x / W) * 100}%`;
      tag.style.top = `${(m.y / H) * 100}%`;
      tag.innerHTML = icon("ally", 18);
      tag.title = `Союз: ${RACES[al.a].name} и ${RACES[al.b].name}`;
      labels.append(tag);
    }
    for (const v of villages) {
      const tag = document.createElement("div");
      tag.className = `wb-label${atWar[v.race] ? " wb-label--war" : ""}`;
      tag.style.left = `${((v.x + 0.5) / W) * 100}%`;
      tag.style.top = `${((v.y - 1.2) / H) * 100}%`;
      tag.style.setProperty("--race-color", v.zone);
      tag.insertAdjacentHTML("afterbegin", icon(`race-${RACES[v.race].id}`, 14, "wb-label-icon"));
      const name = document.createElement("span");
      name.append(text(v.name));
      const pop = document.createElement("b");
      pop.append(text(nf.format(v.pop)));
      tag.append(name, pop);
      if (atWar[v.race]) tag.insertAdjacentHTML("beforeend", icon("war", 12, "wb-label-war"));
      // Склад в подпись не выносим: экономика работает в фоне, а место на
      // карте дорого. Цифры остаются в подсказке по нажатию.
      tag.title = `Основал ${v.founder}${v.king ? `. Король ${v.king}` : ""}. Домов: ${v.houses}. Брёвен ${v.wood}, камня ${v.stone}, еды ${v.food}${v.ore ? `, руды ${v.ore}` : ""}${v.gold ? `, золота ${v.gold}` : ""}${v.weapons ? `, оружия ${v.weapons}` : ""}${v.temple ? ", храм" : ""}${v.walls ? ", стены" : ""}${v.shipyard ? ", верфь" : ""}. Недовольство ${v.unrest}%, вера ${v.faith}%`;
      labels.append(tag);
    }
  };

  let lastHud = null;
  let lastScoreSent = 0;
  const renderHud = (h) => {
    lastHud = h;
    quests?.update({
      pop: h.pop,
      houses: h.houses,
      era: h.era,
      kings: h.kings?.length ?? 0,
      ach: h.ach?.length ?? 0,
    });
    renderIslandAch(h);
    updateMapCards(h.discovered || []);
    if (Date.now() - lastScoreSent > 60_000 && h.score) {
      lastScoreSent = Date.now();
      void sendScore(h);
    }
    renderHudLine(h);
  };
  const renderIslandAch = ({ ach = [], achTotal = 0 }) => {
    const box = el("wb-ach");
    if (!box) return;
    box.replaceChildren();
    const head = document.createElement("div");
    head.className = "wb-settings-sub";
    head.append(text(`Достижения острова · ${ach.length} из ${achTotal}`));
    box.append(head);
    if (!ach.length) {
      const p = document.createElement("p");
      p.className = "wb-settings-alive";
      p.append(
        text(
          "Пока ни одного. Остров запомнит всё: первый храм, пережитую бомбу, гостей из будущего.",
        ),
      );
      box.append(p);
      return;
    }
    const ul = document.createElement("ul");
    ul.className = "wb-ach-list";
    for (const t of ach) {
      const li = document.createElement("li");
      li.insertAdjacentHTML("afterbegin", icon("era", 12, "wb-inline-icon"));
      li.append(text(" " + t));
      ul.append(li);
    }
    box.append(ul);
  };
  const updateMapCards = (discovered) => {
    const known = new Set([...discovered, mapId, "island"]);
    document.querySelectorAll(".wb-map-card").forEach((card) => {
      const id = card.dataset.map;
      const locked = !known.has(id);
      card.classList.toggle("wb-map-card--locked", locked);
      card.setAttribute("aria-disabled", String(locked));
      const desc = card.querySelector(".wb-map-desc");
      if (desc)
        desc.textContent = locked
          ? "Откроют корабли в Средневековье"
          : (MAPS.find((m) => m.id === id)?.desc ?? "");
    });
  };
  const sendScore = async (h) => {
    const initData = tg?.initData;
    if (!initData) return;
    try {
      await fetch("/api/world-score", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Telegram-Init-Data": initData },
        body: JSON.stringify({
          score: h.score,
          pop: h.pop,
          day: h.day,
          era: h.era,
          seed: seed % 10000,
        }),
      });
    } catch {
      /* офлайн — не страшно */
    }
  };
  const loadTop = async () => {
    const box = el("wb-top");
    if (!box) return;
    const initData = tg?.initData;
    if (!initData) {
      box.textContent = "Рейтинг виден только из Telegram.";
      return;
    }
    try {
      const r = await fetch("/api/world-top", { headers: { "X-Telegram-Init-Data": initData } });
      const data = await r.json();
      box.replaceChildren();
      const head = document.createElement("div");
      head.className = "wb-settings-sub";
      head.append(text(`Рейтинг островов${data.me ? ` · ты ${data.me.rank}-й` : ""}`));
      box.append(head);
      const ol = document.createElement("ol");
      ol.className = "wb-top-list";
      for (const row of data.top || []) {
        const li = document.createElement("li");
        li.append(
          text(`${row.name} — ${nf.format(row.score)} · ${row.pop} котов, день ${row.day}`),
        );
        if (row.me) li.className = "wb-top-me";
        ol.append(li);
      }
      if (!(data.top || []).length) box.append(text("Пока пусто — будь первым."));
      box.append(ol);
    } catch {
      box.textContent = "Рейтинг не загрузился.";
    }
  };
  const buildStory = () => {
    const h = lastHud || {};
    const lines = [
      `Мой мир №${seed % 10000} в Claude-боте: день ${h.day ?? 1}, эра «${h.eraName ?? "Начало"}», ${h.season ?? ""}.`,
    ];
    lines.push(`Котов: ${h.pop ?? 0}. Достижений: ${(h.ach || []).length}.`);
    if (h.kings?.length)
      lines.push("Правят: " + h.kings.map((k) => `${k.name} (${k.race})`).join(", ") + ".");
    const vs = world?.villages ?? [];
    if (vs.length) lines.push("Поселения: " + vs.map((v) => `${v.name}`).join(", ") + ".");
    const ch = (world?.chronicle ?? [])
      .slice(0, 6)
      .map((c) => (typeof c === "string" ? c : (c.text ?? c.message ?? "")))
      .filter(Boolean);
    if (ch.length) lines.push("Летопись: " + ch.join(" "));
    return lines.join("\n");
  };
  const renderHudLine = ({ pop, day, night, era, eraName, alive, paused, season, weather }) => {
    el("hud-pop").innerHTML = `${icon("cat", 16, "wb-hud-icon")} ${nf.format(pop)}`;
    const sw = [season, weather && weather !== "Ясно" ? weather : null].filter(Boolean).join(", ");
    el("hud-day").textContent =
      `${paused ? "Пауза · " : ""}${night ? "Ночь" : "День"} ${day}${sw ? ` · ${sw}` : ""}`;
    el("hud-alive").textContent = `жив ${aliveText(alive)}`;
    el("set-alive").textContent =
      `Остров живёт ${aliveText(alive)} — с ${new Date(Date.now() - alive).toLocaleDateString("ru-RU")}.`;
    // Плашка эры слева на карте: римская цифра и название.
    const plaque = el("hud-era");
    plaque.innerHTML = `${icon("era", 14, "wb-era-icon")}<span class="wb-era-num">${["I", "II", "III"][era] ?? era + 1}</span><span class="wb-era-name">${eraName}</span>`;
    plaque.dataset.era = String(era);
  };
  el("hud-name").textContent = `№${seed % 10000}`;

  const quests = createQuests(`world:quests:${seed}:${mapId}`, (quest, rank) => {
    haptic("success");
    const card = el("quest");
    card.classList.remove("is-done");
    void card.offsetWidth;
    card.classList.add("is-done");
    if (rank !== rankFor(0)) el("quest-rank").dataset.flash = String(Date.now());
  });

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
    onVillages: renderVillages,
    onHud: renderHud,
    map: mapId,
  });

  /* ── Панель ───────────────────────────────────────────────────────────── */

  function setRace(r) {
    ui.race = r;
    renderSub();
    hint.textContent = `${RACES[r].name}: ${ui.tool.hint}`;
  }

  function setBrush(i) {
    ui.brush = i;
    renderSub();
  }

  function setTool(tool) {
    ui.tool = tool;
    wb.classList.toggle("wb--hand", tool.kind === "hand");
    renderTools();
    hint.textContent =
      ui.category.sub === "race" ? `${RACES[ui.race].name}: ${tool.hint}` : tool.hint;
    haptic("selection");
  }

  function setCategory(category) {
    ui.category = category;
    renderCats();
    renderSub();
    setTool(category.tools[0]);
  }

  function renderCats() {
    catsRow.replaceChildren();
    for (const category of CATEGORIES) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "wb-cat";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(category === ui.category));
      b.insertAdjacentHTML("afterbegin", icon(category.icon, 22, "wb-cat-icon"));
      const label = document.createElement("span");
      label.className = "wb-cat-label";
      label.append(text(category.name));
      b.append(label);
      b.addEventListener("click", () => setCategory(category));
      catsRow.append(b);
    }
  }

  function renderTools() {
    toolsRow.replaceChildren();
    for (const tool of ui.category.tools) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `wb-tool${tool === ui.tool ? " wb-tool--on" : ""}`;
      b.setAttribute("aria-pressed", String(tool === ui.tool));
      b.insertAdjacentHTML("afterbegin", icon(tool.icon, 28, "wb-tool-icon"));
      b.append(text(tool.name));
      b.addEventListener("click", () => setTool(tool));
      toolsRow.append(b);
    }
  }

  function renderSub() {
    subRow.replaceChildren();
    if (ui.category.sub === "race") {
      RACES.forEach((race, r) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "wb-chip";
        b.setAttribute("aria-pressed", String(r === ui.race));
        b.insertAdjacentHTML("afterbegin", icon(`race-${race.id}`, 22, "wb-chip-icon"));
        b.append(text(race.name.replace("-коты", "")));
        const count = document.createElement("span");
        count.className = "wb-chip-count";
        count.append(text(nf.format(ui.pops[r] ?? 0)));
        b.append(count);
        b.title = `${race.name}: ${nf.format(ui.pops[r] ?? 0)}`;
        b.addEventListener("click", () => setRace(r));
        subRow.append(b);
      });
    } else if (ui.category.sub === "brush") {
      BRUSHES.forEach((brush, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "wb-chip";
        b.setAttribute("aria-pressed", String(i === ui.brush));
        b.setAttribute("aria-label", `Кисть ${brush.label} клетки`);
        const dot = document.createElement("span");
        dot.className = "wb-brush";
        dot.style.width = `${brush.px}px`;
        dot.style.height = `${brush.px}px`;
        dot.setAttribute("aria-hidden", "true");
        b.append(dot, text(`×${brush.label}`));
        b.addEventListener("click", () => setBrush(i));
        subRow.append(b);
      });
    }
  }

  /* ── Камера и жесты ────────────────────────────────────────────────────────
     Рамка карты неподвижна, мир двигается и масштабируется внутри неё — как
     в WorldBox. Раньше зум менял ширину самой карты, и при отдалении мир
     съёживался посреди рамки. Теперь:
       • «Рука»: один палец тащит мир, короткое касание — осмотр, двойное — зум;
       • любой инструмент: один палец рисует, два пальца — щипок и сдвиг;
       • колесо мыши и кнопки ± — зум к точке.
     Мир упирается краями в рамку с небольшим запасом: за чёрной линией
     границы — тёмная пустота, дальше камера не едет. */

  const cam = { scale: 1, x: EDGE, y: EDGE };
  let baseW = 0;
  let baseH = 0;
  let follow = null;

  function layoutStage() {
    const width = viewport.clientWidth;
    if (!width) return;
    baseW = width - EDGE * 2;
    baseH = (baseW * H) / W;
    stage.style.width = `${baseW}px`;
    stage.style.height = `${baseH}px`;
    viewport.style.height = `${baseH + EDGE * 2}px`;
    applyCam(false);
  }

  function clampCam() {
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const cw = baseW * cam.scale;
    const ch = baseH * cam.scale;
    const fit = (pos, size, view) =>
      size + EDGE * 2 <= view
        ? (view - size) / 2
        : Math.min(EDGE, Math.max(view - size - EDGE, pos));
    cam.x = fit(cam.x, cw, vw);
    cam.y = fit(cam.y, ch, vh);
  }

  function applyCam(animate) {
    cam.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, cam.scale));
    clampCam();
    stage.classList.toggle("wb-stage--anim", Boolean(animate) && !reduceMotion);
    stage.style.transform = `translate3d(${cam.x}px, ${cam.y}px, 0) scale(${cam.scale})`;
    // Подписи поселений держат свой размер при любом зуме.
    stage.style.setProperty("--inv", String(1 / cam.scale));
    el("zoom-label").textContent =
      `${cam.scale < 10 ? cam.scale.toFixed(cam.scale % 1 ? 1 : 0) : Math.round(cam.scale)}×`;
    el("zoom-out").disabled = cam.scale <= MIN_SCALE + 0.001;
    el("zoom-in").disabled = cam.scale >= MAX_SCALE - 0.001;
  }

  /** Зум к точке вьюпорта: мир под пальцем остаётся под пальцем. */
  function zoomAt(scale, px, py, animate = false) {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    const wx = (px - cam.x) / cam.scale;
    const wy = (py - cam.y) / cam.scale;
    cam.scale = next;
    cam.x = px - wx * next;
    cam.y = py - wy * next;
    applyCam(animate);
  }

  function zoomStep(dir) {
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    zoomAt(cam.scale * (dir > 0 ? 1.6 : 1 / 1.6), vw / 2, vh / 2, true);
    haptic("selection");
  }

  /** Поставить клетку мира в центр рамки. */
  function centerOn(cx, cy, scale = cam.scale, animate = false) {
    cam.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    const cell = baseW / W;
    cam.x = viewport.clientWidth / 2 - (cx + 0.5) * cell * cam.scale;
    cam.y = viewport.clientHeight / 2 - (cy + 0.5) * cell * cam.scale;
    applyCam(animate);
  }

  el("zoom-in").addEventListener("click", () => zoomStep(1));
  el("zoom-out").addEventListener("click", () => zoomStep(-1));
  // Скрытая вкладка имеет нулевую ширину: пересчитываем, как только рамка
  // получила размер — при показе вкладки, повороте экрана, смене окна.
  if ("ResizeObserver" in window) new window.ResizeObserver(() => layoutStage()).observe(viewport);
  else window.addEventListener("resize", layoutStage);
  layoutStage();

  const local = (e) => {
    const r = viewport.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /* Рисование протяжкой. */
  let painting = false;
  let lastCell = null;

  const brushSize = () => (ui.category.sub === "brush" ? BRUSHES[ui.brush].size : 0);
  const toolFor = () => ({ ...ui.tool, race: ui.race });

  function paintStart(e) {
    painting = true;
    const cell = world.cellAt(e.clientX, e.clientY);
    lastCell = cell;
    world.apply(toolFor(), cell.x, cell.y, brushSize());
    world.setCursor({ ...cell, size: brushSize() });
    const heavy = ["nuke", "meteor", "quake", "tsunami", "volcano"].includes(ui.tool.kind);
    haptic(heavy ? "heavy" : "light");
    if (heavy) shake(ui.tool.kind === "nuke" ? 9 : 5);
  }

  function paintMove(e) {
    const cell = world.cellAt(e.clientX, e.clientY);
    world.setCursor({ ...cell, size: brushSize() });
    if (!painting || !lastCell) return;
    if (cell.x === lastCell.x && cell.y === lastCell.y) return;
    // Быстрый жест перескакивает клетки — заполняем промежуток, чтобы линия
    // леса не рвалась.
    const steps = Math.max(Math.abs(cell.x - lastCell.x), Math.abs(cell.y - lastCell.y));
    for (let i = 1; i <= steps; i += 1) {
      const x = Math.round(lastCell.x + ((cell.x - lastCell.x) * i) / steps);
      const y = Math.round(lastCell.y + ((cell.y - lastCell.y) * i) / steps);
      // Коты и дома — через клетку, иначе от одного мазка стена из котов.
      if ((ui.tool.kind === "cat" || ui.tool.kind === "house") && (x + y) % 2 !== 0 && steps > 1)
        continue;
      world.apply(toolFor(), x, y, brushSize());
    }
    lastCell = cell;
  }

  function paintEnd() {
    if (!painting) return;
    painting = false;
    lastCell = null;
    world.endStroke();
  }

  /* Жесты: карта указателей, щипок из двух, сдвиг из одного. */
  const pointers = new Map();
  let gesture = null; // { kind: "pan" | "pinch" | "paint", ... }
  let lastTap = { t: 0, x: 0, y: 0 };

  function startPinch() {
    paintEnd();
    const [a, b] = [...pointers.values()];
    gesture = {
      kind: "pinch",
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      cam: { ...cam },
    };
    stopFollow();
    viewport.classList.add("is-moving");
  }

  viewport.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    e.preventDefault();
    // Захват держит жест, даже если палец уехал за рамку. Некоторые WebView
    // отказывают в нём — жест тогда просто живёт без захвата.
    try {
      viewport.setPointerCapture(e.pointerId);
    } catch {
      /* без захвата */
    }
    pointers.set(e.pointerId, local(e));
    if (pointers.size === 2) {
      startPinch();
      return;
    }
    if (pointers.size > 2) return;
    const p = local(e);
    if (ui.tool.kind === "hand" || e.button === 1) {
      gesture = {
        kind: "pan",
        start: p,
        cam: { ...cam },
        t: window.performance.now(),
        moved: false,
      };
      viewport.classList.add("is-moving");
    } else {
      gesture = { kind: "paint" };
      paintStart(e);
    }
  });

  viewport.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) {
      // Мышь без нажатия: просто подсветка кисти под курсором.
      if (e.pointerType === "mouse" && ui.tool.kind !== "hand") {
        const cell = world.cellAt(e.clientX, e.clientY);
        world.setCursor({ ...cell, size: brushSize() });
      }
      return;
    }
    pointers.set(e.pointerId, local(e));
    if (!gesture) return;
    if (gesture.kind === "pinch" && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const scale = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, (gesture.cam.scale * dist) / gesture.dist),
      );
      // Точка мира под началом щипка едет за серединой пальцев.
      const wx = (gesture.mid.x - gesture.cam.x) / gesture.cam.scale;
      const wy = (gesture.mid.y - gesture.cam.y) / gesture.cam.scale;
      cam.scale = scale;
      cam.x = mid.x - wx * scale;
      cam.y = mid.y - wy * scale;
      applyCam(false);
    } else if (gesture.kind === "pan") {
      const p = local(e);
      const dx = p.x - gesture.start.x;
      const dy = p.y - gesture.start.y;
      if (!gesture.moved && Math.hypot(dx, dy) > 6) {
        gesture.moved = true;
        stopFollow();
      }
      if (gesture.moved) {
        cam.x = gesture.cam.x + dx;
        cam.y = gesture.cam.y + dy;
        applyCam(false);
      }
    } else if (gesture.kind === "paint") {
      paintMove(e);
    }
  });

  const release = (e) => {
    if (!pointers.has(e.pointerId)) return;
    const p = local(e);
    pointers.delete(e.pointerId);
    if (gesture?.kind === "pinch") {
      // Второй палец отпущен — оставшийся продолжает тащить, без рывка.
      if (pointers.size === 1) {
        const [rest] = [...pointers.values()];
        gesture = { kind: "pan", start: rest, cam: { ...cam }, t: 0, moved: true };
      } else if (pointers.size === 0) {
        gesture = null;
        viewport.classList.remove("is-moving");
      }
      return;
    }
    if (pointers.size > 0) return;
    if (gesture?.kind === "paint") paintEnd();
    if (gesture?.kind === "pan" && !gesture.moved && e.type === "pointerup") {
      const now = window.performance.now();
      const double = now - lastTap.t < 320 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 24;
      if (double) {
        lastTap = { t: 0, x: 0, y: 0 };
        zoomAt(cam.scale < MAX_SCALE - 0.01 ? cam.scale * 2 : MIN_SCALE, p.x, p.y, true);
        haptic("light");
      } else {
        lastTap = { t: now, x: p.x, y: p.y };
        const cell = world.cellAt(e.clientX, e.clientY);
        inspectAt(cell.x, cell.y);
      }
    }
    gesture = null;
    viewport.classList.remove("is-moving");
  };
  viewport.addEventListener("pointerup", release);
  viewport.addEventListener("pointercancel", release);
  viewport.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse" && !pointers.size) world.setCursor(null);
  });

  viewport.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const p = local(e);
      stopFollow();
      zoomAt(cam.scale * Math.exp(-e.deltaY * 0.0018), p.x, p.y, false);
    },
    { passive: false },
  );

  /** Толчок рамки при ударе стихии: вес события чувствуется, а не только виден. */
  function shake(power) {
    if (reduceMotion || perfLow) return;
    const frame = document.querySelector(".wb-body");
    frame.style.setProperty("--shake", `${power}px`);
    frame.classList.remove("is-shaking");
    void frame.offsetWidth;
    frame.classList.add("is-shaking");
  }

  /* ── Осмотр и слежение ────────────────────────────────────────────────────
     Касание «Рукой» — карточка того, кто там: кот, деревня или местность.
     У кота кнопка «Следить»: камера приближается и едет за ним. */

  const inspector = el("wb-inspect");
  let inspected = null;

  function inspectAt(x, y) {
    const info = world.inspect(x, y);
    if (!info) {
      closeInspector();
      return;
    }
    inspected = info;
    haptic("selection");
    const title = el("wb-inspect-title");
    const sub = el("wb-inspect-sub");
    const facts = el("wb-inspect-facts");
    const art = el("wb-inspect-art");
    facts.replaceChildren();
    const fact = (label, value) => {
      if (value === null || value === undefined || value === "") return;
      const li = document.createElement("li");
      const b = document.createElement("b");
      b.append(text(value));
      li.append(text(label), b);
      facts.append(li);
    };

    if (info.kind === "cat") {
      art.innerHTML = icon(`race-${RACES[info.race].id}`, 30);
      title.textContent = info.name || "Кот без имени";
      const role = info.king
        ? "👑 Король"
        : info.hero
          ? "⭐ Герой"
          : info.warrior
            ? "⚔️ Воин"
            : (JOB_LABEL[info.job] ?? "Житель");
      sub.textContent = `${role} · ${info.raceName}`;
      fact("Деревня", info.village ?? "бродяга");
      fact(
        "Здоровье",
        `${"❤".repeat(Math.max(0, Math.min(5, info.hp)))}${info.sick ? " · болен" : ""}`,
      );
    } else if (info.kind === "village") {
      art.innerHTML = icon(`race-${RACES[info.race].id}`, 30);
      title.textContent = info.name;
      sub.textContent = `${info.capital ? "Столица" : "Деревня"} · ${info.raceName} · ${info.era}${info.atWar ? " · ⚔️ воюет" : ""}`;
      fact("Жителей", nf.format(info.pop));
      fact("Домов", nf.format(info.houses));
      fact("Правитель", info.king);
      fact("Основал", info.founder);
      fact(
        "Склад",
        `🪵 ${info.wood} · 🪨 ${info.stone} · 🍞 ${info.food}${info.gold ? ` · 🪙 ${info.gold}` : ""}`,
      );
      fact("Вера", `${info.faith}%`);
      fact("Ропот", `${info.unrest}%`);
      if (info.temple || info.shipyard)
        fact(
          "Постройки",
          [info.temple && "храм", info.shipyard && "верфь"].filter(Boolean).join(", "),
        );
    } else {
      art.innerHTML = icon("terrain", 30);
      title.textContent = info.name;
      sub.textContent = info.owner ? `Земля: ${info.owner}` : "Ничья земля";
    }
    const followBtn = el("wb-inspect-follow");
    followBtn.hidden = info.kind !== "cat" && info.kind !== "village";
    followBtn.textContent =
      info.kind === "cat" ? (follow ? "Перестать следить" : "👁 Следить") : "🔍 Показать";
    inspector.hidden = false;
    void inspector.offsetHeight;
    inspector.classList.add("is-open");
  }

  function closeInspector() {
    inspected = null;
    inspector.classList.remove("is-open");
    setTimeout(() => {
      if (!inspected) inspector.hidden = true;
    }, 260);
  }

  function stopFollow() {
    if (!follow) return;
    follow = null;
    el("wb-follow").hidden = true;
  }

  function startFollow(info) {
    follow = { track: info.track, name: info.name };
    el("wb-follow-name").textContent = info.name;
    el("wb-follow").hidden = false;
    const pos = info.track();
    centerOn(pos.x, pos.y, Math.max(cam.scale, 3), true);
    const step = () => {
      if (!follow) return;
      const p = follow.track();
      if (!p.alive) {
        сообщить(`${follow.name} погиб. Камера свободна.`);
        stopFollow();
        return;
      }
      // Мягко догоняем: камера не дёргается за каждым шагом кота.
      const cell = baseW / W;
      const tx = viewport.clientWidth / 2 - (p.x + 0.5) * cell * cam.scale;
      const ty = viewport.clientHeight / 2 - (p.y + 0.5) * cell * cam.scale;
      cam.x += (tx - cam.x) * 0.12;
      cam.y += (ty - cam.y) * 0.12;
      applyCam(false);
      window.requestAnimationFrame(step);
    };
    setTimeout(() => window.requestAnimationFrame(step), 300);
  }

  el("wb-inspect-close").addEventListener("click", closeInspector);
  el("wb-inspect-follow").addEventListener("click", () => {
    if (!inspected) return;
    if (inspected.kind === "village") {
      centerOn(inspected.x, inspected.y, Math.max(cam.scale, 2.5), true);
      closeInspector();
      return;
    }
    if (follow) stopFollow();
    else startFollow(inspected);
    closeInspector();
    haptic("light");
  });
  el("wb-follow-stop").addEventListener("click", () => {
    stopFollow();
    haptic("selection");
  });

  const settings = el("wb-settings");
  const backdrop = el("wb-backdrop");
  const gear = el("wb-gear");
  let sheetOpen = false;
  let sheetTimer = null;
  // Системная «Назад» закрывает шторку: так ведут себя листы в самом Telegram.
  const onBack = () => openSettings(false);
  const openSettings = (on) => {
    if (on === sheetOpen) return;
    sheetOpen = on;
    clearTimeout(sheetTimer);
    gear.setAttribute("aria-expanded", String(on));
    haptic("selection");
    if (on) {
      settings.hidden = false;
      backdrop.hidden = false;
      // Кадр между показом и классом нужен, иначе переход не проиграется.
      void settings.offsetHeight;
      settings.classList.add("is-open");
      backdrop.classList.add("is-open");
      if (inTelegram && tg.BackButton && can("6.1")) {
        tg.BackButton.onClick(onBack);
        tg.BackButton.show();
      }
      void loadTop();
      // Фокус переносим только тем, кто с клавиатуры: пальцу кольцо фокуса
      // на кнопке «закрыть» ни к чему.
      if (keyboardUser) setTimeout(() => el("set-close").focus({ preventScroll: true }), 50);
    } else {
      settings.classList.remove("is-open");
      backdrop.classList.remove("is-open");
      sheetTimer = setTimeout(() => {
        settings.hidden = true;
        backdrop.hidden = true;
      }, 420);
      if (inTelegram && tg.BackButton && can("6.1")) {
        tg.BackButton.offClick(onBack);
        tg.BackButton.hide();
      }
      if (keyboardUser) gear.focus({ preventScroll: true });
    }
  };
  gear.insertAdjacentHTML("afterbegin", icon("gear", 20, "wb-gear-icon"));
  gear.addEventListener("click", () => openSettings(!sheetOpen));
  el("set-close").addEventListener("click", () => openSettings(false));
  backdrop.addEventListener("click", () => openSettings(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sheetOpen) openSettings(false);
  });

  const bindToggle = (id, name) => {
    const box = el(id);
    box.checked = Boolean(world.options[name]);
    box.addEventListener("change", () => world.setOption(name, box.checked));
  };
  bindToggle("set-territories", "territories");
  bindToggle("set-labels", "labels");
  bindToggle("set-paused", "paused");
  el("set-labels").addEventListener("change", () => {
    labels.hidden = !el("set-labels").checked;
  });
  document.querySelectorAll("[data-speed]").forEach((b) => {
    b.addEventListener("click", () => {
      const speed = Number(b.dataset.speed);
      world.setOption("speed", speed);
      document
        .querySelectorAll("[data-speed]")
        .forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    });
  });

  // Карты: пять миров, у каждого своё сохранение. Миниатюра — настоящая
  // генерация по тому же сиду, так что что видишь, то и получишь.
  const mapsRow = el("wb-maps");
  for (const m of MAPS) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `wb-map-card${m.id === mapId ? " wb-map-card--on" : ""}`;
    card.dataset.map = m.id;
    card.setAttribute("aria-pressed", String(m.id === mapId));
    const thumb = document.createElement("canvas");
    thumb.className = "wb-map-thumb";
    renderPreview(thumb, seed, m.id);
    const name = document.createElement("span");
    name.className = "wb-map-name";
    name.append(text(m.name));
    const desc = document.createElement("span");
    desc.className = "wb-map-desc";
    desc.append(text(m.desc));
    card.append(thumb, name, desc);
    card.addEventListener("click", () => {
      if (m.id === mapId) return;
      if (card.classList.contains("wb-map-card--locked")) {
        сообщить("Этот остров ещё не открыт: нужны корабли (эра Средневековья и верфь).");
        return;
      }
      const go = () => {
        try {
          localStorage.setItem(`world:map:${seed}`, m.id);
        } catch {
          /* ничего */
        }
        location.reload();
      };
      ask(
        `Перейти на карту «${m.name}»? Текущий остров сохранится, вернуться можно в любой момент.`,
        go,
      );
    });
    mapsRow.append(card);
  }
  el("hud-name").textContent =
    `${MAPS.find((m) => m.id === mapId)?.name ?? "Остров"} №${seed % 10000}`;

  el("city-story")?.addEventListener("click", () => {
    const line = buildStory();
    const кудаВедёт = profile.botUsername ? `https://t.me/${profile.botUsername}` : "https://t.me";
    const адрес = `https://t.me/share/url?url=${encodeURIComponent(кудаВедёт)}&text=${encodeURIComponent(line)}`;
    if (tg?.openTelegramLink) tg.openTelegramLink(адрес);
    else if (navigator.share) void navigator.share({ text: line }).catch(() => undefined);
    else
      void navigator.clipboard
        ?.writeText(line)
        .then(() => сообщить("История скопирована"))
        .catch(() => сообщить("Не вышло поделиться"));
  });
  el("city-reset").insertAdjacentHTML("afterbegin", icon("reset", 18, "wb-inline-icon"));
  el("city-reset").addEventListener("click", () => {
    const go = () => {
      world.reset();
      location.reload();
    };
    ask("Стереть всё и вырастить мир заново?", go);
  });

  setCategory(CATEGORIES[0]);

  setTool(HAND_TOOL);
  renderChronicle(world.chronicle);
  // Вкладки поднимаются раньше мира: если мини-апп открылся сразу на городе,
  // start() тогда некому было позвать — и коты стояли как вкопанные.
  // Ручка для отладки в консоли и автопроверок.
  window.__world = world;
  quests.arm();
  // Мир крутится всегда, даже на вкладке «Кот»: там он просто не рисуется.
  world.start();
  if (el("panel-city").hidden) world.stop();
  if (world.population === 0)
    hint.textContent =
      "Мир пуст. Выбери народ и проведи пальцем по суше — там поселятся первые коты. Дальше они сами: нарубят леса, поставят дома, верфь и выйдут в море.";
}

/** Спросить «да/нет»: через Telegram, если умеет, иначе обычным confirm. */
function ask(question, onYes) {
  try {
    if (inTelegram && tg.showConfirm && can("6.2")) {
      tg.showConfirm(question, (ok) => ok && onYes());
      return;
    }
  } catch {
    /* падаем на confirm ниже */
  }
  if (window.confirm(question)) onYes();
}

/** «2 д 5 ч», «37 мин» — сколько остров живёт по настоящим часам. */
function aliveText(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "меньше минуты";
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч ${m % 60} мин`;
  const d = Math.floor(h / 24);
  return `${d} д ${h % 24} ч`;
}

/** Склонение по числу: 1 день, 2 дня, 5 дней. */
function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/**
 * Короткое сообщение. В Telegram — системным окном, иначе тостом снизу.
 * Нужно там, где действие само по себе невидимо.
 */
function сообщить(текст, заголовок) {
  try {
    if (inTelegram && tg.showPopup && can("6.2")) {
      tg.showPopup({
        ...(заголовок ? { title: заголовок.slice(0, 64) } : {}),
        message: текст.slice(0, 256),
      });
      return;
    }
  } catch {
    /* покажем тост ниже */
  }
  const toast = el("toast");
  toast.hidden = true;
  void toast.offsetWidth;
  toast.textContent = заголовок ? `${заголовок}: ${текст}` : текст;
  toast.hidden = false;
  clearTimeout(сообщить.таймер);
  сообщить.таймер = setTimeout(() => {
    toast.hidden = true;
  }, 2800);
}

function setupShare(profile) {
  const line = `Мой Claude-кот: ${profile.cat.name} (уровень ${profile.cat.level}/10), ${nf.format(profile.totals.tokens)} токенов`;

  const share = () => {
    haptic("light");
    // Через обычную ссылку «поделиться», а не switchInlineQuery: тот требует
    // инлайн-режима в BotFather, а без него молча не делает ничего.
    const кудаВедёт = profile.botUsername ? `https://t.me/${profile.botUsername}` : "https://t.me";
    const адрес = `https://t.me/share/url?url=${encodeURIComponent(кудаВедёт)}&text=${encodeURIComponent(line)}`;

    if (inTelegram && tg.openTelegramLink) {
      tg.openTelegramLink(адрес);
      return;
    }
    if (navigator.share) {
      void navigator.share({ text: line, url: кудаВедёт }).catch(() => undefined);
      return;
    }
    void navigator.clipboard
      ?.writeText(`${line} ${кудаВедёт}`)
      .then(() => сообщить("Скопировано в буфер обмена"))
      .catch(() => сообщить("Не вышло поделиться"));
  };

  if (inTelegram && tg.MainButton) {
    tg.MainButton.setParams({
      text: "Поделиться котом",
      color: "#D97757",
      text_color: "#FFFFFF",
      ...(can("7.10") ? { has_shine_effect: true } : {}),
    });
    tg.MainButton.show();
    tg.MainButton.onClick(share);
    return;
  }

  // На десктопе и в демо без запасной кнопки поделиться нечем.
  const button = el("share-fallback");
  button.hidden = false;
  button.addEventListener("click", share);
}

function fail(message) {
  el("loading").hidden = true;
  el("error").hidden = false;
  el("error-text").textContent = message;
  el("error-art").innerHTML = claudeStar(72);
  el("error-retry").addEventListener("click", () => location.reload(), { once: true });
}

/**
 * Демо-режим (?demo=1) рисует страницу на выдуманных данных — чтобы смотреть
 * вёрстку в обычном браузере без подписанных initData.
 */
async function loadDemo() {
  const response = await fetch("/demo-profile.json");
  return response.json();
}

function show() {
  el("loading").hidden = true;
  el("app").hidden = false;
}

async function main() {
  if (perfLow) document.documentElement.classList.add("perf-low");
  applyTheme();
  tg?.onEvent?.("themeChanged", applyTheme);
  if (!inTelegram)
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", applyTheme);
  tg?.ready();
  tg?.expand();

  if (new URLSearchParams(location.search).has("demo")) {
    const profile = await loadDemo();
    show();
    render(profile);
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
    // Показываем до отрисовки: размеры контейнеров (график, лента котов)
    // нужны уже в render, а у скрытых они нулевые.
    show();
    render(profile);
  } catch (error) {
    fail("Не получилось загрузить профиль. Проверь соединение и попробуй ещё раз.");
    console.error(error);
  }
}

void main();

/* ── График расхода по дням ───────────────────────────────────────────────
   Расход за сутки — величина за дискретный период, это столбцы, а не линия.
   Сегодняшний столбец ярче, пунктир — средний день. Геометрия считается в
   настоящих пикселях по ширине контейнера: растяжение через viewBox
   размазало бы скругления. */

const SVG_NS = "http://www.w3.org/2000/svg";
const PLOT_HEIGHT = 120;
const BAR_GAP = 4;
const EMPTY_STUB = 3;

let chartDays = [];
let chartGrown = false;
let chartSelected = -1;

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
    weekday: "short",
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
    el("chart-total").textContent = "";
    note.textContent = "Пока пусто: график наполнится, когда агент поработает.";
    tbody.replaceChildren();
    return;
  }

  box.hidden = false;
  note.textContent = "";
  el("chart-total").textContent = `${short(total)} за ${chartDays.length} дн.`;

  drawChart();
  fillChartTable(tbody);

  // Столбцы вырастают, когда до графика долистали, а не где-то за экраном.
  if (!reduceMotion && !perfLow && "IntersectionObserver" in window) {
    const observer = new window.IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      chartGrown = true;
      box.classList.add("is-grown");
      setTimeout(() => box.classList.remove("is-grown"), 1400);
    });
    observer.observe(box);
  }

  document.addEventListener("pointerdown", (e) => {
    if (!box.contains(e.target)) selectBar(-1);
  });
}

function drawChart() {
  const svg = el("chart-svg");
  const width = el("chart").clientWidth || 320;
  const count = chartDays.length;
  const barWidth = Math.max(4, (width - BAR_GAP * (count - 1)) / count);
  const peak = Math.max(...chartDays.map((d) => d.tokens));
  const peakIndex = chartDays.findIndex((d) => d.tokens === peak);
  const average = chartDays.reduce((s, d) => s + d.tokens, 0) / count;
  const usable = PLOT_HEIGHT - 6;

  svg.setAttribute("viewBox", `0 0 ${width} ${PLOT_HEIGHT}`);
  svg.setAttribute("width", width);
  svg.setAttribute("height", PLOT_HEIGHT);

  const title = svg.querySelector("title");
  svg.replaceChildren(title);
  title.textContent =
    `Столбчатый график расхода за ${count} дней. ` +
    `Больше всего ${dayFull(chartDays[peakIndex].day)} — ${nf.format(peak)} токенов. ` +
    `Точные числа по дням есть в таблице ниже.`;

  const averageY = PLOT_HEIGHT - (average / peak) * usable;
  svg.append(svgEl("line", { class: "avg-line", x1: 0, y1: averageY, x2: width, y2: averageY }));

  chartDays.forEach((day, index) => {
    const x = index * (barWidth + BAR_GAP);
    const empty = day.tokens === 0;
    const height = empty ? EMPTY_STUB : Math.max(4, Math.round((day.tokens / peak) * usable));
    const y = PLOT_HEIGHT - height;
    const today = index === count - 1;
    const classes = empty
      ? "bar-empty"
      : `bar${today ? " bar--today" : ""}${index === chartSelected ? " bar--on" : ""}`;

    const rect = svgEl("rect", {
      class: classes,
      x: x.toFixed(2),
      y,
      width: barWidth.toFixed(2),
      height,
      rx: Math.min(6, barWidth / 2, height / 2),
      "data-i": index,
    });
    rect.style.setProperty("--i", String(index));
    svg.append(rect);

    // Область нажатия шире столбца: в тонкую засечку пальцем не попасть.
    const hit = svgEl("rect", {
      class: "hit",
      x: (x - BAR_GAP / 2).toFixed(2),
      y: 0,
      width: (barWidth + BAR_GAP).toFixed(2),
      height: PLOT_HEIGHT,
    });
    hit.addEventListener("pointerdown", () => selectBar(index));
    hit.addEventListener("pointerenter", (e) => {
      if (e.pointerType === "mouse") selectBar(index);
    });
    svg.append(hit);
  });

  const axis = el("chart-axis");
  axis.replaceChildren();
  const mid = Math.floor(count / 2);
  for (const label of [dayLabel(chartDays[0].day), dayLabel(chartDays[mid].day), "сегодня"]) {
    const span = document.createElement("span");
    span.append(text(label));
    axis.append(span);
  }

  if (chartSelected >= 0) positionTip(chartSelected);
}

function selectBar(index) {
  if (index === chartSelected) return;
  chartSelected = index;
  el("chart-svg")
    .querySelectorAll(".bar")
    .forEach((bar) => bar.classList.toggle("bar--on", Number(bar.dataset.i) === index));
  const tip = el("chart-tip");
  if (index < 0) {
    tip.hidden = true;
    return;
  }
  haptic("selection");
  const day = chartDays[index];
  tip.replaceChildren();
  const when = document.createElement("span");
  when.append(text(dayFull(day.day)));
  const value = document.createElement("b");
  value.append(text(`${nf.format(day.tokens)} токенов`));
  tip.append(when, value);
  tip.hidden = false;
  positionTip(index);
}

function positionTip(index) {
  const tip = el("chart-tip");
  const width = el("chart").clientWidth || 320;
  const count = chartDays.length;
  const barWidth = Math.max(4, (width - BAR_GAP * (count - 1)) / count);
  const center = index * (barWidth + BAR_GAP) + barWidth / 2;
  // Подсказка не уезжает за край: на узком экране это заметно.
  const half = tip.offsetWidth / 2;
  tip.style.left = `${Math.min(Math.max(center, half), width - half)}px`;
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
void chartGrown;

/* ── Кооп ─────────────────────────────────────────────────────────────────
   Те, кто работает на одной подписке. Порядок — по расходу в боте, а не по
   общему: у владельца есть импортированная история, и сравнивать с ней тех,
   кто пришёл вчера, бессмысленно. */

function renderCoop(members) {
  const section = el("coop-section");
  if (!members || members.length < 2) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  const total = members.reduce((sum, m) => sum + m.tokensInBot, 0);
  el("coop-count").textContent =
    `${members.length} ${plural(members.length, "человек", "человека", "человек")}`;
  el("coop-note").textContent = `Вместе ${short(total)} токенов через бота. Кот у каждого свой.`;

  const list = el("coop");
  list.replaceChildren();

  const порядок = [...members].sort((a, b) => b.tokensInBot - a.tokensInBot);
  for (const member of порядок) {
    const li = document.createElement("li");
    li.className = "row";

    const art = document.createElement("div");
    art.className = "row-art";
    art.innerHTML = catSvg(member.cat, 34);

    const body = document.createElement("div");
    body.className = "row-body";
    const name = document.createElement("span");
    name.className = "row-name";
    name.append(text(member.name || `id ${member.id}`));
    if (member.isYou) {
      const you = document.createElement("span");
      you.className = "tag";
      you.append(text("ты"));
      name.append(you);
    }
    if (member.isPayer) {
      // Кто платит — видно словом, а не только порядком в списке.
      const payer = document.createElement("span");
      payer.className = "tag tag--muted";
      payer.append(text("подписка"));
      name.append(payer);
    }
    const under = document.createElement("span");
    under.className = "row-sub";
    under.append(text(`${member.cat.name} · ур. ${member.cat.level}`));
    body.append(name, under);

    const value = document.createElement("div");
    value.className = "row-value";
    const tokens = document.createElement("b");
    tokens.append(text(short(member.tokensInBot)));
    const label = document.createElement("span");
    label.append(text("токенов"));
    value.append(tokens, label);

    li.append(art, body, value);
    list.append(li);
  }
}
