/* global window, document, location, history, localStorage, getComputedStyle */
import { webkit } from "playwright-core";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve("src/miniapp/public");
const browser = await webkit.launch({ headless: true });
try {
  for (const section of ["cats", "world", "admin"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript((section) => {
      window.TelegramWebviewProxy = { postEvent() {} };
      localStorage.setItem("gpt:last-section:1057399602", section);
      const init = new URLSearchParams({
        user: JSON.stringify({ id: 1057399602 }),
        auth_date: "1",
        hash: "fixture",
      });
      if (!location.hash)
        history.replaceState(
          null,
          "",
          location.pathname +
            location.search +
            "#" +
            new URLSearchParams({
              tgWebAppData: init.toString(),
              tgWebAppVersion: "8.0",
              tgWebAppPlatform: "ios",
            }),
        );
      window.wrongFrames = [];
      const frame = () => {
        const content = document.querySelector(".page-content");
        if (
          content &&
          getComputedStyle(content).visibility === "visible" &&
          Number(getComputedStyle(content).opacity) > 0
        ) {
          if (["cats", "world"].includes(section) && location.pathname === "/chats.html")
            window.wrongFrames.push("management");
          if (
            section === "admin" &&
            location.pathname === "/chats.html" &&
            !!document.querySelector("#panel-chats") &&
            !document.querySelector("#panel-chats").hidden
          )
            window.wrongFrames.push("dialogs");
        }
        window.requestAnimationFrame(frame);
      };
      window.requestAnimationFrame(frame);
    }, section);
    let managementRequests = 0;
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    await context.route("https://startup.test/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith("/api/")) {
        let data = { ok: true };
        if (path === "/api/gpt/chats") {
          managementRequests++;
          await gate;
          data = {
            chats: [],
            models: [["gpt-6-sol", "Sol"]],
            model: "gpt-6-sol",
            mode: "auto",
            admin: true,
            quota: { dialogLimit: null },
          };
        }
        if (path === "/api/gpt/admin/users") {
          managementRequests++;
          await gate;
          data = { users: [] };
        }
        if (path === "/api/profile")
          data = {
            ...JSON.parse(await readFile(resolve(root, "demo-profile.json"), "utf8")),
            capabilities: { management: true },
          };
        if (path === "/api/world-save") data = { items: [] };
        if (path === "/api/world-claim") data = { work: {}, inbox: [] };
        if (path === "/api/world-top") data = { top: [], me: null };
        return route.fulfill({ json: data });
      }
      const file = path === "/" ? "index.html" : path.slice(1);
      return route.fulfill({
        body: await readFile(resolve(root, file)),
        contentType: file.endsWith(".html")
          ? "text/html"
          : file.endsWith(".css")
            ? "text/css"
            : file.endsWith(".json")
              ? "application/json"
              : "text/javascript",
      });
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("https://startup.test/chats.html");
    if (section === "admin") {
      assert.equal(
        await page.locator(".page-content").evaluate((el) => getComputedStyle(el).visibility),
        "hidden",
      );
      assert.equal(await page.locator(".page-loader").isVisible(), true);
      release();
      await page.waitForFunction(() => !document.documentElement.hasAttribute("data-boot"));
      assert.equal(await page.locator("#panel-admin").isVisible(), true);
    } else {
      release();
      await page.locator("#app:not([hidden])").waitFor();
      assert.equal(new URL(page.url()).pathname, "/");
      assert.equal(managementRequests, 0);
      assert.equal(
        await page
          .locator(section === "cats" ? "#tab-cat" : "#tab-city")
          .getAttribute("aria-selected"),
        "true",
      );
    }
    await page.waitForFunction(
      () => getComputedStyle(document.querySelector(".page-content")).opacity === "1",
    );
    assert.deepEqual(await page.evaluate(() => window.wrongFrames), []);
    assert.deepEqual(errors, []);
    console.log(
      `PASS startup ${section}: no wrong section frames, saved section restored, loader fades to ready content`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
