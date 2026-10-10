import { QUOTA_RATES, POINT_SCALE, RATE_VERSION } from "./quota-rates.mjs";
import { effortsFor } from "./reasoning.mjs";
import { MODELS } from "./policy.mjs";
/* global navigator, window, document, history, location, innerWidth, innerHeight, structuredClone, getComputedStyle */
import { webkit } from "playwright-core";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve("src/miniapp/public");
await mkdir("output", { recursive: true });
const seed = [
  {
    id: 1057399602,
    name: "Алексей",
    owner: true,
    allowed: true,
    tokenLimit: null,
    tokensToday: 7400000,
    dialogs: 12,
    dialogLimit: null,
  },
  {
    id: 358890553,
    name: "Дарина Героева",
    owner: false,
    allowed: true,
    tokenLimit: 50000,
    tokensToday: 12480,
    dialogs: 3,
    dialogLimit: 5,
  },
  {
    id: 445821298,
    name: "Даниил",
    owner: false,
    allowed: true,
    tokenLimit: 100000,
    tokensToday: 2600,
    dialogs: 1,
    dialogLimit: 5,
  },
  {
    id: 844820548,
    name: "Михаил",
    owner: false,
    allowed: true,
    tokenLimit: null,
    tokensToday: 0,
    dialogs: 52,
    dialogLimit: 5,
  },
  {
    id: 978309662,
    name: "София",
    owner: false,
    allowed: false,
    tokenLimit: 10000,
    tokensToday: 10000,
    dialogs: 1,
    dialogLimit: 5,
  },
  {
    id: 482961058,
    name: "482961058",
    owner: false,
    allowed: true,
    tokenLimit: null,
    tokensToday: 0,
    dialogs: 0,
    dialogLimit: 5,
  },
];
const browser = await webkit.launch({ headless: true });
try {
  for (const [width, theme] of [
    [390, "light"],
    [390, "dark"],
    [320, "light"],
    [768, "dark"],
    [1280, "light"],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      deviceScaleFactor: 1,
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
        history.replaceState(null, "", location.pathname + "#" + p.toString());
      },
      { theme },
    );
    let users = structuredClone(seed),
      posts = [],
      failSave = false,
      failLoad = false,
      deleteFail = true,
      deletePosts = [];
    let selectedModel = "gpt-6-sol",
      selectedEffort = "medium";
    const settingsPosts = [];
    await context.route("https://admin-preview.test/**", async (route) => {
      const url = new URL(route.request().url()),
        path = url.pathname;
      if (path.startsWith("/api/")) {
        if (path.endsWith("/model")) {
          selectedModel = route.request().postDataJSON().model;
          if (selectedModel === "gpt-6-luna" && selectedEffort === "ultra")
            selectedEffort = "medium";
          return route.fulfill({ json: { ok: true } });
        }
        if (path.endsWith("/effort")) {
          const body = route.request().postDataJSON();
          selectedEffort = body.effort;
          settingsPosts.push(body);
          return route.fulfill({ json: { ok: true } });
        }

        if (path.endsWith("admin/accounting"))
          return route.fulfill({
            json: {
              subscription: {
                buckets: [
                  {
                    id: "codex",
                    plan: "pro",
                    name: "Codex",
                    primary: {
                      usedPercent: 3,
                      remainingPercent: 97,
                      windowDurationMins: 10080,
                      resetsAt: Date.now() + 86400000,
                    },
                    credits: { balance: "0", unlimited: false },
                  },
                ],
                fetchedAt: Date.now(),
                stale: false,
              },
              today: {
                units: 267683.2,
                cachePercent: 88.73,
                models: [
                  {
                    model: "gpt-6-sol",
                    input: 1000255,
                    cached: 887552,
                    output: 13245,
                    units: 267683.2,
                  },
                ],
              },
              week: { units: 1234567.89 },
              days: [],
              rates: QUOTA_RATES,
              scale: POINT_SCALE,
              version: RATE_VERSION,
              startedAt: Date.now(),
            },
          });
        if (path.endsWith("admin/users"))
          return route.fulfill({
            status: failLoad ? 503 : 200,
            json: failLoad ? { error: "Сервис недоступен. Повтори позже." } : { users },
          });
        if (path.endsWith("admin/user-delete")) {
          if (route.request().method() === "POST") {
            const body = route.request().postDataJSON();
            deletePosts.push(body);
            return route.fulfill({ status: 202, json: { ok: true, state: "pending" } });
          }
          if (!deleteFail) users = users.filter((u) => String(u.id) !== url.searchParams.get("id"));
          return route.fulfill({ json: { state: deleteFail ? "failed" : "complete" } });
        }
        if (path.endsWith("admin/user")) {
          const body = route.request().postDataJSON();
          posts.push(body);
          if (failSave)
            return route.fulfill({ status: 400, json: { error: "Не удалось сохранить лимит" } });
          const old = users.find((u) => u.id === body.id);
          if (old)
            Object.assign(old, {
              ...(body.note !== undefined ? { name: body.note } : {}),
              ...body,
            });
          else users.push({ owner: false, tokensToday: 0, dialogs: 0, ...body, name: body.note });
          return route.fulfill({ json: { ok: true } });
        }
        if (path.endsWith("admin/invite"))
          return route.fulfill({
            json: {
              url: "https://t.me/fixture_bot?start=invite_" + "a".repeat(32),
              expiresAt: Date.now() + 604800000,
            },
          });
        return route.fulfill({
          json: {
            chats: [],
            models: MODELS,
            model: selectedModel,
            efforts: effortsFor(selectedModel),
            effort: selectedEffort,
            mode: "auto",
            admin: true,
            quota: { dialogLimit: null },
          },
        });
      }
      const file = path === "/" ? "chats.html" : path.slice(1);
      assert.ok(!file.includes(".."));
      const body = await readFile(resolve(root, file));
      await route.fulfill({
        body,
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
    await page.goto("https://admin-preview.test/chats.html");
    assert.equal(await page.locator("#panel-chats").count(), 0);
    assert.equal(await page.locator('[role="tab"]').count(), 0);
    await page.waitForFunction(() => document.querySelectorAll(".user-row").length === 6);
    await page.waitForFunction(() => !document.querySelector("#panel-admin").hidden);
    assert.equal(await page.locator("#page-title").innerText(), "Админка");
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme);
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {})));
    });
    assert.equal(
      await page.locator("#panel-admin").evaluate((n) => getComputedStyle(n).opacity),
      "1",
    );
    await page.locator("#accounting .account-card").first().waitFor();
    assert.match(await page.locator("#accounting").innerText(), /97% осталось/);
    await page.screenshot({ path: `output/admin-${width}-${theme}.png`, fullPage: true });
    assert.equal(await page.locator('[role="tab"]').count(), 0);
    assert.equal(await page.locator("#stat-dialogs").count(), 0);
    assert.equal(await page.locator(".accounting-details").getAttribute("open"), null);
    assert.equal(await page.locator("#accounting-status").innerText(), "");
    const layout = await page.locator(".admin-overview").evaluate((box) => {
      const cells = [...box.children];
      return cells.every((cell) => {
        const r = cell.getBoundingClientRect();
        return (
          [...cell.children].every((el) => {
            const t = el.getBoundingClientRect();
            return (
              el.scrollWidth <= el.clientWidth + 1 && t.left >= r.left && t.right <= r.right + 1
            );
          }) &&
          cell.querySelector("dt").getBoundingClientRect().bottom <=
            cell.querySelector("dd").getBoundingClientRect().top
        );
      });
    });
    assert.equal(layout, true, "overview values fit without overlap");
    await page.locator("#invite-user").click();
    await page.locator("#invite-detail[open]").waitFor();
    assert.match(await page.locator("#invite-url").inputValue(), /start=invite_a{32}$/);
    await page.locator("#invite-detail").evaluate(async (node) => {
      await Promise.all(node.getAnimations().map((a) => a.finished.catch(() => {})));
    });
    assert.equal(
      await page.locator("#invite-detail").evaluate((n) => n.scrollWidth > n.clientWidth),
      false,
    );
    await page.screenshot({ path: `output/invite-${width}-${theme}.png` });
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => {
            throw new Error("denied");
          },
        },
      });
      window.Telegram.WebApp.openTelegramLink = (url) => {
        window.sharedInvite = url;
      };
    });
    await page.locator("#invite-copy").click();
    assert.match(await page.locator("#invite-status").innerText(), /вручную/);
    await page.locator("#invite-share").click();
    assert.equal(
      new URL(await page.evaluate(() => window.sharedInvite)).searchParams.get("url"),
      await page.locator("#invite-url").inputValue(),
    );
    await page.locator("#invite-close").click();
    await page.waitForFunction(() => !document.querySelector("#invite-detail").open);

    if (width === 390 && theme === "light") {
      await page.locator("#user-search").fill("Дарина");
      assert.equal(await page.locator(".user-row").count(), 1);
      await page.locator(".user-row").click();
      await page.locator("#user-detail[open]").waitFor();
      await page.locator("#user-detail").evaluate(async (node) => {
        await Promise.all(node.getAnimations().map((a) => a.finished.catch(() => {})));
      });
      await page.screenshot({ path: "output/admin-user-edit.png" });
      assert.equal(await page.locator("#user-id").getAttribute("readonly"), "");
      await page.locator("#user-name").fill("<script>literal name</script>");
      await page.locator("#user-percent").fill("25.5");
      await page.locator("#user-dialogs").fill("100");

      assert.equal(await page.locator("#user-dialogs").evaluate((el) => el.checkValidity()), true);
      failSave = true;
      await page.locator("#user-save").click();
      await page.locator("#user-form-status:not([hidden])").waitFor();
      assert.equal(await page.locator("#user-detail").getAttribute("open"), "");
      failSave = false;
      await page.locator("#user-save").click();
      await page.waitForFunction(() => !document.querySelector("#user-detail").open);
      assert.equal(posts.at(-1).percentLimit, 25.5);
      assert.equal("tokenLimit" in posts.at(-1), false);
      assert.equal(posts.at(-1).dialogLimit, 100);

      await page.locator("#user-search").fill("");
      assert.ok(
        (await page.locator("#users-list").innerText()).includes("<script>literal name</script>"),
      );
      await page.locator("#user-filter").selectOption("blocked");
      assert.equal(await page.locator(".user-row").count(), 1);
      await page.locator(".user-row").click();
      assert.equal(await page.locator("#user-save").innerText(), "Вернуть доступ");
      await page.locator("#user-close").click();
      await page.waitForFunction(() => !document.querySelector("#user-detail").open);
      await page.locator("#user-filter").selectOption("limited");
      assert.equal(await page.locator(".user-row").count(), 2);
      await page.locator("#user-filter").selectOption("all");
      await page.locator(".user-row").first().click();
      assert.equal(await page.locator("#user-dialogs").isDisabled(), true);
      assert.equal(await page.locator("#user-remove").isVisible(), false);
      await page.locator("#user-close").click();
      await page.waitForFunction(() => !document.querySelector("#user-detail").open);
      await page.locator("#user-search").fill("not-a-user");
      assert.equal(await page.locator(".empty-users").count(), 1);
      await page.locator("#user-search").fill("");
      await page.locator("#add-user").click();
      await page.locator("#user-id").fill("123456789");
      await page.locator("#user-name").fill("Новый пользователь");
      assert.equal(await page.locator("#user-dialogs").inputValue(), "5");
      await page.locator("#user-save").click();
      await page.waitForFunction(() => !document.querySelector("#user-detail").open);
      assert.equal(posts.at(-1).percentLimit, 10);
      assert.equal(posts.at(-1).dialogLimit, 5);
      failLoad = true;
      await page.locator("#accounting-refresh").click();
      await page.locator("#admin-retry:not([hidden])").waitFor();
      failLoad = false;
      await page.locator("#admin-retry").click();
      await page.waitForFunction(() => document.querySelector("#admin-retry").hidden);
      await page.emulateMedia({ reducedMotion: "reduce" });
      for (let i = 0; i < 2; i++) {
        await page.locator("#add-user").click();
        await page.locator("#user-close").click();
        await page.waitForFunction(() => !document.querySelector("#user-detail").open);
      }
      await page.locator("#user-search").fill("Алексей");
      await page.locator(".user-row").click();
      assert.equal(await page.locator("#user-delete-section").isVisible(), false);
      await page.locator("#user-close").click();
      await page.locator("#user-search").fill("София");
      await page.locator(".user-row").click();
      assert.equal(await page.locator("#user-delete").isVisible(), true);
      await page.locator("#user-delete").click();
      await page.locator("#user-delete-detail[open]").waitFor();
      await page.locator("#delete-confirmation").fill("97830966");
      assert.equal(await page.locator("#delete-submit").isDisabled(), true);
      assert.equal(deletePosts.length, 0);
      await page.locator("#delete-confirmation").fill("978309662");
      await page.screenshot({ path: "output/admin-delete-confirmation.png" });
      await page.locator("#delete-submit").click();
      await page.waitForFunction(
        () => document.querySelector("#delete-submit").textContent === "Повторить удаление",
      );
      assert.equal(deletePosts.length, 1);
      deleteFail = false;
      await page.locator("#delete-submit").click();
      await page.waitForFunction(() => !document.querySelector("#user-delete-detail").open);
      await page.waitForFunction(() => document.querySelectorAll(".user-row").length === 0);
      assert.deepEqual(deletePosts.at(-1), { id: 978309662, confirmation: "978309662" });
      console.log(
        "PASS full deletion confirmation, owner protection, disabled user, failure/retry and removal",
      );
      console.log(
        "PASS admin only, search, filters, access, invites, percentage caps and deletion",
      );
    } else {
      await page.locator(".user-row").nth(1).click();
      await page.locator("#user-detail[open]").waitFor();
      await page.locator("#user-detail").evaluate(async (node) => {
        await Promise.all(node.getAnimations().map((a) => a.finished.catch(() => {})));
      });
      assert.equal(await page.locator("#user-save").isVisible(), true);
      assert.ok(
        await page.evaluate(() => {
          const r = document.querySelector("#user-detail").getBoundingClientRect();
          return r.x >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
        }),
      );
      await page.screenshot({ path: `output/admin-form-${width}-${theme}.png` });
    }
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px ${theme}: real Telegram SDK, no overflow or JS errors`);
    await context.close();
  }
} finally {
  await browser.close();
}
