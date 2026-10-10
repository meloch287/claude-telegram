// One editable card per task; trailing updates are delivered even after a burst stops.
export function createTaskProgress({
  api,
  uid,
  statusId,
  journal,
  model,
  keyboard,
  started = Date.now(),
  intervalMs = 2000,
}) {
  let closed = false,
    timer = null,
    inFlight = null,
    pending = null,
    lastBody = "",
    lastEdit = 0;
  const abort = new globalThis.AbortController();
  function schedule() {
    if (closed || timer || inFlight || pending === null) return;
    timer = setTimeout(
      () => {
        timer = null;
        const body = pending;
        pending = null;
        if (body === lastBody) return;
        lastEdit = Date.now();
        inFlight = Promise.resolve()
          .then(() =>
            api.editMessageText(
              uid,
              statusId,
              body,
              {
                parse_mode: "HTML",
                reply_markup: keyboard || { inline_keyboard: [] },
                link_preview_options: { is_disabled: true },
              },
              abort.signal,
            ),
          )
          .then(() => {
            lastBody = body;
          })
          .catch((error) => {
            if (String(error?.description || error?.message).includes("message is not modified")) {
              lastBody = body;
              return;
            }
            // Progress delivery must not abort the user's task. Retry the newest state.
            if (!closed && pending === null) pending = body;
          })
          .finally(() => {
            inFlight = null;
            schedule();
          });
      },
      Math.max(0, intervalMs - (Date.now() - lastEdit)),
    );
    timer.unref?.();
  }
  return {
    update() {
      if (closed) return;
      pending = journal.progress({ model, durationMs: Date.now() - started });
      schedule();
    },
    async close() {
      closed = true;
      pending = null;
      clearTimeout(timer);
      timer = null;
      abort.abort();
      await inFlight;
    },
  };
}
