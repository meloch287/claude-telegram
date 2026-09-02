/**
 * Мой город — континент четырёх кошачьих народов, в духе WorldBox.
 *
 * Остров, на нём четыре расы — все коты, но разные: люди-коты у моря,
 * эльфы-коты в лесу, орки-коты на пустошах, гномы-коты в горах. Коты бродят,
 * строятся, плодятся. Сверху — бог с кистями: ведёшь пальцем — по следу
 * вырастает лес, разливается море, поднимаются горы, появляются коты.
 *
 * Мир детерминирован по сиду из профиля: остров у каждого свой и всегда один
 * и тот же. Всё, что бог натворил, лежит в localStorage снимком целиком —
 * ландшафт, деревья, дома, коты. Если человек с тех пор наработал больше
 * токенов, остров дорастает: рождаются недостающие коты.
 *
 * Отрисовка — canvas в пикселях, клетка 8×8 внутренних пикселей. Ландшафт
 * запекается в отдельный canvas и перерисовывается только там, где менялось.
 * Живое — коты, огонь, метеориты, ночь — рисуется каждый кадр поверх.
 */

export const W = 56;
export const H = 44;
export const PX = 8;

/* ── Ландшафт ───────────────────────────────────────────────────────────── */

export const T = {
  DEEP: 0,
  WATER: 1,
  SAND: 2,
  GRASS: 3,
  FOREST: 4,
  HILL: 5,
  MOUNTAIN: 6,
  SNOW: 7,
};

const TILE_COLOR = {
  [T.DEEP]: ["#1c4a73", "#1f4f7a", "#1a466e"],
  [T.WATER]: ["#3b7fb0", "#3f84b6", "#377aac"],
  [T.SAND]: ["#e2cf94", "#dcc98d", "#e6d49b"],
  [T.GRASS]: ["#7fa64e", "#77a04a", "#85ab53"],
  [T.FOREST]: ["#5f8f42", "#5a893e", "#659547"],
  [T.HILL]: ["#a68b58", "#9f8552", "#ad925e"],
  [T.MOUNTAIN]: ["#7c7a75", "#75736e", "#83817c"],
  [T.SNOW]: ["#eef1f3", "#e6eaee", "#f5f7f9"],
};

export const TERRAIN_TOOLS = [
  { id: "water", name: "Вода", t: T.WATER, swatch: "#3b7fb0" },
  { id: "deep", name: "Глубина", t: T.DEEP, swatch: "#1c4a73" },
  { id: "sand", name: "Песок", t: T.SAND, swatch: "#e2cf94" },
  { id: "grass", name: "Земля", t: T.GRASS, swatch: "#7fa64e" },
  { id: "hill", name: "Холм", t: T.HILL, swatch: "#a68b58" },
  { id: "stone", name: "Камень", t: T.MOUNTAIN, swatch: "#7c7a75" },
  { id: "snow", name: "Снег", t: T.SNOW, swatch: "#eef1f3" },
];

function walkable(t) {
  return t >= T.SAND && t <= T.HILL;
}

/* ── Народы ─────────────────────────────────────────────────────────────── */

export const RACES = [
  {
    id: "human",
    name: "Люди-коты",
    plural: "людей-котов",
    fur: "#d9a066",
    dark: "#a86a3b",
    hat: "#b23a26",
    roof: "#b23a26",
    wall: "#e9d3a6",
    banner: "#b23a26",
    likes: (t) => (t === T.GRASS ? 3 : t === T.SAND ? 1 : 0),
    canStand: (t) => walkable(t),
    canBuild: (t) => t === T.GRASS || t === T.SAND || t === T.FOREST,
  },
  {
    id: "elf",
    name: "Эльфы-коты",
    plural: "эльфов-котов",
    fur: "#efe9d6",
    dark: "#9aa77a",
    hat: "#5f8f45",
    roof: "#3d6a2c",
    wall: "#8a6a44",
    banner: "#5f8f45",
    likes: (t) => (t === T.FOREST ? 3 : t === T.GRASS ? 1 : 0),
    canStand: (t) => walkable(t),
    canBuild: (t) => t === T.FOREST || t === T.GRASS,
  },
  {
    id: "orc",
    name: "Орки-коты",
    plural: "орков-котов",
    fur: "#6f8f4a",
    dark: "#40592a",
    hat: "#3b2f2a",
    roof: "#3b2f2a",
    wall: "#7a5a3a",
    banner: "#7a2a1e",
    likes: (t) => (t === T.HILL ? 3 : t === T.SAND ? 2 : t === T.GRASS ? 1 : 0),
    canStand: (t) => walkable(t),
    canBuild: (t) => t === T.HILL || t === T.SAND || t === T.GRASS,
  },
  {
    id: "gnome",
    name: "Гномы-коты",
    plural: "гномов-котов",
    fur: "#b7b3ad",
    dark: "#6f6a63",
    hat: "#c9402b",
    roof: "#6d6a66",
    wall: "#9a9590",
    banner: "#e0a93b",
    likes: (t) => (t === T.MOUNTAIN ? 3 : t === T.HILL ? 2 : 0),
    canStand: (t) => walkable(t) || t === T.MOUNTAIN,
    canBuild: (t) => t === T.MOUNTAIN || t === T.HILL,
  },
];

/* ── Случайность ────────────────────────────────────────────────────────── */

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function valueNoise(seed, size) {
  const rand = rng(seed);
  const grid = [];
  for (let i = 0; i < (size + 2) * (size + 2); i += 1) grid.push(rand());
  const at = (x, y) => grid[y * (size + 2) + x];
  const smooth = (t) => t * t * (3 - 2 * t);
  return (u, v) => {
    const x = u * size;
    const y = v * size;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const a = at(x0, y0);
    const b = at(x0 + 1, y0);
    const c = at(x0, y0 + 1);
    const d = at(x0 + 1, y0 + 1);
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };
}

function buildTerrain(seed) {
  const n1 = valueNoise(seed + 1, 5);
  const n2 = valueNoise(seed + 2, 11);
  const n3 = valueNoise(seed + 3, 23);
  const nForest = valueNoise(seed + 4, 8);
  const tiles = new Uint8Array(W * H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const u = x / W;
      const v = y / H;
      let h = n1(u, v) * 0.6 + n2(u, v) * 0.28 + n3(u, v) * 0.12;
      const dx = (u - 0.5) * 2;
      const dy = (v - 0.5) * 2;
      const dist = Math.sqrt(dx * dx + dy * dy);
      h -= Math.max(0, dist - 0.6) * 1.4;
      let t;
      if (h < 0.24) t = T.DEEP;
      else if (h < 0.33) t = T.WATER;
      else if (h < 0.37) t = T.SAND;
      else if (h < 0.58) t = nForest(u, v) > 0.56 ? T.FOREST : T.GRASS;
      else if (h < 0.68) t = T.HILL;
      else if (h < 0.78) t = T.MOUNTAIN;
      else t = T.SNOW;
      tiles[y * W + x] = t;
    }
  }
  return tiles;
}

/* ── Мир ────────────────────────────────────────────────────────────────── */

const DAY_TICKS = 30 * 180; // сутки — три минуты
const SAVE_VERSION = 4;

/**
 * Эры. Народ переходит в следующую, когда прожил достаточно дней и оброс
 * домами — или когда бог решил ускорить время. Внешне меняются дома и
 * корабли: хижины → двухэтажные каменные дома и парусники → башни с огнями и
 * летучие лодки. Коты остаются котами.
 */
export const ERAS = [
  { id: "dawn", name: "Начало", days: 0, houses: 0 },
  { id: "medieval", name: "Средневековье", days: 2, houses: 6 },
  { id: "future", name: "Будущее", days: 6, houses: 12 },
];

