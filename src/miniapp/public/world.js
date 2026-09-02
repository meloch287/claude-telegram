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
const SAVE_VERSION = 6;

/* ── Имена ───────────────────────────────────────────────────────────────
   У каждого кота своё имя, у каждой деревни — название от основателя, как
   у королевств в WorldBox. Слоги у народов разные: люди звучат по-домашнему,
   эльфы певуче, орки рыкают, гномы стучат. */
const SYLLABLES = {
  human: ["мур", "бар", "вас", "тим", "мяу", "пуш", "сём", "фил", "ры", "жик", "кот", "мо", "ло", "ти", "ня", "сик"],
  elf: ["эль", "ли", "ара", "ниэ", "тал", "сэ", "ло", "ри", "вэ", "ан", "иль", "фэ", "ми", "лэн", "ая", "ор"],
  orc: ["гр", "рох", "ург", "заг", "мор", "кх", "дар", "гор", "рык", "шаг", "ог", "рум", "бар", "тук", "ур", "дрг"],
  gnome: ["дур", "бол", "кам", "тор", "гим", "фар", "нор", "бром", "дин", "гро", "ин", "ок", "лун", "торн", "ир", "бек"],
};
const SUFFIX = {
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
    pop: [0, 0, 0, 0],
    era: [0, 0, 0, 0], // эра каждого народа
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

  function newCat(x, y, r, v = 0) {
    // px/py — где кот нарисован; x/y — клетка, куда идёт. Между ними кот
    // плавно доезжает, и движение видно, а не мигает по клеткам. task —
    // дело, ради которого он остановится (стройка); без дела кот бродит.
    return { x, y, px: x, py: y, race: r, v, name: catName(RACES[r].id), tx: x, ty: y, wait: Math.floor(Math.random() * 8), step: Math.random(), face: 1, gait: 0, task: null, warrior: false, hp: 3, cd: 0 };
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
    state.villages.push({ race: r, x, y, name: villageName(RACES[r].id, who), founder: who });
    if (!state.homes[r]) state.homes[r] = state.villages[state.villages.length - 1];
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
    // Как в WorldBox: новый мир пуст. Народ появляется там, где бог
    // поставил первого кота, дома коты строят себе сами.
    state.homes = [null, null, null, null];
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
            cats: state.cats.map((c) => [c.x, c.y, c.race, c.v, c.warrior ? 1 : 0, c.hp, c.name]),
            savedAt: Date.now(),
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
      state.homes = Array.isArray(saved.homes) ? saved.homes.map((h) => h || null) : [null, null, null, null];
      state.villages = Array.isArray(saved.villages) ? saved.villages : [];
      state.relations = Array.isArray(saved.relations) && saved.relations.length === 4 ? saved.relations : RACES.map(() => RACES.map(() => "peace"));
      state.wars = Array.isArray(saved.wars) ? saved.wars : [];
      state.allies = Array.isArray(saved.allies) ? saved.allies : [];
      state.cats = (saved.cats || []).map(([x, y, r, v = 0, w = 0, hp = 3, name = null]) => {
        const c = newCat(x, y, r, v);
        c.warrior = Boolean(w);
        c.hp = hp;
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
      state.era = Array.isArray(saved.era) && saved.era.length === 4 ? saved.era : [0, 0, 0, 0];
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
    state.homes = [null, null, null, null];
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
        if (houses < Math.ceil(pop / 3) && houses < 40) {
          const vi = vs[Math.floor(rand() * vs.length)];
          const site = pickSite(r, state.villages[vi]);
          if (site) {
            state.houses.push({ x: site.x, y: site.y, race: r, v: vi, hp: 2 });
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
    const perRace = [0, 0, 0, 0];
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
    state.houses.push({ x: t.x, y: t.y, race: c.race, v: t.v ?? c.v, hp: 2 });
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
    if (!state.villages.length) return;
    const vi = Math.floor(Math.random() * state.villages.length);
    const village = state.villages[vi];
    const r = village.race;
    const popV = state.cats.filter((c) => c.race === r && c.v === vi).length;
    if (popV === 0) return;
    const housesV = state.houses.filter((h) => h.race === r && h.v === vi).length;
    if (housesV >= Math.ceil(popV / 3) || state.houses.filter((h) => h.race === r).length >= 48) return;
    if (state.cats.some((c) => c.race === r && c.v === vi && c.task)) return; // уже строят
    const site = pickSite(r, village);
    if (!site) return;
    // Ближайший свободный кот деревни идёт строить и стоит там секунд пять.
    let worker = null;
    let best = Infinity;
    for (const c of state.cats) {
      if (c.race !== r || c.v !== vi || c.task || c.warrior) continue;
      const d = Math.abs(c.x - site.x) + Math.abs(c.y - site.y);
      if (d < best) {
        best = d;
        worker = c;
      }
    }
    if (!worker) return;
    worker.task = { kind: "build", x: site.x, y: site.y, ttl: 150, v: vi };
    worker.tx = site.x;
    worker.ty = site.y;
    worker.wait = 0;
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
    if (state.tick % Math.max(120, Math.round(540 / fertility)) !== 0 || state.cats.length >= 260) return;
    const r = Math.floor(Math.random() * RACES.length);
    const vs = villagesOf(r);
    if (!vs.length || state.pop[r] === 0) return;
    const houses = state.houses.filter((h) => h.race === r).length;
    if (state.pop[r] >= houses * 4 + 1) return;
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
      if (state.villages.some((v) => Math.max(Math.abs(v.x - x), Math.abs(v.y - y)) < 6)) continue;
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
    if (victim.warrior) chronicle("fallen", victim.race, victim.name, state.villages[victim.v]?.name);
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
          target.hp -= 1;
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
        tg.hp -= 1;
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
        const race = RACES[tool.race];
        if (!race.canStand(tileAt(x, y))) return;
        let vi = nearestVillage(tool.race, x, y, 10);
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
        const race = RACES[tool.race];
        if (!race.canBuild(tileAt(x, y))) return;
        if (state.houses.some((h) => h.x === x && h.y === y)) return;
        let vi = nearestVillage(tool.race, x, y, 10);
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
    for (const v of state.villages) if (v.x >= ax && v.x <= bx && v.y >= ay && v.y <= by + 1) drawFlag(tctx, v);
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
    for (const v of state.villages) {
      const race = RACES[v.race];
      const fl = (state.tick >> 3) % 2;
      rect(ctx, race.banner, v.x * PX + 4, v.y * PX - 6 + fl, 4, 3);
    }
    for (const s of state.smokes) drawSmoke(s);
    // Коты по y: нижние поверх верхних, как в любой изометрии.
    for (const sh of state.ships) drawShip(sh);
    const cats = state.cats.slice().sort((a, b) => a.py - b.py);
    for (const c of cats) drawCat(c);
    for (const f of state.fires) drawFire(f);
    for (const b of state.bolts) drawBolt(b);
    for (const m of state.meteors) drawMeteor(m);
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
        build();
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

  bakeAll();
  refreshWater();
  countPop();
  if (state.catchMs > 5000) catchUp(state.catchMs);
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
