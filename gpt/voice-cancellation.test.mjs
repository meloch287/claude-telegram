import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
const server = createServer((req, res) => {
  req.resume();
  res.writeHead(200, { "content-type": "application/json" });
  if (req.url === "/slow") res.write('{"text":"');
  else res.end(JSON.stringify({ text: "Проверочная расшифровка" }));
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
Object.assign(process.env, {
  BOT_TOKEN: "test",
  ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  WHISPER_URL: `http://127.0.0.1:${server.address().port}/ok`,
  WHISPER_TOKEN: "",
  WHISPER_MODEL: "test",
  WHISPER_FALLBACK_URL: "",
  WHISPER_VIA_PROXY: "",
  PROXY_POOL: "",
});
const { transcribe } = await import("../dist/bot/voice.js");
const { config } = await import("../dist/config.js");
test("transcription returns full text and stop aborts even a stalled response body", async () => {
  try {
    assert.equal(await transcribe(Buffer.from("fixture"), "voice.ogg"), "Проверочная расшифровка");
    config.whisperUrl = config.whisperUrl.replace("/ok", "/slow");
    await assert.rejects(transcribe(Buffer.from("fixture"), "voice.ogg", AbortSignal.timeout(30)));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
