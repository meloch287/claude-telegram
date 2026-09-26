/**
 * Сквозной тест мини-аппа в настоящем браузере: вкладка «Мой мир», камера,
 * жесты, инструменты, шторка настроек и облачная копия острова.
 *
 * Запуск: npm run test:e2e. Нужен Chromium для Playwright — один раз
 * `npx playwright-core install chromium` (или путь к своему в CHROME_PATH).
 * В `npm test` не входит: в образе автовыкатки браузера нет.
 *
 * Сервер поднимается прямо здесь: статика из src/miniapp/public и поддельное
 * API. Бот, токены и база не нужны.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices, type Browser, type BrowserContext, type Page } from "playwright-core";

/** Какой телефон изображаем: E2E_DEVICE="iPhone SE" проверит самый узкий экран. */
const PHONE = devices[process.env.E2E_DEVICE ?? "iPhone 12 Pro"]!;

const PUBLIC_DIR = resolve(fileURLToPath(new URL("../src/miniapp/public", import.meta.url)));
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

/** Облачная копия на поддельном сервере: ключ → { data, updatedAt }. */
const saves = new Map<string, { data: string; updatedAt: number }>();
let clock = 1000;
/** Что сервер отдал на последний GET — с этим мир и должен был создаться. */
let lastServed: Record<string, string> = {};
/** Что ждёт остров при следующем открытии: работа в боте, подарки, набеги. */
let pendingClaim: unknown = null;
/** Подарки и набеги, отправленные из рейтинга. */
const sent: { id: string; kind: string; amount: number }[] = [];
const NEIGHBOR = { id: "neighbor", name: "Остров Соседа" };
const worldSaveKey = () => [...saves.keys()].find((k) => k.startsWith("world:v"));

async function api(
  method: string,
  url: URL,
  body: string,
  authed: boolean,
): Promise<[number, unknown]> {
  if (url.pathname === "/api/profile") {
    if (!authed) return [401, { error: "invalid init data" }];
    return [200, JSON.parse(await readFile(resolve(PUBLIC_DIR, "demo-profile.json"), "utf8"))];
  }
  if (url.pathname === "/api/world-score") return [200, { ok: true }];
  if (url.pathname === "/api/world-top")
    return [
      200,
      {
        top: [
          { rank: 1, ...NEIGHBOR, visitable: true, score: 900, pop: 30, day: 9, era: 1, me: false },
          { rank: 2, id: "me", name: "Мой остров", score: 10, pop: 1, day: 1, era: 0, me: true },
        ],
        me: { rank: 2 },
      },
    ];
  if (url.pathname === "/api/world-claim") {
    const claim = pendingClaim ?? { work: {}, inbox: [] };
    pendingClaim = null;
    return [200, claim];
  }
  if (url.pathname === "/api/world-visit") {
    const key = worldSaveKey();
    if (url.searchParams.get("id") !== NEIGHBOR.id || !key) return [404, {}];
    const [, , seed, map] = key.split(":");
    return [200, { name: NEIGHBOR.name, seed: Number(seed), map, data: saves.get(key)!.data }];
  }
  if (url.pathname === "/api/world-send") {
    sent.push(JSON.parse(body) as (typeof sent)[number]);
    return [200, { ok: true }];
  }
  if (url.pathname !== "/api/world-save") return [404, {}];
  if (!authed) return [401, { error: "invalid init data" }];
  if (method === "GET") {
    const items = [...saves].map(([key, v]) => ({ key, ...v }));
    lastServed = Object.fromEntries(items.map((i) => [i.key, i.data]));
    return [200, { items }];
  }
  if (method === "PUT") {
    const { key, data } = JSON.parse(body) as { key: string; data: string };
    clock += 1;
    saves.set(key, { data, updatedAt: clock });
    return [200, { ok: true, updatedAt: clock }];
  }
  if (method === "DELETE") {
    saves.delete(url.searchParams.get("key") ?? "");
    return [200, { ok: true }];
  }
  return [405, {}];
}

