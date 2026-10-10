import test from 'node:test';
import {createServer, request} from 'node:http';
import assert from 'node:assert/strict';
import {createWebAuth, WEB_COOKIE} from './web-auth.mjs';
import {createWebGateway, proxiedCacheControl} from './web-gateway.mjs';
const ASSET = '/api/v1/plugin-app-assets/0123456789abcdef/app.js';
test('only hashed plugin code marked immutable by bb is cached; everything else stays no-store', () => {
 const immutable = 'public, max-age=31536000, immutable';
 assert.equal(proxiedCacheControl(ASSET, 'GET', 200, immutable), 'private, max-age=31536000, immutable');
 assert.equal(proxiedCacheControl('/api/v1/plugin-app-assets/0123456789abcdef/app.css', 'HEAD', 200, immutable), 'private, max-age=31536000, immutable');
 assert.equal(proxiedCacheControl(ASSET, 'GET', 200, 'no-store'), 'no-store');
 assert.equal(proxiedCacheControl(ASSET, 'GET', 404, immutable), 'no-store');
 assert.equal(proxiedCacheControl(ASSET, 'POST', 200, immutable), 'no-store');
 assert.equal(proxiedCacheControl('/api/v1/plugin-app-assets/notahash/app.js', 'GET', 200, immutable), 'no-store');
 assert.equal(proxiedCacheControl('/api/v1/threads', 'GET', 200, 'public, max-age=3600'), 'no-store');
 assert.equal(proxiedCacheControl('/api/v1/threads', 'GET', 200, immutable), 'no-store');
});
test('gateway passes the long cache only for hashed plugin code', async () => {
 const upstream = createServer((req, res) => {
  if (req.url === ASSET) { res.writeHead(200, {'content-type': 'text/javascript', 'cache-control': 'public, max-age=31536000, immutable'}); return res.end('export{}'); }
  res.writeHead(200, {'content-type': 'application/json', 'cache-control': 'public, max-age=3600'}); res.end('{"secret":true}');
 });
 await new Promise(r => upstream.listen(0, '127.0.0.1', r));
 const allowed = () => true, auth = createWebAuth({domain: 'example.test', allowed}); auth.ensure(1);
 const host = 'u1.example.test', cookie = WEB_COOKIE + '=' + auth.redeem(auth.issue(1).split('#')[1], host);
 const gateway = createWebGateway({auth, allowed, runtime: {ensure: async () => `http://127.0.0.1:${upstream.address().port}`}});
 await new Promise(r => gateway.server.listen(0, '127.0.0.1', r));
 const get = path => new Promise((resolve, reject) => { const req = request(`http://127.0.0.1:${gateway.server.address().port}${path}`, {headers: {host, cookie, origin: 'https://' + host, 'sec-fetch-site': 'same-origin'}}, res => { res.resume(); res.on('end', () => resolve(res)); }); req.on('error', reject); req.end(); });
 try {
  const asset = await get(ASSET); assert.equal(asset.statusCode, 200); assert.equal(asset.headers['cache-control'], 'private, max-age=31536000, immutable');
  const data = await get('/api/v1/threads'); assert.equal(data.statusCode, 200); assert.equal(data.headers['cache-control'], 'no-store');
 } finally { gateway.server.closeAllConnections(); await new Promise(r => gateway.server.close(r)); upstream.close(); }
});
