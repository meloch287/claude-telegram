/**
 * Пиксельные Claude-коты. Общий модуль: им пользуются и мини-апп, и скрипт
 * scripts/render-cats.ts, который печатает SVG для README. Одна реализация —
 * значит картинки в документации не разъедутся с тем, что видит пользователь.
 *
 * Кот стоит в профиль: прямоугольный корпус, два уха вырезом сверху, светлые
 * глаза-прямоугольники, усы слева, хвост справа, четыре лапы снизу. Заливка
 * сплошная, без обводки — силуэт держится сам, за счёт крупной клетки.
 *
 * Сетка 22×20:
 *
 *   ряды 0–5     шляпа
 *   ряды 4–5     уши
 *   ряды 6–15    корпус: глаза, усы, шея
 *   ряды 12–15   шарф, бабочка, плащ
 *   ряды 16–17   лапы
 *   колонки 14+  хвост
 *
 * shape-rendering="crispEdges" не даёт браузеру размазать границы: это вектор,
 * который на любом масштабе остаётся резко пиксельным.
 */

export const BRAND = {
  slate: "#141413",
  cream: "#FAF9F5",
  clay: "#D97757",
  blue: "#6A9BCC",
  green: "#788C5D",
};

/** Цвета нарядов. Живут отдельно от шкуры: шляпа не должна менять тон вместе с котом. */
const OUTFIT = {
  k: "#2B2A28", // чёрный цилиндр, оправа
  r: "#B23A26", // красный: бабочка, лента
  y: "#E0A93B", // золото: корона, застёжка, искры
  p: "#6B4E9B", // фиолетовый: колпак, плащ
  b: "#7A5236", // коричневый: берет, шарф
  s: "#8C9BA8", // сталь: каска, визор
  w: "#FAF9F5", // крем: глаза, блики
};

export const COLS = 22;
export const ROWS = 20;

const EMPTY = ".";

// Раскладка. Всё остальное расставлено относительно этих чисел, а не вписано
// в спрайты руками, — иначе любая правка пропорций ломает половину деталей.
const X0 = 6;
const X1 = 13;
const BODY_TOP = 6;
const BODY_BOTTOM = 15;
const EAR_TOP = 4;
const EYE_ROW = 8;
const WHISKER_ROW = 8;
const LEG_TOP = 16;

function blankGrid() {
  return Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => EMPTY));
}

function rect(grid, x0, y0, x1, y1, ch) {
  for (let y = Math.max(0, y0); y <= Math.min(ROWS - 1, y1); y += 1) {
    for (let x = Math.max(0, x0); x <= Math.min(COLS - 1, x1); x += 1) {
      grid[y][x] = ch;
    }
  }
}

/** Ставит спрайт так, чтобы его центр совпал с центром головы. */
function stamp(grid, sprite, topRow, anchorX) {
  const width = Math.max(...sprite.map((row) => row.length));
  const ox = anchorX ?? Math.round((X0 + X1 + 1 - width) / 2);
  sprite.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      if (cell === EMPTY) return;
      const gy = topRow + y;
      const gx = ox + x;
      if (gy < 0 || gx < 0 || gy >= ROWS || gx >= COLS) return;
      grid[gy][gx] = cell;
    });
  });
}

/**
 * Головные уборы. Нижний ряд каждого спрайта ложится на уши, поэтому шляпа
 * сидит на голове, а не висит над ней.
 */
const HATS = {
  2: [
    // кепка козырьком влево
    "..........",
    "..........",
    "...kkkk...",
    "..kkkkkk..",
    "kkkkkkkk..",
  ],
  3: [
    // цилиндр с красной лентой — как на референсе
    "..kkkkkk..",
    "..kkkkkk..",
    "..rrrrrr..",
    "..kkkkkk..",
    ".kkkkkkkk.",
  ],
  4: [
    // берет со стебельком, завален влево
    "....b.....",
    "..bbbbb...",
    ".bbbbbbb..",
    ".bbbbbbbb.",
    "..bbbbbb..",
  ],
  5: [
    // бандана
    "..........",
    "..........",
    "..rrrrrr..",
    ".rrrrrrrr.",
    "rr......rr",
  ],
  6: [
    // каска с гребнем
    "..........",
    "....ss....",
    "..ssssss..",
    ".ssssssss.",
    "ssssssssss",
  ],
  7: [
    // визор
    "..........",
    "..........",
    "..kkkkkk..",
    ".ssssssss.",
    "ssssssss..",
  ],
  8: [
    // корона с камнем
    "..........",
    "..y.y.y.y.",
    "..yyyyyyy.",
    "..yyykyyy.",
    "..yyyyyyy.",
  ],
  9: [
    // корона повыше
    "...y.y.y..",
    "..y.y.y.y.",
    "..yyyyyyy.",
    "..yyykyyy.",
    "..yyyyyyy.",
  ],
  10: [
    // колпак волшебника с загнутым верхом и звёздами
    ".......ppp",
    ".....pppp.",
    "...ppypp..",
    "..pyppp...",
    ".pppppppp.",
  ],
};

/** Шея и грудь: шарф, бабочка, плащ. Ставится поверх корпуса. */
const NECKWEAR = {
  3: { row: 13, art: ["..r..r..", "..rrrr..", "..r..r.."] },   // бабочка
  4: { row: 13, art: ["bbbbbbbb", "bb......", "bb......"] },   // шарф с концом
  8: { row: 13, art: ["y......y", ".y....y.", "..yyyy..", "...y...."] }, // ожерелье
  9: { row: 13, art: ["ppppppppp", "ppppppppp", ".pppppppp"] },  // плащ
  10: { row: 13, art: ["..yyyy...", "ppppppppp", "ppppppppp", ".pppppppp"] },
};

