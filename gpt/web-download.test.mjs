// «Скачать» файл из рабочей зоны bb: вложением, только свой, без выхода за пределы зоны.
import test from "node:test";
import { request } from "node:http";
import assert from "node:assert/strict";
import { createWebAuth, WEB_COOKIE } from "./web-auth.mjs";
import { createWebGateway, workspaceRelative } from "./web-gateway.mjs";

test("скачивание: вложением, своей сессией, путь только внутри зоны", async () => {
  const allowed = () => true, reads = [];
  const auth = createWebAuth({ domain: "example.test", allowed });
  auth.ensure(1); auth.ensure(2);
  const host = "u1.example.test", cookie = WEB_COOKIE + "=" + auth.redeem(auth.issue(1).split("#")[1], host);
  const gateway = createWebGateway({ auth, allowed, runtime: { ensure: async () => "http://127.0.0.1:1" }, usage: async () => ({}),
    readFile: async (uid, rel) => { reads.push([uid, rel]); if (rel.endsWith("нет.txt")) throw Error("нет"); return Buffer.from("<h1>ОК</h1>"); } });
  await new Promise((r) => gateway.server.listen(0, "127.0.0.1", r));
  const get = (path, headers = {}) => new Promise((resolve, reject) => {
    const req = request(`http://127.0.0.1:${gateway.server.address().port}${path}`, { headers: { host, ...headers } }, (res) => { const c = []; res.on("data", (x) => c.push(x)); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c).toString() })); });
    req.on("error", reject); req.end();
  });
  const q = (p) => "/__web/download?path=" + encodeURIComponent(p);
  try {
    // переход по ссылке — обычный GET без Origin
    const ok = await get(q("Файлы Claude/plan (2).html"), { cookie });
    assert.equal(ok.status, 200);
    assert.equal(ok.body, "<h1>ОК</h1>");
    assert.match(ok.headers["content-disposition"], /^attachment; .*filename\*=UTF-8''plan%20\(2\)\.html$/);
    assert.equal(ok.headers["content-type"], "application/octet-stream");
    assert.deepEqual(reads, [[1, "Файлы Claude/plan (2).html"]], "читаем зону своего пользователя");
    assert.equal((await get(q("Файлы Claude/plan.html"))).status, 401, "без входа — нет");
    assert.equal((await get(q("x"), { cookie, host: "u2.example.test" })).status, 401, "чужая сессия — нет");
    for (const bad of ["../../etc/passwd", "/etc/passwd", "/app/workspaces/2/x", "a//b"]) assert.equal((await get(q(bad), { cookie })).status, 400, bad);
    assert.equal((await get(q("нет.txt"), { cookie })).status, 404);
    assert.equal(reads.length, 2);
  } finally { gateway.server.closeAllConnections(); await new Promise((r) => gateway.server.close(r)); }
});

test("путь из ссылки чата (/app/workspaces/<uid>/…) понимается", () => {
  assert.equal(workspaceRelative(7, "/app/workspaces/7/Файлы Claude/a.html"), "Файлы Claude/a.html");
  assert.equal(workspaceRelative(7, "Файлы Claude/a.html"), "Файлы Claude/a.html");
});
