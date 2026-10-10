// Выключатель движков в рабочей зоне bb: у закрытого движка у человека (не админа)
// выключаются провайдеры bb — он пропадает из выбора, а отправка в его ветки
// отклоняется шлюзом с понятным текстом. При открытии возвращаем только то, что
// выключили сами (журнал в data/engine-web-ledger.json): если провайдер у человека
// был выключен и до этого, он так и останется выключенным.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { engineAccess, engineAllowed } from "../dist/engine-access.js";
import { isAdmin } from "../dist/admin.js";
import { config } from "../dist/config.js";

export const PROVIDERS = { gpt: ["codex"], claude: ["claude-code", "acp-tgclaude"] };
export const webClosedText = (engine) => `⛔ ${engine === "gpt" ? "GPT" : "Claude"} временно ограничен. Попробуй позже.`;

function fileLedger(path = join(config.dataDir, "engine-web-ledger.json")) {
  let data = {};
  try { data = JSON.parse(readFileSync(path, "utf8")) || {}; } catch { data = {}; }
  return {
    get: (uid) => new Set(data[uid] ?? []),
    set(uid, ids) {
      if (ids.size) data[uid] = [...ids]; else delete data[uid];
      const temp = `${path}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify(data), { mode: 0o600 });
      renameSync(temp, path);
    },
  };
}

export function createEngineWeb({ endpoint, request = fetch, access = engineAccess, ledger = fileLedger() }) {
  const applied = new Map(); // uid → отпечаток применённого состояния

  async function apply(uid) {
    if (isAdmin(uid)) return;
    const state = access();
    const stamp = `${state.gpt}|${state.claude}`;
    if (applied.get(uid) === stamp) return;
    const target = await endpoint(uid);
    if (!target) return;
    const listed = await request(`${target}/api/v1/system/providers`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!listed?.ok) return;
    const enabledNow = new Set((await listed.json()).map((p) => p.id));
    const ours = ledger.get(uid);
    let complete = true;
    for (const [engine, ids] of Object.entries(PROVIDERS)) {
      for (const id of ids) {
        const want = state[engine] ? (ours.has(id) ? true : null) : enabledNow.has(id) ? false : null;
        if (want === null) {
          // Мост acp-tgclaude появляется позже остальных: закрытый Claude проверим ещё раз.
          if (!state[engine] && !enabledNow.has(id) && !ours.has(id) && id === "acp-tgclaude") complete = false;
          continue;
        }
        const response = await request(`${target}/api/v1/system/providers/${id}/enabled`, {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: want }), signal: AbortSignal.timeout(8000),
        }).catch(() => null);
        if (!response?.ok) { complete = false; continue; }
        if (want) ours.delete(id); else ours.add(id);
      }
    }
    ledger.set(uid, ours);
    if (complete) applied.set(uid, stamp);
  }

  /** Проверка отправки в bb. claude: true/false — движок ветки, null — неизвестно (создание). */
  function assertTurn(uid, claude) {
    if (claude === true && !engineAllowed("claude", uid)) throw Error(webClosedText("claude"));
    if (claude === false && !engineAllowed("gpt", uid)) throw Error(webClosedText("gpt"));
    if (claude === null && !engineAllowed("claude", uid) && !engineAllowed("gpt", uid)) throw Error("⛔ GPT и Claude временно ограничены. Попробуй позже.");
  }

  return { apply, assertTurn };
}
