/**
 * Пиксельные Claude-коты. Общий модуль: им пользуются и мини-апп, и скрипт
 * scripts/render-cats.ts, который печатает SVG для README. Одна реализация —
 * значит картинки в документации не разъедутся с тем, что видит пользователь.
 *
 * Кот стоит в фас: квадратная голова, два уха углами, тёмные глаза, светлая
 * морда с открытым ртом, усы по бокам, четыре лапы снизу, хвост справа.
 * Заливка сплошная, без обводки — силуэт держится сам, за счёт крупной клетки.
 *
 * Сетка 24×20:
 *
 *   ряды 0–4     головной убор
 *   ряды 3–4     уши
 *   ряды 5–14    голова и корпус
 *   ряд  8       глаза
 *   ряд  10      усы
 *   ряды 11–12   морда и рот
 *   ряды 15–17   лапы
 *   колонки 19+  хвост
 *
 * Рисунок разложен по слоям — тело, глаза, хвост, убор — и каждый слой
 * выезжает отдельной группой. Иначе анимация не сделать: мигать должны только
 * глаза, а кепка съезжать независимо от корпуса.
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

/** Цвета нарядов. Живут отдельно от шкуры: кепка не меняет тон вместе с котом. */
const OUTFIT = {
  k: "#2B2A28", // чёрный: цилиндр, оправа
  r: "#B23A26", // красный: кепка, бабочка, лента
  y: "#E0A93B", // золото: корона, застёжка, искры
  p: "#6B4E9B", // фиолетовый: колпак, плащ
  b: "#7A5236", // коричневый: берет, шарф
  s: "#8C9BA8", // сталь: каска, визор
  w: "#FAF9F5", // крем: надпись на кепке, блики
};

export const COLS = 24;
export const ROWS = 20;

const EMPTY = ".";

// Раскладка. Всё остальное расставлено относительно этих чисел, а не вписано
// в спрайты руками, — иначе любая правка пропорций ломает половину деталей.
const X0 = 5;
const X1 = 18;
const HEAD_TOP = 5;
const BODY_BOTTOM = 14;
const EAR_TOP = 3;
const EYE_ROW = 8;
const WHISKER_ROW = 10;
const MUZZLE_ROW = 11;
const LEG_TOP = 15;

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
 * Головные уборы в фас. Нижний ряд спрайта ложится на макушку, поэтому убор
 * сидит на голове, а не висит над ней.
 *
 * У кепки на околыше четыре светлых клетки — та самая надпись с референса.
 */
const HATS = {
  2: ["....rrrrrr....", "...rrrrrrrr...", "...rwrwrwrw...", "rrrrrrrrrrrrrr", "rrrrrrrrrrrrrr"],
  3: ["..kkkkkk..", "..kkkkkk..", "..rrrrrr..", ".kkkkkkkk.", "kkkkkkkkkk"],
  4: ["....b.....", "..bbbbbb..", ".bbbbbbbb.", ".bbbbbbbb.", "..bbbbbb.."],
  5: ["..............", "....rrrrrr....", "...rrrrrrrr...", "rrrrrrrrrrrrrr", "r............r"],
  6: ["......ss......", "....ssssss....", "...ssssssss...", "ssssssssssssss", "ssssssssssssss"],
  7: ["..............", "....kkkkkk....", "...kkkkkkkk...", "ssssssssssssss", "ssssssssssssss"],
  8: ["..........", ".y.y.y.y..", ".yyyyyyy..", ".yyykyyy..", ".yyyyyyy.."],
  9: ["..y.y.y...", ".y.y.y.y..", ".yyyyyyy..", ".yyykyyy..", ".yyyyyyy.."],
  10: [".......ppp", ".....pppp.", "...ppypp..", "..pppppp..", ".pppppppp."],
};

/** Шея и грудь: бабочка, шарф, ожерелье, плащ. Ставится поверх корпуса. */
const NECKWEAR = {
  3: { row: 13, art: ["..r..r..", "..rrrr..", "...rr..."] },
  4: { row: 13, art: ["bbbbbbbb", "b......b", "b......."] },
  8: { row: 13, art: ["y......y", ".y....y.", "..yyyy.."] },
  9: { row: 13, art: ["pppppppppppp", "pppppppppppp"] },
  10: { row: 13, art: ["...yyyyyy...", "pppppppppppp", "pppppppppppp"] },
};

/**
 * Хвост. У младших опущен вниз, у старших поднят трубой — поднятый хвост
 * читается как «кот подрос». Рисуется отдельным слоем: он единственный
 * машет сам по себе.
 */
function drawTail(grid, level, fur) {
  // Крепление ниже усов и правее корпуса: выше оно перечеркнуло бы усы,
  // а вплотную к ногам — слилось бы с задней лапой в один ком.
  rect(grid, X1 + 1, BODY_BOTTOM - 1, X1 + 2, BODY_BOTTOM, fur);

  const stem = X1 + 3;
  if (level <= 2) {
    // Лежит поленом: уходит вправо по земле, мимо лап.
    rect(grid, stem, BODY_BOTTOM, stem + 2, BODY_BOTTOM + 1, fur);
    return;
  }
  // Поднят трубой; с восьмого уровня кончик загибается наружу.
  rect(grid, stem, EYE_ROW - 1, stem + 1, BODY_BOTTOM, fur);
  if (level >= 8) rect(grid, stem + 1, EYE_ROW - 2, stem + 2, EYE_ROW - 1, fur);
}