function startServer(): Promise<{ server: Server; origin: string }> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    let body = "";
    for await (const chunk of req) body += chunk;
    if (url.pathname.startsWith("/api/")) {
      const [status, payload] = await api(
        req.method ?? "GET",
        url,
        body,
        typeof req.headers["x-telegram-init-data"] === "string",
      );
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(payload));
      return;
    }
    const relative = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
    const target = resolve(PUBLIC_DIR, normalize(relative));
    if (!target.startsWith(PUBLIC_DIR)) return void res.writeHead(403).end();
    try {
      const file = await readFile(target);
      res.writeHead(200, { "content-type": MIME[extname(target)] ?? "application/octet-stream" });
      res.end(file);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((ok) =>
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      ok({ server, origin: `http://127.0.0.1:${port}` });
    }),
  );
}

let server: Server;
let origin = "";
let browser: Browser;
let context: BrowserContext;
let page: Page;
const errors: string[] = [];

/** Подпись Telegram тут не проверяется — поддельному API хватает наличия. */
const TELEGRAM_HASH =
  "#tgWebAppData=" +
  encodeURIComponent("user=%7B%22id%22%3A1%7D&auth_date=1&hash=e2e") +
  "&tgWebAppVersion=7.0&tgWebAppPlatform=tdesktop";

/**
 * tsx собирает тест с keepNames и оборачивает вложенные функции в __name(...).
 * Колбэки page.evaluate уезжают в браузер как текст, а там __name нет.
 */
const KEEP_NAMES_SHIM = { content: "globalThis.__name = (fn) => fn;" };

before(async () => {
  ({ server, origin } = await startServer());
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  context = await browser.newContext({ ...PHONE, colorScheme: "dark" });
  await context.addInitScript(KEEP_NAMES_SHIM);
  page = await context.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("404")) errors.push(m.text());
  });
  await page.goto(`${origin}/?demo=1`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(1200);
  await page.click("#tab-city");
  await page.waitForTimeout(800);
});

after(async () => {
  await browser?.close();
  server?.close();
});

type Cam = { sw: number; sl: number; stp: number; vw: number; vh: number; label: string };
const cam = (): Promise<Cam> =>
  page.evaluate(() => {
    const st = document.getElementById("city-stage")!.getBoundingClientRect();
    const vp = document.getElementById("city-viewport")!.getBoundingClientRect();
    return {
      sw: st.width,
      sl: st.left - vp.left,
      stp: st.top - vp.top,
      vw: vp.width,
      vh: vp.height,
      label: document.getElementById("zoom-label")!.textContent ?? "",
    };
  });
const click = (id: string) => page.evaluate((id) => document.getElementById(id)!.click(), id);

/** Касание пальцем: pointerdown, серия move и pointerup по рамке карты. */
const drag = (dx: number, dy: number) =>
  page.evaluate(
    ({ dx, dy }) => {
      const vp = document.getElementById("city-viewport")!;
      const r = vp.getBoundingClientRect();
      const x0 = r.left + r.width / 2;
      const y0 = r.top + r.height / 2;
      const ev = (type: string, x: number, y: number) =>
        vp.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 7,
            pointerType: "touch",
            clientX: x,
            clientY: y,
            isPrimary: true,
          }),
        );
      ev("pointerdown", x0, y0);
      for (let i = 1; i <= 10; i++) ev("pointermove", x0 + (dx * i) / 10, y0 + (dy * i) / 10);
      ev("pointerup", x0 + dx, y0 + dy);
    },
    { dx, dy },
  );

/** Щипок двумя пальцами: расстояние от центра меняется с from на to. */
const pinch = (from: number, to: number) =>
  page.evaluate(
    ({ from, to }) => {
      const vp = document.getElementById("city-viewport")!;
      const r = vp.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const ev = (type: string, id: number, x: number, y: number) =>
        vp.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: id,
            pointerType: "touch",
            clientX: x,
            clientY: y,
          }),
        );
      ev("pointerdown", 1, cx - from, cy);
      ev("pointerdown", 2, cx + from, cy);
      for (let i = 1; i <= 10; i++) {
        const d = from + ((to - from) * i) / 10;
        ev("pointermove", 1, cx - d, cy);
        ev("pointermove", 2, cx + d, cy);
      }
      ev("pointerup", 1, cx - to, cy);
      ev("pointerup", 2, cx + to, cy);
    },
    { from, to },
  );