/**
 * Хвост. У младших лежит поленом, у старших поднят трубой — на референсе
 * поднятый хвост и читается как «кот подрос».
 */
function drawTail(grid, level, fur) {
  if (level <= 2) {
    // лежит поленом у задней лапы
    rect(grid, X1 + 1, BODY_BOTTOM - 3, X1 + 4, BODY_BOTTOM - 1, fur);
    return;
  }
  // поднят трубой; с восьмого уровня загибается наружу
  rect(grid, X1 + 1, BODY_BOTTOM - 3, X1 + 2, BODY_BOTTOM - 1, fur);
  rect(grid, X1 + 2, EYE_ROW + 3, X1 + 3, BODY_BOTTOM - 2, fur);
  if (level >= 8) rect(grid, X1 + 3, EYE_ROW + 2, X1 + 4, EYE_ROW + 3, fur);
}

/** Искры вокруг — только у двух верхних уровней, как знак предела. */
function drawSparkles(grid, level) {
  if (level < 9) return;
  const spots = level === 9 ? [[3, 5], [18, 7]] : [[3, 4], [19, 6], [4, 15]];
  for (const [x, y] of spots) {
    if (y < 1 || y > ROWS - 2 || x < 1 || x > COLS - 2) continue;
    grid[y][x] = "y";
    grid[y - 1][x] = "y";
    grid[y + 1][x] = "y";
    grid[y][x - 1] = "y";
    grid[y][x + 1] = "y";
  }
}

/** Глаза светлые: на референсе это два ярких прямоугольника, а не тёмные точки. */
function drawEyes(grid, level, row) {
  rect(grid, X0 + 2, row, X0 + 2, row + 1, "w");
  rect(grid, X0 + 5, row, X0 + 5, row + 1, "w");
}

/**
 * Усы по обе стороны морды. Пар всего две, а не три: справа ниже начинается
 * хвост, и третья пара попала бы прямо под него — хвост рисуется поверх и
 * съел бы её.
 */
function drawWhiskers(grid, row) {
  for (const dy of [0, 2]) {
    rect(grid, X0 - 3, row + dy, X0 - 1, row + dy, "e");
    rect(grid, X1 + 1, row + dy, X1 + 3, row + dy, "e");
  }
}

function buildGrid(cat) {
  const grid = blankGrid();
  const level = cat.level;

  drawWhiskers(grid, WHISKER_ROW);
  drawTail(grid, level, "f");

  // Уши вырезом: два блока по углам, между ними провал в четыре клетки.
  rect(grid, X0, EAR_TOP, X0 + 1, BODY_TOP - 1, "f");
  rect(grid, X1 - 1, EAR_TOP, X1, BODY_TOP - 1, "f");
  rect(grid, X0, BODY_TOP, X1, BODY_BOTTOM, "f"); // корпус

  // Лапы: четыре тумбы с просветами.
  for (const x of [X0, X0 + 2, X1 - 2, X1]) {
    rect(grid, x, LEG_TOP, x, ROWS - 2, "f");
  }

  drawEyes(grid, level, EYE_ROW);

  const neck = NECKWEAR[level];
  if (neck) stamp(grid, neck.art, neck.row);

  const hat = HATS[level];
  if (hat) stamp(grid, hat, EAR_TOP + 2 - hat.length);

  drawSparkles(grid, level);

  return grid;
}

/** Клетки одного цвета в строке склеиваются в один <rect> — файл втрое короче. */
function gridRects(grid, palette) {
  const rects = [];
  for (let y = 0; y < ROWS; y += 1) {
    const row = grid[y];
    let x = 0;
    while (x < COLS) {
      const key = row[x];
      const fill = palette[key];
      if (!fill) {
        x += 1;
        continue;
      }
      let run = 1;
      while (x + run < COLS && row[x + run] === key) run += 1;
      rects.push(`<rect x="${x}" y="${y}" width="${run}" height="1" fill="${fill}"/>`);
      x += run;
    }
  }
  return rects.join("");
}

/** Пиксельная звезда Claude — для шапки README и украшений в интерфейсе. */
export function claudeStar(size, color = BRAND.clay) {
  const star = ["...c...", "c..c..c", ".c.c.c.", "ccccccc", ".c.c.c.", "c..c..c", "...c..."];
  const rects = [];
  star.forEach((row, y) =>
    [...row].forEach((cell, x) => {
      if (cell === "c") rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${color}"/>`);
    }),
  );
  return `<svg viewBox="0 0 7 7" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"
     shape-rendering="crispEdges" aria-hidden="true" focusable="false">${rects.join("")}</svg>`;
}

export function catSvg(cat, size, options = {}) {
  const [fur, mark, ink] = cat.palette;

  const palette = { ...OUTFIT, f: fur, e: mark, m: mark, i: ink };

  const background = options.background
    ? `<rect width="${COLS}" height="${ROWS}" fill="${options.background}"/>`
    : "";

  const height = Math.round((size * ROWS) / COLS);
  return `
<svg viewBox="0 0 ${COLS} ${ROWS}" width="${size}" height="${height}"
     xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges"
     aria-hidden="true" focusable="false">${background}${gridRects(buildGrid(cat), palette)}</svg>`.trim();
}
