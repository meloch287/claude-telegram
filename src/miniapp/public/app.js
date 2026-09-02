import { catSvg } from "./cat-art.js";
import { achievementSvg } from "./achievement-art.js";
import { createWorld, RACES, TERRAIN_TOOLS, ERAS } from "./world.js";
import { icon } from "./icons.js";

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

/* ── Мой город ────────────────────────────────────────────────────────────
   Панель инструментов как в WorldBox: снизу категории, над ними инструменты
   категории, над ними подкатегория — народ для котов и домов или размер
   кисти для природы и ландшафта. Рисуют протяжкой: палец ведёт — по следу
   растёт лес или разливается море. Рука двигает карту. */

const ZOOMS = [1, 1.5, 2, 3];
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
      { id: "cat", icon: "cat", name: "Кот", kind: "cat", hint: "Веди пальцем по суше — коты выбранного народа появятся по следу." },
      { id: "house", icon: "house", name: "Дом", kind: "house", hint: "Дом для выбранного народа. Гномы строят только в горах и на холмах." },
    ],
  },
  {
    id: "nature",
    icon: "tree",
    name: "Природа",
    sub: "brush",
    tools: [
      { id: "tree", icon: "tree", name: "Лес", kind: "tree", hint: "Веди пальцем — вырастает лес. Эльфы-коты будут рады." },
      { id: "flowers", icon: "flowers", name: "Цветы", kind: "flowers", hint: "Цветы растут только на земле." },
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
      { id: "fire", icon: "fire", name: "Огонь", kind: "fire", hint: "Ткни в дерево или дом. Огонь перекидывается на соседей." },
      { id: "bolt", icon: "bolt", name: "Молния", kind: "bolt", hint: "Бьёт в точку. Коты разбегаются, дерево загорается." },
      { id: "meteor", icon: "meteor", name: "Метеорит", kind: "meteor", hint: "Падает с неба. Остаётся кратер." },
    ],
  },
  {
    id: "other",
    icon: "other",
    name: "Прочее",
    sub: "brush",
    tools: [
      { id: "hand", icon: "hand", name: "Рука", kind: "hand", hint: "Двигай карту пальцем. Приблизь кнопкой +, чтобы разглядеть котов." },
      { id: "erase", icon: "erase", name: "Стереть", kind: "erase", hint: "Убирает лес, цветы и дома." },
      { id: "era", icon: "era", name: "Эра", kind: "era", hint: "Ткни в карту — все народы шагнут в следующую эру: Начало → Средневековье → Будущее." },
    ],
  },
];