/** Мазок по карте; точки — доли ширины и высоты холста. */
const paint = (points: [number, number][]) =>
  page.evaluate((points) => {
    const vp = document.getElementById("city-viewport")!;
    const cv = document.getElementById("city-map")!.getBoundingClientRect();
    const ev = (type: string, [x, y]: number[]) =>
      vp.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 9,
          pointerType: "touch",
          clientX: x,
          clientY: y,
          isPrimary: true,
        }),
      );
    const px = points.map(([fx, fy]) => [cv.left + cv.width * fx, cv.top + cv.height * fy]);
    ev("pointerdown", px[0]!);
    for (const p of px.slice(1)) ev("pointermove", p);
    ev("pointerup", px.at(-1)!);
  }, points);

const population = () =>
  page.evaluate(
    () => (window as unknown as { __world: { population: number } }).__world.population,
  );

test("вкладка называется «Мой мир»", async () => {
  assert.equal((await page.textContent("#tab-city"))?.trim(), "Мой мир");
});

test("зум: мир растёт внутри неподвижной рамки и не сжимается меньше 1×", async () => {
  const c0 = await cam();
  assert.ok(Math.abs(c0.sl - 10) < 1 && Math.abs(c0.stp - 10) < 1, "на 1× запас 10px под границу");
  assert.ok(Math.abs(c0.sw - (c0.vw - 20)) < 1, "на 1× мир целиком в рамке");
  assert.ok(await page.isDisabled("#zoom-out"), "«−» выключена на 1×");

  await page.click("#zoom-in");
  await page.waitForTimeout(400);
  const c1 = await cam();
  assert.ok(c1.sw > c0.sw * 1.5, `«+» увеличивает мир (${c1.label})`);
  assert.ok(Math.abs(c1.vw - c0.vw) < 0.5 && Math.abs(c1.vh - c0.vh) < 0.5, "рамка неподвижна");

  await click("zoom-out");
  await page.waitForTimeout(400);
  assert.ok(Math.abs((await cam()).sw - c0.sw) < 1, "«−» возвращает к целому миру");
  await click("zoom-out");
  await page.waitForTimeout(300);
  assert.ok(Math.abs((await cam()).sw - c0.sw) < 1, "ниже 1× мир не сжимается");

  const vb = (await page.locator("#city-viewport").boundingBox())!;
  await page.mouse.move(vb.x + vb.width * 0.3, vb.y + vb.height * 0.4);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(200);
  assert.ok((await cam()).sw > c0.sw * 1.2, "колесо зумит");
});

test("рука тащит мир, камера упирается в границу", async () => {
  const before = await cam();
  await drag(-60, -40);
  await page.waitForTimeout(100);
  const moved = await cam();
  assert.ok(Math.abs(moved.sl - before.sl + 60) < 2, `по x: ${before.sl} → ${moved.sl}`);
  assert.ok(Math.abs(moved.stp - before.stp + 40) < 2, `по y: ${before.stp} → ${moved.stp}`);
  await drag(5000, 5000);
  await page.waitForTimeout(100);
  const edge = await cam();
  assert.ok(Math.abs(edge.sl - 10) < 1 && Math.abs(edge.stp - 10) < 1, `${edge.sl},${edge.stp}`);
});

test("щипок приближает и отдаляет до целого мира, подписи не растут", async () => {
  const full = (await cam()).vw - 20;
  const before = await cam();
  await pinch(30, 90);
  await page.waitForTimeout(100);
  const zoomed = await cam();
  assert.ok(zoomed.sw > before.sw * 2, `${before.label} → ${zoomed.label}`);
  await pinch(120, 10);
  await page.waitForTimeout(100);
  assert.ok(Math.abs((await cam()).sw - full) < 1);
  const inv = await page.evaluate(() =>
    getComputedStyle(document.getElementById("city-stage")!).getPropertyValue("--inv").trim(),
  );
  assert.equal(inv, "1");
});

test("мазок «Кот» селит котов и засчитывает первое задание", async () => {
  await page.click(".wb-cat >> nth=0");
  await page.click(".wb-tool >> nth=0");
  await paint([
    [0.3, 0.45],
    [0.35, 0.45],
    [0.4, 0.47],
    [0.45, 0.5],
    [0.5, 0.5],
    [0.55, 0.52],
  ]);
  await page.waitForTimeout(600);
  assert.ok((await population()) >= 5, `котов ${await population()}`);
  const count = (await page.textContent("#quest-count")) ?? "";
  assert.ok(parseInt(count, 10) >= 1, `задания: ${count}`);
});

