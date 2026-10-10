/**
 * Пиксельные GPT-коты. Общий модуль: им пользуются и мини-апп, и скрипт
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
  mint: "#10A37F",
  blue: "#6A9BCC",
  green: "#788C5D",
};

/** Цвета нарядов. Живут отдельно от шкуры: кепка не меняет тон вместе с котом. */
const OUTFIT = {
  k: "#2B2A28", // чёрный: цилиндр, оправа
  r: "#10A37F", // красный: кепка, бабочка, лента
  y: "#E0A93B", // золото: корона, застёжка, искры
  p: "#8B79D6", // фиолетовый: колпак, плащ
  b: "#457E85", // коричневый: берет, шарф
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
/** Середина корпуса: нос и рот держатся её, а не считаются на глаз. */
const CENTRE = Math.floor((X0 + X1) / 2);

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
  4: ["...ppp....", "..pp......", "..pp......", "...ppp....", "bbbbbbbbbb"],
  5: ["..............", "....rrrrrr....", "...rrrrrrrr...", "rrrrrrrrrrrrrr", "r............r"],
  6: ["....y.y.y.....", ".....yyy......", "....yyyyy.....", ".....yyy......", "ssssssssssssss"],
  7: ["..............", "....kkkkkk....", "...kkkkkkkk...", "ssssssssssssss", "ssssssssssssss"],
  8: ["....w.....", "...www....", ".pp.w.pp..", "p..ppp..p.", ".ppppppp.."],
  9: ["..y.y.y...", ".y.y.y.y..", ".yyyyyyy..", ".yyykyyy..", ".yyyyyyy.."],
  10: [".......ppp", ".....pppp.", "...ppypp..", "..pppppp..", ".pppppppp."],
};

