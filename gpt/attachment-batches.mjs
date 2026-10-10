// Accept Telegram updates immediately; prepare all attachments before one GPT turn.
export function createAttachmentBatches({
  api,
  prepare,
  submit,
  allowed,
  track = () => {},
  quietMs = 4000,
  tickMs = 4000,
}) {
  const batches = new Map(),
    active = new Set();
  function clearTimers(b) {
    clearTimeout(b.timer);
    clearInterval(b.ticker);
  }
  function remove(b) {
    if (batches.get(b.key) === b) batches.delete(b.key);
  }
  function body(b) {
    const done = b.items.filter((i) => i.result).length;
    const seconds = Math.floor((Date.now() - b.started) / 1000);
    return `📥 Принято вложений: ${b.items.length}\n${b.stage || "Собираю файлы…"}\nГотово: ${done}/${b.items.length} · ${seconds} с\n${b.pending ? "Дождусь обработки всех вложений." : "Жду ещё 4 секунды после последнего вложения — затем передам всё GPT."}`;
  }
  async function render(b, finalText) {
    if (b.cancelled && !finalText) return;
    const message = await b.message;
    if (!message) return;
    if (!finalText && Date.now() - b.lastEdit < 1400) return;
    b.lastEdit = Date.now();
    await api.editMessageText(b.uid, message.message_id, finalText || body(b)).catch(() => {});
  }
  async function erase(b) {
    const message = await b.message;
    if (message) await api.deleteMessage(b.uid, message.message_id).catch(() => {});
  }
  function finish(b) {
    clearTimers(b);
    remove(b);
    active.delete(b);
    b.resolveDone();
  }
  function arm(b) {
    clearTimeout(b.timer);
    b.timer = setTimeout(() => void flush(b), Math.max(0, b.deadline - Date.now()));
    b.timer.unref?.();
  }
  async function flush(b) {
    if (b.cancelled || b.flushing || b.pending) return;
    if (Date.now() < b.deadline) {
      arm(b);
      return;
    }
    b.flushing = true;
    clearTimers(b);
    remove(b);
    try {
      if (!allowed(b.uid, b.thread.id)) return;
      const errors = b.items.filter((i) => i.error);
      if (errors.length) {
        await render(
          b,
          `⚠️ Не удалось подготовить ${errors.length} из ${b.items.length} вложений.\n${errors
            .map((i) => `${i.name}: ${i.error}`)
            .join("\n")
            .slice(
              0,
              1500,
            )}\n\nЗадача не запущена, чтобы не обработать неполный набор. Отправь вложения повторно.`,
        );
        return;
      }
      const prompt = [
        ...b.notes,
        ...b.items.map((i, index) => `Вложение ${index + 1} — ${i.name}:\n${typeof i.result === "string" ? i.result : i.result.text}`),
      ].join("\n\n");
      const images=b.items.flatMap(i=>typeof i.result === "object" ? i.result.images || [] : []);
      if (!b.cancelled) await submit(b.ctx, prompt, b.thread.id, b.controller.signal, images);
      await erase(b);
    } catch (error) {
      await render(
        b,
        `⚠️ Не удалось передать вложения GPT: ${String(error.message).slice(0, 400)}`,
      );
    } finally {
      finish(b);
    }
  }
  function add(ctx, thread, item, name) {
    const uid = ctx.from.id,
      key = `${uid}:${thread.id}`;
    let b = batches.get(key);
    if (!b) {
      let resolveDone;
      const done = new Promise((resolve) => {
        resolveDone = resolve;
      });
      b = {
        uid,
        key,
        ctx,
        thread,
        items: [],
        notes: [],
        pending: 0,
        started: Date.now(),
        lastEdit: 0,
        controller: new globalThis.AbortController(),
        pipeline: Promise.resolve(),
        resolveDone,
        done,
      };
      batches.set(key, b);
      active.add(b);
      track(uid, done);
      b.message = api
        .sendMessage(
          uid,
          "📥 Принимаю вложения…\nГолосовые расшифрую, затем передам весь набор GPT.",
        )
        .catch(() => null);
      b.ticker = setInterval(() => void render(b), tickMs);
      b.ticker.unref?.();
    }
    if (b.items.length >= 20)
      throw new Error("В одном наборе максимум 20 вложений. Дождись обработки этого набора.");
    const entry = { item, name };
    b.items.push(entry);
    b.pending++;
    b.deadline = Date.now() + quietMs;
    arm(b);
    b.pipeline = b.pipeline
      .then(async () => {
        if (b.cancelled || !allowed(uid, thread.id)) return;
        const progress = async (label) => {
          b.stage = label;
          await render(b);
        };
        try {
          entry.result = await prepare(
            ctx,
            thread,
            item,
            b.controller.signal,
            progress,
            b.items.indexOf(entry) + 1,
          );
        } catch (error) {
          if (!b.cancelled) entry.error = String(error.message).slice(0, 250);
        }
      })
      .catch((error) => {
        if (!b.cancelled) entry.error = String(error.message).slice(0, 250);
      })
      .finally(() => {
        b.pending--;
        if (!b.pending) b.stage = "✅ Вложения подготовлены";
        void flush(b);
      });
    // Every preparation failure is handled above; never reject the background chain.
    return true;
  }
  function addText(ctx, threadId, text) {
    const b = batches.get(`${ctx.from.id}:${threadId}`);
    if (!b) return false;
    b.notes.push(text);
    b.deadline = Date.now() + quietMs;
    arm(b);
    return true;
  }
  async function cancel(uid, ids) {
    const selected = [...active].filter(
      (b) => b.uid === uid && (!ids || ids.includes(b.thread.id)),
    );
    for (const b of selected) {
      b.cancelled = true;
      b.controller.abort();
      clearTimers(b);
      remove(b);
    }
    await Promise.all(
      selected.map(async (b) => {
        await b.pipeline;
        if (b.flushing) {
          await b.done;
          return;
        }
        await erase(b);
        finish(b);
      }),
    );
  }
  return { add, addText, cancel, users: () => [...new Set([...active].map((b) => b.uid))] };
}