test("касание рукой открывает карточку кота, «Следить» ведёт камеру", async () => {
  await page.click(".wb-cat >> nth=4");
  await page.click(".wb-tool >> nth=0");
  const cell = await page.evaluate(() => {
    const world = (
      window as unknown as { __world: { inspect(x: number, y: number): { kind: string } | null } }
    ).__world;
    const cv = document.getElementById("city-map")!.getBoundingClientRect();
    for (let y = 0; y < 66; y++)
      for (let x = 0; x < 84; x++)
        if (world.inspect(x, y)?.kind === "cat")
          return {
            x: cv.left + ((x + 0.5) / 84) * cv.width,
            y: cv.top + ((y + 0.5) / 66) * cv.height,
          };
    return null;
  });
  assert.ok(cell, "в мире есть кот для осмотра");
  await page.evaluate(({ x, y }) => {
    const vp = document.getElementById("city-viewport")!;
    const ev = (type: string) =>
      vp.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 11,
          pointerType: "touch",
          clientX: x,
          clientY: y,
          isPrimary: true,
        }),
      );
    ev("pointerdown");
    ev("pointerup");
  }, cell);
  await page.waitForTimeout(450);
  assert.equal(await page.isHidden("#wb-inspect"), false, "карточка открыта");
  assert.ok(((await page.textContent("#wb-inspect-title")) ?? "").length > 0, "у кота есть имя");

  await page.click("#wb-inspect-follow");
  await page.waitForTimeout(1500);
  assert.equal(await page.isHidden("#wb-follow"), false, "плашка слежения видна");
  assert.ok(parseFloat((await cam()).label) >= 3, "камера приблизилась к коту");
  await page.click("#wb-follow-stop");
  assert.ok(await page.isHidden("#wb-follow"), "слежение выключается");
});

test("двойное касание приближает", async () => {
  for (let i = 0; i < 3; i++) await click("zoom-out");
  await page.waitForTimeout(400);
  const before = await cam();
  await page.evaluate(() => {
    const vp = document.getElementById("city-viewport")!;
    const r = vp.getBoundingClientRect();
    const ev = (type: string) =>
      vp.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 12,
          pointerType: "touch",
          clientX: r.left + r.width / 2,
          clientY: r.top + r.height / 2,
          isPrimary: true,
        }),
      );
    ev("pointerdown");
    ev("pointerup");
    ev("pointerdown");
    ev("pointerup");
  });
  await page.waitForTimeout(450);
  assert.ok((await cam()).sw > before.sw * 1.8);
});

test("все инструменты применяются без исключений", async () => {
  const categories = await page.locator(".wb-cat").count();
  let applied = 0;
  for (let c = 0; c < categories; c++) {
    await page.click(`.wb-cat >> nth=${c}`);
    const tools = await page.locator(".wb-tool").count();
    for (let t = 0; t < tools; t++) {
      await page.click(`.wb-tool >> nth=${t}`);
      await paint([
        [0.62, 0.4],
        [0.64, 0.42],
      ]);
      applied++;
    }
  }
  await page.waitForTimeout(800);
  assert.ok(applied > 10, `применено ${applied}`);
  assert.deepEqual(errors, []);
});

test("шторка настроек: пауза, скорость, закрытие", async () => {
  const options = () =>
    page.evaluate(
      () =>
        (window as unknown as { __world: { options: { paused: boolean; speed: number } } }).__world
          .options,
    );
  await page.click("#wb-gear");
  await page.waitForTimeout(500);
  assert.ok(
    await page.evaluate(() =>
      document.getElementById("wb-settings")!.classList.contains("is-open"),
    ),
  );
  await page.click("label.toggle:has(#set-paused)");
  assert.equal((await options()).paused, true);
  await page.click("label.toggle:has(#set-paused)");
  await page.click("[data-speed='4']");
  assert.equal((await options()).speed, 4);
  await page.click("#set-close");
  await page.waitForTimeout(500);
  assert.ok(await page.isHidden("#wb-settings"));
});

test("мир анимируется, вкладка «Кот» после мира жива", async () => {
  const fps = await page.evaluate(
    () =>
      new Promise<number>((done) => {
        let frames = 0;
        const start = performance.now();
        const tick = (now: number) => {
          frames++;
          if (now - start < 2000) requestAnimationFrame(tick);
          else done(frames / 2);
        };
        requestAnimationFrame(tick);
      }),
  );
  assert.ok(fps >= 20, `${fps} кадр/с`);
  await page.click("#tab-cat");
  await page.waitForTimeout(400);
  assert.equal(await page.locator(".stat").count(), 5);
  assert.deepEqual(errors, []);
});