/** Шея и грудь: бабочка, шарф, ожерелье, плащ. Ставится поверх корпуса. */
const NECKWEAR = {
  3: { row: 13, art: ["..r..r..", "..rrrr..", "...rr..."] },
  4: { row: 13, art: ["bbbbbbbb", "b......b", "b......."] },
  // Цепочка сидит на строку ниже прочих украшений: на груди она смотрелась
  // ошейником, а не подвеской.
  8: { row: 14, art: ["y......y", ".y....y.", "..yyyy.."] },
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

  // Щёки двумя подушками по бокам и нос между ними. Раньше здесь была светлая
  // плита во всю ширину — она читалась как заплатка, а не как морда.

  rect(grid, X0 + 2, MUZZLE_ROW, X0 + 3, MUZZLE_ROW + 1, "w");
  rect(grid, X1 - 3, MUZZLE_ROW, X1 - 2, MUZZLE_ROW + 1, "w");
  rect(grid, CENTRE, MUZZLE_ROW - 1, CENTRE + 1, MUZZLE_ROW - 1, "i");

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

/**
 * Рот. Двумя слоями, как глаза: закрытый висит всегда, открытый показывается
 * несколькими кадрами за цикл. Подменять форму в одном слое нельзя — вышел бы
 * прыжок геометрии вместо движения.
 */
function buildMouth(open) {
  const grid = blankGrid();
  if (open) {
    rect(grid, CENTRE - 1, MUZZLE_ROW, CENTRE + 2, MUZZLE_ROW + 1, "i");
    rect(grid, CENTRE, MUZZLE_ROW + 1, CENTRE + 1, MUZZLE_ROW + 1, "w");
  } else {
    rect(grid, CENTRE - 1, MUZZLE_ROW + 1, CENTRE + 2, MUZZLE_ROW + 1, "i");
  }
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

/** A woven hexagonal GPT badge, distinct from the old radial star. */
export function gptMark(size) { return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22.418 9.822a5.903 5.903 0 0 0-.52-4.91 6.1 6.1 0 0 0-2.822-2.513 6.204 6.204 0 0 0-3.78-.389A6.055 6.055 0 0 0 13.232.518 6.129 6.129 0 0 0 10.726 0a6.185 6.185 0 0 0-3.615 1.153A6.052 6.052 0 0 0 4.88 4.187a6.102 6.102 0 0 0-2.344 1.018A6.008 6.008 0 0 0 .828 7.087a5.981 5.981 0 0 0 .754 7.09 5.904 5.904 0 0 0 .52 4.911 6.101 6.101 0 0 0 2.821 2.513 6.205 6.205 0 0 0 3.78.389 6.057 6.057 0 0 0 2.065 1.492 6.13 6.13 0 0 0 2.505.518 6.185 6.185 0 0 0 3.617-1.154 6.052 6.052 0 0 0 2.232-3.035 6.101 6.101 0 0 0 2.343-1.018 6.009 6.009 0 0 0 1.709-1.883 5.981 5.981 0 0 0-.756-7.088Zm-9.143 12.609a4.583 4.583 0 0 1-2.918-1.04c.037-.02.102-.056.144-.081l4.844-2.76a.783.783 0 0 0 .397-.68v-6.738L17.79 12.3a.072.072 0 0 1 .04.055v5.58a4.473 4.473 0 0 1-1.335 3.176 4.596 4.596 0 0 1-3.219 1.321Zm-9.793-4.127a4.432 4.432 0 0 1-.544-3.014c.036.021.099.06.144.085l4.843 2.76a.796.796 0 0 0 .795 0l5.913-3.369V17.1a.071.071 0 0 1-.029.062L9.708 19.95a4.617 4.617 0 0 1-3.458.447 4.556 4.556 0 0 1-2.768-2.093ZM2.208 7.872A4.527 4.527 0 0 1 4.58 5.9l-.002.164v5.52a.768.768 0 0 0 .397.68l5.913 3.369-2.047 1.166a.075.075 0 0 1-.069.006l-4.896-2.792a4.51 4.51 0 0 1-2.12-2.73 4.45 4.45 0 0 1 .452-3.411Zm16.818 3.861-5.913-3.368 2.047-1.166a.074.074 0 0 1 .07-.006l4.896 2.789a4.526 4.526 0 0 1 1.762 1.815 4.448 4.448 0 0 1-.418 4.808 4.556 4.556 0 0 1-2.049 1.494v-5.686a.767.767 0 0 0-.395-.68Zm2.038-3.025a6.874 6.874 0 0 0-.144-.085l-4.843-2.76a.797.797 0 0 0-.796 0L9.368 9.23V6.9a.072.072 0 0 1 .03-.062l4.895-2.787a4.608 4.608 0 0 1 4.885.207 4.51 4.51 0 0 1 1.599 1.955c.333.788.433 1.654.287 2.496ZM8.255 12.865 6.208 11.7a.071.071 0 0 1-.04-.056v-5.58c0-.854.248-1.69.713-2.412a4.54 4.54 0 0 1 1.913-1.658 4.614 4.614 0 0 1 4.85.616c-.037.02-.102.055-.144.08L8.657 5.452a.782.782 0 0 0-.398.68l-.004 6.734ZM9.367 10.5 12.001 9l2.633 1.5v3L12.001 15l-2.634-1.5v-3Z"></path></svg>`; }

/**
 * options.animated — разложить на живые слои. Само движение задаёт CSS
 * мини-аппа: держать кадры в разметке значило бы дублировать их в каждом коте.
 * Для README и для тех, кто просил меньше движения, слои остаются, но классов
 * анимации нет.
 */
export function catSvg(cat, size, options = {}) {
  const [fur, mark, ink] = cat.palette;
  const palette = { ...OUTFIT, ...(cat.id?.startsWith("claude-")?{r:"#B96A49",b:"#A48165"}:{}), f: fur, e: mark, m: mark, i: ink };

  const background = options.background
    ? `<rect width="${COLS}" height="${ROWS}" fill="${options.background}"/>`
    : "";

  const layer = (name, grid, extra = "") =>
    `<g class="cat-${name}"${extra}>${gridRects(grid, palette)}</g>`;

  const height = Math.round((size * ROWS) / COLS);
  const animated = options.animated ? " cat-animated" : "";

  const level = Math.max(1, Math.min(10, Number(cat.level) || 1));
  const motions = [
    "peek",
    "bounce",
    "sway",
    "stretch",
    "look",
    "proud",
    "step",
    "float",
    "royal",
    "spell",
  ];
  const motion = motions[level - 1];
  const timing = `--cat-duration:${(4.6 + level * 0.37).toFixed(2)}s;--cat-delay:-${(level * 0.83).toFixed(2)}s;--tail-duration:${(2.2 + level * 0.23).toFixed(2)}s;--blink-duration:${(3.7 + level * 0.41).toFixed(2)}s`;
  const layers = [
    background,
    layer("tail", buildTail(cat)),
    layer("body", buildBody(cat)),
    layer("eyes", buildEyes(true)),
    layer("eyes-shut", buildEyes(false)),
    layer("mouth", buildMouth(false)),
    layer("mouth-open", buildMouth(true)),
    layer("hat", buildHat(cat)),
  ].join("");

  return `
<svg viewBox="0 0 ${COLS} ${ROWS}" width="${size}" height="${height}"
     xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges"
     class="cat-sprite${animated} cat-motion-${motion}" style="${timing}" aria-hidden="true" focusable="false">${layers}</svg>`.trim();
}
