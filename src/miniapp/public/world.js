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

export const W = 84;
export const H = 66;
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
    dat: "людям-котам",
    instr: "людьми-котами",
    fur: "#d9a066",
    dark: "#a86a3b",
    hat: "#b23a26",
    roof: "#b23a26",
    wall: "#e9d3a6",
    banner: "#b23a26",
    zone: "#ff4d4d",
    likes: (t) => (t === T.GRASS ? 3 : t === T.SAND ? 1 : 0),
    canStand: (t) => walkable(t),
    canBuild: (t) => t === T.GRASS || t === T.SAND || t === T.FOREST,
  },
  {
    id: "elf",
    name: "Эльфы-коты",
    plural: "эльфов-котов",
    dat: "эльфам-котам",
    instr: "эльфами-котами",
    fur: "#efe9d6",
    dark: "#9aa77a",
    hat: "#5f8f45",
    roof: "#3d6a2c",
    wall: "#8a6a44",
    banner: "#5f8f45",
    zone: "#4dff88",
    likes: (t) => (t === T.FOREST ? 3 : t === T.GRASS ? 1 : 0),
    canStand: (t) => walkable(t),
    canBuild: (t) => t === T.FOREST || t === T.GRASS,
  },
  {
    id: "orc",
    name: "Орки-коты",
    plural: "орков-котов",
    dat: "оркам-котам",
    instr: "орками-котами",
    fur: "#6f8f4a",
    dark: "#40592a",
    hat: "#3b2f2a",
    roof: "#3b2f2a",
    wall: "#7a5a3a",
    banner: "#7a2a1e",
    zone: "#ffa62b",
    likes: (t) => (t === T.HILL ? 3 : t === T.SAND ? 2 : t === T.GRASS ? 1 : 0),
    canStand: (t) => walkable(t),
    canBuild: (t) => t === T.HILL || t === T.SAND || t === T.GRASS,
  },
  {
    id: "gnome",
    name: "Гномы-коты",
    plural: "гномов-котов",
    dat: "гномам-котам",
    instr: "гномами-котами",
    fur: "#b7b3ad",
    dark: "#6f6a63",
    hat: "#c9402b",
    roof: "#6d6a66",
    wall: "#9a9590",
    banner: "#e0a93b",
    zone: "#ffe14d",
    likes: (t) => (t === T.MOUNTAIN ? 3 : t === T.HILL ? 2 : 0),
    canStand: (t) => walkable(t) || t === T.MOUNTAIN,
    canBuild: (t) => t === T.MOUNTAIN || t === T.HILL,
  },
  {
    id: "robot",
    name: "Коты-роботы",
    plural: "котов-роботов",
    dat: "котам-роботам",
    instr: "котами-роботами",
    fur: "#8a97a8",
    dark: "#5a6472",
    hat: "#7fd4ff",
    roof: "#7fd4ff",
    wall: "#c9d3df",
    banner: "#7fd4ff",
    zone: "#7fd4ff",
    minEra: 2,
    likes: (t) => (t === T.MOUNTAIN ? 3 : t === T.HILL ? 2 : t === T.SAND ? 1 : 0),
    canStand: (t) => walkable(t) || t === T.MOUNTAIN,
    canBuild: (t) => t >= T.SAND && t <= T.MOUNTAIN,
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

/**
 * Пять карт. Все из одного сида, но с разной формой суши: у каждой карты
 * свой мир и своё сохранение — можно держать пять островов разом.
 */
export const MAPS = [
  { id: "island", name: "Остров", desc: "Один большой остров, горы в сердце" },
  { id: "archipelago", name: "Архипелаг", desc: "Россыпь островков, много моря и кораблей" },
  { id: "continent", name: "Континент", desc: "Почти сплошная суша, есть где развернуться" },
  { id: "highlands", name: "Нагорье", desc: "Горы и снег, царство гномов" },
  { id: "lakes", name: "Озёрный край", desc: "Земля в озёрах, лес и луга" },
];

export function buildTerrain(seed, mapId = "island") {
  const n1 = valueNoise(seed + 1, 5);
  const n2 = valueNoise(seed + 2, 11);
  const n3 = valueNoise(seed + 3, 23);
  const nForest = valueNoise(seed + 4, 8);
  const nLake = valueNoise(seed + 5, 6);
  const rnd = rng(seed + 77);
  // Архипелаг: несколько центров, от ближайшего — спад высоты.
  const centers = [];
  for (let i = 0; i < 4; i += 1) centers.push({ x: 0.2 + rnd() * 0.6, y: 0.2 + rnd() * 0.6, r: 0.16 + rnd() * 0.12 });
  const tiles = new Uint8Array(W * H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const u = x / W;
      const v = y / H;
      let h = n1(u, v) * 0.6 + n2(u, v) * 0.28 + n3(u, v) * 0.12;
      const dx = (u - 0.5) * 2;
      const dy = (v - 0.5) * 2;
      const dist = Math.sqrt(dx * dx + dy * dy);
      let sea = 0.24;
      let shallow = 0.33;
      let sand = 0.37;
      let hill = 0.58;
      let mount = 0.68;
      let snow = 0.78;
      switch (mapId) {
        case "archipelago": {
          let best = Infinity;
          for (const c of centers) best = Math.min(best, Math.hypot(u - c.x, (v - c.y) * 1.1) / c.r);
          h -= Math.max(0, best - 0.45) * 1.1;
          sea = 0.28;
          shallow = 0.36;
          sand = 0.4;
          hill = 0.62;
          mount = 0.74;
          snow = 0.86;
          break;
        }
        case "continent":
          h -= Math.max(0, dist - 0.9) * 1.6;
          sea = 0.16;
          shallow = 0.22;
          sand = 0.25;
          hill = 0.56;
          mount = 0.7;
          snow = 0.82;
          break;
        case "highlands":
          h = h * 1.25 + 0.05 - Math.max(0, dist - 0.65) * 1.4;
          hill = 0.52;
          mount = 0.62;
          snow = 0.74;
          break;
        case "lakes":
          h -= Math.max(0, dist - 0.85) * 1.6;
          sea = 0.16;
          shallow = 0.22;
          sand = 0.25;
          if (nLake(u, v) > 0.66) h = Math.min(h, 0.3);
          hill = 0.62;
          mount = 0.74;
          snow = 0.88;
          break;
        default:
          h -= Math.max(0, dist - 0.6) * 1.4;
      }
      let t;
      if (h < sea) t = T.DEEP;
      else if (h < shallow) t = T.WATER;
      else if (h < sand) t = T.SAND;
      else if (h < hill) t = nForest(u, v) > (mapId === "lakes" ? 0.5 : 0.56) ? T.FOREST : T.GRASS;
      else if (h < mount) t = T.HILL;
      else if (h < snow) t = T.MOUNTAIN;
      else t = T.SNOW;
      tiles[y * W + x] = t;
    }
  }
  return tiles;
}

/** Миниатюра карты для выбора в настройках: клетка — два пикселя. */
export function renderPreview(canvas, seed, mapId) {
  const tiles = buildTerrain(seed, mapId);
  canvas.width = W * 2;
  canvas.height = H * 2;
  const g = canvas.getContext("2d");
  for (let i = 0; i < W * H; i += 1) {
    g.fillStyle = TILE_COLOR[tiles[i]][0];
    g.fillRect((i % W) * 2, ((i / W) | 0) * 2, 2, 2);
  }
}

/* ── Мир ────────────────────────────────────────────────────────────────── */

const DAY_TICKS = 30 * 180; // сутки — три минуты
const SAVE_VERSION = 8; // 8: карта 84×66, воронки, распад народов

/* ── Экономика ──────────────────────────────────────────────────────────
   Ничего не строится из воздуха. Кот рубит дерево минуту и приносит пять
   брёвен; хижина стоит десять. Улучшение дома — десять брёвен и десять
   камней, камень добывают в горах. Верфь — двадцать брёвен, и только с ней
   деревня выходит в море. Лес отрастает, но медленно. */
const COST = {
  house: { wood: 10, stone: 0 },
  upgrade: { wood: 10, stone: 10 },
  shipyard: { wood: 20, stone: 0 },
};
const CHOP_TICKS = 1800; // минута на дерево
// Воронка от взрыва выпадает из территории и зарастает: метеорит — полторы
// минуты, молния — полминуты. Иначе бомбить чужую землю бессмысленно.
const CRATER_METEOR_TICKS = 2700;
const CRATER_BOLT_TICKS = 900;
const CRATER_NUKE_TICKS = 5400; // три минуты — пустошь надолго
const NUKE_R = 7;
// Времена года сменяются с игровым днём: четыре дня — год.
const SEASONS = [
  { id: "spring", name: "Весна" },
  { id: "summer", name: "Лето" },
  { id: "autumn", name: "Осень" },
  { id: "winter", name: "Зима" },
];
const WEATHER = {
  clear: { name: "Ясно" },
  rain: { name: "Дождь" },
  storm: { name: "Гроза" },
  drought: { name: "Засуха" },
  snow: { name: "Снегопад" },
};
const VOLCANO_ERUPT_TICKS = 240; // сколько течёт лава
const LAVA_TTL = 420; // сколько клетка лавы горит, прежде чем застыть камнем
const LAVA_FLOW = 7; // запас хода: дальше семи клеток от жерла лава не уходит
const FOOD_PER_FISH = 6;
const FOOD_PER_HARVEST = 5;
const WALL_COST = 20;
const ORE_CHANCE = 0.3;
const GOLD_CHANCE = 0.12;
const JOB_NAMES = { fisher: "рыбаком", farmer: "фермером", smith: "кузнецом", healer: "лекарем", priest: "жрецом" };
const MINE_TICKS = 1800;
const LOGS_PER_TREE = 5;
const STONE_PER_DIG = 5;

/* ── Имена ───────────────────────────────────────────────────────────────
   У каждого кота своё имя, у каждой деревни — название от основателя, как
   у королевств в WorldBox. Слоги у народов разные: люди звучат по-домашнему,
   эльфы певуче, орки рыкают, гномы стучат. */
const SYLLABLES = {
  human: ["мур", "бар", "вас", "тим", "мяу", "пуш", "сём", "фил", "ры", "жик", "кот", "мо", "ло", "ти", "ня", "сик"],
  elf: ["эль", "ли", "ара", "ниэ", "тал", "сэ", "ло", "ри", "вэ", "ан", "иль", "фэ", "ми", "лэн", "ая", "ор"],
  orc: ["гр", "рох", "ург", "заг", "мор", "кх", "дар", "гор", "рык", "шаг", "ог", "рум", "бар", "тук", "ур", "дрг"],
  gnome: ["дур", "бол", "кам", "тор", "гим", "фар", "нор", "бром", "дин", "гро", "ин", "ок", "лун", "торн", "ир", "бек"],
  robot: ["зет", "икс", "бип", "рок", "мех", "кло", "вольт", "нео", "бит", "трон", "ом", "цикл", "ал", "гир", "дрон", "юнит"],
};
const SUFFIX = {
  robot: ["-7", "-9", "порт", "блок", "ядро", "сектор"],
  human: ["град", "овка", "поль", "ово", "ск", "ино"],
  elf: ["лесье", "дол", "ирэль", "лориэн", "тэль", "иэн"],
  orc: ["рог", "грох", "-камень", "дуум", "рык", "мор"],
  gnome: ["горн", "шахт", "дум", "форт", "камень", "хол"],
};
function catName(raceId, rnd = Math.random) {
  const syl = SYLLABLES[raceId];
  const n = 2 + (rnd() < 0.3 ? 1 : 0);
  let name = "";
  for (let i = 0; i < n; i += 1) name += syl[Math.floor(rnd() * syl.length)];
  return name.charAt(0).toUpperCase() + name.slice(1);
}
function villageName(raceId, founder, rnd = Math.random) {
  const suf = SUFFIX[raceId];
  const root = founder.replace(/[аяуюоеиыэё]+$/i, "");
  const tail = suf[Math.floor(rnd() * suf.length)];
  return tail.startsWith("-") ? `${founder}${tail}` : `${root}${tail}`;
}
const DAY_MS = 180_000; // игровые сутки в настоящих миллисекундах

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