test("облачная копия: остров переезжает на новый телефон", async () => {
  // Телефон — отдельный контекст браузера со своим localStorage.
  const phone = async () => {
    const ctx = await browser.newContext({ ...PHONE, colorScheme: "dark" });
    await ctx.addInitScript(KEEP_NAMES_SHIM);
    // Запоминаем, что мир прочитал из localStorage при создании: так видно,
    // что копия легла туда раньше, чем мир вырос заново.
    await ctx.addInitScript(() => {
      const firstRead: Record<string, string | null> = {};
      (window as unknown as { __firstRead: typeof firstRead }).__firstRead = firstRead;
      const original = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key: string) {
        const value = original.call(this, key);
        if (key.startsWith("world:v") && !(key in firstRead)) firstRead[key] = value;
        return value;
      };
    });
    const tab = await ctx.newPage();
    tab.on("pageerror", (e) => errors.push(String(e)));
    await tab.goto(`${origin}/${TELEGRAM_HASH}`);
    await tab.waitForTimeout(1200);
    await tab.click("#tab-city");
    await tab.waitForTimeout(600);
    return { ctx, tab };
  };

  const old = await phone();
  await old.tab.click(".wb-cat >> nth=0");
  await old.tab.click(".wb-tool >> nth=0");
  await old.tab.evaluate(() => {
    const vp = document.getElementById("city-viewport")!;
    const cv = document.getElementById("city-map")!.getBoundingClientRect();
    const ev = (type: string, fx: number) =>
      vp.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 21,
          pointerType: "touch",
          clientX: cv.left + cv.width * fx,
          clientY: cv.top + cv.height * 0.48,
          isPrimary: true,
        }),
      );
    ev("pointerdown", 0.3);
    for (let f = 0.32; f < 0.56; f += 0.02) ev("pointermove", f);
    ev("pointerup", 0.56);
  });
  await old.tab.waitForTimeout(700);
  // Свернули мини-апп — копия уходит сразу, не дожидаясь таймера.
  await old.tab.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await old.tab.waitForTimeout(700);
  const worldKey = [...saves.keys()].find((k) => k.startsWith("world:v"));
  assert.ok(worldKey, `остров ушёл на сервер, ключи: ${[...saves.keys()].join(", ")}`);
  assert.ok(
    [...saves.keys()].some((k) => k.startsWith("world:quests:")),
    "задания тоже в копии",
  );
  const uploaded = JSON.parse(saves.get(worldKey)!.data) as { cats: unknown[] };
  assert.ok(uploaded.cats.length >= 5, `коты доехали до сервера: ${uploaded.cats.length}`);
  await old.ctx.close();

  const fresh = await phone();
  const read = await fresh.tab.evaluate(
    () => (window as unknown as { __firstRead: Record<string, string | null> }).__firstRead,
  );
  assert.ok(lastServed[worldKey], "сервер отдал остров новому телефону");
  assert.equal(read[worldKey], lastServed[worldKey], "мир создан из серверной копии");
  const restored = await fresh.tab.evaluate(
    () => (window as unknown as { __world: { population: number } }).__world.population,
  );
  assert.ok(restored >= 5, `остров восстановился целиком, котов ${restored}`);
  const count = (await fresh.tab.textContent("#quest-count")) ?? "";
  assert.ok(parseInt(count, 10) >= 1, `задания вернулись: ${count}`);

  // Очистка хранилища при открытом мини-аппе не должна стирать копию.
  await fresh.tab.evaluate(() => localStorage.clear());
  await fresh.tab.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await fresh.tab.waitForTimeout(700);
  assert.ok(saves.has(worldKey), "копия на сервере цела");
  assert.ok(
    [...saves.keys()].some((k) => k.startsWith("world:quests:")),
    "задания на сервере тоже целы",
  );
  await fresh.ctx.close();
  assert.deepEqual(errors, []);
});

