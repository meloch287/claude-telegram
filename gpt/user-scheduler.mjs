// One active task per tenant. Other tenants do not wait for it.
export function createUserScheduler({ queue, run, canRun, stopping, onError }) {
  const active = new Map();
  function start(uid) {
    if (active.has(uid) || stopping() || !canRun(uid)) return;
    const slot = { job: null, done: null };
    active.set(uid, slot);
    slot.done = Promise.resolve()
      .then(async () => {
        while (!stopping() && canRun(uid)) {
          const index = queue.findIndex((j) => j.uid === uid);
          if (index < 0) break;
          const [job] = queue.splice(index, 1);
          slot.job = job;
          try {
            await run(job);
          } catch (error) {
            await Promise.resolve()
              .then(() => onError(job, error))
              .catch(() => {});
          } finally {
            slot.job = null;
          }
        }
      })
      .finally(() => {
        active.delete(uid);
        if (queue.some((j) => j.uid === uid)) start(uid);
      });
  }
  return {
    has: (uid) => active.has(uid),
    users: () => [...active.keys()],
    job: (uid) => active.get(uid)?.job,
    cancel(uid) {
      const job = active.get(uid)?.job;
      if (job) job.cancelled = true;
    },
    wake() {
      for (const uid of new Set(queue.map((j) => j.uid))) start(uid);
    },
    async wait(uid) {
      await Promise.allSettled(
        uid === undefined ? [...active.values()].map((s) => s.done) : [active.get(uid)?.done],
      );
    },
  };
}
