/**
 * Мой город — континент четырёх кошачьих народов.
 *
 * Игрушка в духе WorldBox: остров, на нём четыре расы — все коты, но разные:
 * люди-коты, эльфы-коты, орки-коты и гномы-коты. Каждая живёт там, где ей
 * положено (люди у моря, эльфы в лесу, орки на пустошах, гномы в горах),
 * строит дома, плодится и бродит. Сверху человек — бог: сажает деревья,
 * подселяет котов, ставит дома, роняет метеориты.
 *
 * Мир детерминирован: сид берётся из профиля, и остров у каждого свой, но
 * одинаковый при каждом открытии. Расти его заставляют настоящие числа
 * пользователя — токены, сессии, серия дней: чем больше работал с ботом,
 * тем больше котов и домов. Божественные вмешательства живут в localStorage,
 * чтобы посаженный лес не исчезал при следующем открытии.
 *
 * Рисуется на canvas в пикселях: клетка 6×6 внутренних пикселей, растянута
 * на ширину экрана через image-rendering: pixelated, есть зум ×2. Ландшафт
 * запекается один раз в отдельный canvas, поверх каждый кадр только живое:
 * коты, огонь, метеориты, ночь.
 */

const W = 64;
const H = 44;
const PX = 6; // внутренних пикселей на клетку

/* ── Народы ─────────────────────────────────────────────────────────────── */

export const RACES = [
  {
    id: "human",
    name: "Люди-коты",
    plural: "людей-котов",
    home: "у моря, на лугах",
    fur: "#d9a066",
    dark: "#a86a3b",
    hat: "#b23a26",
    roof: "#b23a26",
    wall: "#e9d3a6",
    banner: "#b23a26",
    likes: (t) => (t === T.GRASS ? 3 : t === T.SAND ? 1 : 0),
  },
  {
    id: "elf",
    name: "Эльфы-коты",
    plural: "эльфов-котов",
    home: "в чаще леса",
    fur: "#e8e2cf",
    dark: "#9aa77a",
    hat: "#5f8f45",
    roof: "#4f7a3a",
    wall: "#8a6a44",
    banner: "#5f8f45",
    likes: (t) => (t === T.FOREST ? 3 : t === T.GRASS ? 1 : 0),
  },
  {
    id: "orc",
    name: "Орки-коты",
    plural: "орков-котов",
    home: "на сухих пустошах",
    fur: "#6f8f4a",
    dark: "#40592a",
    hat: "#3b2f2a",
    roof: "#3b2f2a",
    wall: "#7a5a3a",
    banner: "#7a2a1e",
    likes: (t) => (t === T.HILL ? 3 : t === T.SAND ? 2 : t === T.GRASS ? 1 : 0),
  },
  {
    id: "gnome",
    name: "Гномы-коты",
    plural: "гномов-котов",
    home: "в недрах гор",
    fur: "#b7b3ad",
    dark: "#6f6a63",
    hat: "#c9402b",
    roof: "#6d6a66",
    wall: "#9a9590",
    banner: "#e0a93b",
    likes: (t) => (t === T.MOUNTAIN ? 3 : t === T.HILL ? 2 : 0),
  },
];

/* ── Ландшафт ───────────────────────────────────────────────────────────── */

const T = {
  DEEP: 0,
  WATER: 1,
  SAND: 2,
  GRASS: 3,
  FOREST: 4,
  HILL: 5,
  MOUNTAIN: 6,
  SNOW: 7,
};

// RACES ссылаются на T до его объявления в порядке кода — но функции likes
// вызываются позже, когда T уже есть. Поле wants — нет, поэтому заполняем тут.
RACES[0].wants = T.GRASS;
RACES[1].wants = T.FOREST;
RACES[2].wants = T.HILL;
RACES[3].wants = T.MOUNTAIN;