/** Скриншот ключевого момента, если задана E2E_SHOTS=<папка>: смотреть глазами. */
const shot = async (tab: Page, name: string) => {
  if (process.env.E2E_SHOTS) await tab.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png` });
};

/** Телефон в режиме Telegram: подтверждения соглашаются сами, всплывашки пишутся в __popups. */
async function telegramPhone(path = "/") {
  const ctx = await browser.newContext({ ...PHONE, colorScheme: "dark" });
  await ctx.addInitScript(KEEP_NAMES_SHIM);
  const tab = await ctx.newPage();
  tab.on("pageerror", (e) => errors.push(String(e)));
  await tab.goto(`${origin}${path}${TELEGRAM_HASH}`);
  await tab.waitForTimeout(300);
  await tab.evaluate(() => {
    const w = window as unknown as {
      Telegram: { WebApp: Record<string, unknown> };
      __popups: string[];
    };
    w.__popups = [];
    w.Telegram.WebApp.showConfirm = (_q: string, cb: (ok: boolean) => void) => cb(true);
    w.Telegram.WebApp.showPopup = (p: { message: string }) => w.__popups.push(p.message);
  });
  await tab.waitForTimeout(1000);
  await tab.click("#tab-city");
  await tab.waitForTimeout(600);
  return { ctx, tab };
}

type WorldApi = {
  population: number;
  readonly: boolean;
  wonders: { id: string }[];
  apply(tool: { kind: string; race?: number }, x: number, y: number, size: number): void;
  endStroke(): void;
};
const worldOf = (tab: Page) =>
  tab.evaluate(() => {
    const w = (window as unknown as { __world: WorldApi }).__world;
    return { population: w.population, readonly: w.readonly, wonders: w.wonders.map((o) => o.id) };
  });

test("пока тебя не было: догон, награды за работу, чудо, подарок и пираты", async () => {
  const key = worldSaveKey();
  assert.ok(key, "остров из прошлого теста лежит на сервере");
  // Остров сохранён два часа назад — мир должен догнать это время.
  const snap = JSON.parse(saves.get(key)!.data) as { savedAt: number; lastVisit: number };
  snap.savedAt -= 2 * 3600_000;
  snap.lastVisit -= 2 * 3600_000;
  clock += 1;
  saves.set(key, { data: JSON.stringify(snap), updatedAt: clock });
  pendingClaim = {
    work: { tasks: 3, commits: 1, pushes: 1, totalCommits: 1 },
    inbox: [
      { kind: "gift", amount: 3, fromName: "Остров Друга", at: Date.now() },
      { kind: "raid", amount: 1, fromName: "Пиратская бухта", at: Date.now() },
    ],
  };
  const { ctx, tab } = await telegramPhone();
  await tab.waitForTimeout(500);
  assert.equal(await tab.isHidden("#wb-away"), false, "карточка «Пока тебя не было» открыта");
  const card = (await tab.textContent("#wb-away")) ?? "";
  assert.match(card, /Тебя не было 2 ч/);
  assert.match(card, /Дел в боте: 3/);
  assert.match(card, /Маяк/);
  assert.match(card, /Остров Друга/);
  assert.match(card, /Пиратская бухта/);
  await tab.locator("#wb-away").scrollIntoViewIfNeeded();
  await shot(tab, "away");
  assert.deepEqual((await worldOf(tab)).wonders, ["lighthouse"], "за первый коммит — маяк");
  assert.equal(pendingClaim, null, "награды забраны с сервера");
  await tab.click("#wb-away-ok");
  await tab.waitForTimeout(400);
  assert.ok(await tab.isHidden("#wb-away"), "карточка закрывается");
  // Свернули — остров с маяком уехал в копию, повторно награды не придут.
  await tab.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await tab.waitForTimeout(700);
  assert.match(saves.get(worldSaveKey()!)!.data, /lighthouse/);
  await ctx.close();
  assert.deepEqual(errors, []);
});

test("в гостях: чужой остров виден, но менять его нельзя", async () => {
  const { ctx, tab } = await telegramPhone(`/?visit=${NEIGHBOR.id}`);
  const own = await tab.evaluate(() =>
    Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.startsWith("world:v"))),
  );
  assert.equal((await tab.textContent("#hud-name"))?.trim(), NEIGHBOR.name);
  assert.equal(await tab.isVisible(".wb-visit"), true, "плашка «В гостях» видна");
  await shot(tab, "visit");
  assert.equal(await tab.isHidden(".wb-dock"), true, "инструментов нет");
  const before = await worldOf(tab);
  assert.equal(before.readonly, true);
  assert.ok(before.wonders.includes("lighthouse"), "видно чудо хозяина");
  await tab.evaluate(() => {
    const w = (window as unknown as { __world: WorldApi }).__world;
    for (let x = 20; x < 40; x++) w.apply({ kind: "cat", race: 0 }, x, 30, 0);
    w.apply({ kind: "nuke" }, 30, 30, 0);
    w.endStroke();
  });
  assert.equal((await worldOf(tab)).population, before.population, "инструменты молчат");
  await tab.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await tab.waitForTimeout(500);
  const after = await tab.evaluate(() =>
    Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.startsWith("world:v"))),
  );
  assert.deepEqual(after, own, "чужой остров не записался поверх своего");
  await tab.click(".wb-visit button");
  await tab.waitForTimeout(1500);
  assert.equal(new URL(tab.url()).search, "", "«Домой» возвращает на свой остров");
  await ctx.close();
  assert.deepEqual(errors, []);
});

test("рейтинг: в гости, подарок котов и пираты соседу", async () => {
  const { ctx, tab } = await telegramPhone();
  await tab.click("#wb-gear");
  await tab.waitForTimeout(800);
  const buttons = await tab.locator(".wb-top-actions button").count();
  assert.equal(buttons, 3, "у соседа три кнопки, у себя — ни одной");
  await tab.locator("#wb-top").scrollIntoViewIfNeeded();
  await shot(tab, "top");
  // Дарить можно, когда котов хотя бы шесть: заселяем остров.
  await tab.evaluate(() => {
    const w = (window as unknown as { __world: WorldApi }).__world;
    for (let y = 26; y < 40; y += 2)
      for (let x = 30; x < 50; x += 2) w.apply({ kind: "cat", race: 0 }, x, y, 0);
    w.endStroke();
  });
  const pop = (await worldOf(tab)).population;
  assert.ok(pop >= 6, `котов ${pop}`);
  await tab.click(".wb-top-actions button:has-text('🎁')");
  await tab.waitForTimeout(500);
  assert.deepEqual(sent.at(-1), { id: NEIGHBOR.id, kind: "gift", amount: 3 });
  assert.equal((await worldOf(tab)).population, pop - 3, "подаренные коты уплыли с острова");
  await tab.click(".wb-top-actions button:has-text('🏴‍☠️')");
  await tab.waitForTimeout(500);
  const popups = await tab.evaluate(() => (window as unknown as { __popups: string[] }).__popups);
  assert.ok(
    sent.at(-1)?.kind === "raid" || popups.some((m) => m.includes("Средневековья")),
    `пираты ушли или честно отказано до Средневековья: ${popups.join(" | ")}`,
  );
  await ctx.close();
  assert.deepEqual(errors, []);
});

test("цунами бьёт туда, куда нажали, и смывает берег", async () => {
  const hit = await page.evaluate(() => {
    const w = (
      window as unknown as {
        __world: WorldApi & { inspect(x: number, y: number): { name?: string } | null };
      }
    ).__world;
    const sea = (x: number, y: number) => /море|вода|Мелк/i.test(w.inspect(x, y)?.name ?? "");
    for (let x = 6; x < 60; x++)
      for (let y = 20; y < 46; y++)
        if (!sea(x, y) && [1, 2, 3, 4, 5, 6].every((d) => sea(x - d, y))) {
          for (let dy = -3; dy <= 3; dy++)
            for (let dx = 0; dx < 5; dx++)
              if (!sea(x + dx, y + dy)) w.apply({ kind: "cat", race: 0 }, x + dx, y + dy, 0);
          w.endStroke();
          return { x, y, pop: w.population };
        }
    return null;
  });
  assert.ok(hit, "нашёлся западный берег");
  await page.evaluate(({ x, y }) => {
    const w = (window as unknown as { __world: WorldApi }).__world;
    w.apply({ kind: "tsunami" }, x + 1, y, 0);
    w.apply({ kind: "tsunami" }, x + 3, y + 3, 0); // протяжка не перезапускает волну
    w.endStroke();
  }, hit);
  await page.waitForTimeout(3500);
  const after = await page.evaluate(
    () => (window as unknown as { __world: WorldApi }).__world.population,
  );
  assert.ok(after < hit.pop, `волна смыла котов у берега: ${hit.pop} → ${after}`);
  assert.deepEqual(errors, []);
});