export function createWorld({ seed, stats, canvas, onEvent, onRaces, onHud, onVillages, map = "island" }) {
  const rand = rng(seed * 7 + 13);
  // У каждой карты своё сохранение: пять миров живут параллельно.
  const storeKey = `world:v${SAVE_VERSION}:${seed}:${map}`;

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
    pop: RACES.map(() => 0),
    era: RACES.map(() => 0), // эра каждого народа
    ships: [], // { x, y, vx, vy, race, wait } — по воде
    born: Date.now(), // когда остров появился: эры идут по настоящему времени
    particles: [], // { x, y, vx, vy, ttl, life, color } — сердечки, пыль, искры
    villages: [], // { race, x, y } — у народа их несколько, столица — первая
    relations: RACES.map(() => RACES.map(() => "peace")),
    wars: [], // { a, b, ttl, kills: [0, 0] }
    allies: [], // { a, b, ttl } — союзы: вступают в войну друг за друга
    projectiles: [], // стрелы и лучи: { x, y, tx, ty, color, kind, race }
    savedAt: Date.now(),
    terr: null, // Uint8Array: чья территория у клетки, 255 — ничья
    craters: [], // { x, y, r, ttl } — воронки от взрывов: земля там ничья, пока не заживёт
    nukes: [], // { x, y, t } — атомные бомбы: падение, вспышка, гриб
    needBake: false, // перепечь весь ландшафт перед кадром (после распада народа)
    animals: [], // { kind, x, y, px, py, tx, ty, wait, face, hp }
    volcanoes: [], // { x, y, erupt } — постоянные, erupt > 0 пока извергается
    lava: new Map(), // idx → { ttl, flow }: течёт, пока есть запас хода, потом застывает камнем
    weather: { kind: "clear", ttl: 1500 },
    seasonId: null, // чтобы поймать смену сезона
    kings: RACES.map(() => null), // { name, since } — правитель народа
    faith: RACES.map(() => 50), // вера народа в бога (тебя), 0..100
    graves: [], // { x, y, name, race } — надгробия героев
    farms: new Set(), // idx — поля: жёлтые грядки, дают еду
    roads: new Set(), // idx — дороги (и мосты через реки)
    roadLinks: [], // { a, b, path: [idx] } — дорога между двумя деревнями
    caravans: [], // { path, i, race, to } — кот с тележкой едет по дороге
    walls: new Map(), // idx → { race, hp }
    towers: [], // { x, y, race, cd }
    pirates: [], // { x, y, vx, vy, wait, face, hp }
    quake: { ttl: 0 }, // тряска экрана
    tsunami: null, // { x, y, dx, dy, t, len }
    blessed: RACES.map(() => 0), // ttl благословения народа
    cursed: RACES.map(() => 0), // ttl проклятия
    ufo: null, // { x, y, tx, ty, t, phase }
    islandAch: [], // id достижений острова
    flags: {}, // разовые события: nuked, plagueSurvived, eruption, piratesBeaten…
    discovered: [], // id открытых карт
    lastVisit: Date.now(),
    centers: RACES.map(() => null), // центр территории народа, для подписи
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

  function newCat(x, y, r, v = 0) {
    // px/py — где кот нарисован; x/y — клетка, куда идёт. Между ними кот
    // плавно доезжает, и движение видно, а не мигает по клеткам. task —
    // дело, ради которого он остановится (стройка); без дела кот бродит.
    const c = { x, y, px: x, py: y, race: r, v, name: catName(RACES[r].id), tx: x, ty: y, wait: Math.floor(Math.random() * 8), step: Math.random(), face: 1, gait: 0, task: null, warrior: false, hp: 3, cd: 0, job: null, hero: false, king: false };
    // Герой — один на полсотни: живучий и бьёт втрое, имя попадёт в летопись.
    if (Math.random() < 0.02 && state.cats.length >= 8) {
      c.hero = true;
      c.hp = 30;
      c.warrior = true;
      chronicle("hero", r, c.name);
    }
    return c;
  }

  /** Деревня кота; без деревни — он сам себе дом. */
  function villageOf(c) {
    return state.villages[c.v] || state.homes[c.race] || c;
  }

  function nearestVillage(r, x, y, maxDist = Infinity) {
    let best = -1;
    let bestD = maxDist;
    state.villages.forEach((v, i) => {
      if (v.race !== r) return;
      const d = Math.max(Math.abs(v.x - x), Math.abs(v.y - y));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  function foundVillage(r, x, y, founder = null) {
    const who = founder || catName(RACES[r].id);
    state.villages.push({ race: r, x, y, name: villageName(RACES[r].id, who), founder: who, wood: 0, stone: 0, food: 12, unrest: 0, shipyard: null, temple: null, ore: 0, gold: 0, weapons: 0 });
    if (!state.homes[r]) {
      state.homes[r] = state.villages[state.villages.length - 1];
      // Первый основатель народа — его первый король.
      if (!state.kings[r]) {
        state.kings[r] = { name: who, since: state.tick };
        chronicle("crown", r, who);
      }
    }
    return state.villages.length - 1;
  }

  /** Каждый четвёртый кот народа — воин: с луком, мечом или бластером по эре. */
  function assignWarrior(c) {
    const same = state.cats.filter((o) => o.race === c.race);
    const warriors = same.filter((o) => o.warrior).length;
    if (warriors < Math.floor(same.length / 4)) c.warrior = true;
  }

  function newShip(x, y, r) {
    const a = Math.random() * Math.PI * 2;
    return { x, y, vx: Math.cos(a) * 0.05, vy: Math.sin(a) * 0.05, race: r, wait: 0, face: 1 };
  }

  function spawnCat(r, vi, spread = 4) {
    const race = RACES[r];
    const near = state.villages[vi];
    if (!near) return false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const x = near.x + Math.round((rand() * 2 - 1) * spread);
      const y = near.y + Math.round((rand() * 2 - 1) * spread * 0.7);
      if (!inside(x, y) || !race.canStand(tileAt(x, y))) continue;
      const c = newCat(x, y, r, vi);
      state.cats.push(c);
      assignWarrior(c);
      return true;
    }
    return false;
  }

  function villagesOf(r) {
    const out = [];
    state.villages.forEach((v, i) => {
      if (v.race === r) out.push(i);
    });
    return out;
  }

  function generate() {
    state.tiles = buildTerrain(seed, map);
    for (let i = 0; i < W * H; i += 1) {
      const t = state.tiles[i];
      if (t === T.FOREST && rand() < 0.6) state.trees.add(i);
      else if (t === T.GRASS && rand() < 0.05) state.trees.add(i);
      else if (t === T.GRASS && rand() < 0.08) state.flowers.add(i);
      else if (t === T.HILL && rand() < 0.04) state.trees.add(i);
    }
    carveRivers();
    // Как в WorldBox: новый мир пуст. Народ появляется там, где бог
    // поставил первого кота, дома коты строят себе сами.
    state.homes = RACES.map(() => null);
  }

  /**
   * Реки: от гор к морю. Высоты у мира нет, есть тайлы, поэтому русло
   * спускается по типу земли (снег → гора → холм → трава → песок → вода),
   * чуть петляя. Две-три реки на остров, вдоль них потом селятся коты.
   */
  function carveRivers() {
    const peaks = [];
    for (let i = 0; i < W * H; i += 1) if (state.tiles[i] >= T.MOUNTAIN) peaks.push(i);
    if (!peaks.length) return;
    const count = 2 + Math.floor(rand() * 2);
    for (let n = 0; n < count; n += 1) {
      let i = peaks[Math.floor(rand() * peaks.length)];
      let x = i % W;
      let y = (i / W) | 0;
      const path = [];
      for (let step = 0; step < 90; step += 1) {
        const cur = state.tiles[idx(x, y)];
        if (cur <= T.WATER && step > 2) break;
        const opts = [];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (!inside(nx, ny)) continue;
          const t = state.tiles[idx(nx, ny)];
          if (t > cur) continue;
          if (path.includes(idx(nx, ny))) continue;
          // Ниже — лучше; равное — можно, с шумом, чтобы русло петляло.
          opts.push({ nx, ny, score: (cur - t) * 2 + rand() });
        }
        if (!opts.length) break;
        opts.sort((a, b) => b.score - a.score);
        const pick = opts[0];
        x = pick.nx;
        y = pick.ny;
        path.push(idx(x, y));
      }
      if (path.length < 6) continue;
      for (const p of path) {
        if (state.tiles[p] > T.WATER) state.tiles[p] = T.WATER;
        state.trees.delete(p);
        state.flowers.delete(p);
      }
    }
  }

  /* ── Сохранение ───────────────────────────────────────────────────────── */

  let saveTimer = 0;
  function persist(now = false) {
    clearTimeout(saveTimer);
    if (now) {
      writeSave();
      return;
    }
    saveTimer = setTimeout(writeSave, 400);
  }
  function writeSave() {
    {
      try {
        localStorage.setItem(
          storeKey,
          JSON.stringify({
            v: SAVE_VERSION,
            tiles: Array.from(state.tiles),
            trees: [...state.trees],
            flowers: [...state.flowers],
            houses: state.houses,
            homes: state.homes.map((h) => (h ? { race: h.race, x: h.x, y: h.y } : null)),
            villages: state.villages,
            relations: state.relations,
            wars: state.wars,
            allies: state.allies,
            cats: state.cats.map((c) => [c.x, c.y, c.race, c.v, c.warrior ? 1 : 0, c.hp, c.name, c.job || null, c.hero ? 1 : 0, c.king ? 1 : 0, c.sick ? 1 : 0]),
            savedAt: Date.now(),
            day: state.day,
            era: state.era,
            born: state.born,
            ships: state.ships.map((sh) => [sh.x, sh.y, sh.race]),
            chronicle: state.chronicle.slice(0, 12),
            volcanoes: state.volcanoes,
            kings: state.kings,
            faith: state.faith,
            graves: state.graves.slice(-40),
            farms: [...state.farms],
            roads: [...state.roads],
            roadLinks: state.roadLinks,
            walls: [...state.walls],
            towers: state.towers,
            lastVisit: Date.now(),
            blessed: state.blessed,
            cursed: state.cursed,
            islandAch: state.islandAch,
            flags: state.flags,
          }),
        );
      } catch {
        /* приватный режим — пусть */
      }
    }
  }

  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(storeKey) || "null");
      if (!saved || saved.v !== SAVE_VERSION || !Array.isArray(saved.tiles) || saved.tiles.length !== W * H) return false;
      state.tiles = Uint8Array.from(saved.tiles);
      state.trees = new Set(saved.trees || []);
      state.flowers = new Set(saved.flowers || []);
      state.houses = saved.houses || [];
      state.homes = Array.isArray(saved.homes) ? saved.homes.map((h) => h || null) : RACES.map(() => null);
      state.villages = Array.isArray(saved.villages) ? saved.villages : [];
      for (const v of state.villages) {
        v.wood = v.wood || 0;
        v.stone = v.stone || 0;
        v.shipyard = v.shipyard || null;
        v.food = v.food ?? 12;
        v.unrest = v.unrest || 0;
        v.temple = v.temple || null;
        v.ore = v.ore || 0;
        v.gold = v.gold || 0;
        v.weapons = v.weapons || 0;
      }
      state.roads = new Set(saved.roads || []);
      state.roadLinks = Array.isArray(saved.roadLinks) ? saved.roadLinks : [];
      state.walls = new Map((saved.walls || []).map(([i, c]) => [i, c]));
      state.towers = Array.isArray(saved.towers) ? saved.towers : [];
      state.kings = Array.isArray(saved.kings) && saved.kings.length === RACES.length ? saved.kings : RACES.map(() => null);
      state.faith = Array.isArray(saved.faith) && saved.faith.length === RACES.length ? saved.faith : RACES.map(() => 50);
      state.graves = Array.isArray(saved.graves) ? saved.graves : [];
      state.farms = new Set(saved.farms || []);
      state.lastVisit = saved.lastVisit || Date.now();
      state.islandAch = Array.isArray(saved.islandAch) ? saved.islandAch : [];
      state.flags = saved.flags && typeof saved.flags === "object" ? saved.flags : {};
      state.blessed = Array.isArray(saved.blessed) && saved.blessed.length === RACES.length ? saved.blessed : RACES.map(() => 0);
      state.cursed = Array.isArray(saved.cursed) && saved.cursed.length === RACES.length ? saved.cursed : RACES.map(() => 0);
      for (const h of state.houses) if (h.lvl === undefined) h.lvl = 0;
      state.relations = Array.isArray(saved.relations) && saved.relations.length === RACES.length ? saved.relations : RACES.map(() => RACES.map(() => "peace"));
      state.wars = Array.isArray(saved.wars) ? saved.wars : [];
      state.volcanoes = Array.isArray(saved.volcanoes) ? saved.volcanoes : [];
      state.allies = Array.isArray(saved.allies) ? saved.allies : [];
      state.cats = (saved.cats || []).map(([x, y, r, v = 0, w = 0, hp = 3, name = null, job = null, hero = 0, king = 0, sick = 0]) => {
        const c = newCat(x, y, r, v);
        c.warrior = Boolean(w);
        c.hp = hp;
        c.job = job || null;
        c.hero = Boolean(hero);
        c.king = Boolean(king);
        c.sick = Boolean(sick);
        if (name) c.name = name;
        return c;
      });
      for (const v of state.villages) {
        if (!v.name) {
          v.founder = v.founder || catName(RACES[v.race].id);
          v.name = villageName(RACES[v.race].id, v.founder);
        }
      }
      state.savedAt = saved.savedAt || Date.now();
      state.day = saved.day || 1;
      state.era = Array.isArray(saved.era) && saved.era.length === RACES.length ? saved.era : RACES.map(() => 0);
      state.born = saved.born || Date.now();
      state.ships = (saved.ships || []).map(([x, y, r]) => newShip(x, y, r));
      state.chronicle = saved.chronicle || [];
      if (state.homes.length !== 4) return false;
      // Столица — ссылка на первую деревню народа, чтобы двигалась вместе с ней.
      state.homes = state.homes.map((h, r) => {
        if (!h) return null;
        const vi = nearestVillage(r, h.x, h.y);
        return vi >= 0 ? state.villages[vi] : h;
      });
      // Догоняем не здесь: холсты ещё не созданы, а догон печёт карту.
      state.catchMs = Date.now() - state.savedAt;
      return true;
    } catch {
      return false;
    }
  }

  if (!restore()) {
    state.trees = new Set();
    state.flowers = new Set();
    state.houses = [];
    state.homes = RACES.map(() => null);
    state.villages = [];
    state.relations = RACES.map(() => RACES.map(() => "peace"));
    state.wars = [];
    state.cats = [];
    state.catchMs = 0;
    generate();
  }

  /**
   * Остров живёт и без нас. Пока мини-апп закрыт, никто не тикает, поэтому
   * при открытии догоняем: первые минуты честно, тик за тиком без
   * отрисовки, а дальше — крупными мазками: рождения, дома, дни. Иначе
   * после ночи всё стояло бы на месте, как выключенное.
   */
  function catchUp(elapsedMs) {
    if (!(elapsedMs > 5000) || state.villages.length === 0) return;
    const before = { cats: state.cats.length, houses: state.houses.length };
    const fast = Math.min(Math.floor(elapsedMs / 33), 5400);
    for (let i = 0; i < fast; i += 1) {
      state.tick += 1;
      moveCats();
      burn();
      build();
      breed();
      warTick();
      allyTick();
      colonize();
      advanceEras();
      stepParticles();
    }
    state.particles = [];
    state.projectiles = [];
    const restMs = elapsedMs - fast * 33;
    const slots = Math.floor(restMs / DAY_MS); // по игровому дню
    for (let d = 0; d < Math.min(slots, 400); d += 1) {
      for (let r = 0; r < RACES.length; r += 1) {
        const vs = villagesOf(r);
        if (!vs.length || state.pop[r] === 0) continue;
        const houses = state.houses.filter((h) => h.race === r).length;
        const pop = state.cats.filter((c) => c.race === r).length;
        // За день деревня добывает примерно столько, сколько котов, и строит
        // на накопленное.
        for (const vi of vs) {
          const v = state.villages[vi];
          v.wood += Math.max(1, Math.floor(state.cats.filter((c) => c.v === vi).length / 2));
          if (state.era[r] >= 1) v.stone += 2;
        }
        const vi = vs[Math.floor(rand() * vs.length)];
        const v = state.villages[vi];
        if (houses < Math.ceil(pop / 3) && houses < 40 && v.wood >= COST.house.wood) {
          const site = pickSite(r, v);
          if (site) {
            v.wood -= COST.house.wood;
            state.houses.push({ x: site.x, y: site.y, race: r, v: vi, hp: 2, lvl: 0 });
            state.trees.delete(idx(site.x, site.y));
          }
        } else if (pop < houses * 4 + 1 && state.cats.length < 260) {
          spawnCat(r, vs[Math.floor(rand() * vs.length)]);
        }
      }
    }
    state.day += Math.floor(elapsedMs / DAY_MS);
    countPop();
    const born = state.cats.length - before.cats;
    const built = state.houses.length - before.houses;
    if (born > 0 || built > 0) chronicle("away", born, built);
    bakeAll();
  }

  /* ── Летопись ─────────────────────────────────────────────────────────── */

  const lines = {
    born: (r, name, village) => (name ? `В ${village || "деревне"} у ${RACES[r].plural} родился котёнок ${name}.` : `У ${RACES[r].plural} родился котёнок.`),
    settle: (r, founder, village) => (founder ? `${founder} из ${RACES[r].plural} основал поселение ${village}.` : `${RACES[r].name} основали поселение.`),
    colony: (r, founder, village) => (founder ? `${founder} увёл ${RACES[r].plural} на новое место: деревня ${village}.` : `${RACES[r].name} основали новую деревню.`),
    away: (b, h) => `Пока тебя не было: родилось ${b} кот${plural(b)}, построено ${h} дом${plural(h)}.`,
    war: (a, b) => `⚔ ${RACES[a].name} объявили войну ${RACES[b].dat}!`,
    join: (c, a, b) => `⚔ ${RACES[c].name} вступают в войну против ${RACES[b].plural} на стороне ${RACES[a].plural}.`,
    ally: (a, b) => `🤝 ${RACES[a].name} и ${RACES[b].name.toLowerCase()} заключили союз.`,
    allyEnd: (a, b) => `Союз ${RACES[a].plural} и ${RACES[b].plural} распался.`,
    peace: (a, b, ka, kb) => `Мир между ${RACES[a].instr} и ${RACES[b].instr}. Потери: ${ka} и ${kb}.`,
    arson: (a, b) => `${RACES[a].name} подожгли дом ${RACES[b].plural}.`,
    fallen: (r, name, village) => `Пал воин ${name || ""} ${RACES[r].plural}${village ? ` из ${village}` : ""}.`.replace("  ", " "),
    built: (r) => `${RACES[r].name} построили себе дом.`,
    upgraded: (r, lvl) => `${RACES[r].name} ${lvl === 1 ? "надстроили второй этаж" : "возвели башню"}.`,
    shipyard: (r, village) => `В ${village} ${RACES[r].plural === "людей-котов" ? "люди-коты" : RACES[r].name.toLowerCase()} поставили верфь — можно в море.`,
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
    season: (s) => ({ spring: "Пришла весна: тает снег, на лугах цветы.", summer: "Лето: жара, поля зреют.", autumn: "Осень: лес рыжеет, коты запасаются.", winter: "Зима: снег лёг на остров, реки встали." })[s],
    weather: (k) => ({ rain: "Пошёл дождь — пожары гаснут.", storm: "Гроза! Молнии бьют сами.", drought: "Засуха: земля трескается, лес сохнет.", snow: "Снегопад укрыл остров.", clear: "Небо прояснилось." })[k],
    volcano: () => "Бог поднял вулкан.",
    crown: (r, name) => `${name} коронован: у ${RACES[r].plural} есть король.`,
    kingDied: (r, old, heir) => `Король ${old} ${RACES[r].plural} умер. Трон занял ${heir}.`,
    kingFell: (r, name) => `Король ${name} ${RACES[r].plural} пал в бою — смута!`,
    hero: (r, name) => `У ${RACES[r].plural} родился герой ${name}: в десять раз сильнее любого кота.`,
    heroFell: (r, name) => `Герой ${name} ${RACES[r].plural} погиб. На месте гибели — камень с именем.`,
    job: (r, name, job) => `${name} из ${RACES[r].plural} стал ${JOB_NAMES[job]}.`,
    hunger: (r, v) => `В ${v} голод: ${RACES[r].name} ропщут.`,
    revolt: (r, v, to) => `Бунт в ${v}: деревня отделилась от ${RACES[r].plural} и присягнула ${RACES[to].dat}.`,
    temple: (r, v) => `${RACES[r].name} возвели храм в ${v}.`,
    prayer: (r) => `Жрец ${RACES[r].plural} молится богу. Вера крепнет.`,
    faithLow: (r) => `Бог давно не заходил: культ ${RACES[r].plural} слабеет.`,
    healed: (r, name) => `Лекарь ${RACES[r].plural} выходил ${name}.`,
    road: (r, a, b) => `${RACES[r].name} проложили дорогу из ${a} в ${b}.`,
    caravan: (r, a, b) => `Караван из ${a} довёз еду и брёвна в ${b}.`,
    walls: (r, v) => `${RACES[r].name} обнесли ${v} стеной с башнями.`,
    wallDown: (r) => `Стена ${RACES[r].plural} проломлена!`,
    seaTrade: (a, b) => `Корабли ${RACES[a].plural} торгуют с ${RACES[b].instr} по морю.`,
    pirate: () => "На горизонте чёрный парус: пираты-коты!",
    pirateSink: (r) => `Пираты потопили корабль ${RACES[r].plural}.`,
    pirateRaid: (r, v) => `Пираты разграбили ${v} у ${RACES[r].plural}.`,
    pirateDead: (r) => `Воины ${RACES[r].plural} отбили пиратов — те пошли ко дну.`,
    ore: (r) => `Шахтёры ${RACES[r].plural} нашли железную руду.`,
    plague: (r) => (r == null ? "На остров пришла чума." : `Чума у ${RACES[r].plural}: больные кашляют, лекари сбиваются с лап.`),
    plagueEnd: () => "Чума отступила.",
    quake: () => "Землетрясение! Дома трещат, горы растут.",
    tsunami: () => "Цунами! Волна идёт на берег.",
    bless: (r) => `Бог благословил ${RACES[r].plural}: котята, сила и покой.`,
    curse: (r) => `Бог проклял ${RACES[r].plural}: пожары, бесплодие и ропот.`,
    blessEnd: (r) => `Благословение ${RACES[r].plural} иссякло.`,
    curseEnd: (r) => `Проклятие ${RACES[r].plural} снято.`,
    ufo: () => "В небе тарелка: гости из будущего.",
    robots: (v) => `Из будущего прибыли коты-роботы: их база — ${v}.`,
    robotsLocked: () => "Коты-роботы появятся только в эре Будущего.",
    achievement: (t) => `Достижение острова: «${t}».`,
    discover: (name) => `Корабли открыли новую землю: «${name}». Теперь туда можно переселиться.`,
    ufoTaken: (r, n) => `Тарелка забрала ${n} ${RACES[r].plural} и улетела.`,
    gold: (r, v) => `В горах у ${v} нашли золото! Казна ${RACES[r].plural} полнеет.`,
    weapons: (r) => `Кузнец ${RACES[r].plural} выковал оружие: воины бьют сильнее.`,
    eruption: (r) => (r == null ? "Вулкан проснулся: лава течёт по склонам." : `Вулкан извергается рядом с землёй ${RACES[r].plural}!`),
    wolf: (r, name) => `Волки напали на ${name} из ${RACES[r].plural}.`,
    dragon: (r) => (r == null ? "Над горами кружит дракон." : `Дракон сжёг дом ${RACES[r].plural}.`),
    mouse: (r, name) => `${name} из ${RACES[r].plural} поймал мышь.`,
    nuke: (r) => (r == null ? "Атомный взрыв выжег пустошь." : `Атомный гриб встал над землёй ${RACES[r].plural}.`),
    collapse: (r) => `Город ${RACES[r].plural} пал: имя забыто, склады пусты. Всё заново.`,
    meteor: (r) => (r == null ? "С неба упал метеорит." : `Метеорит упал рядом с деревней ${RACES[r].plural}.`),
    drown: (n) => `${n} кот${plural(n)} уплыл${n === 1 ? "" : "и"} на плотах: их землю затопило.`,
    trade: (a, b) => `${RACES[a].name} торгуют с ${RACES[b].instr}.`,
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
  function season() {
    return SEASONS[(((state.day - 1) % 4) + 4) % 4];
  }
  const isWinter = () => season().id === "winter";
  const isSpring = () => season().id === "spring";
  const raining = () => state.weather.kind === "rain" || state.weather.kind === "storm";

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
    const perRace = RACES.map(() => 0);
    for (const h of state.houses) perRace[h.race] += 1;
    for (const h of state.houses) seeds.push({ x: h.x, y: h.y, r: h.race });
    for (const v of state.villages) seeds.push({ x: v.x, y: v.y, r: v.race });
    for (const sd of seeds) {
      // Территория растёт вместе с народом: чем больше домов, тем дальше
      // тянется земля от каждого из них.
      const R = 3 + Math.min(4, Math.floor(perRace[sd.r] / 4));
      for (let dy = -R; dy <= R; dy += 1) {
        for (let dx = -R; dx <= R; dx += 1) {
          const x = sd.x + dx;
          const y = sd.y + dy;
          if (!inside(x, y)) continue;
          const t = state.tiles[idx(x, y)];
          if (t <= T.WATER) continue;
          const d = dx * dx + dy * dy;
          if (d > R * R + 2) continue;
          // Чужой дом рядом — там уже чужое: не переписываем, а даём тому, чей дом ближе.
          const i = idx(x, y);
          if (d < dist[i]) {
            dist[i] = d;
            terr[i] = sd.r;
          }
        }
      }
    }
    // Воронки: пока не заросли, эта земля ничья — у народа в территории дыра.
    for (const cr of state.craters) {
      for (let dy = -cr.r; dy <= cr.r; dy += 1) {
        for (let dx = -cr.r; dx <= cr.r; dx += 1) {
          if (dx * dx + dy * dy > cr.r * cr.r + 1) continue;
          const x = cr.x + dx;
          const y = cr.y + dy;
          if (inside(x, y)) terr[idx(x, y)] = 255;
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

  /**
   * Народ без жителей или без единой клетки земли распадается: деревни и их
   * названия исчезают, склады брёвен и камня — вместе с ними, дома сносятся.
   * Выжившие коты (когда землю выжгли воронки) основывают новую деревню с
   * новым именем и пустым складом — ресурсы собирают заново.
   */
  function collapseRace(r) {
    if (!state.villages.some((v) => v.race === r)) return false;
    const remap = new Map();
    const kept = [];
    state.villages.forEach((v, i) => {
      if (v.race === r) return;
      remap.set(i, kept.length);
      kept.push(v);
    });
    state.villages = kept;
    state.roadLinks = state.roadLinks.map((l) => ({ ...l, a: remap.get(l.a), b: remap.get(l.b) })).filter((l) => l.a !== undefined && l.b !== undefined);
    state.homes[r] = null;
    state.kings[r] = null;
    state.faith[r] = 50;
    state.houses = state.houses.filter((h) => h.race !== r);
    for (const h of state.houses) h.v = remap.get(h.v) ?? 0;
    state.ships = state.ships.filter((sh) => sh.race !== r);
    for (const [i, wl] of [...state.walls]) if (wl.race === r) state.walls.delete(i);
    state.towers = state.towers.filter((t) => t.race !== r);
    state.roadLinks = state.roadLinks.filter((l) => state.villages[l.a]?.race !== r && state.villages[l.b]?.race !== r);
    state.caravans = state.caravans.filter((cv) => cv.race !== r);
    for (const c of state.cats) {
      if (c.race === r) {
        c.task = null;
        c.v = -1;
        continue;
      }
      c.v = remap.get(c.v) ?? 0;
      if (c.task && c.task.v !== undefined) c.task.v = remap.get(c.task.v) ?? 0;
    }
    const survivors = state.cats.filter((c) => c.race === r);
    if (survivors.length) {
      const first = survivors[0];
      const nv = foundVillage(r, first.x, first.y, first.name);
      for (const c of survivors) c.v = nv;
    }
    chronicle("collapse", r);
    state.needBake = true;
    return true;
  }

  function countPop() {
    const pop = RACES.map(() => 0);
    const houses = RACES.map(() => 0);
    for (const c of state.cats) pop[c.race] += 1;
    for (const h of state.houses) houses[h.race] += 1;
    state.pop = pop;
    computeTerritory();
    let collapsed = false;
    for (let r = 0; r < RACES.length; r += 1) {
      if (pop[r] === 0 || !state.centers[r]) collapsed = collapseRace(r) || collapsed;
    }
    if (collapsed) {
      for (const h of state.houses) houses[h.race] = 0;
      for (const h of state.houses) houses[h.race] += 1;
      computeTerritory();
    }
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
    onVillages?.({
      wars: state.wars.map((w) => ({ a: w.a, b: w.b })),
      allies: state.allies.map((al) => ({ a: al.a, b: al.b })),
      atWar: RACES.map((_, r) => RACES.some((__, o) => atWar(r, o))),
      capitals: state.homes.map((h) => (h ? { x: h.x, y: h.y } : null)),
      villages: state.villages.map((v, i) => ({
        name: v.name,
        founder: v.founder,
        race: v.race,
        zone: RACES[v.race].zone,
        x: v.x,
        y: v.y,
        pop: state.cats.filter((c) => c.v === i).length,
        houses: state.houses.filter((h) => h.v === i).length,
        wood: v.wood || 0,
        stone: v.stone || 0,
        food: v.food || 0,
        unrest: v.unrest || 0,
        temple: Boolean(v.temple),
        ore: v.ore || 0,
        gold: v.gold || 0,
        weapons: v.weapons || 0,
        walls: state.towers.some((t) => t.race === v.race && state.homes[v.race] === v),
        king: state.homes[v.race] === v ? state.kings[v.race]?.name ?? null : null,
        faith: state.faith[v.race],
        shipyard: Boolean(v.shipyard),
      })),
    });
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
      ach: state.islandAch.map((id) => ISLAND_ACH.find((a) => a.id === id)?.title).filter(Boolean),
      achTotal: ISLAND_ACH.length,
      discovered: state.discovered,
      score: state.cats.length * 3 + state.houses.length * 2 + state.day * 10 + Math.max(...state.era) * 50 + state.villages.length * 5 + state.islandAch.length * 20,
      kings: state.kings.map((k, r) => (k ? { race: RACES[r].name, name: k.name } : null)).filter(Boolean),
      season: season().name,
      weather: WEATHER[state.weather.kind]?.name ?? "",
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
        const home = villageOf(c);
        // Мирный кот бежит от вражеского воина, если тот рядом.
        if (!c.warrior && state.wars.length) {
          const foe = nearestEnemy(c, 3, true);
          if (foe) {
            c.tx = c.x + Math.sign(c.x - foe.x || 1) * 3;
            c.ty = c.y + Math.sign(c.y - foe.y || 1) * 2;
            if (inside(c.tx, c.ty) && race.canStand(tileAt(c.tx, c.ty))) continue;
          }
        }
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
        // Зимой — наоборот, отсиживаются: снег, холодно.
        c.wait = Math.floor(Math.random() * (isWinter() ? 24 : 6));
        continue;
      }
      // Чужая стена — стоп: воин будет её ломать (towersTick), мирный обойдёт.
      {
        const nx0 = c.x + Math.sign(c.tx - c.x);
        const ny0 = c.y + Math.sign(c.ty - c.y);
        const wl = state.walls.get(idx(nx0, ny0));
        if (wl && wl.race !== c.race) {
          c.tx = c.x;
          c.ty = c.y;
          c.wait = 10;
          continue;
        }
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
    const village = state.villages[t.v ?? c.v];
    if (t.kind === "chop") {
      const i = idx(t.x, t.y);
      if (state.trees.has(i)) {
        state.trees.delete(i);
        puff(t.x, t.y, "#3d6a2c", 6, "dust");
        puff(t.x, t.y, "#8a5a2b", 3, "dust");
        if (village) village.wood += LOGS_PER_TREE;
        bakeArea(t.x - 1, t.y - 2, t.x + 1, t.y + 1);
      }
      return;
    }
    if (t.kind === "mine") {
      puff(t.x, t.y, "#c9d3df", 5, "spark");
      if (village) {
        village.stone += STONE_PER_DIG;
        if (Math.random() < ORE_CHANCE) {
          village.ore += 1;
          if (village.ore === 1) chronicle("ore", c.race);
        }
        if (tileAt(t.x, t.y) === T.SNOW && Math.random() < GOLD_CHANCE) {
          village.gold += 1;
          puff(t.x, t.y, "#ffd23a", 6, "spark");
          chronicle("gold", c.race, village.name);
        }
      }
      return;
    }
    if (t.kind === "fish") {
      if (village) village.food = (village.food || 0) + FOOD_PER_FISH;
      puff(t.x, t.y, "#5b9fcc", 4, "dust");
      return;
    }
    if (t.kind === "farm") {
      if (village) village.food = (village.food || 0) + FOOD_PER_HARVEST + (season().id === "summer" ? 3 : 0) - (isWinter() ? 4 : 0);
      state.farms.add(idx(t.x, t.y));
      puff(t.x, t.y, "#e0c05a", 4, "dust");
      bakeArea(t.x, t.y, t.x, t.y);
      return;
    }
    if (t.kind === "smith") {
      if (village) {
        if (village.ore > 0) {
          village.ore -= 1;
          village.weapons += 1;
          if (village.weapons === 1) chronicle("weapons", c.race);
        } else village.stone = Math.max(0, village.stone - 1);
      }
      puff(t.x, t.y, "#ffd23a", 3, "spark");
      return;
    }
    if (t.kind === "heal") {
      const who = t.who;
      if (who && state.cats.includes(who)) {
        who.hp = who.hero ? 30 : 3;
        who.sick = false;
        puff(who.x, who.y, "#7dff9a", 4, "heart");
        if (Math.random() < 0.4) chronicle("healed", c.race, who.name);
      }
      return;
    }
    if (t.kind === "pray") {
      state.faith[c.race] = Math.min(100, state.faith[c.race] + 4);
      puff(t.x, t.y, "#fff3a3", 5, "spark");
      if (Math.random() < 0.25) chronicle("prayer", c.race);
      return;
    }
    if (t.kind === "temple") {
      if (village && !village.temple) {
        village.temple = { x: t.x, y: t.y };
        state.trees.delete(idx(t.x, t.y));
        puff(t.x, t.y, "#f5f7f9", 8, "spark");
        chronicle("temple", c.race, village.name);
        bakeArea(t.x - 1, t.y - 3, t.x + 1, t.y + 1);
        countPop();
        persist();
      }
      return;
    }
    if (t.kind === "upgrade") {
      const h = state.houses.find((o) => o.x === t.x && o.y === t.y);
      if (h && h.lvl < 2) {
        h.lvl += 1;
        puff(t.x, t.y, "#e0a93b", 6, "spark");
        chronicle("upgraded", c.race, h.lvl);
        bakeArea(t.x - 1, t.y - 3, t.x + 1, t.y + 1);
        countPop();
        persist();
      }
      return;
    }
    if (t.kind === "shipyard") {
      if (village && !village.shipyard) {
        village.shipyard = { x: t.x, y: t.y };
        puff(t.x, t.y, "#8a5a2b", 8, "dust");
        chronicle("shipyard", c.race, village.name);
        bakeArea(t.x - 1, t.y - 2, t.x + 1, t.y + 1);
        countPop();
        persist();
      }
      return;
    }
    if (t.kind !== "build") return;
    if (!RACES[c.race].canBuild(tileAt(t.x, t.y)) || state.houses.some((h) => h.x === t.x && h.y === t.y)) {
      if (village) village.wood += COST.house.wood; // брёвна не пропали
      return;
    }
    state.houses.push({ x: t.x, y: t.y, race: c.race, v: t.v ?? c.v, hp: 2, lvl: 0 });
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

  /** Свободный кот деревни, ближайший к точке. */
  function idleCatNear(vi, x, y) {
    let worker = null;
    let best = Infinity;
    for (const c of state.cats) {
      if (c.v !== vi || c.task || c.warrior) continue;
      const d = Math.abs(c.x - x) + Math.abs(c.y - y);
      if (d < best) {
        best = d;
        worker = c;
      }
    }
    return worker;
  }

  function assign(c, task) {
    c.task = task;
    c.tx = task.x;
    c.ty = task.y;
    c.wait = 0;
  }

  /** Ближайшее дерево к деревне, ещё не занятое дровосеком. */
  function nearestTree(village, radius = 10) {
    let best = null;
    let bestD = Infinity;
    const busy = new Set(state.cats.filter((c) => c.task?.kind === "chop").map((c) => idx(c.task.x, c.task.y)));
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const x = village.x + dx;
        const y = village.y + dy;
        if (!inside(x, y)) continue;
        const i = idx(x, y);
        if (!state.trees.has(i) || busy.has(i)) continue;
        if (state.terr && state.terr[i] !== 255 && state.terr[i] !== village.race) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    }
    return best;
  }

  /** Ближайшая скала, где можно стоять рядом и долбить камень. */
  function nearestRock(village, radius = 10) {
    let best = null;
    let bestD = Infinity;
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const x = village.x + dx;
        const y = village.y + dy;
        if (!inside(x, y)) continue;
        const t = tileAt(x, y);
        if (t !== T.MOUNTAIN && t !== T.HILL) continue;
        const race = RACES[village.race];
        // Стоять надо на самой клетке (гномы) или на соседней проходимой.
        const spot = race.canStand(t) ? { x, y } : nearestStand(x, y, race, 1);
        if (!spot) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = spot;
        }
      }
    }
    return best;
  }

  /** Берег рядом с деревней: суша, у которой есть вода. */
  function nearestShore(village, radius = 8) {
    let best = null;
    let bestD = Infinity;
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const x = village.x + dx;
        const y = village.y + dy;
        if (!inside(x, y)) continue;
        const t = tileAt(x, y);
        if (t !== T.SAND && t !== T.GRASS) continue;
        if (state.houses.some((h) => h.x === x && h.y === y)) continue;
        const water = tileAt(x + 1, y) <= T.WATER || tileAt(x - 1, y) <= T.WATER || tileAt(x, y + 1) <= T.WATER || tileAt(x, y - 1) <= T.WATER;
        if (!water) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    }
    return best;
  }

  /**
   * Хозяйство деревни. Раз в несколько секунд одна деревня решает, кого
   * куда послать: сперва добыча, если склад пуст, потом стройка за брёвна,
   * верфь за двадцать, улучшения за брёвна и камень. Рабочие руки — мирные
   * коты без дела; воины не рубят.
   */
  function build() {
    if (state.tick % 90 !== 45 || !state.villages.length) return;
    const vi = Math.floor(Math.random() * state.villages.length);
    const village = state.villages[vi];
    const r = village.race;
    const race = RACES[r];
    const mine = state.cats.filter((c) => c.v === vi);
    if (!mine.length) return;
    const houses = state.houses.filter((h) => h.v === vi);
    const needHouses = houses.length < Math.ceil(mine.length / 3) && state.houses.filter((h) => h.race === r).length < 48;
    const era = state.era[r] || 0;
    const needUpgrade = houses.find((h) => (h.lvl || 0) < era);
    const wantShipyard = !village.shipyard && houses.length >= 2;

    // 1. Стройка за брёвна.
    if (needHouses && village.wood >= COST.house.wood && !mine.some((c) => c.task?.kind === "build")) {
      const site = pickSite(r, village);
      const worker = site && idleCatNear(vi, site.x, site.y);
      if (worker) {
        village.wood -= COST.house.wood;
        assign(worker, { kind: "build", x: site.x, y: site.y, ttl: 150, v: vi });
        return;
      }
    }
    // 1б. Храм: с эры Средневековья, за камень, один на деревню.
    if (!village.temple && era >= 1 && houses.length >= 4 && village.stone >= 15 && !mine.some((c) => c.task?.kind === "temple")) {
      const site = pickSite(r, village);
      const worker = site && idleCatNear(vi, site.x, site.y);
      if (worker) {
        village.stone -= 15;
        assign(worker, { kind: "temple", x: site.x, y: site.y, ttl: 260, v: vi });
        return;
      }
    }
    // 2. Верфь.
    if (wantShipyard && village.wood >= COST.shipyard.wood && !mine.some((c) => c.task?.kind === "shipyard")) {
      const shore = nearestShore(village);
      const worker = shore && idleCatNear(vi, shore.x, shore.y);
      if (worker) {
        village.wood -= COST.shipyard.wood;
        assign(worker, { kind: "shipyard", x: shore.x, y: shore.y, ttl: 200, v: vi });
        return;
      }
    }
    // 3. Улучшение дома под эру.
    if (needUpgrade && village.wood >= COST.upgrade.wood && village.stone >= COST.upgrade.stone && !mine.some((c) => c.task?.kind === "upgrade")) {
      const worker = idleCatNear(vi, needUpgrade.x, needUpgrade.y);
      if (worker) {
        village.wood -= COST.upgrade.wood;
        village.stone -= COST.upgrade.stone;
        assign(worker, { kind: "upgrade", x: needUpgrade.x, y: needUpgrade.y, ttl: 150, v: vi });
        return;
      }
    }
    // 4. Добыча: дровосеков — до трети деревни, камнетёсов — когда нужен камень.
    const idle = mine.filter((c) => !c.task && !c.warrior);
    if (!idle.length) return;
    const choppers = mine.filter((c) => c.task?.kind === "chop").length;
    const miners = mine.filter((c) => c.task?.kind === "mine").length;
    const wantWood = village.wood < 40 || needHouses || wantShipyard;
    const wantStone = (needUpgrade || era >= 1) && village.stone < 30;
    if (wantStone && miners < Math.max(1, Math.floor(mine.length / 5))) {
      const rock = nearestRock(village);
      const worker = rock && idleCatNear(vi, rock.x, rock.y);
      if (worker) {
        assign(worker, { kind: "mine", x: rock.x, y: rock.y, ttl: MINE_TICKS, v: vi });
        return;
      }
    }
    if (wantWood && choppers < Math.max(1, Math.floor(mine.length / 3))) {
      const tree = nearestTree(village);
      const worker = tree && idleCatNear(vi, tree.x, tree.y);
      if (worker) assign(worker, { kind: "chop", x: tree.x, y: tree.y, ttl: CHOP_TICKS, v: vi });
    }
  }

  /** Лес отрастает: раз в двадцать секунд на лесной клетке без дерева всходит новое. */
  function regrow() {
    if (state.weather.kind === "drought") return;
    if (isSpring() && state.tick % 40 === 0) {
      const x = Math.floor(Math.random() * W);
      const y = Math.floor(Math.random() * H);
      const i = idx(x, y);
      if (state.tiles[i] === T.GRASS && !state.trees.has(i) && !state.flowers.has(i) && !state.houses.some((h) => h.x === x && h.y === y)) {
        state.flowers.add(i);
        bakeArea(x, y, x, y);
      }
    }
    if (state.tick % 600 !== 100) return;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const i = Math.floor(Math.random() * W * H);
      if (state.tiles[i] !== T.FOREST || state.trees.has(i)) continue;
      if (state.houses.some((h) => idx(h.x, h.y) === i)) continue;
      state.trees.add(i);
      bakeArea(i % W, ((i / W) | 0) - 1, i % W, (i / W) | 0);
      return;
    }
  }

  /** Место под дом рядом со столицей, по вкусу народа. Без постановки. */
  function pickSite(r, near) {
    const race = RACES[r];
    for (let attempt = 0; attempt < 80; attempt += 1) {
      // Радиус растёт с попытками: свободное место ищется всё дальше, и
      // деревня расползается — так расширяется территория.
      const radius = 1 + Math.floor(attempt / 6);
      const x = near.x + Math.round((rand() * 2 - 1) * radius * 2);
      const y = near.y + Math.round((rand() * 2 - 1) * radius * 1.4);
      if (!inside(x, y) || !race.canBuild(tileAt(x, y))) continue;
      if (state.houses.some((h) => h.x === x && h.y === y)) continue;
      if (state.villages.some((v) => v.x === x && v.y === y)) continue;
      // На чужой земле не строим: это уже война, а не стройка.
      if (state.terr && state.terr[idx(x, y)] !== 255 && state.terr[idx(x, y)] !== r) continue;
      return { x, y };
    }
    return null;
  }

  function breed() {
    // Коты плодятся сами: деревня и без домов кормит троих, каждый дом —
    // ещё четверых. Раньше без домов рождений не было вовсе, и остров
    // замирал, пока коты копили брёвна. Потолок — под большую карту.
    if (state.tick % Math.max(90, Math.round(420 / fertility)) !== 0 || state.cats.length >= 400) return;
    const r = Math.floor(Math.random() * RACES.length);
    const vs = villagesOf(r);
    if (!vs.length || state.pop[r] === 0) return;
    const houses = state.houses.filter((h) => h.race === r).length;
    const capacity = houses * 4 + vs.length * 3 + 1;
    if (state.pop[r] >= capacity) return;
    // Голод — не до котят; крепкая вера — наоборот.
    if (vs.every((i) => (state.villages[i].food || 0) <= 0)) return;
    if (state.faith[r] < 60 && Math.random() < 0.15) return;
    if (state.cursed[r] > 0) return;
    if (state.blessed[r] > 0 && Math.random() < 0.5 && state.pop[r] < capacity - 1) spawnCat(r, vs[Math.floor(Math.random() * vs.length)]);
    if (spawnCat(r, vs[Math.floor(Math.random() * vs.length)])) {
      const kitten = state.cats[state.cats.length - 1];
      puff(kitten.x, kitten.y, "#ff6f91", 5, "heart");
      chronicle("born", r, kitten.name, state.villages[kitten.v]?.name);
      countPop();
      persist();
    }
  }

  /**
   * Отселение: разросшаяся деревня отправляет троих котов основать новую в
   * восьми-четырнадцати клетках. Так у народа появляется несколько деревень,
   * а территория тянется по острову.
   */
  function colonize() {
    if (state.tick % 900 !== 450 || !state.villages.length) return;
    const vi = Math.floor(Math.random() * state.villages.length);
    const village = state.villages[vi];
    const r = village.race;
    const race = RACES[r];
    if (villagesOf(r).length >= 4) return;
    const mine = state.cats.filter((c) => c.race === r && c.v === vi && !c.task && !c.warrior);
    const housesV = state.houses.filter((h) => h.race === r && h.v === vi).length;
    if (mine.length < 9 || housesV < 3 || Math.random() < 0.5) return;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const a = Math.random() * Math.PI * 2;
      const d = 8 + Math.random() * 6;
      const x = Math.round(village.x + Math.cos(a) * d);
      const y = Math.round(village.y + Math.sin(a) * d * 0.8);
      if (!inside(x, y) || !race.canStand(tileAt(x, y))) continue;
      if (state.villages.some((v) => Math.max(Math.abs(v.x - x), Math.abs(v.y - y)) < 8)) continue;
      if (state.terr && state.terr[idx(x, y)] !== 255 && state.terr[idx(x, y)] !== r) continue;
      const leader = mine[0];
      const nv = foundVillage(r, x, y, leader.name);
      for (const c of mine.slice(0, 3)) {
        c.v = nv;
        c.tx = x;
        c.ty = y;
        c.wait = 0;
      }
      chronicle("colony", r, leader.name, state.villages[nv].name);
      bakeArea(x - 1, y - 2, x + 1, y + 1);
      countPop();
      persist();
      return;
    }
  }

  function atWar(a, b) {
    return a !== b && state.relations[a][b] === "war";
  }

  function allied(a, b) {
    return a !== b && state.relations[a][b] === "ally";
  }

  function alliesOf(r) {
    return RACES.map((_, o) => o).filter((o) => allied(r, o));
  }

  /**
   * Война. Союзники обеих сторон встают рядом — так на одного нападают двое,
   * а коалиции складываются сами. Между союзниками войны быть не может:
   * сначала распадается союз.
   */
  function declareWar(a, b, joinedFor = null) {
    if (a === b || atWar(a, b)) return false;
    if (allied(a, b)) breakAlliance(a, b);
    state.relations[a][b] = "war";
    state.relations[b][a] = "war";
    state.wars.push({ a, b, ttl: 3600, kills: [0, 0] });
    if (joinedFor === null) chronicle("war", a, b);
    else chronicle("join", a, joinedFor, b);
    for (const c of state.cats) if (c.race === a || c.race === b) assignWarrior(c);
    if (joinedFor === null) {
      for (const c of alliesOf(a)) if (!atWar(c, b) && state.pop[c] >= 3) declareWar(c, b, a);
      for (const c of alliesOf(b)) if (!atWar(c, a) && state.pop[c] >= 3) declareWar(c, a, b);
    }
    persist();
    return true;
  }

  function endWar(w) {
    state.relations[w.a][w.b] = "peace";
    state.relations[w.b][w.a] = "peace";
    state.wars = state.wars.filter((o) => o !== w);
    chronicle("peace", w.a, w.b, w.kills[1], w.kills[0]);
    persist();
  }

  function makeAlliance(a, b) {
    if (a === b || allied(a, b) || atWar(a, b)) return false;
    state.relations[a][b] = "ally";
    state.relations[b][a] = "ally";
    state.allies.push({ a, b, ttl: 7200 });
    chronicle("ally", a, b);
    persist();
    return true;
  }

  function breakAlliance(a, b) {
    state.relations[a][b] = "peace";
    state.relations[b][a] = "peace";
    state.allies = state.allies.filter((o) => !((o.a === a && o.b === b) || (o.a === b && o.b === a)));
    chronicle("allyEnd", a, b);
  }

  /** Союзы рождаются у мирных соседей с общим врагом или просто по-соседски. */
  function allyTick() {
    for (const al of state.allies.slice()) {
      al.ttl -= 1;
      if (al.ttl <= 0) breakAlliance(al.a, al.b);
    }
    if (state.tick % 600 !== 400 || !state.terr) return;
    const alive = RACES.map((_, r) => r).filter((r) => state.pop[r] >= 4);
    if (alive.length < 2) return;
    const a = alive[Math.floor(Math.random() * alive.length)];
    const b = alive[Math.floor(Math.random() * alive.length)];
    if (a === b || atWar(a, b) || allied(a, b)) return;
    // Общий враг сближает: шанс выше, если оба воюют с одним и тем же.
    const commonFoe = RACES.some((_, r) => atWar(a, r) && atWar(b, r));
    if (Math.random() < (commonFoe ? 0.5 : 0.08)) makeAlliance(a, b);
  }

  /** Ближайший враг для кота: воин (или любой кот) враждебного народа. */
  function nearestEnemy(c, range, warriorsOnly = false) {
    let best = null;
    let bestD = range + 0.001;
    for (const o of state.cats) {
      if (o.race === c.race || !atWar(c.race, o.race)) continue;
      if (warriorsOnly && !o.warrior) continue;
      const d = Math.max(Math.abs(o.x - c.x), Math.abs(o.y - c.y));
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  function nearestEnemyHouse(c, range) {
    let best = null;
    let bestD = range + 0.001;
    for (const h of state.houses) {
      if (!atWar(c.race, h.race)) continue;
      const d = Math.max(Math.abs(h.x - c.x), Math.abs(h.y - c.y));
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    return best;
  }

  function weaponOf(c) {
    const era = state.era[c.race] || 0;
    return era === 0 ? { kind: "bow", range: 4, cd: 30 } : era === 1 ? { kind: "sword", range: 1, cd: 18 } : { kind: "blaster", range: 5, cd: 24 };
  }

  function killCat(victim, byRace) {
    state.cats = state.cats.filter((o) => o !== victim);
    puff(victim.x, victim.y, "#d9d3c4", 6, "dust");
    // Призрак кота поднимается к небу.
    state.particles.push({ x: victim.x * PX + 1, y: victim.y * PX + 1, vx: 0, vy: -0.25, ttl: 60, life: 60, color: "#ffffff", kind: "ghost" });
    const w = state.wars.find((o) => (o.a === victim.race && o.b === byRace) || (o.b === victim.race && o.a === byRace));
    if (w) w.kills[victim.race === w.a ? 0 : 1] += 1;
    if (victim.hero) {
      state.graves.push({ x: victim.x, y: victim.y, name: victim.name, race: victim.race });
      chronicle("heroFell", victim.race, victim.name);
      bakeArea(victim.x, victim.y, victim.x, victim.y);
    } else if (victim.warrior) chronicle("fallen", victim.race, victim.name, state.villages[victim.v]?.name);
    if (victim.king) {
      chronicle("kingFell", victim.race, victim.name);
      state.flags.kingFell = true;
      state.kings[victim.race] = null;
      // Смута: без короля деревни ропщут вдвое сильнее.
      for (const v of state.villages) if (v.race === victim.race) v.unrest = Math.min(100, (v.unrest || 0) + 25);
      succession(victim.race, null);
    }
  }

  /** Наследование: трон занимает герой, иначе случайный взрослый кот народа. */
  function succession(r, old) {
    const same = state.cats.filter((c) => c.race === r && !c.king);
    if (!same.length) {
      state.kings[r] = null;
      return;
    }
    const heir = same.find((c) => c.hero) || same[Math.floor(Math.random() * same.length)];
    for (const c of state.cats) if (c.race === r) c.king = false;
    heir.king = true;
    state.kings[r] = { name: heir.name, since: state.tick };
    if (old) chronicle("kingDied", r, old, heir.name);
    else chronicle("crown", r, heir.name);
  }

  /** Правители: король стареет и умирает раз в несколько дней; корона — у кота. */
  function kingsTick() {
    if (state.tick % 600 !== 300) return;
    for (let r = 0; r < RACES.length; r += 1) {
      const k = state.kings[r];
      const has = state.cats.some((c) => c.race === r && c.king);
      if (k && !has) {
        // Король записан, но кота с короной нет (старый снимок) — коронуем.
        const same = state.cats.filter((c) => c.race === r);
        const named = same.find((c) => c.name === k.name) || same[0];
        if (named) named.king = true;
        else state.kings[r] = null;
        continue;
      }
      if (!k && state.pop[r] > 0) {
        succession(r, null);
        continue;
      }
      if (k && state.tick - k.since > DAY_TICKS * 2 && Math.random() < 0.08) {
        const old = k.name;
        succession(r, old);
      }
    }
  }

  /**
   * Профессии. Деревня раздаёт дела свободным котам: рыбак у верфи, фермер на
   * лугу, кузнец с эры Средневековья, лекарь при раненых, жрец при храме.
   * Еда копится в деревне и тратится на котов; без еды — голод и ропот.
   */
  function jobsTick() {
    if (state.tick % 120 !== 60 || !state.villages.length) return;
    const vi = Math.floor(Math.random() * state.villages.length);
    const v = state.villages[vi];
    const r = v.race;
    const mine = state.cats.filter((c) => c.v === vi);
    if (!mine.length) return;
    const idle = mine.filter((c) => !c.task && !c.warrior && !c.job && !c.king);
    const count = (job) => mine.filter((c) => c.job === job).length;
    const give = (c, job) => {
      c.job = job;
      if (Math.random() < 0.5) chronicle("job", r, c.name, job);
    };
    if (idle.length && v.shipyard && count("fisher") < 1 + Math.floor(mine.length / 12)) give(idle.pop(), "fisher");
    if (idle.length && count("farmer") < 1 + Math.floor(mine.length / 8)) give(idle.pop(), "farmer");
    if (idle.length && (state.era[r] || 0) >= 1 && v.stone >= 10 && count("smith") < 1) give(idle.pop(), "smith");
    if (idle.length && count("healer") < 1 && mine.length >= 6) give(idle.pop(), "healer");
    if (idle.length && v.temple && count("priest") < 1) give(idle.pop(), "priest");
    // Работа: рыбак и фермер ходят на промысел, кузнец точит, лекарь лечит, жрец молится.
    for (const c of mine) {
      if (c.task || !c.job) continue;
      if (c.job === "fisher" && v.shipyard) assign(c, { kind: "fish", x: v.shipyard.x, y: v.shipyard.y, ttl: 240, v: vi });
      else if (c.job === "farmer") {
        const site = nearestFarmSite(v);
        if (site) assign(c, { kind: "farm", x: site.x, y: site.y, ttl: 300, v: vi });
      } else if (c.job === "smith") assign(c, { kind: "smith", x: v.x, y: v.y, ttl: 360, v: vi });
      else if (c.job === "healer") {
        const sick = mine.find((o) => o !== c && o.hp < (o.hero ? 30 : 3));
        if (sick) assign(c, { kind: "heal", x: sick.x, y: sick.y, ttl: 90, v: vi, who: sick });
      } else if (c.job === "priest" && v.temple) assign(c, { kind: "pray", x: v.temple.x, y: v.temple.y, ttl: 300, v: vi });
    }
    // Еда: каждый кот ест понемногу; мыши и промысел пополняют.
    // Зимой еда уходит вдвое быстрее, летом поля щедрее.
    v.food = (v.food || 0) - Math.ceil(mine.length / (isWinter() ? 3 : 6));
    if (v.gold > 0 && state.tick % 600 === 60) {
      v.gold -= 1;
      v.unrest = Math.max(0, (v.unrest || 0) - 10);
    }
    if (v.food < 0) {
      v.food = 0;
      v.unrest = Math.min(100, (v.unrest || 0) + 6);
      if (Math.random() < 0.2) chronicle("hunger", r, v.name);
    } else {
      v.unrest = Math.max(0, (v.unrest || 0) - 2);
    }
    // Война затянулась — недовольство.
    if (state.wars.some((wr) => (wr.a === r || wr.b === r) && wr.ttl < 1800)) v.unrest = Math.min(100, v.unrest + 3);
    // Вера: с храмом и жрецом растёт, без внимания бога падает.
    if (v.temple && count("priest")) state.faith[r] = Math.min(100, state.faith[r] + 1);
    if (state.faith[r] > 60) v.unrest = Math.max(0, v.unrest - 1);
    if (state.faith[r] < 20) v.unrest = Math.min(100, v.unrest + 1);
    if (v.unrest >= 100) revolt(vi);
  }

  function nearestFarmSite(village, radius = 6) {
    let best = null;
    let bestD = Infinity;
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const x = village.x + dx;
        const y = village.y + dy;
        if (!inside(x, y)) continue;
        const i = idx(x, y);
        if (tileAt(x, y) !== T.GRASS || state.trees.has(i)) continue;
        if (state.houses.some((h) => h.x === x && h.y === y)) continue;
        if (state.terr && state.terr[i] !== 255 && state.terr[i] !== village.race) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    }
    return best;
  }

  /**
   * Бунт: деревня отделяется и присягает соседу — союзнику, а если его нет,
   * тому, кто ближе. Коты и дома меняют народ, склады остаются деревне.
   */
  function revolt(vi) {
    const v = state.villages[vi];
    const r = v.race;
    if (state.homes[r] === v || villagesOf(r).length < 2) {
      v.unrest = 60;
      return;
    }
    const others = RACES.map((_, o) => o).filter((o) => o !== r && state.pop[o] > 0);
    if (!others.length) {
      v.unrest = 60;
      return;
    }
    const ally = others.find((o) => allied(r, o));
    let to = ally ?? null;
    if (to === null) {
      let bestD = Infinity;
      for (const o of others) {
        const home = state.homes[o];
        if (!home) continue;
        const d = Math.abs(home.x - v.x) + Math.abs(home.y - v.y);
        if (d < bestD) {
          bestD = d;
          to = o;
        }
      }
    }
    if (to === null) to = others[0];
    v.race = to;
    v.unrest = 0;
    for (const c of state.cats) if (c.v === vi) { c.race = to; c.king = false; c.task = null; }
    for (const h of state.houses) if (h.v === vi) h.race = to;
    chronicle("revolt", r, v.name, to);
    state.needBake = true;
    countPop();
    persist();
  }

  /** Дорога между двумя деревнями: по суше прямой линией, через реку — мост. */
  function layRoad(ai, bi) {
    const a = state.villages[ai];
    const b = state.villages[bi];
    const path = [];
    let x = a.x;
    let y = a.y;
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    const sx = a.x < b.x ? 1 : -1;
    const sy = a.y < b.y ? 1 : -1;
    let err = dx - dy;
    for (let guard = 0; guard < 200; guard += 1) {
      if (!(x === a.x && y === a.y) && !(x === b.x && y === b.y)) {
        const t = tileAt(x, y);
        if (t === T.DEEP || t >= T.MOUNTAIN) return false; // море и горы дорога не берёт
        path.push(idx(x, y));
      }
      if (x === b.x && y === b.y) break;
      const e2 = err * 2;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
    for (const i of path) {
      state.roads.add(i);
      state.trees.delete(i);
      state.flowers.delete(i);
    }
    state.roadLinks.push({ a: ai, b: bi, path });
    chronicle("road", a.race, a.name, b.name);
    state.needBake = true;
    return true;
  }

  function roadsTick() {
    if (state.tick % 900 === 450) {
      for (let r = 0; r < RACES.length; r += 1) {
        const vs = villagesOf(r);
        for (let i = 0; i < vs.length; i += 1) {
          for (let j = i + 1; j < vs.length; j += 1) {
            const a = state.villages[vs[i]];
            const b = state.villages[vs[j]];
            if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > 26) continue;
            if (state.roadLinks.some((l) => (l.a === vs[i] && l.b === vs[j]) || (l.a === vs[j] && l.b === vs[i]))) continue;
            if (a.wood >= 2 && layRoad(vs[i], vs[j])) {
              a.wood -= 2;
              persist();
              return;
            }
          }
        }
      }
    }
    // Караваны: сытая деревня делится с соседкой по дороге.
    if (state.tick % 600 === 120 && state.roadLinks.length && state.caravans.length < 6) {
      const l = state.roadLinks[Math.floor(Math.random() * state.roadLinks.length)];
      const a = state.villages[l.a];
      const b = state.villages[l.b];
      if (a && b && a.race === b.race && l.path.length > 2) {
        const rich = a.food >= b.food ? [a, b, l.path] : [b, a, [...l.path].reverse()];
        if (rich[0].food > 20) {
          rich[0].food -= 8;
          rich[0].wood = Math.max(0, rich[0].wood - 3);
          state.caravans.push({ path: rich[2], i: 0, race: a.race, to: rich[1], from: rich[0], t: 0 });
        }
      }
    }
    for (const cv of [...state.caravans]) {
      cv.t += 1;
      if (cv.t % 5 !== 0) continue;
      cv.i += 1;
      if (cv.i >= cv.path.length) {
        cv.to.food = (cv.to.food || 0) + 8;
        cv.to.wood += 3;
        state.caravans = state.caravans.filter((o) => o !== cv);
        if (Math.random() < 0.5) chronicle("caravan", cv.race, cv.from.name, cv.to.name);
      }
    }
  }

  /** Стены с башнями вокруг столицы — с эры Средневековья, за камень. */
  function wallsTick() {
    if (state.tick % 900 !== 700) return;
    for (let r = 0; r < RACES.length; r += 1) {
      const home = state.homes[r];
      if (!home || (state.era[r] || 0) < 1 || home.stone < WALL_COST) continue;
      if (state.towers.some((t) => t.race === r)) continue;
      const R = 3;
      const cells = [];
      for (let dy = -R; dy <= R; dy += 1) {
        for (let dx = -R; dx <= R; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== R) continue;
          const x = home.x + dx;
          const y = home.y + dy;
          if (!inside(x, y) || tileAt(x, y) <= T.WATER || tileAt(x, y) >= T.MOUNTAIN) continue;
          if (state.houses.some((h) => h.x === x && h.y === y) || state.villages.some((v) => v.x === x && v.y === y)) continue;
          if (state.roads.has(idx(x, y))) continue; // ворота — где дорога
          cells.push({ x, y, corner: Math.abs(dx) === R && Math.abs(dy) === R });
        }
      }
      if (cells.length < 8) continue;
      home.stone -= WALL_COST;
      for (const c of cells) {
        state.walls.set(idx(c.x, c.y), { race: r, hp: 3 });
        state.trees.delete(idx(c.x, c.y));
        if (c.corner) state.towers.push({ x: c.x, y: c.y, race: r, cd: 0 });
      }
      chronicle("walls", r, home.name);
      state.needBake = true;
      persist();
    }
  }

  function towersTick() {
    for (const t of state.towers) {
      if (t.cd > 0) {
        t.cd -= 1;
        continue;
      }
      const foe = state.cats.find((c) => c.warrior && atWar(t.race, c.race) && Math.abs(c.x - t.x) <= 4 && Math.abs(c.y - t.y) <= 4);
      if (!foe) continue;
      foe.hp -= 1;
      puff(foe.x, foe.y, "#e0242f", 3, "hit");
      state.particles.push({ x: t.x * PX + 4, y: t.y * PX - 2, vx: (foe.x - t.x) * 0.9, vy: (foe.y - t.y) * 0.9, ttl: 10, life: 10, color: "#f4efe2", kind: "spark" });
      t.cd = 40;
      if (foe.hp <= 0) killCat(foe, t.race);
    }
    // Вражеские воины ломают стены, если упёрлись.
    if (state.tick % 30 === 0 && state.walls.size) {
      for (const c of state.cats) {
        if (!c.warrior) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const i = idx(c.x + dx, c.y + dy);
          const wl = state.walls.get(i);
          if (!wl || !atWar(c.race, wl.race)) continue;
          wl.hp -= 1;
          puff(c.x + dx, c.y + dy, "#8c8780", 3, "dust");
          if (wl.hp <= 0) {
            state.walls.delete(i);
            state.towers = state.towers.filter((t) => idx(t.x, t.y) !== i);
            chronicle("wallDown", wl.race);
            state.needBake = true;
          }
          break;
        }
      }
    }
  }

  /** Морская торговля и пираты. */
  function seaTick() {
    // Торговля: корабль у чужой верфи — обмен едой и брёвнами.
    if (state.tick % 300 === 150) {
      for (const sh of state.ships) {
        if (sh.wait <= 0) continue;
        const v = state.villages.find((o) => o.shipyard && o.race !== sh.race && !atWar(o.race, sh.race) && Math.abs(o.shipyard.x - sh.x) <= 3 && Math.abs(o.shipyard.y - sh.y) <= 3);
        if (!v) continue;
        const home = state.homes[sh.race];
        v.food = (v.food || 0) + 6;
        v.wood += 2;
        if (home) {
          home.food = (home.food || 0) + 6;
          home.wood += 2;
        }
        if (Math.random() < 0.5) chronicle("seaTrade", sh.race, v.race);
      }
    }
    // Пираты: с эры Средневековья, в открытом море.
    if (state.tick % 1800 === 900 && state.pirates.length < 2 && Math.max(...state.era) >= 1 && state.ships.length + state.villages.filter((v) => v.shipyard).length > 0) {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const x = Math.floor(Math.random() * W);
        const y = Math.floor(Math.random() * H);
        if (state.tiles[idx(x, y)] !== T.DEEP) continue;
        const a = Math.random() * Math.PI * 2;
        state.pirates.push({ x, y, vx: Math.cos(a) * 0.06, vy: Math.sin(a) * 0.06, wait: 0, face: 1, hp: 4 });
        chronicle("pirate");
        break;
      }
    }
    for (const p of [...state.pirates]) {
      if (p.wait > 0) {
        p.wait -= 1;
      } else {
        // Курс на ближайший корабль или верфь.
        let target = null;
        let bestD = Infinity;
        for (const sh of state.ships) {
          const d = Math.abs(sh.x - p.x) + Math.abs(sh.y - p.y);
          if (d < bestD) { bestD = d; target = { x: sh.x, y: sh.y }; }
        }
        for (const v of state.villages) {
          if (!v.shipyard) continue;
          const d = Math.abs(v.shipyard.x - p.x) + Math.abs(v.shipyard.y - p.y);
          if (d < bestD) { bestD = d; target = v.shipyard; }
        }
        if (target && Math.random() < 0.1) {
          const a = Math.atan2(target.y - p.y, target.x - p.x);
          p.vx = Math.cos(a) * 0.06;
          p.vy = Math.sin(a) * 0.06;
        }
        const nx = p.x + p.vx;
        const ny = p.y + p.vy;
        if (inside(Math.round(nx), Math.round(ny)) && tileAt(Math.round(nx), Math.round(ny)) <= T.WATER) {
          p.x = nx;
          p.y = ny;
          if (Math.abs(p.vx) > 0.001) p.face = p.vx > 0 ? 1 : -1;
        } else {
          p.wait = 40;
          const a = Math.atan2(p.vy, p.vx) + Math.PI + (Math.random() - 0.5);
          p.vx = Math.cos(a) * 0.06;
          p.vy = Math.sin(a) * 0.06;
        }
      }
      // Абордаж и грабёж.
      const victim = state.ships.find((sh) => Math.abs(sh.x - p.x) <= 1.5 && Math.abs(sh.y - p.y) <= 1.5);
      if (victim && state.tick % 20 === 0) {
        state.ships = state.ships.filter((sh) => sh !== victim);
        puff(Math.round(victim.x), Math.round(victim.y), "#5b3d22", 8, "dust");
        chronicle("pirateSink", victim.race);
      }
      if (state.tick % 240 === 0) {
        const yard = state.villages.find((v) => v.shipyard && Math.abs(v.shipyard.x - p.x) <= 2.5 && Math.abs(v.shipyard.y - p.y) <= 2.5);
        if (yard) {
          yard.food = Math.max(0, (yard.food || 0) - 5);
          yard.wood = Math.max(0, yard.wood - 5);
          yard.unrest = Math.min(100, (yard.unrest || 0) + 5);
          chronicle("pirateRaid", yard.race, yard.name);
          p.wait = 30;
        }
      }
      // Воины на берегу отстреливаются.
      if (state.tick % 45 === 0) {
        const guard = state.cats.find((c) => c.warrior && Math.abs(c.x - p.x) <= 3 && Math.abs(c.y - p.y) <= 3);
        if (guard) {
          p.hp -= 1;
          puff(Math.round(p.x), Math.round(p.y), "#e0242f", 3, "hit");
          if (p.hp <= 0) {
            state.pirates = state.pirates.filter((o) => o !== p);
            puff(Math.round(p.x), Math.round(p.y), "#5b3d22", 8, "dust");
            chronicle("pirateDead", guard.race);
            state.flags.piratesBeaten = true;
          }
        }
      }
    }
  }

  /* ── Бедствия: чума, землетрясение, цунами, благословение, НЛО ── */
  function plagueTick() {
    const sick = state.cats.filter((c) => c.sick);
    // Сама приходит редко и только в людный остров.
    if (!sick.length && state.tick % 3000 === 1500 && state.cats.length >= 25 && Math.random() < 0.25) {
      const c = state.cats[Math.floor(Math.random() * state.cats.length)];
      c.sick = true;
      chronicle("plague", c.race);
      return;
    }
    if (!sick.length) {
      if (state.plagueWas) {
        state.plagueWas = false;
        state.flags.plagueEnded = true;
        chronicle("plagueEnd");
      }
      return;
    }
    state.plagueWas = true;
    if (state.tick % 30 === 0) {
      for (const s of sick) {
        for (const c of state.cats) {
          if (c.sick || Math.abs(c.x - s.x) > 1 || Math.abs(c.y - s.y) > 1) continue;
          if (Math.random() < 0.25) c.sick = true;
        }
      }
    }
    if (state.tick % 240 === 0) {
      for (const s of [...sick]) {
        s.hp -= 1;
        s.wait = Math.max(s.wait, 8);
        if (s.hp <= 0) killCat(s, null);
      }
    }
    // Лекари бегут к больным.
    if (state.tick % 60 === 0) {
      for (const h of state.cats) {
        if (h.job !== "healer" || h.task) continue;
        const patient = sick.find((s) => s.v === h.v);
        if (patient) assign(h, { kind: "heal", x: patient.x, y: patient.y, ttl: 60, v: h.v, who: patient });
      }
    }
  }

  function startQuake(x, y) {
    state.quake = { ttl: 60, x, y };
    chronicle("quake");
    const R = 9;
    for (const h of [...state.houses]) {
      if (Math.abs(h.x - x) > R || Math.abs(h.y - y) > R) continue;
      if (Math.random() < 0.45) {
        state.houses = state.houses.filter((o) => o !== h);
        puff(h.x, h.y, "#c9b48a", 8, "dust");
      }
    }
    for (const [i, wl] of [...state.walls]) {
      const wx = i % W;
      const wy = (i / W) | 0;
      if (Math.abs(wx - x) <= R && Math.abs(wy - y) <= R && Math.random() < 0.5) {
        state.walls.delete(i);
        state.towers = state.towers.filter((t) => idx(t.x, t.y) !== i);
      }
    }
    // Горы растут: холмы становятся горами, кое-где трескается земля.
    for (let i = 0; i < 14; i += 1) {
      const cx = x + Math.round((Math.random() * 2 - 1) * R);
      const cy = y + Math.round((Math.random() * 2 - 1) * R);
      if (!inside(cx, cy)) continue;
      const j = idx(cx, cy);
      if (state.tiles[j] === T.HILL) state.tiles[j] = T.MOUNTAIN;
      else if (state.tiles[j] === T.GRASS && Math.random() < 0.3) state.tiles[j] = T.HILL;
    }
    for (const c of state.cats) {
      if (Math.abs(c.x - x) <= R && Math.abs(c.y - y) <= R) {
        c.wait = 0;
        c.tx = c.x + Math.sign(c.x - x || 1) * 3;
        c.ty = c.y + Math.sign(c.y - y || 1) * 2;
      }
    }
    state.needBake = true;
    countPop();
    persist();
  }
  function quakeTick() {
    if (state.quake.ttl > 0) state.quake.ttl -= 1;
    if (state.tick % 4200 === 2100 && state.houses.length >= 10 && Math.random() < 0.3) {
      const h = state.houses[Math.floor(Math.random() * state.houses.length)];
      startQuake(h.x, h.y);
    }
  }

  function startTsunami(x, y) {
    // Точка старта — в море; волна идёт к ближайшему берегу.
    if (tileAt(x, y) > T.WATER) {
      let best = null;
      let bestD = Infinity;
      for (let i = 0; i < W * H; i += 1) {
        if (state.tiles[i] !== T.DEEP) continue;
        const d = Math.abs((i % W) - x) + Math.abs(((i / W) | 0) - y);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best === null) return;
      x = best % W;
      y = (best / W) | 0;
    }
    let target = null;
    let bestD = Infinity;
    for (let i = 0; i < W * H; i += 1) {
      if (state.tiles[i] < T.SAND) continue;
      const d = Math.abs((i % W) - x) + Math.abs(((i / W) | 0) - y);
      if (d < bestD) { bestD = d; target = i; }
    }
    if (target === null) return;
    const tx = target % W;
    const ty = (target / W) | 0;
    const a = Math.atan2(ty - y, tx - x);
    state.tsunami = { x, y, dx: Math.cos(a) * 0.35, dy: Math.sin(a) * 0.35, t: 0, len: 9 };
    chronicle("tsunami");
  }
  function tsunamiTick() {
    if (!state.tsunami) {
      if (state.tick % 6000 === 3000 && Math.random() < 0.2 && state.villages.some((v) => v.shipyard)) {
        const v = state.villages.find((o) => o.shipyard);
        startTsunami(v.shipyard.x + 6, v.shipyard.y);
      }
      return;
    }
    const ts = state.tsunami;
    ts.t += 1;
    ts.x += ts.dx;
    ts.y += ts.dy;
    const cx = Math.round(ts.x);
    const cy = Math.round(ts.y);
    if (!inside(cx, cy) || ts.t > 260) {
      state.tsunami = null;
      return;
    }
    // Фронт волны: перпендикуляр длиной len; на суше смывает первые две клетки.
    const nx = -ts.dy / 0.35;
    const ny = ts.dx / 0.35;
    let onLand = false;
    for (let k = -ts.len; k <= ts.len; k += 1) {
      const x = Math.round(cx + nx * k);
      const y = Math.round(cy + ny * k);
      if (!inside(x, y)) continue;
      const i = idx(x, y);
      if (state.tiles[i] >= T.SAND) {
        onLand = true;
        ts.depth = (ts.depth || 0);
        state.trees.delete(i);
        state.flowers.delete(i);
        state.farms.delete(i);
        state.houses = state.houses.filter((h) => !(h.x === x && h.y === y));
        for (const c of [...state.cats]) if (c.x === x && c.y === y) killCat(c, null);
        bakeArea(x, y, x, y);
      }
      for (const sh of [...state.ships]) if (Math.abs(sh.x - x) <= 1 && Math.abs(sh.y - y) <= 1) state.ships = state.ships.filter((o) => o !== sh);
    }
    if (onLand) {
      ts.land = (ts.land || 0) + 1;
      if (ts.land > 2) {
        state.tsunami = null;
        countPop();
        persist();
      }
    }
  }

  function blessTick() {
    for (let r = 0; r < RACES.length; r += 1) {
      if (state.blessed[r] > 0) {
        state.blessed[r] -= 1;
        if (state.blessed[r] === 0) chronicle("blessEnd", r);
        else if (state.tick % 20 === 0 && state.homes[r]) puff(state.homes[r].x + Math.round(Math.random() * 4 - 2), state.homes[r].y + Math.round(Math.random() * 2 - 1), "#ffd23a", 1, "heart");
        for (const v of state.villages) if (v.race === r && state.tick % 120 === 0) v.unrest = Math.max(0, (v.unrest || 0) - 3);
      }
      if (state.cursed[r] > 0) {
        state.cursed[r] -= 1;
        if (state.cursed[r] === 0) chronicle("curseEnd", r);
        else {
          if (state.tick % 20 === 0 && state.homes[r]) puff(state.homes[r].x + Math.round(Math.random() * 4 - 2), state.homes[r].y + Math.round(Math.random() * 2 - 1), "#4a4643", 1, "dust");
          if (state.tick % 300 === 0) {
            const hs = state.houses.filter((h) => h.race === r);
            if (hs.length) {
              const h = hs[Math.floor(Math.random() * hs.length)];
              if (!state.fires.some((f) => f.x === h.x && f.y === h.y)) state.fires.push({ x: h.x, y: h.y, ttl: 60 });
            }
          }
          for (const v of state.villages) if (v.race === r && state.tick % 120 === 0) v.unrest = Math.min(100, (v.unrest || 0) + 3);
        }
      }
    }
  }

  /** Коты-роботы: прилетают сами, когда кто-то дошёл до Будущего. */
  function robotsTick() {
    if (state.tick % 1800 !== 900) return;
    const ri = RACES.findIndex((r) => r.id === "robot");
    if (ri < 0 || state.pop[ri] > 0 || Math.max(...state.era) < 2 || Math.random() < 0.3) return;
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const x = Math.floor(Math.random() * W);
      const y = Math.floor(Math.random() * H);
      if (state.tiles[idx(x, y)] < T.SAND || state.tiles[idx(x, y)] > T.MOUNTAIN) continue;
      if (state.terr && state.terr[idx(x, y)] !== 255) continue;
      if (attempt < 150 && state.tiles[idx(x, y)] < T.HILL) continue; // сначала ищем горы, потом любую свободную сушу
      const vi = foundVillage(ri, x, y);
      state.era[ri] = 2;
      for (let i = 0; i < 6; i += 1) spawnCat(ri, vi, 3);
      puff(x, y, "#7fd4ff", 20, "spark");
      chronicle("robots", state.villages[vi].name);
      countPop();
      persist();
      break;
    }
  }

  const ISLAND_ACH = [
    { id: "first", title: "Первое поселение", test: () => state.villages.length >= 1 },
    { id: "four", title: "Четыре народа живут вместе", test: () => RACES.slice(0, 4).every((_, r) => state.pop[r] > 0) },
    { id: "hundred", title: "Сто котов", test: () => state.cats.length >= 100 },
    { id: "future", title: "Эра Будущего", test: () => Math.max(...state.era) >= 2 },
    { id: "nuke", title: "Пережил атомную бомбу", test: () => state.flags.nuked && state.cats.length > 0 },
    { id: "plague", title: "Пережили чуму", test: () => state.flags.plagueEnded },
    { id: "eruption", title: "Видели извержение", test: () => state.flags.eruption },
    { id: "pirates", title: "Пираты отбиты", test: () => state.flags.piratesBeaten },
    { id: "temple", title: "Первый храм", test: () => state.villages.some((v) => v.temple) },
    { id: "king", title: "Король пал в бою", test: () => state.flags.kingFell },
    { id: "robots", title: "Гости из будущего", test: () => RACES.some((r, i) => r.id === "robot" && state.pop[i] > 0) },
    { id: "hour", title: "Остров живёт час", test: () => Date.now() - state.born > 3_600_000 },
    { id: "walls", title: "Крепость", test: () => state.towers.length >= 4 },
  ];
  function achTick() {
    if (state.tick % 300 !== 150) return;
    for (const a of ISLAND_ACH) {
      if (state.islandAch.includes(a.id)) continue;
      let ok = false;
      try { ok = Boolean(a.test()); } catch { ok = false; }
      if (!ok) continue;
      state.islandAch.push(a.id);
      chronicle("achievement", a.title);
      if (state.homes.find(Boolean)) { const h = state.homes.find(Boolean); puff(h.x, h.y, "#ffd23a", 10, "spark"); }
      persist();
    }
  }
  const discoverKey = `world:discovered:${seed}`;
  function loadDiscovered() {
    try { state.discovered = JSON.parse(localStorage.getItem(discoverKey) || "[]"); } catch { state.discovered = []; }
    if (!Array.isArray(state.discovered)) state.discovered = [];
  }
  function discoverTick() {
    if (state.tick % 3600 !== 1800) return;
    if (Math.max(...state.era) < 1 || state.ships.length < 2) return;
    const known = new Set([...state.discovered, map, "island"]);
    const left = MAPS.filter((m) => !known.has(m.id));
    if (!left.length || Math.random() < 0.4) return;
    const found = left[Math.floor(Math.random() * left.length)];
    state.discovered.push(found.id);
    try { localStorage.setItem(discoverKey, JSON.stringify(state.discovered)); } catch { /* пусть */ }
    chronicle("discover", found.name);
  }

  function ufoTick() {
    if (!state.ufo) {
      if (Math.max(...state.era) >= 2 && state.tick % 2400 === 1200 && Math.random() < 0.35 && state.villages.length) {
        const v = state.villages[Math.floor(Math.random() * state.villages.length)];
        const fromLeft = Math.random() < 0.5;
        state.ufo = { x: fromLeft ? -4 : W + 4, y: Math.max(2, v.y - 3), tx: v.x, ty: v.y, t: 0, phase: "fly", taken: 0, race: v.race };
        chronicle("ufo");
      }
      return;
    }
    const u = state.ufo;
    u.t += 1;
    if (u.phase === "fly") {
      u.x += Math.sign(u.tx - u.x) * 0.3;
      if (Math.abs(u.x - u.tx) < 0.4) {
        u.x = u.tx;
        u.phase = "beam";
        u.t = 0;
      }
    } else if (u.phase === "beam") {
      if (u.t % 40 === 20 && u.taken < 3) {
        const c = state.cats.find((o) => Math.abs(o.x - u.tx) <= 2 && Math.abs(o.y - u.ty) <= 2);
        if (c) {
          state.cats = state.cats.filter((o) => o !== c);
          puff(c.x, c.y, "#7fd4ff", 6, "spark");
          u.taken += 1;
        }
      }
      if (u.t > 150) {
        u.phase = "leave";
        u.t = 0;
        if (u.taken) chronicle("ufoTaken", u.race, u.taken);
        countPop();
        persist();
      }
    } else {
      u.x += 0.5;
      u.y -= 0.15;
      if (u.x > W + 6 || u.y < -6) state.ufo = null;
    }
  }

  /** Вера гаснет, когда бог (ты) долго не заходил. Зовётся при старте. */
  function faithDecay(elapsedMs) {
    const days = Math.floor(elapsedMs / 86_400_000);
    if (days <= 0) return;
    for (let r = 0; r < RACES.length; r += 1) {
      if (state.pop[r] === 0) continue;
      state.faith[r] = Math.max(0, state.faith[r] - days * 12);
      if (state.faith[r] < 20) chronicle("faithLow", r);
    }
  }

  function hitHouse(h, byRace) {
    h.hp = (h.hp ?? 2) - 1;
    if (h.hp > 0) return;
    if (!state.fires.some((f) => f.x === h.x && f.y === h.y)) {
      state.fires.push({ x: h.x, y: h.y, ttl: 60 });
      chronicle("arson", byRace, h.race);
    }
  }

  /**
   * Война. Начинается сама у соседей по границе (орки задиристее) или по
   * воле бога. Воины идут к чужим домам и котам: лучники стреляют издали,
   * мечники рубят вплотную, в будущем — бластеры. Дома от попаданий
   * загораются, коты гибнут, территория горящего сжимается. Через сто
   * секунд — мир и счёт потерь.
   */
  function warTick() {
    // Самозарождение: раз в 20 с смотрим, чьи границы соприкасаются.
    if (state.tick % 600 === 200 && state.terr && state.villages.length >= 2) {
      const pairs = new Set();
      const terr = state.terr;
      for (let y = 0; y < H - 1; y += 1) {
        for (let x = 0; x < W - 1; x += 1) {
          const a = terr[idx(x, y)];
          if (a === 255) continue;
          const b1 = terr[idx(x + 1, y)];
          const b2 = terr[idx(x, y + 1)];
          if (b1 !== 255 && b1 !== a) pairs.add(Math.min(a, b1) * 10 + Math.max(a, b1));
          if (b2 !== 255 && b2 !== a) pairs.add(Math.min(a, b2) * 10 + Math.max(a, b2));
        }
      }
      const list = [...pairs];
      if (list.length) {
        const code = list[Math.floor(Math.random() * list.length)];
        const a = Math.floor(code / 10);
        const b = code % 10;
        const orc = RACES[a].id === "orc" || RACES[b].id === "orc";
        if (!atWar(a, b) && !allied(a, b) && state.pop[a] >= 6 && state.pop[b] >= 6 && Math.random() < (orc ? 0.3 : 0.12)) declareWar(a, b);
      }
    }

    for (const w of state.wars.slice()) {
      w.ttl -= 1;
      if (w.ttl <= 0 || state.pop[w.a] < 2 || state.pop[w.b] < 2) {
        endWar(w);
        continue;
      }
    }
    if (!state.wars.length) return;

    for (const c of state.cats) {
      if (!c.warrior) continue;
      const foes = RACES.map((_, r) => r).filter((r) => atWar(c.race, r));
      if (!foes.length) continue;
      if (c.cd > 0) c.cd -= 1;
      if (state.tick % 10 !== 0 && c.cd > 0) continue;
      const wp = weaponOf(c);
      const foe = nearestEnemy(c, 12);
      const house = nearestEnemyHouse(c, 14);
      const target = foe && (!house || Math.max(Math.abs(foe.x - c.x), Math.abs(foe.y - c.y)) <= Math.max(Math.abs(house.x - c.x), Math.abs(house.y - c.y))) ? foe : house;
      if (!target) {
        // Никого рядом — идём к ближайшей вражеской деревне.
        let dest = null;
        let bestD = Infinity;
        for (const v of state.villages) {
          if (!foes.includes(v.race)) continue;
          const d = Math.abs(v.x - c.x) + Math.abs(v.y - c.y);
          if (d < bestD) {
            bestD = d;
            dest = v;
          }
        }
        if (dest && state.tick % 10 === 0) {
          c.tx = c.x + Math.sign(dest.x - c.x) * 2;
          c.ty = c.y + Math.sign(dest.y - c.y);
          c.wait = 0;
        }
        continue;
      }
      const dist = Math.max(Math.abs(target.x - c.x), Math.abs(target.y - c.y));
      if (dist > wp.range) {
        if (state.tick % 10 === 0) {
          c.tx = c.x + Math.sign(target.x - c.x) * Math.min(2, Math.abs(target.x - c.x));
          c.ty = c.y + Math.sign(target.y - c.y) * Math.min(1, Math.abs(target.y - c.y));
          c.wait = 0;
        }
        continue;
      }
      if (c.cd > 0) continue;
      c.cd = wp.cd;
      c.face = target.x >= c.x ? 1 : -1;
      c.wait = 6;
      const isCat = "px" in target;
      if (wp.kind === "sword") {
        // Пять боевых сцен: выпад с ударом, свалка двух мечников, отбрасывание,
        // залп стрел по дуге и луч бластера со вспышкой. Какая — по оружию и
        // тому, дерётся ли цель в ответ.
        const duel = isCat && target.warrior && weaponOf(target).kind === "sword";
        c.anim = { kind: duel ? "brawl" : "lunge", t: duel ? 14 : 8, dx: c.face, dy: Math.sign(target.y - c.y) };
        if (duel) target.anim = { kind: "brawl", t: 14, dx: -c.face, dy: 0 };
        puff(target.x, target.y, "#fff3a3", 3, "spark");
        if (isCat) {
          target.hp -= c.hero ? 3 : 1 + (state.blessed[c.race] > 0 ? 1 : 0) + (state.villages[c.v]?.weapons > 0 ? 1 : 0) + (state.cats.some((o) => o.race === c.race && o.job === "smith") ? 1 : 0);
          target.hit = 5;
          if (!duel) target.anim = { kind: "knock", t: 8, dx: c.face, dy: 0 };
          puff(target.x, target.y, "#e0242f", 3, "hit");
          if (target.hp <= 0) killCat(target, c.race);
        } else {
          hitHouse(target, c.race);
        }
      } else {
        c.anim = { kind: wp.kind === "bow" ? "shoot" : "blast", t: 8, dx: c.face, dy: 0 };
        state.projectiles.push({
          x: c.x * PX + 4,
          y: c.y * PX + 3,
          tx: target.x * PX + 4,
          ty: target.y * PX + 4,
          kind: wp.kind,
          race: c.race,
          target,
          t: 0,
          steps: Math.max(4, Math.round(dist * 3)),
        });
      }
    }
  }

  function stepProjectiles() {
    for (const p of state.projectiles) {
      p.t += 1;
      if (p.t < p.steps) continue;
      const tg = p.target;
      if (!tg) continue;
      if ("px" in tg) {
        if (!state.cats.includes(tg)) continue;
        tg.hp -= p.hero ? 3 : 1;
        tg.hit = 5;
        tg.anim = { kind: "knock", t: 6, dx: Math.sign(p.tx - p.x) || 1, dy: 0 };
        puff(tg.x, tg.y, p.kind === "blaster" ? "#7fd4ff" : "#e0242f", 3, "hit");
        if (tg.hp <= 0) killCat(tg, p.race);
      } else if (state.houses.includes(tg)) {
        hitHouse(tg, p.race);
      }
    }
    state.projectiles = state.projectiles.filter((p) => p.t < p.steps);
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

  /** Воронки зарастают: когда истекает срок, территория возвращается народу. */
  function healCraters() {
    if (!state.craters.length) return;
    let healed = false;
    for (const cr of state.craters) {
      cr.ttl -= 1;
      if (cr.ttl <= 0) healed = true;
    }
    if (!healed) return;
    state.craters = state.craters.filter((cr) => cr.ttl > 0);
    countPop();
  }

  /**
   * Атомная бомба. Падает 40 тиков, потом взрыв радиусом NUKE_R: всё живое в
   * округе гибнет, лес и дома исчезают, в центре остаётся озеро-кратер, по
   * краю горит. Территория выпадает на три минуты — пустошь.
   */
  /** Молния в клетку: пожар, коты рядом гибнут, воронка. Зовёт и бог, и гроза. */
  function strikeBolt(x, y) {
    state.bolts.push({ x, y, ttl: 12 });
    const i = idx(x, y);
    if (state.trees.has(i) || state.houses.some((h) => h.x === x && h.y === y)) state.fires.push({ x, y, ttl: 50 });
    for (const c of [...state.cats]) {
      const dx = Math.abs(c.x - x);
      const dy = Math.abs(c.y - y);
      if (dx <= 1 && dy <= 1) {
        killCat(c, null);
      } else if (dx <= 2 && dy <= 2) {
        c.tx = c.x + Math.sign(c.x - x || 1) * 3;
        c.ty = c.y + Math.sign(c.y - y || 1) * 2;
        c.wait = 0;
      }
    }
    state.craters.push({ x, y, r: 1, ttl: CRATER_BOLT_TICKS });
    countPop();
  }

  /** Погода: меняется сама, по сезону. Дождь тушит, гроза бьёт, засуха сушит. */
  function weatherTick() {
    const wth = state.weather;
    wth.ttl -= 1;
    if (wth.ttl <= 0) {
      const s = season().id;
      const roll = Math.random();
      let kind = "clear";
      if (s === "winter") kind = roll < 0.45 ? "snow" : roll < 0.6 ? "storm" : "clear";
      else if (s === "summer") kind = roll < 0.25 ? "rain" : roll < 0.4 ? "storm" : roll < 0.6 ? "drought" : "clear";
      else kind = roll < 0.35 ? "rain" : roll < 0.5 ? "storm" : "clear";
      if (kind !== wth.kind) chronicle("weather", kind);
      wth.kind = kind;
      wth.ttl = 900 + Math.floor(Math.random() * 1500);
    }
    if (wth.kind === "storm" && state.tick % 210 === 0) {
      // Гроза бьёт сама — в случайную сушу.
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const x = Math.floor(Math.random() * W);
        const y = Math.floor(Math.random() * H);
        if (state.tiles[idx(x, y)] >= T.SAND) {
          strikeBolt(x, y);
          break;
        }
      }
    }
    if (raining() && state.fires.length && state.tick % 3 === 0) {
      for (const f of state.fires) f.ttl -= 4;
    }
  }

  /** Смена сезона ловится по дню; зимой перепекаем снег. */
  function seasonTick() {
    const id = season().id;
    if (state.seasonId === id) return;
    const first = state.seasonId === null;
    state.seasonId = id;
    if (!first) chronicle("season", id);
    bakeSeason();
  }

  /* ── Животные ── */
  const ANIMALS = {
    mouse: { max: 10, on: (t) => t === T.GRASS || t === T.SAND, speed: 1 },
    bird: { max: 6, on: () => true, speed: 1 },
    deer: { max: 5, on: (t) => t === T.FOREST || t === T.GRASS, speed: 1 },
    wolf: { max: 3, on: (t) => t === T.HILL || t === T.FOREST, speed: 1 },
    dragon: { max: 1, on: () => true, speed: 1 },
  };
  function spawnAnimal(kind) {
    const spec = ANIMALS[kind];
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const x = Math.floor(Math.random() * W);
      const y = Math.floor(Math.random() * H);
      const t = state.tiles[idx(x, y)];
      if (kind === "dragon" ? t < T.MOUNTAIN : kind === "bird" ? t <= T.WATER : !spec.on(t)) continue;
      state.animals.push({ kind, x, y, px: x, py: y, tx: x, ty: y, wait: 0, face: 1, hp: kind === "dragon" ? 12 : kind === "wolf" ? 4 : 1, cd: 0 });
      return true;
    }
    return false;
  }
  function animalsTick() {
    if (state.tick % 300 === 0) {
      // Заселение: мыши и птицы всегда, олени в лесу, волки в холмах,
      // дракон — редко и только когда есть кого пугать.
      for (const kind of Object.keys(ANIMALS)) {
        const have = state.animals.filter((a) => a.kind === kind).length;
        if (have >= ANIMALS[kind].max) continue;
        const chance = kind === "dragon" ? (state.cats.length >= 20 ? 0.08 : 0) : kind === "wolf" ? 0.5 : 0.8;
        if (Math.random() < chance) spawnAnimal(kind);
      }
    }
    const night = nightAlpha() > 0.25;
    for (const a of [...state.animals]) {
      const ddx = a.x - a.px;
      const ddy = a.y - a.py;
      if (Math.abs(ddx) > 0.01 || Math.abs(ddy) > 0.01) {
        const sp = a.kind === "bird" || a.kind === "dragon" ? 0.25 : 0.15;
        a.px += Math.sign(ddx) * Math.min(Math.abs(ddx), sp);
        a.py += Math.sign(ddy) * Math.min(Math.abs(ddy), sp);
        continue;
      }
      a.px = a.x;
      a.py = a.y;
      if (a.cd > 0) a.cd -= 1;
      if (a.wait > 0) {
        a.wait -= 1;
        continue;
      }
      // Волк ночью идёт на одинокого кота; дракон — на дома.
      if (a.kind === "wolf" && night && a.cd === 0) {
        const prey = state.cats.find((c) => Math.abs(c.x - a.x) <= 4 && Math.abs(c.y - a.y) <= 3 && !c.warrior);
        if (prey) {
          if (Math.abs(prey.x - a.x) <= 1 && Math.abs(prey.y - a.y) <= 1) {
            prey.hp -= 1;
            puff(prey.x, prey.y, "#e0242f", 3, "hit");
            prey.tx = prey.x + Math.sign(prey.x - a.x || 1) * 4;
            prey.ty = prey.y + Math.sign(prey.y - a.y || 1) * 3;
            prey.wait = 0;
            a.cd = 90;
            if (prey.hp <= 0) {
              chronicle("wolf", prey.race, prey.name);
              killCat(prey, null);
            }
          } else {
            a.tx = prey.x;
            a.ty = prey.y;
            a.face = Math.sign(prey.x - a.x) || a.face;
            if (a.x !== a.tx || a.y !== a.ty) { const nx = a.x + Math.sign(a.tx - a.x); const ny = a.y + Math.sign(a.ty - a.y); if (inside(nx, ny) && state.tiles[idx(nx, ny)] >= T.SAND) { a.x = nx; a.y = ny; } }
            continue;
          }
        }
      }
      if (a.kind === "dragon" && a.cd === 0 && state.houses.length && Math.random() < 0.02) {
        const h = state.houses[Math.floor(Math.random() * state.houses.length)];
        a.tx = h.x;
        a.ty = h.y;
        a.cd = 600;
        a.target = h;
      }
      if (a.kind === "dragon" && a.target && a.x === a.target.x && a.y === a.target.y) {
        if (!state.fires.some((f) => f.x === a.x && f.y === a.y)) state.fires.push({ x: a.x, y: a.y, ttl: 60 });
        chronicle("dragon", a.target.race);
        a.target = null;
      }
      // Воины отбиваются: волк рядом с воином получает урон.
      if ((a.kind === "wolf" || a.kind === "dragon") && a.cd % 30 === 0) {
        const guard = state.cats.find((c) => c.warrior && Math.abs(c.x - a.x) <= 2 && Math.abs(c.y - a.y) <= 2);
        if (guard) {
          a.hp -= 1;
          puff(a.x, a.y, "#e0242f", 3, "hit");
          if (a.hp <= 0) {
            state.animals = state.animals.filter((o) => o !== a);
            puff(a.x, a.y, "#d9d3c4", 6, "dust");
            continue;
          }
        }
      }
      // Мышь рядом с котом — поймана (кот сыт, сердечко).
      if (a.kind === "mouse") {
        const hunter = state.cats.find((c) => Math.abs(c.x - a.x) <= 1 && Math.abs(c.y - a.y) <= 1);
        if (hunter) {
          state.animals = state.animals.filter((o) => o !== a);
          puff(a.x, a.y, "#ff6f91", 2, "heart");
          if (Math.random() < 0.15) chronicle("mouse", hunter.race, hunter.name);
          continue;
        }
      }
      if (a.x === a.tx && a.y === a.ty) {
        const spec = ANIMALS[a.kind];
        for (let attempt = 0; attempt < 6; attempt += 1) {
          const range = a.kind === "bird" || a.kind === "dragon" ? 6 : 3;
          const tx = a.x + Math.round((Math.random() * 2 - 1) * range);
          const ty = a.y + Math.round((Math.random() * 2 - 1) * range * 0.7);
          if (!inside(tx, ty)) continue;
          const t = state.tiles[idx(tx, ty)];
          if (a.kind === "bird" || a.kind === "dragon" ? true : spec.on(t) || t === T.GRASS) {
            a.tx = tx;
            a.ty = ty;
            a.face = Math.sign(tx - a.x) || a.face;
            break;
          }
        }
        a.wait = a.kind === "bird" ? 2 : 6 + Math.floor(Math.random() * 20);
        continue;
      }
      const nx = a.x + Math.sign(a.tx - a.x);
      const ny = a.y + Math.sign(a.ty - a.y);
      if (inside(nx, ny)) {
        a.x = nx;
        a.y = ny;
      } else {
        a.tx = a.x;
        a.ty = a.y;
      }
    }
  }

  /* ── Вулкан и лава ── */
  function volcanoTick() {
    for (const v of state.volcanoes) {
      // Спящий вулкан просыпается сам — примерно раз в три игровых дня.
      if (v.erupt <= 0 && state.tick % 300 === 0 && Math.random() < 300 / (DAY_TICKS * 3)) {
        v.erupt = VOLCANO_ERUPT_TICKS;
        const near = state.homes.find((h) => h && Math.abs(h.x - v.x) < 12 && Math.abs(h.y - v.y) < 10);
        chronicle("eruption", near ? near.race : null);
        state.flags.eruption = true;
      }
      if (v.erupt > 0) {
        v.erupt -= 1;
        if (v.erupt % 6 === 0) {
          // Выплеск: лава у жерла и растекается вниз.
          for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const x = v.x + dx;
            const y = v.y + dy;
            if (inside(x, y) && (dx === 0 && dy === 0 ? true : Math.random() < 0.5)) state.lava.set(idx(x, y), { ttl: LAVA_TTL, flow: LAVA_FLOW });
          }
          puff(v.x, v.y, "#ff6a00", 3, "spark");
        }
      }
    }
    if (!state.lava.size) return;
    if (state.tick % 6 === 0) {
      const spread = [];
      for (const [i, cell] of state.lava) {
        if (cell.ttl < LAVA_TTL - 30 || cell.flow <= 0) continue; // растекается только свежая и с запасом хода
        const x = i % W;
        const y = (i / W) | 0;
        const cur = state.tiles[i];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (!inside(nx, ny)) continue;
          const j = idx(nx, ny);
          if (state.lava.has(j)) continue;
          const t = state.tiles[j];
          if (t <= T.WATER) continue; // в море шипит и гаснет
          if (t > cur) continue; // вверх не течёт
          // Вниз по склону — почти наверняка, по ровному — с трудом.
          if (Math.random() < (t < cur ? 0.7 : 0.3)) spread.push([j, cell.flow - 1]);
        }
      }
      for (const [j, flow] of spread) if (!state.lava.has(j)) state.lava.set(j, { ttl: LAVA_TTL, flow });
    }
    // Лава жжёт всё: лес, дома, котов, животных.
    for (const [i, cell] of state.lava) {
      const x = i % W;
      const y = (i / W) | 0;
      const ttl = cell.ttl;
      if (ttl === LAVA_TTL) {
        state.trees.delete(i);
        state.flowers.delete(i);
        const had = state.houses.length;
        state.houses = state.houses.filter((h) => !(h.x === x && h.y === y));
        if (state.houses.length !== had) countPop();
        for (const c of [...state.cats]) if (c.x === x && c.y === y) killCat(c, null);
        state.animals = state.animals.filter((a) => !(a.x === x && a.y === y) || a.kind === "bird" || a.kind === "dragon");
        bakeArea(x, y, x, y);
      }
      cell.ttl = ttl - 1;
      if (cell.ttl <= 0) {
        state.lava.delete(i);
        // Застыла камнем.
        if (state.tiles[i] > T.WATER) state.tiles[i] = T.MOUNTAIN;
        bakeArea(x - 1, y - 1, x + 1, y + 1);
        if (state.lava.size === 0) {
          countPop();
          persist();
        }
      }
    }
    for (const c of state.cats) {
      if (state.lava.has(idx(c.tx, c.ty))) {
        c.tx = c.x;
        c.ty = c.y;
      }
    }
  }

  function fallNukes() {
    for (const n of state.nukes) {
      n.t += 1;
      if (n.t !== 40) continue;
      const R = NUKE_R;
      const edgeTrees = [];
      for (let dy = -R; dy <= R; dy += 1) {
        for (let dx = -R; dx <= R; dx += 1) {
          const d = dx * dx + dy * dy;
          if (d > R * R + 2) continue;
          const x = n.x + dx;
          const y = n.y + dy;
          if (!inside(x, y)) continue;
          const i = idx(x, y);
          if (state.trees.has(i) && d >= (R - 2) * (R - 2)) edgeTrees.push({ x, y });
          if (state.tiles[i] >= T.SAND) state.tiles[i] = d <= 5 ? T.WATER : T.SAND;
          state.trees.delete(i);
          state.flowers.delete(i);
          state.houses = state.houses.filter((h) => !(h.x === x && h.y === y));
        }
      }
      for (const e of edgeTrees) if (!state.fires.some((f) => f.x === e.x && f.y === e.y)) state.fires.push({ x: e.x, y: e.y, ttl: 60 });
      for (const c of [...state.cats]) {
        const dx = Math.abs(c.x - n.x);
        const dy = Math.abs(c.y - n.y);
        if (dx <= R + 1 && dy <= R + 1) {
          killCat(c, null);
        } else if (dx <= R + 5 && dy <= R + 5) {
          c.tx = c.x + Math.sign(c.x - n.x || 1) * 6;
          c.ty = c.y + Math.sign(c.y - n.y || 1) * 5;
          c.wait = 0;
        }
      }
      state.ships = state.ships.filter((sh) => Math.abs(sh.x - n.x) > R + 1 || Math.abs(sh.y - n.y) > R + 1);
      state.craters.push({ x: n.x, y: n.y, r: R + 1, ttl: CRATER_NUKE_TICKS });
      const near = state.homes.find((h) => h && Math.abs(h.x - n.x) < 12 && Math.abs(h.y - n.y) < 10);
      puff(n.x, n.y, "#fff3a3", 40, "spark");
      puff(n.x, n.y, "#4a4643", 30, "dust");
      chronicle("nuke", near ? near.race : null);
      state.flags.nuked = true;
      bakeArea(n.x - R - 1, n.y - R - 1, n.x + R + 1, n.y + R + 1);
      countPop();
      persist();
    }
    state.nukes = state.nukes.filter((n) => n.t < 170);
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
        // В эпицентре (две клетки) коты гибнут, дальше — разбегаются. Раньше
        // метеорит только пугал, и «убить кота» было невозможно ничем.
        for (const c of [...state.cats]) {
          const dx = Math.abs(c.x - m.x);
          const dy = Math.abs(c.y - m.y);
          if (dx <= 2 && dy <= 2) {
            killCat(c, null);
          } else if (dx <= 3 && dy <= 3) {
            c.tx = c.x + Math.sign(c.x - m.x || 1) * 4;
            c.ty = c.y + Math.sign(c.y - m.y || 1) * 3;
            c.wait = 0;
          }
        }
        state.craters.push({ x: m.x, y: m.y, r: 3, ttl: CRATER_METEOR_TICKS });
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
      const yards = state.villages.filter((v) => v.race === r && v.shipyard);
      if (yards.length && state.ships.filter((sh) => sh.race === r).length < yards.length * 2) {
        const docks = [];
        for (const v of yards) {
          const h = v.shipyard;
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
    // Рыбалка — только у кого есть верфь; иначе в море выходить не на чем.
    const kinds = ["trade", "festival", "forge", "song", "raid"];
    if (state.villages.some((v) => v.shipyard)) kinds.push("fishing");
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const alive = RACES.map((_, r) => r).filter((r) => state.pop[r] > 0);
    if (alive.length < 2) return;
    const a = alive[Math.floor(Math.random() * alive.length)];
    let b = alive[Math.floor(Math.random() * alive.length)];
    if (b === a) b = alive[(alive.indexOf(a) + 1) % alive.length];
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
    for (const v of state.villages) {
      if (v.x === x && v.y === y && !RACES[v.race].canStand(t)) {
        const spot = nearestStand(x, y, RACES[v.race], 8);
        if (spot) {
          v.x = spot.x;
          v.y = spot.y;
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
        if (RACES[tool.race].minEra && Math.max(...state.era) < RACES[tool.race].minEra) {
          if (!state.robotsHint || state.tick - state.robotsHint > 300) {
            state.robotsHint = state.tick;
            chronicle("robotsLocked");
          }
          break;
        }
        const race = RACES[tool.race];
        if (!race.canStand(tileAt(x, y))) return;
        let vi = nearestVillage(tool.race, x, y, 14);
        const c = newCat(x, y, tool.race, vi < 0 ? 0 : vi);
        if (vi < 0) {
          vi = foundVillage(tool.race, x, y, c.name);
          c.v = vi;
          chronicle("settle", tool.race, c.name, state.villages[vi].name);
          mark(x, y);
        }
        state.cats.push(c);
        assignWarrior(c);
        stroke.spawned += 1;
        stroke.kind = "cat";
        stroke.race = tool.race;
        break;
      }
      case "house": {
        if (RACES[tool.race].minEra && Math.max(...state.era) < RACES[tool.race].minEra) break;
        const race = RACES[tool.race];
        if (!race.canBuild(tileAt(x, y))) return;
        if (state.houses.some((h) => h.x === x && h.y === y)) return;
        let vi = nearestVillage(tool.race, x, y, 14);
        if (vi < 0) {
          vi = foundVillage(tool.race, x, y);
          chronicle("settle", tool.race, state.villages[vi].founder, state.villages[vi].name);
        }
        state.houses.push({ x, y, race: tool.race, v: vi, hp: 2 });
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
        strikeBolt(x, y);
        stroke.kind = "bolt";
        break;
      }
      case "plague": {
        let n = 0;
        for (const c of state.cats) if (!c.sick && Math.abs(c.x - x) <= 2 && Math.abs(c.y - y) <= 2) { c.sick = true; n += 1; }
        if (n) chronicle("plague", state.cats.find((c) => c.sick)?.race ?? null);
        break;
      }
      case "quake": {
        startQuake(x, y);
        break;
      }
      case "tsunami": {
        startTsunami(x, y);
        break;
      }
      case "bless": {
        state.blessed[tool.race] = 3000;
        state.cursed[tool.race] = 0;
        chronicle("bless", tool.race);
        persist();
        break;
      }
      case "curse": {
        state.cursed[tool.race] = 3000;
        state.blessed[tool.race] = 0;
        chronicle("curse", tool.race);
        persist();
        break;
      }
      case "volcano": {
        if (state.volcanoes.some((v) => Math.abs(v.x - x) < 4 && Math.abs(v.y - y) < 4)) break;
        // Вулкан стоит на горе: если её нет — бог поднимает.
        brush(x, y, 1, (cx, cy, i) => {
          if (state.tiles[i] < T.HILL) state.tiles[i] = T.HILL;
          state.trees.delete(i);
          state.flowers.delete(i);
        });
        state.tiles[idx(x, y)] = T.MOUNTAIN;
        state.houses = state.houses.filter((h) => !(h.x === x && h.y === y));
        state.volcanoes.push({ x, y, erupt: VOLCANO_ERUPT_TICKS });
        chronicle("volcano");
        bakeArea(x - 2, y - 2, x + 2, y + 2);
        countPop();
        persist();
        break;
      }
      case "meteor": {
        if (!state.meteors.some((m) => Math.abs(m.x - x) < 3 && Math.abs(m.y - y) < 3)) state.meteors.push({ x, y, t: 0 });
        break;
      }
      case "nuke": {
        // Одна бомба на штрих: вторая рядом — та же воронка, только шум.
        if (!state.nukes.some((n) => Math.abs(n.x - x) < 8 && Math.abs(n.y - y) < 8)) state.nukes.push({ x, y, t: 0 });
        break;
      }
      case "war": {
        if (stroke.kind === "war") break;
        const r2 = state.terr ? state.terr[idx(x, y)] : 255;
        if (r2 === 255 || r2 === tool.race || state.pop[tool.race] === 0 || state.pop[r2] === 0) break;
        if (declareWar(tool.race, r2)) stroke.kind = "war";
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
  const seasonLayer = document.createElement("canvas");
  seasonLayer.width = canvas.width;
  seasonLayer.height = canvas.height;
  const sctx = seasonLayer.getContext("2d");
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
        const color = race.zone;
        octx.globalAlpha = 0.3;
        octx.fillStyle = color;
        octx.fillRect(x * PX, y * PX, PX, PX);
        octx.globalAlpha = 1;
        const other = (nx, ny) => !inside(nx, ny) || terr[idx(nx, ny)] !== r;
        if (other(x, y - 1)) octx.fillRect(x * PX, y * PX, PX, 2);
        if (other(x, y + 1)) octx.fillRect(x * PX, y * PX + PX - 2, PX, 2);
        if (other(x - 1, y)) octx.fillRect(x * PX, y * PX, 2, PX);
        if (other(x + 1, y)) octx.fillRect(x * PX + PX - 2, y * PX, 2, PX);
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
    for (const c of state.cats) {
      if (c.anim && --c.anim.t <= 0) c.anim = null;
      if (c.hit > 0) c.hit -= 1;
    }
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
      } else if (p.kind === "ghost") {
        const gx = Math.round(p.x + Math.sin(p.ttl / 5) * 1.5);
        const gy = Math.round(p.y);
        ctx.globalAlpha = Math.max(0, p.ttl / p.life) * 0.85;
        rect(ctx, "#ffffff", gx, gy + 1, 6, 4);
        rect(ctx, "#ffffff", gx, gy, 1, 1);
        rect(ctx, "#ffffff", gx + 5, gy, 1, 1);
        rect(ctx, "#141413", gx + 1, gy + 2, 1, 1);
        rect(ctx, "#141413", gx + 4, gy + 2, 1, 1);
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
    const era = Math.min(h.lvl || 0, state.era[h.race] || 0);
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

  /** Верфь: настил на сваях, каркас лодки, флажок народа. */
  function drawRoad(g, x, y) {
    const bx = x * PX;
    const by = y * PX;
    if (tileAt(x, y) <= T.WATER) {
      // Мост: настил с перилами.
      rect(g, "#8a5a2b", bx, by + 2, PX, 4);
      rect(g, "#5b3d22", bx, by + 1, PX, 1);
      rect(g, "#5b3d22", bx, by + 6, PX, 1);
      return;
    }
    rect(g, "#cdb98f", bx + 1, by + 2, 6, 4);
    rect(g, "#b9a37a", bx + 2, by + 3, 1, 1);
    rect(g, "#b9a37a", bx + 5, by + 4, 1, 1);
  }
  function drawWall(g, x, y, wl) {
    const bx = x * PX;
    const by = y * PX;
    rect(g, "#8c8780", bx, by + 1, PX, 6);
    rect(g, "#b7b3ad", bx, by, PX, 1);
    rect(g, "#5f5d58", bx + 1, by + 3, 2, 1);
    rect(g, "#5f5d58", bx + 5, by + 3, 2, 1);
    rect(g, "#5f5d58", bx + 3, by + 5, 2, 1);
    if (wl.hp < 3) rect(g, "#4a4844", bx + 3, by + 1, 2, 2);
  }
  function drawTower2(g, t) {
    const race = RACES[t.race];
    const bx = t.x * PX;
    const by = t.y * PX;
    rect(g, "#8c8780", bx + 1, by - 3, 6, 10);
    rect(g, "#b7b3ad", bx, by - 4, 8, 1);
    rect(g, "#b7b3ad", bx + 1, by - 5, 1, 1);
    rect(g, "#b7b3ad", bx + 3, by - 5, 2, 1);
    rect(g, "#b7b3ad", bx + 6, by - 5, 1, 1);
    rect(g, "#141413", bx + 3, by, 2, 2);
    rect(g, race.banner, bx + 7, by - 7, 1, 3);
  }
  function drawFarm(g, x, y) {
    const bx = x * PX;
    const by = y * PX;
    rect(g, "#b89a4a", bx, by, PX, PX);
    for (let r = 1; r < PX; r += 2) rect(g, "#e0c05a", bx, by + r, PX, 1);
    rect(g, "#5b3d22", bx + 3, by + 2, 1, 1);
    rect(g, "#5b3d22", bx + 6, by + 5, 1, 1);
  }
  function drawGrave(g, gr) {
    const bx = gr.x * PX;
    const by = gr.y * PX;
    rect(g, "#8c8780", bx + 2, by + 1, 4, 6);
    rect(g, "#b7b3ad", bx + 3, by + 1, 2, 1);
    rect(g, "#4a4844", bx + 3, by + 3, 2, 1);
    rect(g, "#4a4844", bx + 3, by + 5, 2, 1);
    rect(g, "#5f8f42", bx + 1, by + 7, 6, 1);
  }
  function drawTemple(g, v) {
    const race = RACES[v.race];
    const bx = v.temple.x * PX;
    const by = v.temple.y * PX;
    rect(g, "#e9e4d8", bx, by + 2, 8, 6);
    rect(g, "#c9c2b3", bx, by + 7, 8, 1);
    rect(g, "#f5f7f9", bx + 2, by - 2, 4, 4);
    rect(g, race.banner, bx + 3, by - 5, 2, 3);
    rect(g, "#e0a93b", bx + 2, by - 6, 4, 1);
    rect(g, "#141413", bx + 3, by + 5, 2, 3);
    rect(g, "#a9d4ea", bx + 1, by + 3, 1, 1);
    rect(g, "#a9d4ea", bx + 6, by + 3, 1, 1);
  }
  function drawShipyard(g, v) {
    const race = RACES[v.race];
    const bx = v.shipyard.x * PX;
    const by = v.shipyard.y * PX;
    rect(g, "#8a5a2b", bx, by + 3, 8, 3);
    rect(g, "#5b3d22", bx + 1, by + 6, 1, 2);
    rect(g, "#5b3d22", bx + 6, by + 6, 1, 2);
    rect(g, "#5b3d22", bx, by + 2, 8, 1);
    rect(g, "#5b3d22", bx + 2, by, 4, 2);
    rect(g, "#c9d3df", bx + 3, by + 1, 2, 1);
    rect(g, race.banner, bx + 7, by - 1, 1, 3);
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
      // Бугор: светлый гребень сверху, тень у подножия — холм выпирает.
      rect(tctx, "#c2a46e", x * PX + 1 + s, y * PX + 1, 4, 1);
      rect(tctx, "#b3955f", x * PX + s, y * PX + 2, 6, 1);
      rect(tctx, "#8e7648", x * PX + 1, y * PX + 6, 6, 1);
      rect(tctx, "#7d6740", x * PX + 2 + s, y * PX + 7, 4, 1);
    } else if (t === T.MOUNTAIN || t === T.SNOW) {
      // Пик в 2.5D: тёмный левый склон, светлый правый, гребень и вершина.
      // Снежные горы — те же грани, но в холодных тонах; у каменных снег
      // только на макушке, и то не у каждой.
      const snowy = t === T.SNOW;
      const L = snowy ? "#b9c6cf" : "#5f5d58";
      const Rr = snowy ? "#ffffff" : "#9a9893";
      const ridge = snowy ? "#eef4f7" : "#b3b1ac";
      const ox = x * PX;
      const oy = y * PX;
      const peak = 2 + (s === 2 ? 1 : 0);
      for (let row = 0; row < 6; row += 1) {
        const yy = oy + peak + row;
        const half = row + 1;
        rect(tctx, L, ox + 4 - half, yy, half, 1);
        rect(tctx, Rr, ox + 4, yy, Math.min(half, 4), 1);
      }
      rect(tctx, ridge, ox + 3, oy + peak, 2, 1);
      const cap = snowy || s === 2 || tileAt(x, y - 1) === T.SNOW;
      if (cap) {
        rect(tctx, "#f5f7f9", ox + 3, oy + peak, 2, 1);
        rect(tctx, "#f5f7f9", ox + 2, oy + peak + 1, 4, 1);
        rect(tctx, "#dfe6ea", ox + 4, oy + peak + 2, 2, 1);
      }
      rect(tctx, snowy ? "#9fb1bd" : "#4a4844", ox + 1, oy + 7, 6, 1);
    } else if (t === T.SNOW) {
      rect(tctx, "#cfd7dd", x * PX + 2 + s * 2, y * PX + 4, 1, 1);
    }
    // Тень от гор ложится на соседей справа и снизу — рельеф читается объёмным.
    if (t < T.MOUNTAIN && t >= T.SAND) {
      const leftHigh = tileAt(x - 1, y) >= T.MOUNTAIN;
      const upHigh = tileAt(x, y - 1) >= T.MOUNTAIN;
      if (leftHigh || upHigh) {
        tctx.globalAlpha = 0.22;
        if (leftHigh) rect(tctx, "#141413", x * PX, y * PX, 2, PX);
        if (upHigh) rect(tctx, "#141413", x * PX, y * PX, PX, 2);
        tctx.globalAlpha = 1;
      }
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
        if (state.farms.has(i)) drawFarm(tctx, x, y);
        if (state.roads.has(i)) drawRoad(tctx, x, y);
        if (state.walls.has(i)) drawWall(tctx, x, y, state.walls.get(i));
      }
    }
    for (const gr of state.graves) if (gr.x >= ax && gr.x <= bx && gr.y >= ay && gr.y <= by) drawGrave(tctx, gr);
    for (const t of state.towers) if (t.x >= ax && t.x <= bx && t.y >= ay && t.y <= by + 1) drawTower2(tctx, t);
    for (const v of state.villages) {
      const t = v.temple;
      if (t && t.x >= ax && t.x <= bx && t.y >= ay && t.y <= by + 2) drawTemple(tctx, v);
    }
    refreshWater();
    for (const v of state.villages) {
      const y = v.shipyard;
      if (y && y.x >= ax && y.x <= bx && y.y >= ay && y.y <= by + 1) drawShipyard(tctx, v);
    }
    const inArea = state.houses.filter((h) => h.x >= ax && h.x <= bx && h.y >= ay && h.y <= by + 2);
    inArea.sort((a, b) => a.y - b.y);
    for (const h of inArea) drawHouse(tctx, h);
    for (const v of state.villages) if (v.x >= ax && v.x <= bx && v.y >= ay && v.y <= by + 1) drawFlag(tctx, v);
  }

  /**
   * Сезонный слой поверх ландшафта: зимой снег на суше и лёд на мелкой
   * воде, осенью — рыжина. Перепекается только при смене сезона.
   */
  function bakeSeason() {
    sctx.clearRect(0, 0, seasonLayer.width, seasonLayer.height);
    const id = season().id;
    if (id === "summer" || id === "spring") return;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const t = state.tiles[idx(x, y)];
        const s = shadeMap[idx(x, y)];
        if (id === "winter") {
          if (t === T.WATER) {
            sctx.globalAlpha = 0.75;
            rect(sctx, "#d8e9f2", x * PX, y * PX, PX, PX);
            sctx.globalAlpha = 1;
            rect(sctx, "#b9d3e0", x * PX + 1 + s * 2, y * PX + 3 + s, 3, 1);
          } else if (t >= T.SAND && t <= T.HILL) {
            sctx.globalAlpha = 0.72;
            rect(sctx, "#f1f5f7", x * PX, y * PX, PX, PX);
            sctx.globalAlpha = 1;
            rect(sctx, "#dfe8ee", x * PX + s * 2, y * PX + 5 + (s % 2), 3, 1);
          } else if (t === T.MOUNTAIN) {
            sctx.globalAlpha = 0.45;
            rect(sctx, "#f1f5f7", x * PX, y * PX, PX, PX);
            sctx.globalAlpha = 1;
          }
        } else if (id === "autumn" && (t === T.GRASS || t === T.FOREST)) {
          sctx.globalAlpha = t === T.FOREST ? 0.42 : 0.22;
          rect(sctx, "#d9822b", x * PX, y * PX, PX, PX);
          sctx.globalAlpha = 1;
        }
      }
    }
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
    let bx = Math.round(c.px * PX) + 1;
    let by = Math.round(c.py * PX) + 1 - hop;
    const f = c.face;
    const an = c.anim;
    if (an) {
      // Смещение тела по сцене: выпад вперёд, отброс назад, дрожь в свалке.
      if (an.kind === "lunge") bx += an.dx * Math.round(3 * Math.sin((Math.PI * an.t) / 8));
      if (an.kind === "knock") bx += an.dx * Math.round(2 * (an.t / 8));
      if (an.kind === "brawl") {
        bx += ((state.tick + c.x) % 2) * 2 - 1;
        by += (state.tick >> 1) % 2;
      }
      if (an.kind === "shoot") bx -= an.dx * (an.t > 4 ? 1 : 0);
    }
    if (c.sick && (state.tick >> 2) % 2) {
      rect(ctx, "#7fe07a", bx + 1, by - 1, 1, 1);
      rect(ctx, "#7fe07a", bx + 4, by - 2, 1, 1);
    }
    // Корона у короля, звезда над героем.
    if (c.king) {
      rect(ctx, "#e0a93b", bx + 1, by - 2, 4, 1);
      rect(ctx, "#e0a93b", bx + 1, by - 3, 1, 1);
      rect(ctx, "#e0a93b", bx + 3, by - 3, 1, 1);
      rect(ctx, "#e0242f", bx + 2, by - 2, 1, 1);
    } else if (c.hero) {
      const tw = (state.tick >> 3) % 2;
      rect(ctx, "#ffd23a", bx + 2, by - 3 - tw, 2, 1);
      rect(ctx, "#ffd23a", bx + 1, by - 2 - tw, 4, 1);
    }
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
    if (c.task && c.x === c.task.x && c.y === c.task.y && (c.task.kind === "chop" || c.task.kind === "mine")) {
      // Рубит или долбит: топор/кирка машут, щепки летят, дерево вздрагивает.
      const swing = (state.tick >> 2) % 2;
      const tool = c.task.kind === "chop" ? "#c9d3df" : "#8c9ba8";
      rect(ctx, "#5b3d22", f > 0 ? bx + 6 : bx - 1, by - 2 + swing, 1, 4);
      rect(ctx, tool, f > 0 ? bx + 6 : bx - 2, by - 3 + swing, 2, 1);
      if (state.tick % 12 === 0) puff(c.task.x, c.task.y, c.task.kind === "chop" ? "#8a5a2b" : "#c9d3df", 1, c.task.kind === "chop" ? "dust" : "spark");
      if (c.task.kind === "chop" && swing) {
        // Дерево вздрагивает от удара: перерисовываем крону со сдвигом.
        ctx.globalAlpha = 0.5;
        rect(ctx, "#3d6a2c", c.task.x * PX + 3, c.task.y * PX, 4, 5);
        ctx.globalAlpha = 1;
      }
      // Полоска прогресса над работой.
      const total = c.task.kind === "chop" ? CHOP_TICKS : MINE_TICKS;
      const done = Math.round((1 - c.task.ttl / total) * 6);
      rect(ctx, "#141413", bx, by - 5, 6, 1);
      rect(ctx, "#e0a93b", bx, by - 5, done, 1);
    }
    if (c.task && c.x === c.task.x && c.y === c.task.y && (c.task.kind === "build" || c.task.kind === "upgrade" || c.task.kind === "shipyard")) {
      // Строит: молоток машет, под котом каркас будущего дома.
      const swing = (state.tick >> 2) % 2;
      rect(ctx, "#5b3d22", bx + 6, by - 2 + swing, 1, 3);
      rect(ctx, "#8c9ba8", bx + 5, by - 3 + swing, 3, 1);
      rect(ctx, "#5b3d22", c.task.x * PX, c.task.y * PX + 7, 8, 1);
      rect(ctx, "#5b3d22", c.task.x * PX, c.task.y * PX + 4, 1, 3);
      rect(ctx, "#5b3d22", c.task.x * PX + 7, c.task.y * PX + 4, 1, 3);
    }
    if (an) {
      const ax = f > 0 ? bx + 7 : bx - 4;
      if (an.kind === "lunge" && an.t > 2) {
        // Дуга удара: три пикселя от жёлтого к белому.
        rect(ctx, "#fff3a3", ax, by, 1, 1);
        rect(ctx, "#ffffff", ax + (f > 0 ? 1 : -1), by + 1, 1, 2);
        rect(ctx, "#fff3a3", ax, by + 3, 1, 1);
      }
      if (an.kind === "brawl") {
        // Свалка: облако пыли и звёздочки вокруг.
        ctx.globalAlpha = 0.6;
        const ph = state.tick % 4;
        for (let i = 0; i < 4; i += 1) {
          const a = ((i + ph / 4) * Math.PI) / 2;
          rect(ctx, "#c9b48a", Math.round(bx + 3 + Math.cos(a) * 5), Math.round(by + 2 + Math.sin(a) * 3), 2, 2);
        }
        ctx.globalAlpha = 1;
        rect(ctx, "#fff3a3", bx + ((state.tick >> 1) % 6), by - 3, 1, 1);
        rect(ctx, "#ffffff", bx + 5 - ((state.tick >> 1) % 6), by - 2, 1, 1);
      }
      if (an.kind === "blast" && an.t > 5) {
        rect(ctx, "#7fd4ff", ax, by + 1, 2, 2);
        rect(ctx, "#ffffff", ax + (f > 0 ? 1 : 0), by + 1, 1, 1);
      }
    }
    if (c.hit > 0) {
      // Вспышка попадания: тело на кадр краснеет.
      ctx.globalAlpha = 0.55;
      rect(ctx, "#ff3b3b", bx, by, 6, 5);
      ctx.globalAlpha = 1;
    }
    if (c.warrior) {
      const wp = weaponOf(c);
      const wx = f > 0 ? bx + 6 : bx - 1;
      if (wp.kind === "bow") {
        rect(ctx, "#8a5a2b", wx, by - 1, 1, 6);
        const pull = an && an.kind === "shoot" && an.t > 4 ? 2 : 1;
        rect(ctx, "#f4efe2", f > 0 ? wx + pull : wx - pull, by, 1, 4);
      } else if (wp.kind === "sword") {
        rect(ctx, "#c9d3df", wx, by - 3, 1, 5);
        rect(ctx, "#e0a93b", wx - 1, by + 2, 3, 1);
      } else {
        rect(ctx, "#4a4a52", wx, by + 1, 2, 2);
        rect(ctx, "#7fd4ff", f > 0 ? wx + 2 : wx - 1, by + 1, 1, 1);
      }
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

  function drawTsunami(ts) {
    const nx = -ts.dy / 0.35;
    const ny = ts.dx / 0.35;
    for (let k = -ts.len; k <= ts.len; k += 1) {
      const x = Math.round(ts.x + nx * k);
      const y = Math.round(ts.y + ny * k);
      if (!inside(x, y)) continue;
      ctx.globalAlpha = 0.85;
      rect(ctx, "#a9d4ea", x * PX, y * PX, PX, PX);
      rect(ctx, "#ffffff", x * PX + 1, y * PX + 1 + ((state.tick + k) % 3), 6, 1);
      ctx.globalAlpha = 0.5;
      rect(ctx, "#3b7fb0", Math.round(x - ts.dx * 3) * PX, Math.round(y - ts.dy * 3) * PX, PX, PX);
      ctx.globalAlpha = 1;
    }
  }
  function drawUfo(u) {
    const bx = Math.round(u.x * PX);
    const by = Math.round(u.y * PX) - 24 + ((state.tick >> 3) % 2);
    if (u.phase === "beam") {
      ctx.globalAlpha = 0.35 + 0.15 * ((state.tick >> 2) % 2);
      ctx.fillStyle = "#7fd4ff";
      ctx.beginPath();
      ctx.moveTo(bx + 2, by + 4);
      ctx.lineTo(bx + 6, by + 4);
      ctx.lineTo(bx + 14, u.ty * PX + 8);
      ctx.lineTo(bx - 6, u.ty * PX + 8);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    rect(ctx, "#8a97a8", bx - 4, by + 2, 16, 3);
    rect(ctx, "#c9d3df", bx - 1, by, 10, 2);
    rect(ctx, "#7fd4ff", bx + 2, by - 1, 4, 1);
    for (let i = 0; i < 4; i += 1) rect(ctx, (state.tick >> 2) % 4 === i ? "#ffd23a" : "#e0242f", bx - 3 + i * 4, by + 5, 2, 1);
  }
  function drawPirate(p) {
    const bx = Math.round(p.x * PX);
    const by = Math.round(p.y * PX) + ((state.tick >> 4) % 2);
    const f = p.face;
    rect(ctx, "#2b2926", bx + 1, by + 5, 7, 2);
    rect(ctx, "#3b2f2a", bx, by + 4, 9, 1);
    rect(ctx, "#141413", bx + 4, by, 1, 5);
    rect(ctx, "#141413", f > 0 ? bx + 5 : bx + 1, by, 3, 4);
    rect(ctx, "#f4efe2", f > 0 ? bx + 6 : bx + 2, by + 1, 1, 1);
    rect(ctx, "#f4efe2", f > 0 ? bx + 5 : bx + 1, by + 2, 3, 1);
  }
  function drawCaravan(cv) {
    const i = cv.path[Math.min(cv.i, cv.path.length - 1)];
    const x = i % W;
    const y = (i / W) | 0;
    const race = RACES[cv.race];
    const bx = x * PX;
    const by = y * PX;
    rect(ctx, race.fur, bx, by + 2, 4, 3);
    rect(ctx, "#8a5a2b", bx + 4, by + 2, 4, 3);
    rect(ctx, "#5b3d22", bx + 4, by + 5, 1, 1);
    rect(ctx, "#5b3d22", bx + 7, by + 5, 1, 1);
    rect(ctx, "#e0c05a", bx + 5, by + 1, 2, 1);
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

  function drawLava() {
    if (!state.lava.size) return;
    const blink = (state.tick >> 2) % 2;
    for (const [i, cell] of state.lava) {
      const x = i % W;
      const y = (i / W) | 0;
      const cooling = cell.ttl < 90;
      rect(ctx, cooling ? "#7a2a12" : blink ? "#ff6a00" : "#ff8c1a", x * PX, y * PX, PX, PX);
      rect(ctx, cooling ? "#4a1a0c" : "#ffd23a", x * PX + 2 + blink, y * PX + 3, 3, 1);
    }
  }

  function drawVolcano(v) {
    const bx = v.x * PX;
    const by = v.y * PX;
    // Конус: тёмный, шире у основания, с красным жерлом.
    rect(ctx, "#3b3733", bx - 3, by + 6, 14, 2);
    rect(ctx, "#4a4541", bx - 1, by + 3, 10, 3);
    rect(ctx, "#5a5450", bx + 1, by, 6, 3);
    rect(ctx, "#6b6560", bx + 3, by - 2, 2, 2);
    rect(ctx, v.erupt > 0 ? "#ff6a00" : "#8a2a12", bx + 3, by - 1, 2, 1);
    if (v.erupt > 0) {
      ctx.globalAlpha = 0.5;
      rect(ctx, "#4a4643", bx + 2 - ((state.tick >> 3) % 3), by - 8, 5, 5);
      rect(ctx, "#6b6560", bx + 1 + ((state.tick >> 4) % 3), by - 13, 5, 5);
      ctx.globalAlpha = 1;
    }
  }

  function drawAnimal(a) {
    const bx = Math.round(a.px * PX);
    const by = Math.round(a.py * PX);
    const f = a.face >= 0 ? 1 : -1;
    switch (a.kind) {
      case "mouse":
        rect(ctx, "#8c8780", bx + 2, by + 5, 3, 2);
        rect(ctx, "#141413", f > 0 ? bx + 4 : bx + 2, by + 5, 1, 1);
        rect(ctx, "#c9a2a2", f > 0 ? bx + 1 : bx + 5, by + 6, 1, 1);
        break;
      case "bird": {
        const flap = (state.tick >> 2) % 2;
        rect(ctx, "#2b2926", bx + 2, by + 2 + flap, 1, 1);
        rect(ctx, "#2b2926", bx + 3, by + 3, 2, 1);
        rect(ctx, "#2b2926", bx + 5, by + 2 + flap, 1, 1);
        break;
      }
      case "deer":
        ctx.globalAlpha = 0.25;
        rect(ctx, "#141413", bx + 1, by + 7, 6, 1);
        ctx.globalAlpha = 1;
        rect(ctx, "#8a5a2b", bx + 1, by + 3, 6, 3);
        rect(ctx, "#8a5a2b", f > 0 ? bx + 6 : bx + 1, by + 1, 1, 2);
        rect(ctx, "#5b3d22", f > 0 ? bx + 5 : bx + 2, by, 1, 1);
        rect(ctx, "#5b3d22", f > 0 ? bx + 7 : bx, by, 1, 1);
        rect(ctx, "#5b3d22", bx + 2, by + 6, 1, 1);
        rect(ctx, "#5b3d22", bx + 5, by + 6, 1, 1);
        break;
      case "wolf":
        ctx.globalAlpha = 0.25;
        rect(ctx, "#141413", bx + 1, by + 7, 6, 1);
        ctx.globalAlpha = 1;
        rect(ctx, "#6b6f78", bx + 1, by + 3, 6, 3);
        rect(ctx, "#6b6f78", f > 0 ? bx + 6 : bx + 1, by + 2, 2, 2);
        rect(ctx, "#e0242f", f > 0 ? bx + 7 : bx + 1, by + 3, 1, 1);
        rect(ctx, "#4a4d55", f > 0 ? bx : bx + 7, by + 2, 1, 2);
        break;
      case "dragon": {
        const flap = (state.tick >> 3) % 2;
        ctx.globalAlpha = 0.2;
        rect(ctx, "#141413", bx - 1, by + 9, 10, 1);
        ctx.globalAlpha = 1;
        rect(ctx, "#b8322a", bx, by + 2, 8, 3);
        rect(ctx, "#b8322a", f > 0 ? bx + 8 : bx - 2, by + 1, 2, 2);
        rect(ctx, "#ffd23a", f > 0 ? bx + 9 : bx - 2, by + 1, 1, 1);
        rect(ctx, "#7a1f1a", bx + 1, by - 1 + flap, 3, 2);
        rect(ctx, "#7a1f1a", bx + 4, by - 1 + flap, 3, 2);
        rect(ctx, "#b8322a", f > 0 ? bx - 2 : bx + 8, by + 3, 2, 1);
        break;
      }
      default:
        break;
    }
  }

  function drawWeather() {
    const k = state.weather.kind;
    if (k === "rain" || k === "storm") {
      ctx.strokeStyle = k === "storm" ? "rgba(200,215,235,0.55)" : "rgba(180,205,235,0.45)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      const n = k === "storm" ? 110 : 70;
      for (let i = 0; i < n; i += 1) {
        const x = (i * 97 + state.tick * 3) % canvas.width;
        const y = (i * 61 + state.tick * 7) % canvas.height;
        ctx.moveTo(x, y);
        ctx.lineTo(x - 1, y + 4);
      }
      ctx.stroke();
      if (k === "storm") {
        ctx.fillStyle = "rgba(20,24,40,0.18)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    } else if (k === "snow") {
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      for (let i = 0; i < 80; i += 1) {
        const x = (i * 89 + Math.round(Math.sin((state.tick + i) / 20) * 6) + state.tick) % canvas.width;
        const y = (i * 53 + state.tick * 2) % canvas.height;
        ctx.fillRect(x, y, 1, 1);
      }
    } else if (k === "drought") {
      ctx.fillStyle = "rgba(255, 190, 90, 0.10)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  function drawNuke(n) {
    const cx = n.x * PX + 4;
    const cy = n.y * PX + 4;
    if (n.t < 40) {
      // Бомба падает отвесно, с высоты — чёрная капля с оранжевым поясом.
      const t = n.t / 40;
      const by = cy - (1 - t) * 220;
      rect(ctx, "#2b2926", cx - 2, by - 6, 4, 6);
      rect(ctx, "#e8792f", cx - 2, by - 3, 4, 1);
      rect(ctx, "#8c8780", cx - 1, by, 2, 2);
      return;
    }
    const k = n.t - 40;
    if (k < 10) {
      // Вспышка на весь остров.
      ctx.globalAlpha = 0.95 - k * 0.09;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    }
    // Огненный шар и гриб: растут, тускнеют, уходят вверх.
    // Гриб растёт медленно и стоит долго: на телефоне карта мелкая, и
    // скромный взрыв просто не читался.
    const p = Math.min(1, k / 100);
    const fade = k < 100 ? 1 : Math.max(0, 1 - (k - 100) / 30);
    const ball = 10 + p * 70;
    ctx.globalAlpha = 0.85 * fade;
    ctx.fillStyle = "#ffb347";
    ctx.beginPath();
    ctx.arc(cx, cy, ball, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff3a3";
    ctx.beginPath();
    ctx.arc(cx, cy, ball * 0.55, 0, Math.PI * 2);
    ctx.fill();
    const stem = p * 120;
    ctx.globalAlpha = 0.8 * fade;
    ctx.fillStyle = "#4a4643";
    ctx.fillRect(cx - 8 - p * 6, cy - stem, 16 + p * 12, stem);
    const cap = 16 + p * 56;
    ctx.fillStyle = "#6b6560";
    ctx.beginPath();
    ctx.arc(cx, cy - stem, cap, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#c9673a";
    ctx.beginPath();
    ctx.arc(cx, cy - stem + cap * 0.35, cap * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function nightAlpha() {
    const phase = (state.tick % DAY_TICKS) / DAY_TICKS;
    return Math.max(0, -Math.cos(phase * Math.PI * 2)) * 0.5;
  }

  let cursor = null; // { x, y, size } — подсветка кисти под пальцем
  function frame() {
    if (state.needBake) {
      state.needBake = false;
      bakeAll();
    }
    ctx.save();
    if (state.quake.ttl > 0) ctx.translate(Math.round((Math.random() - 0.5) * 6), Math.round((Math.random() - 0.5) * 6));
    ctx.drawImage(terrain, 0, 0);
    drawWater();
    ctx.drawImage(seasonLayer, 0, 0);
    drawLava();
    for (const v of state.volcanoes) drawVolcano(v);
    if (options.territories) ctx.drawImage(overlay, 0, 0);
    // Флаги столиц машут поверх запечённых: два кадра полотнища.
    for (const v of state.villages) {
      const race = RACES[v.race];
      const fl = (state.tick >> 3) % 2;
      rect(ctx, race.banner, v.x * PX + 4, v.y * PX - 6 + fl, 4, 3);
    }
    for (const s of state.smokes) drawSmoke(s);
    // Коты по y: нижние поверх верхних, как в любой изометрии.
    for (const sh of state.ships) drawShip(sh);
    for (const p of state.pirates) drawPirate(p);
    for (const cv of state.caravans) drawCaravan(cv);
    const cats = state.cats.slice().sort((a, b) => a.py - b.py);
    for (const a of state.animals) if (a.kind !== "bird" && a.kind !== "dragon") drawAnimal(a);
    for (const c of cats) drawCat(c);
    for (const a of state.animals) if (a.kind === "bird" || a.kind === "dragon") drawAnimal(a);
    for (const f of state.fires) drawFire(f);
    for (const b of state.bolts) drawBolt(b);
    for (const m of state.meteors) drawMeteor(m);
    for (const n of state.nukes) drawNuke(n);
    for (const pr of state.projectiles) {
      const k = pr.t / pr.steps;
      const x = Math.round(pr.x + (pr.tx - pr.x) * k);
      const y = Math.round(pr.y + (pr.ty - pr.y) * k - Math.sin(Math.PI * k) * (pr.kind === "bow" ? 6 : 0));
      if (pr.kind === "blaster") {
        rect(ctx, "#7fd4ff", x - 1, y, 3, 1);
      } else {
        rect(ctx, "#8a5a2b", x - 1, y, 3, 1);
        rect(ctx, "#f4efe2", pr.tx >= pr.x ? x + 2 : x - 2, y, 1, 1);
      }
    }
    drawParticles();
    drawWeather();
    const night = nightAlpha();
    if (night > 0.01) {
      ctx.fillStyle = `rgba(16, 20, 48, ${night})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = `rgba(255, 220, 130, ${Math.min(1, night * 1.6)})`;
      for (const h of state.houses) {
        const era = Math.min(h.lvl || 0, state.era[h.race] || 0);
        ctx.fillRect(h.x * PX + 3, h.y * PX + (era === 0 ? 5 : era === 1 ? 0 : -3), 2, 2);
        if (era >= 1) ctx.fillRect(h.x * PX + 5, h.y * PX + (era === 1 ? -4 : -6), 1, 1);
      }
      for (const sh of state.ships) ctx.fillRect(Math.round(sh.x * PX) + 4, Math.round(sh.y * PX) + 2, 1, 1);
      for (const f of state.fires) ctx.fillRect(f.x * PX + 2, f.y * PX + 2, 4, 4);
    }
    if (state.tsunami) drawTsunami(state.tsunami);
    if (state.ufo) drawUfo(state.ufo);
    ctx.restore();
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
  let visible = true;
  // Уходя в фон, сохраняемся сразу: следующий вход догонит время от этой метки.
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) persist(true);
    });
    window.addEventListener("pagehide", () => persist(true));
  }
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
        fallNukes();
        healCraters();
        weatherTick();
        seasonTick();
        animalsTick();
        volcanoTick();
        kingsTick();
        jobsTick();
        roadsTick();
        wallsTick();
        towersTick();
        seaTick();
        plagueTick();
        quakeTick();
        tsunamiTick();
        blessTick();
        ufoTick();
        robotsTick();
        achTick();
        discoverTick();
        build();
        regrow();
        breed();
        warTick();
        allyTick();
        stepProjectiles();
        colonize();
        advanceEras();
        ambient();
        stepParticles();
        if (state.tick % 900 === 0) persist();
      }
      if (visible) frame();
      if (state.tick % 90 === 0 || options.paused) hud();
    }
    raf = requestAnimationFrame(loop);
  }

  loadDiscovered();
  bakeAll();
  refreshWater();
  countPop();
  if (state.catchMs > 5000) catchUp(state.catchMs);
  faithDecay(Date.now() - (state.lastVisit || Date.now()));
  state.lastVisit = Date.now();
  onEvent?.(state.chronicle);
  frame();

  return {
    start() {
      visible = true;
      if (running) return;
      running = true;
      raf = requestAnimationFrame(loop);
    },
    /** Вкладка ушла — остров живёт дальше, просто не рисуется. */
    stop() {
      visible = false;
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
    get wars() {
      return state.wars.map((w) => ({ a: w.a, b: w.b, ttl: w.ttl }));
    },
    get villages() {
      return state.villages.map((v) => ({ ...v }));
    },
    get terrAt() {
      return (x, y) => (state.terr ? state.terr[y * W + x] : 255);
    },
    get day() {
      return state.day;
    },
    get era() {
      return Math.max(...state.era);
    },
  };
}