const TILE_COLOR = {
  [T.DEEP]: ["#1f4f7a", "#234f78", "#1c4a73"],
  [T.WATER]: ["#3b7fb0", "#3f84b6", "#377aac"],
  [T.SAND]: ["#e2cf94", "#dcc98d", "#e6d49b"],
  [T.GRASS]: ["#7fa64e", "#77a04a", "#85ab53"],
  [T.FOREST]: ["#4f7f3a", "#4a7836", "#55863f"],
  [T.HILL]: ["#a68b58", "#9f8552", "#ad925e"],
  [T.MOUNTAIN]: ["#7c7a75", "#75736e", "#83817c"],
  [T.SNOW]: ["#eef1f3", "#e6eaee", "#f5f7f9"],
};

function walkable(t) {
  return t >= T.SAND && t <= T.HILL;
}

/* ── Случайность ────────────────────────────────────────────────────────── */

/** mulberry32: маленький, детерминированный, годится для игрушки. */
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

/** Шум значений: решётка случайных чисел и плавная интерполяция между узлами. */
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
  const n1 = valueNoise(seed + 1, 6);
  const n2 = valueNoise(seed + 2, 12);
  const n3 = valueNoise(seed + 3, 24);
  const nForest = valueNoise(seed + 4, 9);
  const tiles = new Uint8Array(W * H);
  const height = new Float32Array(W * H);

  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const u = x / W;
      const v = y / H;
      let h = n1(u, v) * 0.6 + n2(u, v) * 0.28 + n3(u, v) * 0.12;
      // Радиальный спад: остров, а не бесконечная суша. Слегка вытянут по
      // ширине — экран телефона в мини-аппе шире, чем выше.
      const dx = (u - 0.5) * 2;
      const dy = (v - 0.5) * 2.0;
      const dist = Math.sqrt(dx * dx + dy * dy);
      h = h - Math.max(0, dist - 0.55) * 1.3;
      height[y * W + x] = h;

      let t;
      if (h < 0.24) t = T.DEEP;
      else if (h < 0.33) t = T.WATER;
      else if (h < 0.37) t = T.SAND;
      else if (h < 0.58) t = nForest(u, v) > 0.58 ? T.FOREST : T.GRASS;
      else if (h < 0.68) t = T.HILL;
      else if (h < 0.78) t = T.MOUNTAIN;
      else t = T.SNOW;
      tiles[y * W + x] = t;
    }
  }
  return { tiles, height };
}

/* ── Мир ────────────────────────────────────────────────────────────────── */