/** Искры вокруг — только у двух верхних уровней, как знак предела. */
function drawSparkles(grid, level) {
  if (level < 9) return;
  const spots =
    level === 9
      ? [
          [3, 6],
          [3, 14],
        ]
      : [
          [3, 5],
          [3, 14],
          [2, 17],
        ];
  for (const [x, y] of spots) {
    if (y < 1 || y > ROWS - 2 || x < 1 || x > COLS - 2) continue;
    grid[y][x] = "y";
    grid[y - 1][x] = "y";
    grid[y + 1][x] = "y";
    grid[y][x - 1] = "y";
    grid[y][x + 1] = "y";
  }
}

/** Голова, уши, морда, лапы — всё, что не мигает и не машет. */
function buildBody(cat) {
  const grid = blankGrid();

  // Уши углами, между ними провал.
  rect(grid, X0, EAR_TOP, X0 + 1, HEAD_TOP - 1, "f");
  rect(grid, X1 - 1, EAR_TOP, X1, HEAD_TOP - 1, "f");

  rect(grid, X0, HEAD_TOP, X1, BODY_BOTTOM, "f");

  // Тень по правому краю: без неё голова читается плоской наклейкой.
  rect(grid, X1, HEAD_TOP, X1, BODY_BOTTOM, "m");

  // Усы по обе стороны морды.
  for (const dy of [0, 2]) {
    rect(grid, X0 - 3, WHISKER_ROW + dy - 1, X0 - 1, WHISKER_ROW + dy - 1, "m");
    rect(grid, X1 + 1, WHISKER_ROW + dy - 1, X1 + 2, WHISKER_ROW + dy - 1, "m");
  }

  // Морда светлее шкуры, рот — тёмный прямоугольник, как на референсе.
  rect(grid, X0 + 2, MUZZLE_ROW, X1 - 2, MUZZLE_ROW + 1, "w");
  rect(grid, X0 + 4, MUZZLE_ROW + 1, X1 - 4, MUZZLE_ROW + 1, "i");
  rect(grid, X0 + 4, MUZZLE_ROW, X0 + 4, MUZZLE_ROW, "i");
  rect(grid, X1 - 4, MUZZLE_ROW, X1 - 4, MUZZLE_ROW, "i");

  // Лапы: четыре тумбы по две клетки. Просветы 1–2–1: средний шире, поэтому
  // видно переднюю и заднюю пары, а не забор из восьми палок. По клетке
  // корпуса остаётся слева и справа от крайних лап — иначе бока выглядят
  // срезанными ровно по ноге.
  for (const x of [X0 + 1, X0 + 4, X1 - 5, X1 - 2]) {
    rect(grid, x, LEG_TOP, x + 1, ROWS - 3, "f");
  }

  const neck = NECKWEAR[cat.level];
  if (neck) stamp(grid, neck.art, neck.row);

  drawSparkles(grid, cat.level);
  return grid;
}

function buildEyes(open) {
  const grid = blankGrid();
  if (open) {
    rect(grid, X0 + 2, EYE_ROW, X0 + 3, EYE_ROW + 1, "i");
    rect(grid, X1 - 3, EYE_ROW, X1 - 2, EYE_ROW + 1, "i");
  } else {
    // Закрытые глаза — одна полоска: так моргание читается даже на 76 пикселях.
    rect(grid, X0 + 2, EYE_ROW + 1, X0 + 3, EYE_ROW + 1, "i");
    rect(grid, X1 - 3, EYE_ROW + 1, X1 - 2, EYE_ROW + 1, "i");
  }
  return grid;
}

function buildTail(cat) {
  const grid = blankGrid();
  drawTail(grid, cat.level, "f");
  return grid;
}

function buildHat(cat) {
  const grid = blankGrid();
  const hat = HATS[cat.level];
  if (hat) stamp(grid, hat, EAR_TOP + 2 - hat.length);
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
      if (cell === "c")
        rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${color}"/>`);
    }),
  );
  return `<svg viewBox="0 0 7 7" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"
     shape-rendering="crispEdges" aria-hidden="true" focusable="false">${rects.join("")}</svg>`;
}

/**
 * options.animated — разложить на живые слои. Само движение задаёт CSS
 * мини-аппа: держать кадры в разметке значило бы дублировать их в каждом коте.
 * Для README и для тех, кто просил меньше движения, слои остаются, но классов
 * анимации нет.
 */
export function catSvg(cat, size, options = {}) {
  const [fur, mark, ink] = cat.palette;
  const palette = { ...OUTFIT, f: fur, e: mark, m: mark, i: ink };

  const background = options.background
    ? `<rect width="${COLS}" height="${ROWS}" fill="${options.background}"/>`
    : "";

  const layer = (name, grid, extra = "") =>
    `<g class="cat-${name}"${extra}>${gridRects(grid, palette)}</g>`;

  const height = Math.round((size * ROWS) / COLS);
  const animated = options.animated ? " cat-animated" : "";

  return `
<svg viewBox="0 0 ${COLS} ${ROWS}" width="${size}" height="${height}"
     xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges"
     class="cat-sprite${animated}" aria-hidden="true" focusable="false">${background}${layer(
       "tail",
       buildTail(cat),
     )}${layer("body", buildBody(cat))}${layer("eyes", buildEyes(true))}${layer(
       "eyes-shut",
       buildEyes(false),
     )}${layer("hat", buildHat(cat))}</svg>`.trim();
}