export function createWorld({ seed, stats, canvas, onEvent, onRaces, onHud }) {
  const rand = rng(seed * 7 + 13);
  const storeKey = `world:v${SAVE_VERSION}:${seed}`;

  const state = {
    tiles: null,
    trees: new Set(),
    flowers: new Set(),
    houses: [],
    cats: [],
    fires: [],
    meteors: [],
    bolts: [],
    smokes: [],
    homes: [],
    tick: 0,
    day: 1,
    chronicle: [],
    pop: [0, 0, 0, 0],
    era: [0, 0, 0, 0], // эра каждого народа
    ships: [], // { x, y, vx, vy, race, wait } — по воде
    born: Date.now(), // когда остров появился: эры идут по настоящему времени
    particles: [], // { x, y, vx, vy, ttl, life, color } — сердечки, пыль, искры
    terr: null, // Uint8Array: чья территория у клетки, 255 — ничья
    centers: [null, null, null, null], // центр территории народа, для подписи
  };
  // Настройки игрока: подсветка территорий, подписи, скорость, пауза.
  const options = { territories: true, labels: true, speed: 1, paused: false };

  const idx = (x, y) => y * W + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const tileAt = (x, y) => (inside(x, y) ? state.tiles[idx(x, y)] : T.DEEP);

  /* Население из настоящих чисел человека. */
  const tokens = Math.max(0, stats.tokens || 0);
  // Плодовитость от настоящих чисел: серия дней и токены ускоряют рождения.
  const fertility = 1 + Math.min(3, Math.sqrt(tokens / 2_000_000) + (stats.streakDays || 0) / 10);

  function placeHouse(r, near) {
    const race = RACES[r];
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const radius = 1 + Math.floor(attempt / 10);
      const x = near.x + Math.round((rand() * 2 - 1) * radius * 2);
      const y = near.y + Math.round((rand() * 2 - 1) * radius * 1.4);
      if (!inside(x, y) || !race.canBuild(tileAt(x, y))) continue;
      if (state.houses.some((h) => h.x === x && h.y === y)) continue;
      if (state.homes.some((h) => h && h.x === x && h.y === y)) continue;
      state.houses.push({ x, y, race: r });
      state.trees.delete(idx(x, y));
      return true;
    }
    return false;
  }

  function newCat(x, y, r) {
    // px/py — где кот нарисован; x/y — клетка, куда идёт. Между ними кот
    // плавно доезжает, и движение видно, а не мигает по клеткам. task —
    // дело, ради которого он остановится (стройка); без дела кот бродит.
    return { x, y, px: x, py: y, race: r, tx: x, ty: y, wait: Math.floor(Math.random() * 8), step: Math.random(), face: 1, gait: 0, task: null };
  }

  function newShip(x, y, r) {
    const a = Math.random() * Math.PI * 2;
    return { x, y, vx: Math.cos(a) * 0.05, vy: Math.sin(a) * 0.05, race: r, wait: 0, face: 1 };
  }

  function spawnCat(r, near, spread = 4) {
    const race = RACES[r];
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const x = near.x + Math.round((rand() * 2 - 1) * spread);
      const y = near.y + Math.round((rand() * 2 - 1) * spread * 0.7);
      if (!inside(x, y) || !race.canStand(tileAt(x, y))) continue;
      state.cats.push(newCat(x, y, r));
      return true;
    }
    return false;
  }

  function generate() {
    state.tiles = buildTerrain(seed);
    for (let i = 0; i < W * H; i += 1) {
      const t = state.tiles[i];
      if (t === T.FOREST && rand() < 0.6) state.trees.add(i);
      else if (t === T.GRASS && rand() < 0.05) state.trees.add(i);
      else if (t === T.GRASS && rand() < 0.08) state.flowers.add(i);
      else if (t === T.HILL && rand() < 0.04) state.trees.add(i);
    }
    // Как в WorldBox: новый мир пуст. Народ появляется там, где бог
    // поставил первого кота, дома коты строят себе сами.
    state.homes = [null, null, null, null];
  }

  /* ── Сохранение ───────────────────────────────────────────────────────── */

  let saveTimer = 0;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(
          storeKey,
          JSON.stringify({
            v: SAVE_VERSION,
            tiles: Array.from(state.tiles),
            trees: [...state.trees],
            flowers: [...state.flowers],
            houses: state.houses,
            homes: state.homes,
            cats: state.cats.map((c) => [c.x, c.y, c.race]),
            day: state.day,
            era: state.era,
            born: state.born,
            ships: state.ships.map((sh) => [sh.x, sh.y, sh.race]),
            chronicle: state.chronicle.slice(0, 12),
          }),
        );
      } catch {
        /* приватный режим — пусть */
      }
    }, 400);
  }

  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(storeKey) || "null");
      if (!saved || saved.v !== SAVE_VERSION || !Array.isArray(saved.tiles) || saved.tiles.length !== W * H) return false;
      state.tiles = Uint8Array.from(saved.tiles);
      state.trees = new Set(saved.trees || []);
      state.flowers = new Set(saved.flowers || []);
      state.houses = saved.houses || [];
      state.homes = Array.isArray(saved.homes) ? saved.homes.map((h) => h || null) : [null, null, null, null];
      state.cats = (saved.cats || []).map(([x, y, r]) => newCat(x, y, r));
      state.day = saved.day || 1;
      state.era = Array.isArray(saved.era) && saved.era.length === 4 ? saved.era : [0, 0, 0, 0];
      state.born = saved.born || Date.now();
      state.ships = (saved.ships || []).map(([x, y, r]) => newShip(x, y, r));
      state.chronicle = saved.chronicle || [];
      if (state.homes.length !== 4) return false;
      return true;
    } catch {
      return false;
    }
  }

  if (!restore()) {
    state.trees = new Set();
    state.flowers = new Set();
    state.houses = [];
    state.homes = [null, null, null, null];
    state.cats = [];
    generate();
  }

  /* ── Летопись ─────────────────────────────────────────────────────────── */

  const lines = {
    born: (r) => `У ${RACES[r].plural} родился котёнок.`,
    settle: (r) => `${RACES[r].name} основали поселение.`,
    built: (r) => `${RACES[r].name} построили себе дом.`,
    grow: (n) => `Пока тебя не было, родилось ${n} кот${plural(n)} — остров растёт от твоей работы.`,
    spawn: (n, r) => `Бог призвал ${n} ${RACES[r].plural}.`,
    house: (r) => `${RACES[r].name} обживают новый дом.`,
    tree: () => "Бог посадил лес.",
    flowers: () => "На лугах расцвели цветы.",
    water: () => "Бог разлил море.",
    land: () => "Бог поднял сушу из воды.",
    stone: () => "Бог воздвиг горы.",
    fire: () => "Пожар! Коты бегут.",
    bolt: () => "Молния ударила с ясного неба.",
    meteor: (r) => (r == null ? "С неба упал метеорит." : `Метеорит упал рядом с деревней ${RACES[r].plural}.`),
    drown: (n) => `${n} кот${plural(n)} уплыл${n === 1 ? "" : "и"} на плотах: их землю затопило.`,
    trade: (a, b) => `${RACES[a].name} торгуют с ${RACES[b].plural}.`,
    festival: (r) => `У ${RACES[r].plural} праздник урожая.`,
    fishing: () => "Люди-коты вышли в море на рыбалку.",
    forge: () => "В горах гномов-котов стучит кузня.",
    song: () => "Эльфы-коты поют в чаще — слышно даже на пустошах.",
    raid: () => "Орки-коты устроили набег на соседей. Никто не пострадал: все коты.",
    newday: (d) => `Настал день ${d}.`,
    era: (r, e) => `${RACES[r].name} вступили в эру «${ERAS[e].name}».`,
    ship: (r) => `${RACES[r].name} спустили на воду корабль.`,
    eraAll: (e) => `Бог ускорил время: на острове эра «${ERAS[e].name}».`,
  };
  function plural(n) {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return "";
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "а";
    return "ов";
  }
  function chronicle(kind, ...args) {
    const line = lines[kind]?.(...args);
    if (!line) return;
    if (state.chronicle[0]?.text === line) return; // одно и то же подряд не дублируем
    state.chronicle.unshift({ text: line, day: state.day });
    if (state.chronicle.length > 14) state.chronicle.length = 14;
    onEvent?.(state.chronicle);
  }

  /**
   * Территории как в WorldBox: земля в четырёх клетках от домов и столицы
   * народа — его. Спорные клетки достаются тому, чей дом ближе. Считается
   * заново при каждой смене домов, рисуется полупрозрачной заливкой с
   * границей в отдельный слой.
   */
  function computeTerritory() {
    const terr = new Uint8Array(W * H).fill(255);
    const dist = new Float32Array(W * H).fill(Infinity);
    const seeds = [];
    for (const h of state.houses) seeds.push({ x: h.x, y: h.y, r: h.race });
    for (const home of state.homes) if (home) seeds.push({ x: home.x, y: home.y, r: home.race });
    const R = 4;
    for (const sd of seeds) {
      for (let dy = -R; dy <= R; dy += 1) {
        for (let dx = -R; dx <= R; dx += 1) {
          const x = sd.x + dx;
          const y = sd.y + dy;
          if (!inside(x, y)) continue;
          const t = state.tiles[idx(x, y)];
          if (t <= T.WATER) continue;
          const d = dx * dx + dy * dy;
          if (d > R * R + 2) continue;
          const i = idx(x, y);
          if (d < dist[i]) {
            dist[i] = d;
            terr[i] = sd.r;
          }
        }
      }
    }
    state.terr = terr;
    const sums = RACES.map(() => ({ x: 0, y: 0, n: 0 }));
    for (let i = 0; i < W * H; i += 1) {
      const r = terr[i];
      if (r === 255) continue;
      sums[r].x += i % W;
      sums[r].y += (i / W) | 0;
      sums[r].n += 1;
    }
    state.centers = sums.map((a) => (a.n ? { x: a.x / a.n + 0.5, y: a.y / a.n + 0.5, area: a.n } : null));
    bakeOverlay();
  }

  function countPop() {
    const pop = [0, 0, 0, 0];
    const houses = [0, 0, 0, 0];
    for (const c of state.cats) pop[c.race] += 1;
    for (const h of state.houses) houses[h.race] += 1;
    state.pop = pop;
    computeTerritory();
    onRaces?.(
      RACES.map((race, r) => ({
        ...race,
        pop: pop[r],
        houses: houses[r],
        era: state.era[r],
        eraName: ERAS[state.era[r]].name,
        ships: state.ships.filter((sh) => sh.race === r).length,
        mood: mood(r, pop[r], houses[r]),
        center: state.centers[r],
      })),
    );
    hud();
  }

  function mood(r, pop, houses) {
    if (pop === 0) return "деревня опустела";
    if (state.fires.length > 3) return "в панике";
    const perHouse = pop / Math.max(1, houses);
    if (perHouse > 6) return "тесно, просят домов";
    if (perHouse < 1.2) return "простор и лень";
    return "довольны";
  }

  function hud() {
    const era = Math.max(...state.era);
    onHud?.({
      pop: state.cats.length,
      day: state.day,
      night: nightAlpha() > 0.2,
      trees: state.trees.size,
      houses: state.houses.length,
      era,
      eraName: ERAS[era].name,
      alive: Date.now() - state.born,
      paused: options.paused,
    });
  }

  /* ── Симуляция ────────────────────────────────────────────────────────── */

  function moveCats() {
    for (const c of state.cats) {
      const race = RACES[c.race];
      // Доезжаем до клетки: четверть клетки за тик — видно, что кот идёт.
      const ddx = c.x - c.px;
      const ddy = c.y - c.py;
      if (Math.abs(ddx) > 0.01 || Math.abs(ddy) > 0.01) {
        c.px += Math.sign(ddx) * Math.min(Math.abs(ddx), 0.2);
        c.py += Math.sign(ddy) * Math.min(Math.abs(ddy), 0.2);
        c.gait += 1;
        continue;
      }
      c.px = c.x;
      c.py = c.y;
      // Дело: дошёл до места — стоит и работает, пока не закончит.
      if (c.task) {
        if (c.x === c.task.x && c.y === c.task.y) {
          c.task.ttl -= 1;
          if (c.task.ttl <= 0) finishTask(c);
          continue;
        }
        c.tx = c.task.x;
        c.ty = c.task.y;
        c.wait = 0;
      } else if (c.wait > 0) {
        c.wait -= 1;
        continue;
      }
      if (c.x === c.tx && c.y === c.ty) {
        const home = state.homes[c.race] || c;
        for (let attempt = 0; attempt < 6; attempt += 1) {
          const tx = c.x + Math.round((Math.random() * 2 - 1) * 3);
          const ty = c.y + Math.round((Math.random() * 2 - 1) * 2);
          const far = Math.abs(tx - home.x) + Math.abs(ty - home.y);
          if (!inside(tx, ty) || far > 18) continue;
          if (race.canStand(tileAt(tx, ty))) {
            c.tx = tx;
            c.ty = ty;
            break;
          }
        }
        // Почти без передышки: кот, который стоит, выглядит сломанным.
        c.wait = Math.floor(Math.random() * 6);
        continue;
      }
      c.step += 0.5;
      if (c.step < 1) continue;
      c.step = 0;
      const dx = Math.sign(c.tx - c.x);
      const dy = Math.sign(c.ty - c.y);
      const nx = c.x + (dx !== 0 && Math.random() < 0.6 ? dx : 0);
      const ny = c.y + (nx === c.x ? dy : 0);
      if (race.canStand(tileAt(nx, ny))) {
        if (nx !== c.x) c.face = nx > c.x ? 1 : -1;
        c.x = nx;
        c.y = ny;
      } else if (c.task) {
        // Не пройти к стройке — бросаем и пусть возьмётся другой.
        c.task = null;
        c.tx = c.x;
        c.ty = c.y;
      } else {
        c.tx = c.x;
        c.ty = c.y;
      }
    }
  }

  /** Стройка закончена: дом встаёт, кот идёт дальше по делам. */
  function finishTask(c) {
    const t = c.task;
    c.task = null;
    if (t.kind !== "build") return;
    if (!RACES[c.race].canBuild(tileAt(t.x, t.y)) || state.houses.some((h) => h.x === t.x && h.y === t.y)) return;
    state.houses.push({ x: t.x, y: t.y, race: c.race });
    state.trees.delete(idx(t.x, t.y));
    state.flowers.delete(idx(t.x, t.y));
    puff(t.x, t.y, "#c9b48a", 8, "dust");
    chronicle("built", c.race);
    bakeArea(t.x - 1, t.y - 2, t.x + 1, t.y + 1);
    // Строитель отходит от свежего дома, а не стоит в дверях.
    c.tx = t.x + (Math.random() < 0.5 ? -1 : 1);
    c.ty = t.y + 1;
    countPop();
    persist();
  }

  function build() {
    // Раз в ~8 секунд один народ достраивает дом, если тесно: на дом — три
    // кота. Так деревня растёт сама, как в WorldBox, а не по кисти бога.
    if (state.tick % 240 !== 120) return;
    const r = Math.floor(Math.random() * RACES.length);
    const home = state.homes[r];
    if (!home || state.pop[r] === 0) return;
    const houses = state.houses.filter((h) => h.race === r).length;
    if (houses >= Math.ceil(state.pop[r] / 3) || houses >= 40) return;
    if (state.cats.some((c) => c.race === r && c.task)) return; // уже строят
    const site = pickSite(r, home);
    if (!site) return;
    // Ближайший свободный кот народа идёт строить и стоит там секунд пять.
    let worker = null;
    let best = Infinity;
    for (const c of state.cats) {
      if (c.race !== r || c.task) continue;
      const d = Math.abs(c.x - site.x) + Math.abs(c.y - site.y);
      if (d < best) {
        best = d;
        worker = c;
      }
    }
    if (!worker) return;
    worker.task = { kind: "build", x: site.x, y: site.y, ttl: 150 };
    worker.tx = site.x;
    worker.ty = site.y;
    worker.wait = 0;
  }

  /** Место под дом рядом со столицей, по вкусу народа. Без постановки. */
  function pickSite(r, near) {
    const race = RACES[r];
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const radius = 1 + Math.floor(attempt / 10);
      const x = near.x + Math.round((rand() * 2 - 1) * radius * 2);
      const y = near.y + Math.round((rand() * 2 - 1) * radius * 1.4);
      if (!inside(x, y) || !race.canBuild(tileAt(x, y))) continue;
      if (state.houses.some((h) => h.x === x && h.y === y)) continue;
      if (state.homes.some((h) => h && h.x === x && h.y === y)) continue;
      return { x, y };
    }
    return null;
  }

  function breed() {
    if (state.tick % Math.max(120, Math.round(540 / fertility)) !== 0 || state.cats.length >= 260) return;
    const r = Math.floor(Math.random() * RACES.length);
    if (!state.homes[r] || state.pop[r] === 0) return;
    const houses = state.houses.filter((h) => h.race === r).length;
    if (state.pop[r] >= houses * 4 + 1) return;
    if (spawnCat(r, state.homes[r])) {
      const kitten = state.cats[state.cats.length - 1];
      puff(kitten.x, kitten.y, "#ff6f91", 5, "heart");
      chronicle("born", r);
      countPop();
      persist();
    }
  }

  function burn() {
    for (const f of state.fires) {
      f.ttl -= 1;
      if (f.ttl % 10 === 0) {
        const x = f.x + Math.round(Math.random() * 2 - 1);
        const y = f.y + Math.round(Math.random() * 2 - 1);
        const i = idx(x, y);
        if (inside(x, y) && (state.trees.has(i) || state.houses.some((h) => h.x === x && h.y === y)) && !state.fires.some((o) => o.x === x && o.y === y)) {
          state.fires.push({ x, y, ttl: 40 + Math.floor(Math.random() * 40) });
        }
      }
      if (f.ttl <= 0) {
        const i = idx(f.x, f.y);
        state.trees.delete(i);
        const before = state.houses.length;
        state.houses = state.houses.filter((h) => !(h.x === f.x && h.y === f.y));
        if (state.houses.length !== before) countPop();
        state.smokes.push({ x: f.x, y: f.y, ttl: 60 });
        bakeCell(f.x, f.y);
        persist();
      }
      for (const c of state.cats) {
        if (Math.abs(c.x - f.x) <= 1 && Math.abs(c.y - f.y) <= 1) {
          c.tx = c.x + (c.x - f.x || 1) * 3;
          c.ty = c.y + (c.y - f.y) * 2;
          c.wait = 0;
        }
      }
    }
    state.fires = state.fires.filter((f) => f.ttl > 0);
    for (const s of state.smokes) s.ttl -= 1;
    state.smokes = state.smokes.filter((s) => s.ttl > 0);
    for (const b of state.bolts) b.ttl -= 1;
    state.bolts = state.bolts.filter((b) => b.ttl > 0);
  }

  function fallMeteors() {
    for (const m of state.meteors) {
      m.t += 1;
      if (m.t === 30) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const x = m.x + dx;
            const y = m.y + dy;
            if (!inside(x, y)) continue;
            const i = idx(x, y);
            if (state.tiles[i] >= T.SAND) {
              state.tiles[i] = T.SAND;
              if (state.trees.has(i)) state.fires.push({ x, y, ttl: 40 });
            }
            state.trees.delete(i);
            state.flowers.delete(i);
            state.houses = state.houses.filter((h) => !(h.x === x && h.y === y));
          }
        }
        for (const c of state.cats) {
          if (Math.abs(c.x - m.x) <= 3 && Math.abs(c.y - m.y) <= 3) {
            c.tx = c.x + Math.sign(c.x - m.x || 1) * 4;
            c.ty = c.y + Math.sign(c.y - m.y || 1) * 3;
            c.wait = 0;
          }
        }
        const near = state.homes.find((h) => h && Math.abs(h.x - m.x) < 8 && Math.abs(h.y - m.y) < 6);
        puff(m.x, m.y, "#ffb347", 16, "spark");
        chronicle("meteor", near ? near.race : null);
        bakeArea(m.x - 2, m.y - 2, m.x + 2, m.y + 2);
        countPop();
        persist();
      }
    }
    state.meteors = state.meteors.filter((m) => m.t < 36);
  }

  /** Возраст острова в настоящих днях + игровые дни: эра идёт по большему. */
  function ageDays() {
    const real = (Date.now() - state.born) / 86_400_000;
    return Math.max(real, state.day - 1);
  }

  function advanceEras() {
    if (state.tick % 150 !== 0) return;
    const age = ageDays();
    let changed = false;
    RACES.forEach((race, r) => {
      const next = state.era[r] + 1;
      if (next >= ERAS.length) return;
      const houses = state.houses.filter((h) => h.race === r).length;
      if (age >= ERAS[next].days && houses >= ERAS[next].houses) {
        state.era[r] = next;
        chronicle("era", r, next);
        changed = true;
      }
    });
    if (changed) {
      bakeAll();
      countPop();
      persist();
    }
  }

  /** Корабли: с эры Средневековья прибрежные народы выходят в море. */
  function sailShips() {
    // Раз в ~20 с каждый народ, доросший до Средневековья, может спустить
    // корабль: пристань — вода в пяти клетках от любого его дома, а если
    // деревня совсем сухопутная — ближайшая вода к столице.
    if (state.tick % 600 === 300 && state.ships.length < 12) {
      const r = Math.floor(Math.random() * RACES.length);
      if (state.era[r] >= 1 && state.ships.filter((sh) => sh.race === r).length < 3) {
        const docks = [];
        for (const h of state.houses) {
          if (h.race !== r) continue;
          for (let dy = -5; dy <= 5; dy += 1) {
            for (let dx = -5; dx <= 5; dx += 1) {
              const x = h.x + dx;
              const y = h.y + dy;
              if (inside(x, y) && tileAt(x, y) <= T.WATER) docks.push({ x, y });
            }
          }
        }
        let dock = docks.length ? docks[Math.floor(Math.random() * docks.length)] : null;
        if (!dock && state.homes[r]) {
          const home = state.homes[r];
          for (let rad = 1; rad <= 12 && !dock; rad += 1) {
            for (let dy = -rad; dy <= rad && !dock; dy += 1) {
              for (let dx = -rad; dx <= rad; dx += 1) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
                const x = home.x + dx;
                const y = home.y + dy;
                if (inside(x, y) && tileAt(x, y) <= T.WATER) {
                  dock = { x, y };
                  break;
                }
              }
            }
          }
        }
        if (dock) {
          state.ships.push(newShip(dock.x, dock.y, r));
          chronicle("ship", r);
          countPop();
          persist();
        }
      }
    }
    for (const sh of state.ships) {
      if (sh.wait > 0) {
        sh.wait -= 1;
        continue;
      }
      const nx = sh.x + sh.vx;
      const ny = sh.y + sh.vy;
      const t = tileAt(Math.round(nx), Math.round(ny));
      if (t <= T.WATER && inside(Math.round(nx), Math.round(ny))) {
        sh.x = nx;
        sh.y = ny;
        if (Math.abs(sh.vx) > 0.001) sh.face = sh.vx > 0 ? 1 : -1;
        // Лёгкий дрейф курса — не прямые линии.
        if (Math.random() < 0.02) {
          const a = Math.atan2(sh.vy, sh.vx) + (Math.random() - 0.5) * 0.8;
          sh.vx = Math.cos(a) * 0.05;
          sh.vy = Math.sin(a) * 0.05;
        }
      } else {
        // Берег: постоять у пристани и отчалить в другую сторону.
        sh.wait = 60 + Math.floor(Math.random() * 120);
        const a = Math.atan2(sh.vy, sh.vx) + Math.PI + (Math.random() - 0.5) * 1.2;
        sh.vx = Math.cos(a) * 0.05;
        sh.vy = Math.sin(a) * 0.05;
      }
    }
  }

  function ambient() {
    if (state.tick % DAY_TICKS === 0 && state.tick > 0) {
      state.day += 1;
      chronicle("newday", state.day);
      persist();
    }
    if (state.tick % 1200 !== 600) return;
    const kinds = ["trade", "festival", "fishing", "forge", "song", "raid"];
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const a = Math.floor(Math.random() * 4);
    let b = Math.floor(Math.random() * 4);
    if (b === a) b = (a + 1) % 4;
    chronicle(kind, a, b);
  }

  /* ── Кисти бога ───────────────────────────────────────────────────────── */

  /** Обойти клетки кисти радиуса size вокруг (x, y). */
  function brush(x, y, size, fn) {
    for (let dy = -size; dy <= size; dy += 1) {
      for (let dx = -size; dx <= size; dx += 1) {
        // Круглая кисть, а не квадрат: так рисуют в WorldBox.
        if (dx * dx + dy * dy > size * size + size * 0.5) continue;
        const cx = x + dx;
        const cy = y + dy;
        if (inside(cx, cy)) fn(cx, cy, idx(cx, cy));
      }
    }
  }

  /** После смены ландшафта: что было на клетке, должно ей соответствовать. */
  function settle(x, y) {
    const i = idx(x, y);
    const t = state.tiles[i];
    if (t <= T.WATER || t === T.SNOW || t === T.MOUNTAIN) {
      state.trees.delete(i);
      state.flowers.delete(i);
    }
    if (t <= T.WATER || t === T.SNOW) state.houses = state.houses.filter((h) => !(h.x === x && h.y === y));
    // Столица под водой переезжает на ближайшую сушу своего народа.
    for (const home of state.homes) {
      if (home && home.x === x && home.y === y && !RACES[home.race].canStand(t)) {
        const spot = nearestStand(x, y, RACES[home.race], 8);
        if (spot) {
          home.x = spot.x;
          home.y = spot.y;
        }
      }
    }
  }

  function nearestStand(x, y, race, radius) {
    for (let r = 1; r <= radius; r += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const cx = x + dx;
          const cy = y + dy;
          if (inside(cx, cy) && race.canStand(tileAt(cx, cy))) return { x: cx, y: cy };
        }
      }
    }
    return null;
  }

  /** Коты, оказавшиеся не на своей земле, уплывают к ближайшему берегу. */
  function rescueCats() {
    let lost = 0;
    state.cats = state.cats.filter((c) => {
      const race = RACES[c.race];
      if (race.canStand(tileAt(c.x, c.y))) return true;
      const spot = nearestStand(c.x, c.y, race, 4);
      if (spot) {
        c.x = spot.x;
        c.y = spot.y;
        c.tx = spot.x;
        c.ty = spot.y;
        return true;
      }
      lost += 1;
      return false;
    });
    if (lost) chronicle("drown", lost);
  }

  const stroke = { changed: false, kind: null, minX: W, minY: H, maxX: -1, maxY: -1, spawned: 0 };
  function mark(x, y) {
    stroke.changed = true;
    stroke.minX = Math.min(stroke.minX, x);
    stroke.minY = Math.min(stroke.minY, y);
    stroke.maxX = Math.max(stroke.maxX, x);
    stroke.maxY = Math.max(stroke.maxY, y);
  }

  /**
   * Применить инструмент в клетке. Зовётся на каждое движение пальца по новой
   * клетке, поэтому тяжёлые вещи (перепечь ландшафт, сохранить) откладываются
   * до конца штриха — endStroke().
   */
  function apply(tool, x, y, size) {
    if (!inside(x, y)) return;
    switch (tool.kind) {
      case "terrain": {
        let touched = false;
        brush(x, y, size, (cx, cy, i) => {
          if (state.tiles[i] === tool.t) return;
          state.tiles[i] = tool.t;
          settle(cx, cy);
          mark(cx, cy);
          touched = true;
        });
        // Печём сразу: человек ведёт пальцем и должен видеть след кисти, а не
        // ждать, пока отпустит.
        if (touched) bakeArea(x - size - 1, y - size - 2, x + size + 1, y + size + 1);
        stroke.kind = tool.t <= T.WATER ? "water" : tool.t >= T.MOUNTAIN ? "stone" : "land";
        break;
      }
      case "tree": {
        brush(x, y, size, (cx, cy, i) => {
          const t = state.tiles[i];
          if (t < T.SAND || t > T.HILL || state.trees.has(i)) return;
          if (state.houses.some((h) => h.x === cx && h.y === cy)) return;
          // Внутри кисти — не сплошняком, а с просветами: лес, а не забор.
          if (size > 0 && Math.random() < 0.35) return;
          state.trees.add(i);
          state.flowers.delete(i);
          mark(cx, cy);
        });
        bakeArea(x - size - 1, y - size - 2, x + size + 1, y + size + 1);
        stroke.kind = "tree";
        break;
      }
      case "flowers": {
        brush(x, y, size, (cx, cy, i) => {
          if (state.tiles[i] !== T.GRASS || state.trees.has(i)) return;
          state.flowers.add(i);
          mark(cx, cy);
        });
        bakeArea(x - size - 1, y - size - 1, x + size + 1, y + size + 1);
        stroke.kind = "flowers";
        break;
      }
      case "erase": {
        brush(x, y, size, (cx, cy, i) => {
          if (state.trees.delete(i)) mark(cx, cy);
          if (state.flowers.delete(i)) mark(cx, cy);
          const before = state.houses.length;
          state.houses = state.houses.filter((h) => !(h.x === cx && h.y === cy));
          if (before !== state.houses.length) mark(cx, cy);
        });
        bakeArea(x - size - 1, y - size - 2, x + size + 1, y + size + 1);
        break;
      }
      case "cat": {
        const race = RACES[tool.race];
        if (!race.canStand(tileAt(x, y))) return;
        if (!state.homes[tool.race]) {
          state.homes[tool.race] = { race: tool.race, x, y };
          chronicle("settle", tool.race);
          mark(x, y);
        }
        state.cats.push(newCat(x, y, tool.race));
        stroke.spawned += 1;
        stroke.kind = "cat";
        stroke.race = tool.race;
        break;
      }
      case "house": {
        const race = RACES[tool.race];
        if (!race.canBuild(tileAt(x, y))) return;
        if (state.houses.some((h) => h.x === x && h.y === y)) return;
        if (!state.homes[tool.race]) {
          state.homes[tool.race] = { race: tool.race, x, y };
          chronicle("settle", tool.race);
        }
        state.houses.push({ x, y, race: tool.race });
        state.trees.delete(idx(x, y));
        state.flowers.delete(idx(x, y));
        mark(x, y);
        bakeArea(x - 1, y - 2, x + 1, y + 1);
        stroke.kind = "house";
        stroke.race = tool.race;
        break;
      }
      case "fire": {
        const i = idx(x, y);
        if (state.trees.has(i) || state.houses.some((h) => h.x === x && h.y === y)) {
          if (!state.fires.some((f) => f.x === x && f.y === y)) state.fires.push({ x, y, ttl: 60 });
          stroke.kind = "fire";
        }
        break;
      }
      case "bolt": {
        state.bolts.push({ x, y, ttl: 12 });
        const i = idx(x, y);
        if (state.trees.has(i) || state.houses.some((h) => h.x === x && h.y === y)) state.fires.push({ x, y, ttl: 50 });
        for (const c of state.cats) {
          if (Math.abs(c.x - x) <= 2 && Math.abs(c.y - y) <= 2) {
            c.tx = c.x + Math.sign(c.x - x || 1) * 3;
            c.ty = c.y + Math.sign(c.y - y || 1) * 2;
            c.wait = 0;
          }
        }
        stroke.kind = "bolt";
        break;
      }
      case "meteor": {
        if (!state.meteors.some((m) => Math.abs(m.x - x) < 3 && Math.abs(m.y - y) < 3)) state.meteors.push({ x, y, t: 0 });
        break;
      }
      case "era": {
        // Ускорить время: все народы шагают в следующую эру. Одна на штрих.
        if (stroke.kind === "era") break;
        const top = Math.max(...state.era);
        if (top + 1 >= ERAS.length) {
          stroke.kind = "era-max";
          break;
        }
        state.era = state.era.map((e) => Math.min(ERAS.length - 1, Math.max(e + 1, top + 1)));
        stroke.kind = "era";
        stroke.era = top + 1;
        bakeAll();
        break;
      }
      default:
        break;
    }
  }

  function endStroke() {
    if (stroke.changed) {
      bakeArea(stroke.minX - 1, stroke.minY - 1, stroke.maxX + 1, stroke.maxY + 1);
      rescueCats();
    }
    switch (stroke.kind) {
      case "water":
        chronicle("water");
        break;
      case "land":
        chronicle("land");
        break;
      case "stone":
        chronicle("stone");
        break;
      case "tree":
        chronicle("tree");
        break;
      case "flowers":
        chronicle("flowers");
        break;
      case "house":
        chronicle("house", stroke.race);
        break;
      case "cat":
        if (stroke.spawned === 1) chronicle("born", stroke.race);
        else chronicle("spawn", stroke.spawned, stroke.race);
        break;
      case "fire":
        chronicle("fire");
        break;
      case "bolt":
        chronicle("bolt");
        break;
      case "era":
        chronicle("eraAll", stroke.era);
        break;
      default:
        break;
    }
    if (stroke.changed || stroke.spawned || stroke.kind) {
      countPop();
      persist();
    }
    stroke.changed = false;
    stroke.kind = null;
    stroke.spawned = 0;
    stroke.minX = W;
    stroke.minY = H;
    stroke.maxX = -1;
    stroke.maxY = -1;
  }

  /* ── Отрисовка ────────────────────────────────────────────────────────── */

  const ctx = canvas.getContext("2d");
  canvas.width = W * PX;
  canvas.height = H * PX;
  ctx.imageSmoothingEnabled = false;

  const terrain = document.createElement("canvas");
  terrain.width = canvas.width;
  terrain.height = canvas.height;
  const tctx = terrain.getContext("2d");

  // Слой территорий: полупрозрачная заливка цветом народа и граница там, где
  // сосед — другой народ или ничья земля. Печётся при смене домов.
  const overlay = document.createElement("canvas");
  overlay.width = canvas.width;
  overlay.height = canvas.height;
  const octx = overlay.getContext("2d");

  function bakeOverlay() {
    octx.clearRect(0, 0, overlay.width, overlay.height);
    const terr = state.terr;
    if (!terr) return;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const r = terr[idx(x, y)];
        if (r === 255) continue;
        const race = RACES[r];
        const color = race.id === "elf" ? race.hat : race.banner;
        octx.globalAlpha = 0.16;
        octx.fillStyle = color;
        octx.fillRect(x * PX, y * PX, PX, PX);
        octx.globalAlpha = 0.85;
        const other = (nx, ny) => !inside(nx, ny) || terr[idx(nx, ny)] !== r;
        if (other(x, y - 1)) octx.fillRect(x * PX, y * PX, PX, 1);
        if (other(x, y + 1)) octx.fillRect(x * PX, y * PX + PX - 1, PX, 1);
        if (other(x - 1, y)) octx.fillRect(x * PX, y * PX, 1, PX);
        if (other(x + 1, y)) octx.fillRect(x * PX + PX - 1, y * PX, 1, PX);
      }
    }
    octx.globalAlpha = 1;
  }

  /** Частицы: короткие, дешёвые, ради ощущения жизни. */
  function puff(x, y, color, n, kind) {
    for (let i = 0; i < n; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const sp = kind === "spark" ? 0.6 + Math.random() * 1.2 : 0.15 + Math.random() * 0.35;
      state.particles.push({
        x: x * PX + 4,
        y: y * PX + 4,
        vx: Math.cos(a) * sp,
        vy: kind === "heart" ? -0.3 - Math.random() * 0.3 : Math.sin(a) * sp - (kind === "dust" ? 0.2 : 0),
        ttl: kind === "heart" ? 40 : kind === "spark" ? 24 : 30,
        life: kind === "heart" ? 40 : kind === "spark" ? 24 : 30,
        color,
        kind,
      });
    }
  }

  function stepParticles() {
    for (const p of state.particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.kind === "spark") p.vy += 0.08;
      if (p.kind === "dust") p.vx *= 0.92;
      p.ttl -= 1;
    }
    state.particles = state.particles.filter((p) => p.ttl > 0);
    // Дым из труб: у домов изредка вылетает клуб. Только в эрах до будущего —
    // башни не коптят.
    if (state.tick % 20 === 0 && state.houses.length) {
      const h = state.houses[Math.floor(Math.random() * state.houses.length)];
      const era = state.era[h.race] || 0;
      if (era < 2 && Math.random() < 0.5) {
        state.smokes.push({ x: h.x, y: h.y - (era === 1 ? 1 : 0), ttl: 60 });
      }
    }
  }

  function drawParticles() {
    for (const p of state.particles) {
      ctx.globalAlpha = Math.max(0, p.ttl / p.life);
      if (p.kind === "heart") {
        rect(ctx, p.color, Math.round(p.x), Math.round(p.y) + 1, 3, 2);
        rect(ctx, p.color, Math.round(p.x), Math.round(p.y), 1, 1);
        rect(ctx, p.color, Math.round(p.x) + 2, Math.round(p.y), 1, 1);
        rect(ctx, p.color, Math.round(p.x) + 1, Math.round(p.y) + 3, 1, 1);
      } else {
        rect(ctx, p.color, Math.round(p.x), Math.round(p.y), p.kind === "dust" ? 2 : 1, p.kind === "dust" ? 2 : 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Вода живая: блики бегут по волнам. Клетки воды известны после запекания. */
  let waterCells = [];
  function drawWater() {
    const t = state.tick;
    ctx.fillStyle = "#8fc9e6";
    for (let i = 0; i < waterCells.length; i += 1) {
      const cell = waterCells[i];
      // Каждая клетка мерцает в своей фазе; в кадре светится примерно каждая шестая.
      const phase = (t + cell * 7) % 90;
      if (phase > 12) continue;
      const x = cell % W;
      const y = (cell / W) | 0;
      const off = phase >> 2;
      ctx.fillRect(x * PX + 1 + off, y * PX + 3 + (cell % 3), 2, 1);
    }
  }

  const shadeRand = rng(seed + 99);
  const shadeMap = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i += 1) shadeMap[i] = Math.floor(shadeRand() * 3);

  function rect(g, c, x, y, w = 1, h = 1) {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  }

  function drawTree(g, x, y) {
    const bx = x * PX;
    const by = y * PX;
    rect(g, "#2f5423", bx + 1, by + 1, 6, 5);
    rect(g, "#3d6a2c", bx + 2, by, 4, 6);
    rect(g, "#4f8a38", bx + 3, by + 1, 2, 2);
    rect(g, "#4f8a38", bx + 2, by + 3, 1, 1);
    rect(g, "#5b3d22", bx + 3, by + 6, 2, 2);
  }

  function drawFlowers(g, x, y) {
    const bx = x * PX;
    const by = y * PX;
    const s = shadeMap[idx(x, y)];
    rect(g, s === 0 ? "#e85d75" : s === 1 ? "#f2d54a" : "#f5f1e6", bx + 2, by + 3, 1, 1);
    rect(g, s === 1 ? "#e85d75" : "#f5f1e6", bx + 5, by + 5, 1, 1);
    rect(g, "#f2d54a", bx + 6, by + 1, 1, 1);
  }

  /**
   * Дом народа в его эре. Начало — хижина в клетку; Средневековье —
   * двухэтажный дом, растёт на клетку вверх; Будущее — башня на полторы
   * клетки с огнями. Все три рисуются от нижней клетки, поэтому порядок
   * запекания — по y: нижний дом перекрывает верхний, как в изометрии.
   */
  function drawHouse(g, h) {
    const race = RACES[h.race];
    const era = state.era[h.race] || 0;
    const bx = h.x * PX;
    const by = h.y * PX;
    if (era === 0) {
      drawHut(g, race, bx, by);
    } else if (era === 1) {
      drawTwoStorey(g, race, bx, by);
    } else {
      drawTower(g, race, bx, by);
    }
  }

  function drawHut(g, race, bx, by) {
    switch (race.id) {
      case "human":
        rect(g, race.wall, bx, by + 3, 8, 5);
        rect(g, race.roof, bx, by + 2, 8, 1);
        rect(g, race.roof, bx + 1, by + 1, 6, 1);
        rect(g, race.roof, bx + 2, by, 4, 1);
        rect(g, "#5b3d22", bx + 3, by + 5, 2, 3);
        rect(g, "#8fc1dd", bx + 6, by + 4, 1, 1);
        rect(g, "#8fc1dd", bx + 1, by + 4, 1, 1);
        break;
      case "elf":
        rect(g, "#2f5423", bx, by, 8, 5);
        rect(g, "#3d6a2c", bx + 1, by + 1, 6, 4);
        rect(g, race.wall, bx + 2, by + 2, 4, 3);
        rect(g, race.roof, bx + 2, by + 1, 4, 1);
        rect(g, "#e0a93b", bx + 3, by + 3, 1, 1);
        rect(g, "#5b3d22", bx + 3, by + 5, 2, 3);
        break;
      case "orc":
        rect(g, race.wall, bx, by + 3, 8, 5);
        rect(g, race.roof, bx + 1, by + 2, 6, 1);
        rect(g, race.roof, bx + 2, by + 1, 4, 1);
        rect(g, race.roof, bx + 3, by, 2, 1);
        rect(g, "#efe9d6", bx, by + 2, 1, 1);
        rect(g, "#efe9d6", bx + 7, by + 2, 1, 1);
        rect(g, "#3b2f2a", bx + 3, by + 5, 2, 3);
        rect(g, race.banner, bx + 6, by + 4, 1, 2);
        break;
      case "gnome":
        rect(g, race.wall, bx, by + 1, 8, 7);
        rect(g, race.roof, bx + 1, by, 6, 1);
        rect(g, "#6f6a63", bx + 1, by + 2, 6, 1);
        rect(g, "#3b2f2a", bx + 3, by + 4, 2, 4);
        rect(g, "#5b3d22", bx + 2, by + 3, 4, 1);
        rect(g, race.banner, bx + 1, by + 4, 1, 1);
        rect(g, race.banner, bx + 6, by + 4, 1, 1);
        break;
      default:
        break;
    }
  }

  /** Двухэтажный дом: 8 в ширину, 14 в высоту, стоит на нижней клетке. */
  function drawTwoStorey(g, race, bx, by) {
    const top = by - 6;
    const stone = race.id === "gnome" ? "#8d8983" : race.id === "orc" ? "#5a4636" : "#cfc4ad";
    const trim = race.id === "elf" ? "#5b3d22" : "#4a3a2a";
    // Стены двух этажей, балки, окна, дверь.
    rect(g, stone, bx, top + 4, 8, 10);
    rect(g, race.wall, bx + 1, top + 5, 6, 3);
    rect(g, race.wall, bx + 1, top + 9, 6, 4);
    rect(g, trim, bx, top + 8, 8, 1);
    rect(g, "#8fc1dd", bx + 2, top + 6, 1, 1);
    rect(g, "#8fc1dd", bx + 5, top + 6, 1, 1);
    rect(g, "#8fc1dd", bx + 5, top + 10, 1, 1);
    rect(g, "#3b2f2a", bx + 2, top + 10, 2, 4);
    // Крыша: конёк на две клетки, цвет народа.
    rect(g, race.roof, bx - 1, top + 3, 10, 1);
    rect(g, race.roof, bx, top + 2, 8, 1);
    rect(g, race.roof, bx + 1, top + 1, 6, 1);
    rect(g, race.roof, bx + 2, top, 4, 1);
    rect(g, "#141413", bx + 3, top - 1, 2, 1);
    if (race.id === "gnome") rect(g, race.banner, bx + 6, top + 10, 1, 1);
    if (race.id === "orc") rect(g, "#efe9d6", bx, top + 1, 1, 2);
    if (race.id === "elf") rect(g, "#3d6a2c", bx - 1, top + 9, 1, 5);
    if (race.id === "human") rect(g, race.banner, bx + 7, top + 4, 1, 3);
  }

  /** Башня будущего: 8 в ширину, 16 в высоту, с огнями и куполом. */
  function drawTower(g, race, bx, by) {
    const top = by - 8;
    const body = race.id === "gnome" ? "#6f7d8a" : race.id === "orc" ? "#4a4a52" : race.id === "elf" ? "#4f7a6a" : "#8a97a8";
    const glow = race.id === "orc" ? "#ff6a3d" : race.id === "elf" ? "#7dffb0" : race.id === "gnome" ? "#ffd166" : "#7fd4ff";
    rect(g, body, bx + 1, top + 4, 6, 12);
    rect(g, "#2b2f3a", bx + 1, top + 4, 1, 12);
    rect(g, "#c9d3df", bx + 6, top + 4, 1, 12);
    for (let i = 0; i < 4; i += 1) rect(g, glow, bx + 3, top + 5 + i * 3, 2, 1);
    rect(g, glow, bx + 2, top + 13, 1, 1);
    rect(g, glow, bx + 5, top + 13, 1, 1);
    // Купол и антенна.
    rect(g, body, bx, top + 3, 8, 1);
    rect(g, "#c9d3df", bx + 1, top + 2, 6, 1);
    rect(g, "#c9d3df", bx + 2, top + 1, 4, 1);
    rect(g, glow, bx + 3, top, 2, 1);
    rect(g, "#f4efe2", bx + 4, top - 2, 1, 2);
    rect(g, race.banner, bx + 7, top + 6, 1, 2);
  }

  function drawFlag(g, home) {
    const race = RACES[home.race];
    const bx = home.x * PX;
    const by = home.y * PX;
    rect(g, "#3b2f2a", bx + 3, by - 6, 1, 8);
    rect(g, race.banner, bx + 4, by - 6, 4, 3);
    rect(g, "#141413", bx + 5, by - 5, 1, 1);
    rect(g, "#e0a93b", bx + 2, by - 7, 3, 1);
  }

  function bakeCell(x, y) {
    if (!inside(x, y)) return;
    const i = idx(x, y);
    const t = state.tiles[i];
    rect(tctx, TILE_COLOR[t][shadeMap[i]], x * PX, y * PX, PX, PX);
    const s = shadeMap[i];
    if (t === T.WATER || t === T.DEEP) {
      // Рябь: две светлые точки, в разных местах по клеткам.
      rect(tctx, t === T.WATER ? "#5b9fcc" : "#2a5f8c", x * PX + 1 + s * 2, y * PX + 2 + s, 2, 1);
      const shore = tileAt(x + 1, y) >= T.SAND || tileAt(x - 1, y) >= T.SAND || tileAt(x, y + 1) >= T.SAND || tileAt(x, y - 1) >= T.SAND;
      if (shore && t === T.WATER) rect(tctx, "#a9d4ea", x * PX + 2, y * PX + 5, 3, 1);
    } else if (t === T.GRASS) {
      rect(tctx, "#6f9644", x * PX + 1 + s * 2, y * PX + 5 - s, 1, 2);
    } else if (t === T.FOREST) {
      rect(tctx, "#4f7f3a", x * PX + 2 + s, y * PX + 3 + s, 2, 2);
    } else if (t === T.SAND) {
      rect(tctx, "#d1bc7c", x * PX + 2 + s * 2, y * PX + 2 + s, 1, 1);
    } else if (t === T.HILL) {
      rect(tctx, "#8e7648", x * PX + 1 + s, y * PX + 5, 3, 1);
    } else if (t === T.MOUNTAIN) {
      rect(tctx, "#5f5d58", x * PX + 1 + s, y * PX + 4, 3, 1);
      rect(tctx, "#9a9893", x * PX + 3, y * PX + 1 + s, 2, 1);
    } else if (t === T.SNOW) {
      rect(tctx, "#cfd7dd", x * PX + 2 + s * 2, y * PX + 4, 1, 1);
    }
    if (state.flowers.has(i)) drawFlowers(tctx, x, y);
  }

  function bakeArea(x0, y0, x1, y1) {
    const ax = Math.max(0, x0 - 1);
    const ay = Math.max(0, y0 - 2);
    const bx = Math.min(W - 1, x1 + 1);
    const by = Math.min(H - 1, y1 + 1);
    for (let y = ay; y <= by; y += 1) for (let x = ax; x <= bx; x += 1) bakeCell(x, y);
    // Деревья и дома — поверх, и с запасом на клетку вверх: кроны и крыши
    // залезают на соседей.
    for (let y = ay; y <= by + 1; y += 1) {
      for (let x = ax; x <= bx; x += 1) {
        if (!inside(x, y)) continue;
        const i = idx(x, y);
        if (state.trees.has(i)) drawTree(tctx, x, y);
      }
    }
    refreshWater();
    const inArea = state.houses.filter((h) => h.x >= ax && h.x <= bx && h.y >= ay && h.y <= by + 2);
    inArea.sort((a, b) => a.y - b.y);
    for (const h of inArea) drawHouse(tctx, h);
    for (const home of state.homes) if (home && home.x >= ax && home.x <= bx && home.y >= ay && home.y <= by + 1) drawFlag(tctx, home);
  }

  function bakeAll() {
    bakeArea(0, 0, W - 1, H - 1);
  }

  function refreshWater() {
    waterCells = [];
    for (let i = 0; i < W * H; i += 1) if (state.tiles[i] <= T.WATER) waterCells.push(i);
  }

  function drawCat(c) {
    const race = RACES[c.race];
    const left = Math.max(Math.abs(c.x - c.px), Math.abs(c.y - c.py));
    // Прыжок между клетками по дуге, как в WorldBox: чем ближе к середине
    // шага, тем выше. Стоя кот тоже изредка подскакивает — живой.
    let hop = 0;
    if (left > 0.01) hop = Math.round(3 * Math.sin(Math.PI * (1 - left)));
    else if (c.wait > 0 && c.wait % 45 < 3) hop = 1;
    const bx = Math.round(c.px * PX) + 1;
    const by = Math.round(c.py * PX) + 1 - hop;
    const f = c.face;
    // Тень, тело 6×4, уши, глаза, хвост. Лицо смотрит туда, куда шёл.
    ctx.globalAlpha = 0.25;
    rect(ctx, "#141413", bx, by + 5 + hop, 6, 1);
    ctx.globalAlpha = 1;
    rect(ctx, race.fur, bx, by + 1, 6, 4);
    rect(ctx, race.fur, bx, by, 1, 1);
    rect(ctx, race.fur, bx + 5, by, 1, 1);
    rect(ctx, race.dark, bx + 1, by + 4, 1, 1);
    rect(ctx, race.dark, bx + 4, by + 4, 1, 1);
    const eyeL = f > 0 ? bx + 2 : bx + 1;
    // Моргание: раз в несколько секунд на пару кадров глаза — полоски.
    const blink = (state.tick + c.x * 13 + c.y * 7) % 140 < 4;
    if (!blink) {
      rect(ctx, "#141413", eyeL, by + 2, 1, 1);
      rect(ctx, "#141413", eyeL + 2, by + 2, 1, 1);
    } else {
      rect(ctx, race.dark, eyeL, by + 2, 3, 1);
    }
    rect(ctx, "#e37f6a", f > 0 ? bx + 3 : bx + 2, by + 3, 1, 1); // нос
    // Хвост машет: две фазы, у каждого кота своя.
    const wag = ((state.tick >> 3) + c.x) % 2;
    rect(ctx, race.dark, f > 0 ? bx - 1 : bx + 6, by + 1 + wag, 1, 2);
    if (c.task && c.x === c.task.x && c.y === c.task.y) {
      // Строит: молоток машет, под котом каркас будущего дома.
      const swing = (state.tick >> 2) % 2;
      rect(ctx, "#5b3d22", bx + 6, by - 2 + swing, 1, 3);
      rect(ctx, "#8c9ba8", bx + 5, by - 3 + swing, 3, 1);
      rect(ctx, "#5b3d22", c.task.x * PX, c.task.y * PX + 7, 8, 1);
      rect(ctx, "#5b3d22", c.task.x * PX, c.task.y * PX + 4, 1, 3);
      rect(ctx, "#5b3d22", c.task.x * PX + 7, c.task.y * PX + 4, 1, 3);
    }
    switch (race.id) {
      case "human":
        rect(ctx, race.hat, bx, by - 1, 6, 1);
        rect(ctx, race.hat, f > 0 ? bx + 5 : bx - 1, by, 2, 1);
        break;
      case "elf":
        rect(ctx, race.dark, bx - 1, by, 1, 1);
        rect(ctx, race.dark, bx + 6, by, 1, 1);
        rect(ctx, "#3d6a2c", bx + 2, by - 1, 2, 1);
        break;
      case "orc":
        rect(ctx, "#efe9d6", bx + 1, by + 4, 1, 1);
        rect(ctx, "#efe9d6", bx + 4, by + 4, 1, 1);
        rect(ctx, "#3b2f2a", bx + 1, by - 1, 1, 1);
        rect(ctx, "#3b2f2a", bx + 4, by - 1, 1, 1);
        break;
      case "gnome":
        rect(ctx, race.hat, bx + 2, by - 2, 2, 1);
        rect(ctx, race.hat, bx + 1, by - 1, 4, 1);
        rect(ctx, "#efe9d6", bx + 1, by + 4, 4, 1);
        break;
      default:
        break;
    }
  }

  function drawShip(sh) {
    const race = RACES[sh.race];
    const era = state.era[sh.race] || 0;
    const bx = Math.round(sh.x * PX);
    const by = Math.round(sh.y * PX) + ((state.tick >> 4) % 2); // качка
    const f = sh.face;
    // След на воде.
    ctx.globalAlpha = 0.5;
    rect(ctx, "#a9d4ea", f > 0 ? bx - 3 : bx + 8, by + 6, 3, 1);
    ctx.globalAlpha = 1;
    if (era >= 2) {
      // Летучая лодка будущего: корпус, огни, свечение снизу.
      rect(ctx, "#8a97a8", bx + 1, by + 3, 7, 3);
      rect(ctx, "#c9d3df", bx + 2, by + 2, 5, 1);
      rect(ctx, race.banner, bx + 3, by + 1, 3, 1);
      rect(ctx, "#7fd4ff", f > 0 ? bx + 7 : bx + 1, by + 4, 1, 1);
      ctx.globalAlpha = 0.6;
      rect(ctx, "#7fd4ff", bx + 2, by + 6, 5, 1);
      ctx.globalAlpha = 1;
      return;
    }
    // Парусник: корпус, мачта, парус цвета народа.
    rect(ctx, "#5b3d22", bx + 1, by + 5, 7, 2);
    rect(ctx, "#7a5236", bx, by + 4, 9, 1);
    rect(ctx, "#3b2f2a", bx + 4, by, 1, 5);
    if (f > 0) {
      rect(ctx, "#f4efe2", bx + 5, by, 3, 4);
      rect(ctx, race.banner, bx + 5, by + 1, 3, 1);
    } else {
      rect(ctx, "#f4efe2", bx + 1, by, 3, 4);
      rect(ctx, race.banner, bx + 1, by + 1, 3, 1);
    }
  }

  function drawFire(f) {
    const bx = f.x * PX;
    const by = f.y * PX;
    const flick = (state.tick + f.x * 3) % 6 < 3;
    rect(ctx, "#e0a93b", bx + 1, by + 2, 6, 6);
    rect(ctx, "#d9573b", bx + 2, by + (flick ? 0 : 1), 4, 2);
    rect(ctx, "#d9573b", bx + 1, by + 3, 1, 2);
    rect(ctx, "#fff3a3", bx + 3, by + 4, 2, 2);
  }

  function drawSmoke(s) {
    const bx = s.x * PX + 2 + ((60 - s.ttl) >> 4);
    const by = s.y * PX - ((60 - s.ttl) >> 3);
    ctx.globalAlpha = s.ttl / 60;
    rect(ctx, "#9a9590", bx, by, 3, 3);
    ctx.globalAlpha = 1;
  }

  function drawBolt(b) {
    const bx = b.x * PX + 4;
    const by = b.y * PX + 4;
    ctx.globalAlpha = Math.min(1, b.ttl / 6);
    rect(ctx, "#fff3a3", bx, by - 40, 1, 40);
    rect(ctx, "#fff3a3", bx - 3, by - 28, 4, 1);
    rect(ctx, "#fff3a3", bx + 1, by - 16, 3, 1);
    rect(ctx, "#ffffff", bx - 1, by - 2, 3, 3);
    ctx.globalAlpha = 1;
  }

  function drawMeteor(m) {
    const t = m.t / 30;
    const bx = m.x * PX + 3 + (1 - t) * 80;
    const by = m.y * PX + 3 - (1 - t) * 160;
    if (m.t < 30) {
      rect(ctx, "#d9573b", bx, by, 4, 4);
      rect(ctx, "#fff3a3", bx + 1, by + 1, 2, 2);
      ctx.globalAlpha = 0.5;
      rect(ctx, "#e0a93b", bx + 4, by - 4, 3, 3);
      rect(ctx, "#e0a93b", bx + 8, by - 8, 2, 2);
      ctx.globalAlpha = 1;
    } else {
      const r = (m.t - 30) * 3 + 3;
      ctx.globalAlpha = 0.75 - (m.t - 30) * 0.12;
      rect(ctx, "#fff3a3", m.x * PX + 4 - r, m.y * PX + 4 - r, r * 2 + 1, r * 2 + 1);
      ctx.globalAlpha = 1;
    }
  }

  function nightAlpha() {
    const phase = (state.tick % DAY_TICKS) / DAY_TICKS;
    return Math.max(0, -Math.cos(phase * Math.PI * 2)) * 0.5;
  }

  let cursor = null; // { x, y, size } — подсветка кисти под пальцем
  function frame() {
    ctx.drawImage(terrain, 0, 0);
    drawWater();
    if (options.territories) ctx.drawImage(overlay, 0, 0);
    // Флаги столиц машут поверх запечённых: два кадра полотнища.
    for (const home of state.homes) {
      if (!home) continue;
      const race = RACES[home.race];
      const fl = (state.tick >> 3) % 2;
      rect(ctx, race.banner, home.x * PX + 4, home.y * PX - 6 + fl, 4, 3);
    }
    for (const s of state.smokes) drawSmoke(s);
    // Коты по y: нижние поверх верхних, как в любой изометрии.
    for (const sh of state.ships) drawShip(sh);
    const cats = state.cats.slice().sort((a, b) => a.py - b.py);
    for (const c of cats) drawCat(c);
    for (const f of state.fires) drawFire(f);
    for (const b of state.bolts) drawBolt(b);
    for (const m of state.meteors) drawMeteor(m);
    drawParticles();
    const night = nightAlpha();
    if (night > 0.01) {
      ctx.fillStyle = `rgba(16, 20, 48, ${night})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = `rgba(255, 220, 130, ${Math.min(1, night * 1.6)})`;
      for (const h of state.houses) {
        const era = state.era[h.race] || 0;
        ctx.fillRect(h.x * PX + 3, h.y * PX + (era === 0 ? 5 : era === 1 ? 0 : -3), 2, 2);
        if (era >= 1) ctx.fillRect(h.x * PX + 5, h.y * PX + (era === 1 ? -4 : -6), 1, 1);
      }
      for (const sh of state.ships) ctx.fillRect(Math.round(sh.x * PX) + 4, Math.round(sh.y * PX) + 2, 1, 1);
      for (const f of state.fires) ctx.fillRect(f.x * PX + 2, f.y * PX + 2, 4, 4);
    }
    if (cursor) {
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 1;
      const s = cursor.size;
      ctx.strokeRect((cursor.x - s) * PX + 0.5, (cursor.y - s) * PX + 0.5, (s * 2 + 1) * PX - 1, (s * 2 + 1) * PX - 1);
    }
  }

  /* ── Цикл ─────────────────────────────────────────────────────────────── */

  let raf = 0;
  let last = 0;
  let running = false;
  const STEP = 1000 / 30;

  function loop(now) {
    if (!running) return;
    if (now - last >= STEP) {
      last = now;
      const steps = options.paused ? 0 : options.speed;
      for (let i = 0; i < steps; i += 1) {
        state.tick += 1;
        moveCats();
        sailShips();
        burn();
        fallMeteors();
        build();
        breed();
        advanceEras();
        ambient();
        stepParticles();
      }
      frame();
      if (state.tick % 90 === 0 || options.paused) hud();
    }
    raf = requestAnimationFrame(loop);
  }

  bakeAll();
  refreshWater();
  countPop();
  onEvent?.(state.chronicle);
  frame();

  return {
    start() {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(loop);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    /** Экранные координаты → клетка. */
    cellAt(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      return {
        x: Math.floor(((clientX - r.left) / r.width) * W),
        y: Math.floor(((clientY - r.top) / r.height) * H),
      };
    },
    apply,
    endStroke,
    setOption(name, value) {
      options[name] = value;
      if (!running) frame();
      hud();
    },
    get options() {
      return { ...options };
    },
    setCursor(c) {
      cursor = c;
      if (!running) frame();
    },
    reset() {
      clearTimeout(saveTimer);
      localStorage.removeItem(storeKey);
    },
    get chronicle() {
      return state.chronicle;
    },
    get population() {
      return state.cats.length;
    },
    get day() {
      return state.day;
    },
    get era() {
      return Math.max(...state.era);
    },
  };
}