export function createWorld({ seed, stats, canvas, onEvent, onRaces }) {
  const rand = rng(seed * 7 + 13);
  const { tiles } = buildTerrain(seed);

  const state = {
    tiles,
    trees: new Set(), // индексы клеток с деревьями (поверх ландшафта)
    houses: [], // { x, y, race }
    cats: [], // { x, y, race, tx, ty, wait }
    fires: [], // { x, y, ttl }
    meteors: [], // { x, y, t }
    smokes: [], // { x, y, ttl }
    homes: [], // столицы: { race, x, y }
    tick: 0,
    power: "cat",
    race: 0,
    chronicle: [],
    pop: [0, 0, 0, 0],
  };

  const idx = (x, y) => y * W + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const tileAt = (x, y) => (inside(x, y) ? tiles[idx(x, y)] : T.DEEP);

  /* Столицы: лучшая клетка для народа в своей четверти. Четверти раздаются по
     сиду, чтобы гномы не всегда сидели в левом верхнем углу. */
  const quadrants = [0, 1, 2, 3].sort(() => rand() - 0.5);
  RACES.forEach((race, r) => {
    const q = quadrants[r];
    const x0 = q % 2 === 0 ? 4 : W / 2;
    const y0 = q < 2 ? 3 : H / 2;
    let best = null;
    let bestScore = -1;
    for (let y = y0; y < y0 + H / 2 - 3; y += 1) {
      for (let x = x0; x < x0 + W / 2 - 4; x += 1) {
        const t = tileAt(x, y);
        if (!walkable(t) && !(race.id === "gnome" && t === T.MOUNTAIN)) continue;
        // Оценка: сколько «своих» клеток вокруг + немного случая.
        let s = 0;
        for (let dy = -2; dy <= 2; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) s += race.likes(tileAt(x + dx, y + dy));
        }
        s += rand() * 3;
        if (s > bestScore) {
          bestScore = s;
          best = { x, y };
        }
      }
    }
    // Если четверть — сплошная вода, ищем где угодно на суше.
    if (!best) {
      for (let i = 0; i < W * H && !best; i += 1) if (walkable(tiles[i])) best = { x: i % W, y: (i / W) | 0 };
    }
    state.homes.push({ race: r, x: best.x, y: best.y });
  });

  /* Население из настоящих чисел. Токены дают тело, серия дней — плодовитость,
     сессии — дома. Числа подобраны так, чтобы новичок увидел деревню, а не
     пустошь, а ветеран — не кашу из точек. */
  const tokens = Math.max(0, stats.tokens || 0);
  const basePop = 16 + Math.floor(Math.sqrt(tokens / 8_000));
  const totalPop = Math.min(180, basePop + (stats.streakDays || 0) * 2);
  const housesPer = Math.min(14, 1 + Math.floor(Math.log2(1 + (stats.sessions || 0))) + Math.floor(totalPop / 24));

  function placeHouse(r, near) {
    const race = RACES[r];
    // Ищем клетку, которую народ любит, недалеко от столицы; без штрафа за
    // расстояние деревня расползлась бы по всему острову.
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const radius = 1 + Math.floor(attempt / 8);
      const x = near.x + Math.round((rand() * 2 - 1) * radius * 2);
      const y = near.y + Math.round((rand() * 2 - 1) * radius);
      if (!inside(x, y)) continue;
      const t = tileAt(x, y);
      const ok = race.id === "gnome" ? t === T.MOUNTAIN || t === T.HILL : walkable(t) && race.likes(t) > 0;
      if (!ok) continue;
      if (state.houses.some((h) => h.x === x && h.y === y)) continue;
      state.houses.push({ x, y, race: r });
      state.trees.delete(idx(x, y));
      return true;
    }
    return false;
  }

  function spawnCat(r, near) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const x = near.x + Math.round((rand() * 2 - 1) * 4);
      const y = near.y + Math.round((rand() * 2 - 1) * 3);
      if (!inside(x, y)) continue;
      const t = tileAt(x, y);
      if (!walkable(t) && !(RACES[r].id === "gnome" && t === T.MOUNTAIN)) continue;
      state.cats.push({ x, y, race: r, tx: x, ty: y, wait: Math.floor(rand() * 40), step: rand() });
      return true;
    }
    return false;
  }

  // Лес: там, где ландшафт лесной, деревья стоят густо; на лугах — редко.
  for (let i = 0; i < W * H; i += 1) {
    const t = tiles[i];
    if (t === T.FOREST && rand() < 0.55) state.trees.add(i);
    else if (t === T.GRASS && rand() < 0.06) state.trees.add(i);
    else if (t === T.HILL && rand() < 0.04) state.trees.add(i);
  }

  state.homes.forEach((home) => {
    for (let i = 0; i < housesPer; i += 1) placeHouse(home.race, home);
  });
  // Делёж населения: не поровну — у народов свой вес по сиду, чтобы на острове
  // была история («здесь правят орки»), а не четыре одинаковых деревни.
  const weights = RACES.map(() => 0.6 + rand());
  const wsum = weights.reduce((a, b) => a + b, 0);
  state.homes.forEach((home, r) => {
    const n = Math.max(2, Math.round((totalPop * weights[r]) / wsum));
    for (let i = 0; i < n; i += 1) spawnCat(r, home);
  });

  /* Божественные вмешательства из прошлого. */
  const storeKey = `world:${seed}`;
  function loadSaved() {
    try {
      const saved = JSON.parse(localStorage.getItem(storeKey) || "null");
      if (!saved) return;
      for (const i of saved.trees || []) state.trees.add(i);
      for (const i of saved.cutTrees || []) state.trees.delete(i);
      for (const h of saved.houses || []) state.houses.push(h);
      for (const c of saved.cats || []) state.cats.push({ ...c, tx: c.x, ty: c.y, wait: 0, step: rand() });
      for (const s of saved.scars || []) {
        if (inside(s.x, s.y)) tiles[idx(s.x, s.y)] = s.t;
      }
    } catch {
      /* испорченное сохранение просто игнорируем */
    }
  }
  const saved = { trees: [], cutTrees: [], houses: [], cats: [], scars: [] };
  function persist() {
    try {
      localStorage.setItem(storeKey, JSON.stringify(saved));
    } catch {
      /* private mode и прочее — не страшно */
    }
  }
  loadSaved();

  /* ── Летопись ─────────────────────────────────────────────────────────── */

  const chronicleTemplates = {
    born: (r) => `У ${RACES[r].plural} родился котёнок.`,
    house: (r) => `${RACES[r].name} построили дом.`,
    tree: () => "Бог посадил дерево.",
    fire: () => "Лес горит!",
    meteor: (r) => (r == null ? "С неба упал метеорит." : `Метеорит упал рядом с деревней ${RACES[r].plural}.`),
    trade: (a, b) => `${RACES[a].name} торгуют с ${RACES[b].plural}.`,
    festival: (r) => `У ${RACES[r].plural} праздник урожая.`,
    fishing: () => "Люди-коты вышли в море на рыбалку.",
    forge: () => "В горах гномов-котов стучит кузня.",
    song: () => "Эльфы-коты поют в чаще — слышно даже на пустошах.",
    raid: () => "Орки-коты устроили набег на соседей. Никто не пострадал: все коты.",
  };
  function chronicle(kind, ...args) {
    const line = chronicleTemplates[kind]?.(...args);
    if (!line) return;
    state.chronicle.unshift({ text: line, at: Date.now() });
    if (state.chronicle.length > 12) state.chronicle.length = 12;
    onEvent?.(state.chronicle);
  }

  function countPop() {
    const pop = [0, 0, 0, 0];
    for (const c of state.cats) pop[c.race] += 1;
    state.pop = pop;
    const houses = [0, 0, 0, 0];
    for (const h of state.houses) houses[h.race] += 1;
    onRaces?.(
      RACES.map((race, r) => ({
        ...race,
        pop: pop[r],
        houses: houses[r],
        mood: mood(r, pop[r], houses[r]),
      })),
    );
  }

  function mood(r, pop, houses) {
    if (pop === 0) return "деревня опустела";
    const perHouse = pop / Math.max(1, houses);
    if (state.fires.length > 3) return "в панике";
    if (perHouse > 6) return "тесно, просят домов";
    if (perHouse < 1.5) return "простор и лень";
    return "довольны";
  }

  /* ── Симуляция ────────────────────────────────────────────────────────── */

  function moveCats() {
    for (const c of state.cats) {
      if (c.wait > 0) {
        c.wait -= 1;
        continue;
      }
      if (c.x === c.tx && c.y === c.ty) {
        // Новая цель: недалеко, туда, где можно ходить. Гномы ходят по горам.
        const home = state.homes[c.race];
        for (let attempt = 0; attempt < 6; attempt += 1) {
          const tx = c.x + Math.round((Math.random() * 2 - 1) * 3);
          const ty = c.y + Math.round((Math.random() * 2 - 1) * 2);
          const far = Math.abs(tx - home.x) + Math.abs(ty - home.y);
          if (!inside(tx, ty) || far > 14) continue;
          const t = tileAt(tx, ty);
          if (walkable(t) || (RACES[c.race].id === "gnome" && t === T.MOUNTAIN)) {
            c.tx = tx;
            c.ty = ty;
            break;
          }
        }
        c.wait = 10 + Math.floor(Math.random() * 60);
        continue;
      }
      // Шаг раз в несколько тиков, чтобы коты гуляли, а не носились.
      c.step += 0.18;
      if (c.step < 1) continue;
      c.step = 0;
      const dx = Math.sign(c.tx - c.x);
      const dy = Math.sign(c.ty - c.y);
      const nx = c.x + (dx !== 0 && Math.random() < 0.6 ? dx : 0);
      const ny = c.y + (nx === c.x ? dy : 0);
      const t = tileAt(nx, ny);
      if (walkable(t) || (RACES[c.race].id === "gnome" && t === T.MOUNTAIN)) {
        c.x = nx;
        c.y = ny;
      } else {
        c.tx = c.x;
        c.ty = c.y;
      }
    }
  }

  function breed() {
    // Раз в ~20 секунд в одной из деревень рождается котёнок, если есть где
    // жить. Потолок — чтобы за ночь остров не превратился в ковёр из котов.
    if (state.tick % 600 !== 0 || state.cats.length >= 220) return;
    const r = Math.floor(Math.random() * RACES.length);
    const houses = state.houses.filter((h) => h.race === r).length;
    if (state.pop[r] >= houses * 6 + 2) return;
    if (spawnCat(r, state.homes[r])) {
      chronicle("born", r);
      countPop();
    }
  }

  function burn() {
    for (const f of state.fires) {
      f.ttl -= 1;
      // Огонь перекидывается на соседние деревья.
      if (f.ttl % 12 === 0) {
        const dx = Math.round(Math.random() * 2 - 1);
        const dy = Math.round(Math.random() * 2 - 1);
        const x = f.x + dx;
        const y = f.y + dy;
        if (inside(x, y) && state.trees.has(idx(x, y)) && !state.fires.some((o) => o.x === x && o.y === y)) {
          state.fires.push({ x, y, ttl: 50 + Math.floor(Math.random() * 40) });
        }
      }
      if (f.ttl <= 0) {
        state.trees.delete(idx(f.x, f.y));
        saved.cutTrees.push(idx(f.x, f.y));
        state.smokes.push({ x: f.x, y: f.y, ttl: 60 });
      }
      // Коты бегут от огня.
      for (const c of state.cats) {
        if (Math.abs(c.x - f.x) <= 1 && Math.abs(c.y - f.y) <= 1) {
          c.tx = c.x + (c.x - f.x || 1) * 3;
          c.ty = c.y + (c.y - f.y) * 2;
          c.wait = 0;
        }
      }
    }
    state.fires = state.fires.filter((f) => f.ttl > 0);
    if (state.fires.length === 0 && saved.cutTrees.length) persist();
    for (const s of state.smokes) s.ttl -= 1;
    state.smokes = state.smokes.filter((s) => s.ttl > 0);
  }

  function fallMeteors() {
    for (const m of state.meteors) {
      m.t += 1;
      if (m.t === 30) {
        // Удар: кратер, пожар вокруг, коты разбегаются.
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const x = m.x + dx;
            const y = m.y + dy;
            if (!inside(x, y)) continue;
            const t = tileAt(x, y);
            if (t >= T.SAND) {
              tiles[idx(x, y)] = T.SAND;
              saved.scars.push({ x, y, t: T.SAND });
              if (state.trees.has(idx(x, y))) state.fires.push({ x, y, ttl: 40 });
            }
            state.houses = state.houses.filter((h) => !(h.x === x && h.y === y));
            saved.houses = saved.houses.filter((h) => !(h.x === x && h.y === y));
          }
        }
        for (const c of state.cats) {
          if (Math.abs(c.x - m.x) <= 3 && Math.abs(c.y - m.y) <= 3) {
            c.tx = c.x + Math.sign(c.x - m.x || 1) * 4;
            c.ty = c.y + Math.sign(c.y - m.y || 1) * 3;
            c.wait = 0;
          }
        }
        const near = state.homes.find((h) => Math.abs(h.x - m.x) < 8 && Math.abs(h.y - m.y) < 6);
        chronicle("meteor", near ? near.race : null);
        bakeTerrain();
        countPop();
        persist();
      }
    }
    state.meteors = state.meteors.filter((m) => m.t < 34);
  }

  function ambient() {
    // Мелкие новости без последствий — чтобы летопись жила, даже когда бог спит.
    if (state.tick % 900 !== 450) return;
    const kinds = ["trade", "festival", "fishing", "forge", "song", "raid"];
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const a = Math.floor(Math.random() * 4);
    let b = Math.floor(Math.random() * 4);
    if (b === a) b = (a + 1) % 4;
    chronicle(kind, a, b);
  }

  /* ── Силы бога ────────────────────────────────────────────────────────── */

  function act(x, y) {
    if (!inside(x, y)) return;
    const t = tileAt(x, y);
    const i = idx(x, y);
    switch (state.power) {
      case "tree":
        if (t >= T.SAND && t <= T.HILL && !state.trees.has(i)) {
          state.trees.add(i);
          saved.trees.push(i);
          chronicle("tree");
          bakeTerrain();
          persist();
        }
        break;
      case "cat": {
        if (walkable(t) || (RACES[state.race].id === "gnome" && t === T.MOUNTAIN)) {
          const cat = { x, y, race: state.race, tx: x, ty: y, wait: 0, step: 0 };
          state.cats.push(cat);
          saved.cats.push({ x, y, race: state.race });
          chronicle("born", state.race);
          countPop();
          persist();
        }
        break;
      }
      case "house": {
        const race = RACES[state.race];
        const ok = race.id === "gnome" ? t === T.MOUNTAIN || t === T.HILL : walkable(t);
        if (ok && !state.houses.some((h) => h.x === x && h.y === y)) {
          state.houses.push({ x, y, race: state.race });
          saved.houses.push({ x, y, race: state.race });
          state.trees.delete(i);
          chronicle("house", state.race);
          bakeTerrain();
          countPop();
          persist();
        }
        break;
      }
      case "fire":
        if (state.trees.has(i) || state.houses.some((h) => h.x === x && h.y === y)) {
          state.fires.push({ x, y, ttl: 60 });
          state.houses = state.houses.filter((h) => !(h.x === x && h.y === y));
          saved.houses = saved.houses.filter((h) => !(h.x === x && h.y === y));
          chronicle("fire");
          bakeTerrain();
          countPop();
        }
        break;
      case "meteor":
        state.meteors.push({ x, y, t: 0 });
        break;
      default:
        break;
    }
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

  const shade = rng(seed + 99);
  const shadeMap = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i += 1) shadeMap[i] = Math.floor(shade() * 3);

  function px(c, x, y, w = 1, h = 1) {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, w, h);
  }
  function tpx(c, x, y, w = 1, h = 1) {
    tctx.fillStyle = c;
    tctx.fillRect(x, y, w, h);
  }

  function drawTree(g, x, y) {
    const bx = x * PX;
    const by = y * PX;
    g.fillStyle = "#3d6a2c";
    g.fillRect(bx + 1, by, 4, 4);
    g.fillStyle = "#2f5423";
    g.fillRect(bx + 2, by - 1, 2, 1);
    g.fillRect(bx, by + 1, 1, 2);
    g.fillRect(bx + 5, by + 1, 1, 2);
    g.fillStyle = "#4f8a38";
    g.fillRect(bx + 2, by + 1, 1, 1);
    g.fillStyle = "#5b3d22";
    g.fillRect(bx + 2, by + 4, 2, 2);
  }

  function drawHouse(g, h) {
    const race = RACES[h.race];
    const bx = h.x * PX;
    const by = h.y * PX;
    switch (race.id) {
      case "human":
        g.fillStyle = race.wall;
        g.fillRect(bx, by + 2, 6, 4);
        g.fillStyle = race.roof;
        g.fillRect(bx, by + 1, 6, 1);
        g.fillRect(bx + 1, by, 4, 1);
        g.fillStyle = "#5b3d22";
        g.fillRect(bx + 2, by + 4, 2, 2);
        g.fillStyle = "#8fc1dd";
        g.fillRect(bx + 4, by + 3, 1, 1);
        break;
      case "elf":
        // Дом на дереве: крона и площадка.
        g.fillStyle = "#3d6a2c";
        g.fillRect(bx, by, 6, 4);
        g.fillStyle = race.wall;
        g.fillRect(bx + 1, by + 1, 4, 2);
        g.fillStyle = race.roof;
        g.fillRect(bx + 1, by, 4, 1);
        g.fillStyle = "#e0a93b";
        g.fillRect(bx + 2, by + 2, 1, 1);
        g.fillStyle = "#5b3d22";
        g.fillRect(bx + 2, by + 4, 2, 2);
        break;
      case "orc":
        // Шатёр с шипами.
        g.fillStyle = race.wall;
        g.fillRect(bx, by + 2, 6, 4);
        g.fillStyle = race.roof;
        g.fillRect(bx + 1, by + 1, 4, 1);
        g.fillRect(bx + 2, by, 2, 1);
        g.fillStyle = "#e8e2cf";
        g.fillRect(bx, by + 1, 1, 1);
        g.fillRect(bx + 5, by + 1, 1, 1);
        g.fillStyle = "#3b2f2a";
        g.fillRect(bx + 2, by + 4, 2, 2);
        break;
      case "gnome":
        // Дверь в скале.
        g.fillStyle = race.wall;
        g.fillRect(bx, by + 1, 6, 5);
        g.fillStyle = race.roof;
        g.fillRect(bx + 1, by, 4, 1);
        g.fillStyle = "#3b2f2a";
        g.fillRect(bx + 2, by + 3, 2, 3);
        g.fillStyle = race.banner;
        g.fillRect(bx + 1, by + 2, 1, 1);
        g.fillRect(bx + 4, by + 2, 1, 1);
        break;
      default:
        break;
    }
  }

  function drawFlag(g, home) {
    const race = RACES[home.race];
    const bx = home.x * PX;
    const by = home.y * PX;
    g.fillStyle = "#3b2f2a";
    g.fillRect(bx + 2, by - 5, 1, 6);
    g.fillStyle = race.banner;
    g.fillRect(bx + 3, by - 5, 3, 3);
  }

  function bakeTerrain() {
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const i = idx(x, y);
        const t = tiles[i];
        tpx(TILE_COLOR[t][shadeMap[i]], x * PX, y * PX, PX, PX);
        // Берег: светлая кромка у воды рядом с сушей — остров читается сразу.
        if (t === T.WATER && (tileAt(x + 1, y) >= T.SAND || tileAt(x - 1, y) >= T.SAND || tileAt(x, y + 1) >= T.SAND || tileAt(x, y - 1) >= T.SAND)) {
          tpx("#8fc1dd", x * PX + 1, y * PX + 1, 1, 1);
        }
        if (t === T.MOUNTAIN && shadeMap[i] === 2) tpx("#5f5d58", x * PX + 1, y * PX + 2, 2, 1);
        if (t === T.SNOW && shadeMap[i] === 0) tpx("#cfd7dd", x * PX + 2, y * PX + 3, 1, 1);
        if (t === T.HILL && shadeMap[i] === 1) tpx("#8e7648", x * PX + 1, y * PX + 3, 2, 1);
      }
    }
    for (const i of state.trees) drawTree(tctx, i % W, (i / W) | 0);
    for (const h of state.houses) drawHouse(tctx, h);
    for (const home of state.homes) drawFlag(tctx, home);
  }

  function drawCat(c) {
    const race = RACES[c.race];
    const bx = c.x * PX + 1;
    const by = c.y * PX + 1;
    // Тело 4×3, уши углами, два глаза, хвост. Народ узнаётся по шкуре и убору.
    px(race.fur, bx, by + 1, 4, 3);
    px(race.fur, bx, by, 1, 1);
    px(race.fur, bx + 3, by, 1, 1);
    px("#141413", bx, by + 1, 1, 1);
    px("#141413", bx + 3, by + 1, 1, 1);
    px(race.dark, bx + 4, by + 2, 1, 1);
    switch (race.id) {
      case "human":
        px(race.hat, bx, by - 1, 4, 1);
        break;
      case "elf":
        px(race.dark, bx - 1, by, 1, 1);
        px(race.dark, bx + 4, by, 1, 1);
        px("#3d6a2c", bx + 1, by - 1, 2, 1);
        break;
      case "orc":
        px("#e8e2cf", bx, by + 3, 1, 1);
        px("#e8e2cf", bx + 3, by + 3, 1, 1);
        px(race.dark, bx + 1, by - 1, 1, 1);
        break;
      case "gnome":
        px(race.hat, bx + 1, by - 2, 2, 1);
        px(race.hat, bx, by - 1, 4, 1);
        px("#e8e2cf", bx + 1, by + 3, 2, 1);
        break;
      default:
        break;
    }
  }

  function drawFire(f) {
    const bx = f.x * PX;
    const by = f.y * PX;
    const flick = (state.tick + f.x * 3) % 6 < 3;
    px("#e0a93b", bx + 1, by + 1, 4, 4);
    px("#d9573b", bx + 1, by + (flick ? 0 : 1), 4, 1);
    px("#fff3a3", bx + 2, by + 3, 2, 1);
  }

  function drawSmoke(s) {
    const bx = s.x * PX + 1 + ((60 - s.ttl) >> 4);
    const by = s.y * PX - ((60 - s.ttl) >> 3);
    ctx.globalAlpha = s.ttl / 60;
    px("#9a9590", bx, by, 2, 2);
    ctx.globalAlpha = 1;
  }

  function drawMeteor(m) {
    const t = m.t / 30;
    const bx = m.x * PX + 2 + (1 - t) * 60;
    const by = m.y * PX + 2 - (1 - t) * 120;
    if (m.t < 30) {
      px("#d9573b", bx, by, 3, 3);
      px("#fff3a3", bx + 1, by + 1, 1, 1);
      ctx.globalAlpha = 0.5;
      px("#e0a93b", bx + 3, by - 3, 2, 2);
      px("#e0a93b", bx + 6, by - 6, 2, 2);
      ctx.globalAlpha = 1;
    } else {
      // Вспышка удара.
      const r = (m.t - 30) * 2 + 2;
      ctx.globalAlpha = 0.7 - (m.t - 30) * 0.15;
      px("#fff3a3", m.x * PX + 2 - r, m.y * PX + 2 - r, r * 2 + 1, r * 2 + 1);
      ctx.globalAlpha = 1;
    }
  }

  // Сутки — три минуты: ночь заметна, но не мешает играть.
  const DAY_TICKS = 30 * 180;
  function nightAlpha() {
    const phase = (state.tick % DAY_TICKS) / DAY_TICKS;
    // 0..1 → день, сумерки, ночь, рассвет. Плавно через косинус.
    return Math.max(0, -Math.cos(phase * Math.PI * 2)) * 0.45;
  }

  function frame() {
    ctx.drawImage(terrain, 0, 0);
    for (const s of state.smokes) drawSmoke(s);
    for (const c of state.cats) drawCat(c);
    for (const f of state.fires) drawFire(f);
    for (const m of state.meteors) drawMeteor(m);
    const night = nightAlpha();
    if (night > 0.01) {
      ctx.fillStyle = `rgba(16, 20, 48, ${night})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // Огни в окнах: дома светятся ночью. Так остров виден и в темноте.
      ctx.fillStyle = `rgba(255, 220, 130, ${night * 1.6})`;
      for (const h of state.houses) ctx.fillRect(h.x * PX + 2, h.y * PX + 3, 2, 1);
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
      state.tick += 1;
      moveCats();
      burn();
      fallMeteors();
      breed();
      ambient();
      frame();
    }
    raf = requestAnimationFrame(loop);
  }

  bakeTerrain();
  countPop();
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
    setPower(p) {
      state.power = p;
    },
    setRace(r) {
      state.race = r;
    },
    /** Клик по canvas в экранных координатах → клетка. */
    tapAt(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const x = Math.floor(((clientX - rect.left) / rect.width) * W);
      const y = Math.floor(((clientY - rect.top) / rect.height) * H);
      act(x, y);
    },
    reset() {
      localStorage.removeItem(storeKey);
    },
    get chronicle() {
      return state.chronicle;
    },
    get population() {
      return state.cats.length;
    },
  };
}
