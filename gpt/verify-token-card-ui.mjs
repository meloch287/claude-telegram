/* global window, document, history, location, innerWidth */
import { webkit } from "playwright-core";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve("src/miniapp/public");
await mkdir("output", { recursive: true });
const browser = await webkit.launch({ headless: true });
try {
  for (const width of [320, 390, 430, 768])
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width, height: 844 },
        colorScheme: theme,
      });
      await context.addInitScript(
        ({ theme }) => {
          window.TelegramWebviewProxy = { postEvent() {} };
          const p = new URLSearchParams({
            tgWebAppData: "test",
            tgWebAppVersion: "8.0",
            tgWebAppPlatform: "ios",
            tgWebAppThemeParams: JSON.stringify(
              theme === "dark"
                ? { bg_color: "#14171c", text_color: "#e5e8ee" }
                : { bg_color: "#ffffff", text_color: "#20242b" },
            ),
          });
          history.replaceState(null, "", location.pathname + "#" + p);
        },
        { theme },
      );
      await context.route("https://tokens-preview.test/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.startsWith("/api/")) {
          const data = JSON.parse(await readFile(resolve(root, "demo-profile.json"), "utf8"));
          data.bot = { ...data.bot, tokens: 14437799 };
          data.today = { tokens: 1632006, unverifiedTokens: 111758 };
          data.capabilities = { management: true };
          return route.fulfill({ json: data });
        }
        const file = path === "/" ? "index.html" : path.slice(1);
        return route.fulfill({
          body: await readFile(resolve(root, file)),
          contentType: file.endsWith(".html")
            ? "text/html"
            : file.endsWith(".css")
              ? "text/css"
              : "text/javascript",
        });
      });
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto("https://tokens-preview.test/");
      await page.locator("#app:not([hidden])").waitFor();
      await page.waitForTimeout(1000);
      const boxes = await page.locator(".stat--wide").evaluate((card) => {
        const rect = (el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        };
        return {
          card: rect(card),
          items: [...card.children].map(rect),
          overflow: document.documentElement.scrollWidth > innerWidth,
          clipped: [...card.querySelectorAll("*")].some((n) => n.scrollWidth > n.clientWidth + 1),
        };
      });
      assert.equal(boxes.overflow, false);
      assert.equal(boxes.clipped, false, `clipped content at ${width}/${theme}`);
      for (const a of boxes.items) {
        assert.ok(a.left >= boxes.card.left && a.right <= boxes.card.right);
        for (const b of boxes.items)
          if (a !== b)
            assert.ok(
              a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top,
              `overlap at ${width}/${theme}`,
            );
      }
      assert.deepEqual(errors, []);
      await page
        .locator(".stat--wide")
        .screenshot({ path: `output/token-card-${width}-${theme}.png` });
      console.log(`PASS token card ${width}/${theme}`);
      await context.close();
    }
} finally {
  await browser.close();
}
