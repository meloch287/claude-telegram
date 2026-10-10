/* global window, document, location, history, getComputedStyle, innerWidth */
import { webkit } from "playwright-core";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve("src/miniapp/public");
await mkdir("output", { recursive: true });
const browser = await webkit.launch({ headless: true });
try {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      colorScheme: theme,
    });
    await context.addInitScript(
      ({ theme }) => {
        window.TelegramWebviewProxy = { postEvent() {} };
        const signed = new URLSearchParams({
          user: JSON.stringify({ id: 1057399602 }),
          auth_date: "1",
          hash: "fixture",
        }).toString();
        const p = new URLSearchParams({
          tgWebAppData: signed,
          tgWebAppVersion: "8.0",
          tgWebAppPlatform: "ios",
          tgWebAppThemeParams: JSON.stringify(
            theme === "dark"
              ? { bg_color: "#14171c", text_color: "#e5e8ee" }
              : { bg_color: "#ffffff", text_color: "#20242b" },
          ),
        });
        if (!location.hash)
          history.replaceState(null, "", location.pathname + location.search + "#" + p);
      },
      { theme },
    );
    await context.route("https://cats-preview.test/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let body;
      if (path.startsWith("/api/")) {
        let data = { ok: true };
        if (path === "/api/gpt/quota")
          data = {
            mode: "weighted",
            subscription: {
              used: 4,
              limit: 10,
              remaining: 6,
              percent: 40,
              exceeded: false,
              resetsAt: 1791580519000,
              startedAt: Date.now(),
              measured: true,
              pending: false,
            },
            daily: {
              used: 123.5,
              limit: 1000000,
              percent: 0.01235,
              remaining: 999876.5,
              resetsAt: Date.now() + 86400000,
            },
            weekly: { used: 123.5, limit: null, resetsAt: Date.now() + 604800000 },
            exceeded: false,
          };
        if (path === "/api/profile") {
          data = JSON.parse(await readFile(resolve(root, "demo-profile.json"), "utf8"));
          data.capabilities = { management: true };
        }
        if (path === "/api/world-save") data = { items: [] };
        if (path === "/api/world-claim") data = { work: {}, inbox: [] };
        if (path === "/api/world-top") data = { top: [], me: null };
        if (path === "/api/gpt/chats")
          data = {
            chats: [],
            models: [["gpt-6-sol", "Sol"]],
            model: "gpt-6-sol",
            mode: "auto",
            admin: true,
            quota: { dialogLimit: null },
          };
        if (path === "/api/gpt/admin/users") data = { users: [] };
        return route.fulfill({ json: data });
      }
      const file = path === "/" ? "index.html" : path.slice(1);
      body = await readFile(resolve(root, file));
      return route.fulfill({
        body,
        contentType: file.endsWith(".html")
          ? "text/html"
          : file.endsWith(".css")
            ? "text/css"
            : file.endsWith(".json")
              ? "application/json"
              : "text/javascript",
      });
    });
    let page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("https://cats-preview.test/chats.html");
    await page.waitForFunction(() => !document.documentElement.hasAttribute("data-boot"));
    await page.locator('a[data-section="cats"]').click();
    await page.locator("#app:not([hidden])").waitFor();
    assert.equal(await page.locator(".cat-gpt-badge").count(), 0);
    await page.locator("#personal-quota:not([hidden])").waitFor();
    assert.match(await page.locator("#personal-quota").innerText(), /Мой лимит/);
    assert.match(await page.locator("#personal-quota").innerText(), /123,5/);
    assert.match(await page.locator("#personal-quota").innerText(), /4% из 10%/);
    assert.equal(
      await page.locator("#personal-quota progress").first().getAttribute("value"),
      "40",
    );
    await page.waitForFunction(() => !document.documentElement.hasAttribute("data-boot"));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `output/cats-${theme}.png`, fullPage: true });
    await page.locator("#personal-quota").screenshot({ path: `output/percent17-${theme}.png` });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.close();
    page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("https://cats-preview.test/chats.html");
    await page.locator("#app:not([hidden])").waitFor();
    assert.equal(await page.locator("#tab-cat").getAttribute("aria-selected"), "true");
    assert.ok(new URL(page.url()).pathname === "/");
    await page.locator('a[data-section="admin"]').click();
    await page.waitForFunction(() => !document.documentElement.hasAttribute("data-boot"));
    await page.waitForFunction(() => !document.querySelector("#panel-admin").hidden);
    await page.reload();
    await page.waitForFunction(() => !document.querySelector("#panel-admin").hidden);
    await page.locator('a[data-section="cats"]').click();
    await page.locator("#app:not([hidden])").waitFor();
    await page.locator("#tab-city").click();
    await page.goto("https://cats-preview.test/chats.html");
    await page.locator("#app:not([hidden])").waitFor();
    assert.equal(await page.locator("#tab-city").getAttribute("aria-selected"), "true");
    await page.locator("#tab-cat").click();
    // A review sheet shows all ten animation variants at once, using production SVG and CSS.
    await page.evaluate(async () => {
      const { catSvg } = await import("/cat-art.js");
      const fixture = await (await fetch("/demo-profile.json")).json();
      const sheet = document.createElement("div");
      sheet.id = "motion-review";
      sheet.style =
        "position:relative;display:grid;grid-template-columns:repeat(2,1fr);gap:28px;padding:24px;background:var(--bg);";
      for (const cat of fixture.cats) {
        const card = document.createElement("div");
        card.innerHTML = catSvg(cat, 118, { animated: true }) + `<p>${cat.level}. ${cat.name}</p>`;
        sheet.append(card);
      }
      document.body.replaceChildren(sheet);
    });
    const variants = await page.locator(".cat-animated").evaluateAll((nodes) =>
      nodes.map((n) => ({
        name: getComputedStyle(n).animationName,
        duration: getComputedStyle(n).animationDuration,
        delay: getComputedStyle(n).animationDelay,
      })),
    );
    assert.equal(new Set(variants.map((v) => v.name)).size, 10);
    assert.equal(new Set(variants.map((v) => v.duration)).size, 10);
    const start = await page
      .locator(".cat-animated")
      .evaluateAll((nodes) => nodes.map((n) => getComputedStyle(n).transform));
    await page.screenshot({ path: `output/cats-motion-${theme}-1.png`, fullPage: true });
    await page.waitForTimeout(1100);
    const end = await page
      .locator(".cat-animated")
      .evaluateAll((nodes) => nodes.map((n) => getComputedStyle(n).transform));
    assert.ok(start.filter((v, i) => v !== end[i]).length >= 7);
    await page.screenshot({ path: `output/cats-motion-${theme}-2.png`, fullPage: true });
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await page
        .locator(".cat-animated")
        .evaluateAll((nodes) => nodes.every((n) => getComputedStyle(n).animationName === "none")),
      true,
    );
    assert.deepEqual(errors, []);
    console.log(
      `PASS ${theme}: cats reopen after closing, explicit return/admin, world restore, 10 distinct motions, no badge, reduced motion, no overflow/errors`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
