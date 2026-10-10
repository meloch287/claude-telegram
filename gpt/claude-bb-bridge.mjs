// Вход моста Claude для контейнера bb: http://172.30.0.1:8790/claude-bb/...
// Контейнер предъявляет токен личной команды ИИ (как ai-team.py); uid берём только
// из токена и передаём ходы в ai-bot по его локальному сокету. Ответ хода — поток NDJSON.
import { request } from "node:http";

const SOCKET = process.env.CLAUDE_BB_SOCKET || "/opt/ai-bot/data/claude-bb.sock";
const ROUTE = /^\/claude-bb\/(?:(new)|([0-9a-f-]{36})\/(check|turn|cancel))$/;

export function createClaudeBridgeHandler({ identify, socket = SOCKET }) {
  return async (req, res) => {
    const fail = (status, error) => {
      if (res.headersSent) return res.end();
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ error }));
    };
    const match = ROUTE.exec(req.url || "");
    if (!match) return fail(404, "Неизвестный адрес");
    if (req.method !== "POST") return fail(405, "Нужен POST");
    const uid = await identify(req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]);
    if (!uid) return fail(401, "Нет доступа");
    const path = `/v1/${uid}/` + (match[1] ? "new" : `${match[2]}/${match[3]}`);
    const upstream = request({ socketPath: socket, path, method: "POST", headers: { "content-type": "application/json" } }, (answer) => {
      res.writeHead(answer.statusCode || 502, {
        "content-type": answer.headers["content-type"] || "application/json",
        "cache-control": "no-store",
      });
      answer.pipe(res);
    });
    upstream.on("error", () => fail(503, "Claude бота сейчас недоступен. Повтори через минуту."));
    // Человек закрыл bb или отменил ход — обрываем и ход в боте.
    res.once("close", () => { if (!res.writableFinished) upstream.destroy(); });
    let size = 0;
    req.on("data", (chunk) => { size += chunk.length; if (size > 512000) { upstream.destroy(); fail(413, "Слишком длинное сообщение"); } });
    req.pipe(upstream);
  };
}