function setupCity(profile) {
  const canvas = el("city-map");
  const viewport = el("city-viewport");
  const stage = el("city-stage");
  const wb = document.querySelector(".wb");
  const seed = profile.world?.seed ?? 1;

  // Элементы панели — до создания мира: он сразу зовёт колбэки, которые
  // рисуют панель, и константы ниже по коду были бы ещё не объявлены.
  const catsRow = el("wb-cats");
  const toolsRow = el("wb-tools");
  const subRow = el("wb-sub");
  const hint = el("city-hint");

  const ui = {
    category: CATEGORIES[0],
    tool: CATEGORIES[0].tools[0],
    race: 0,
    brush: 0,
    zoom: 0,
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
    for (const item of items) {
      const li = document.createElement("li");
      const day = document.createElement("span");
      day.className = "chronicle-day";
      day.append(text(`Д${item.day ?? 1}`));
      li.append(day, text(item.text));
      chronicleList.append(li);
    }
  };

  // Численность народов держим при себе и показываем прямо в кнопках выбора
  // народа: отдельные карточки внизу дублировали панель.
  const labels = el("city-labels");
  const renderRaces = (races) => {
    ui.pops = races.map((r) => r.pop);
    if (ui.category.sub === "race") renderSub();
    // Подпись на территории: имя народа и сколько котов, как у королевств в
    // WorldBox. Пустые территории без подписи.
    labels.replaceChildren();
    for (const race of races) {
      if (!race.center || race.pop === 0) continue;
      const tag = document.createElement("div");
      tag.className = "wb-label";
      tag.style.left = `${(race.center.x / 56) * 100}%`;
      tag.style.top = `${(race.center.y / 44) * 100}%`;
      tag.style.setProperty("--race-color", race.id === "elf" ? race.hat : race.banner);
      tag.insertAdjacentHTML("afterbegin", icon(`race-${race.id}`, 14, "wb-label-icon"));
      const name = document.createElement("span");
      name.append(text(race.name.replace("-коты", "")));
      const pop = document.createElement("b");
      pop.append(text(nf.format(race.pop)));
      tag.append(name, pop);
      labels.append(tag);
    }
  };

  const renderHud = ({ pop, day, night, era, eraName, alive, paused }) => {
    el("hud-pop").innerHTML = `${icon("cat", 16, "wb-hud-icon")} ${nf.format(pop)}`;
    el("hud-day").textContent = `${paused ? "Пауза · " : ""}${night ? "Ночь" : "День"} ${day}`;
    el("hud-alive").textContent = `жив ${aliveText(alive)}`;
    el("set-alive").textContent = `Остров живёт ${aliveText(alive)} — с ${new Date(Date.now() - alive).toLocaleDateString("ru-RU")}.`;
    // Плашка эры слева на карте: римская цифра и название.
    const plaque = el("hud-era");
    plaque.innerHTML = `${icon("era", 14, "wb-era-icon")}<span class="wb-era-num">${["I", "II", "III"][era] ?? era + 1}</span><span class="wb-era-name">${eraName}</span>`;
    plaque.dataset.era = String(era);
  };
  el("hud-name").textContent = `№${seed % 10000}`;

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
    onHud: renderHud,
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
    // Рука — карта прокручивается пальцем. Кисть — палец рисует, а не скроллит.
    canvas.style.touchAction = tool.kind === "hand" ? "pan-x pan-y" : "none";
    renderTools();
    hint.textContent = ui.category.sub === "race" ? `${RACES[ui.race].name}: ${tool.hint}` : tool.hint;
    tg?.HapticFeedback?.selectionChanged?.();
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

  /* ── Рисование протяжкой ──────────────────────────────────────────────── */

  let painting = false;
  let lastCell = null;
  let pan = null;

  const brushSize = () => (ui.category.sub === "brush" ? BRUSHES[ui.brush].size : 0);
  const toolFor = () => ({ ...ui.tool, race: ui.race });

  canvas.addEventListener("pointerdown", (e) => {
    if (ui.tool.kind === "hand") {
      // Мышью карту тоже можно таскать; палец скроллит вьюпорт сам.
      if (e.pointerType === "mouse") {
        pan = { x: e.clientX, y: e.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
        canvas.setPointerCapture(e.pointerId);
      }
      return;
    }
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    painting = true;
    const cell = world.cellAt(e.clientX, e.clientY);
    lastCell = cell;
    world.apply(toolFor(), cell.x, cell.y, brushSize());
    world.setCursor({ ...cell, size: brushSize() });
    tg?.HapticFeedback?.impactOccurred?.("light");
  });

  canvas.addEventListener("pointermove", (e) => {
    if (pan) {
      viewport.scrollLeft = pan.left - (e.clientX - pan.x);
      viewport.scrollTop = pan.top - (e.clientY - pan.y);
      return;
    }
    const cell = world.cellAt(e.clientX, e.clientY);
    if (ui.tool.kind !== "hand") world.setCursor({ ...cell, size: brushSize() });
    if (!painting) return;
    if (lastCell && cell.x === lastCell.x && cell.y === lastCell.y) return;
    // Быстрый жест перескакивает клетки — заполняем промежуток, чтобы линия
    // леса не рвалась.
    const steps = Math.max(Math.abs(cell.x - lastCell.x), Math.abs(cell.y - lastCell.y));
    for (let i = 1; i <= steps; i += 1) {
      const x = Math.round(lastCell.x + ((cell.x - lastCell.x) * i) / steps);
      const y = Math.round(lastCell.y + ((cell.y - lastCell.y) * i) / steps);
      // Коты и дома — не сплошняком по каждой клетке: через одну, иначе от
      // одного мазка получается стена из котов.
      if ((ui.tool.kind === "cat" || ui.tool.kind === "house") && (x + y) % 2 !== 0 && steps > 1) continue;
      world.apply(toolFor(), x, y, brushSize());
    }
    lastCell = cell;
  });

  const finish = () => {
    if (pan) pan = null;
    if (!painting) return;
    painting = false;
    lastCell = null;
    world.endStroke();
  };
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);
  canvas.addEventListener("pointerleave", () => {
    world.setCursor(null);
  });

  /* ── Зум ──────────────────────────────────────────────────────────────── */

  function setZoom(i) {
    ui.zoom = Math.max(0, Math.min(ZOOMS.length - 1, i));
    const ratioX = (viewport.scrollLeft + viewport.clientWidth / 2) / Math.max(1, viewport.scrollWidth);
    const ratioY = (viewport.scrollTop + viewport.clientHeight / 2) / Math.max(1, viewport.scrollHeight);
    stage.style.width = `${ZOOMS[ui.zoom] * 100}%`;
    el("zoom-label").textContent = `${ZOOMS[ui.zoom]}×`;
    viewport.scrollLeft = ratioX * viewport.scrollWidth - viewport.clientWidth / 2;
    viewport.scrollTop = ratioY * viewport.scrollHeight - viewport.clientHeight / 2;
    // На приближенной карте рука нужнее: подсказываем, где она.
    if (ui.zoom > 0 && ui.tool.kind !== "hand") hint.textContent = `${ui.tool.hint} Двигать карту — «Рука» в «Прочее».`;
  }
  el("zoom-in").addEventListener("click", () => setZoom(ui.zoom + 1));
  el("zoom-out").addEventListener("click", () => setZoom(ui.zoom - 1));

  const settings = el("wb-settings");
  const gear = el("wb-gear");
  const openSettings = (on) => {
    settings.hidden = !on;
    gear.setAttribute("aria-expanded", String(on));
    tg?.HapticFeedback?.selectionChanged?.();
  };
  gear.insertAdjacentHTML("afterbegin", icon("gear", 20, "wb-gear-icon"));
  gear.addEventListener("click", () => openSettings(settings.hidden));
  el("set-close").addEventListener("click", () => openSettings(false));

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
      document.querySelectorAll("[data-speed]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    });
  });

  el("city-reset").insertAdjacentHTML("afterbegin", icon("reset", 18, "wb-inline-icon"));
  el("city-reset").addEventListener("click", () => {
    const go = () => {
      world.reset();
      location.reload();
    };
    if (tg?.showConfirm) tg.showConfirm("Стереть всё и вырастить остров заново?", (ok) => ok && go());
    else if (confirm("Стереть всё и вырастить остров заново?")) go();
  });

  setCategory(CATEGORIES[0]);
  renderChronicle(world.chronicle);
  // Вкладки поднимаются раньше мира: если мини-апп открылся сразу на городе,
  // start() тогда некому было позвать — и коты стояли как вкопанные.
  if (!el("panel-city").hidden) world.start();
  if (world.population === 0) hint.textContent = "Остров пуст. Выбери народ и проведи пальцем по суше — там поселятся первые коты. Дома они построят сами.";
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
