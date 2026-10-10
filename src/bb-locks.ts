/**
 * Claude-диалоги, которые прямо сейчас отвечают в рабочей зоне bb.
 *
 * Один диалог — одна история на диске. Пока bb ведёт ход, Telegram этот
 * диалог не поднимает, иначе два процесса писали бы в одну сессию.
 */
const held = new Map<string, () => Promise<void>>();
const key = (userId: number, sessionId: string) => `${userId}:${sessionId}`;

export function bbHolds(userId: number, sessionId: string | null | undefined): boolean {
  return !!sessionId && held.has(key(userId, sessionId));
}

/** Занять диалог. false — уже занят другим ходом из bb. */
export function bbAcquire(userId: number, sessionId: string, stop: () => Promise<void>): boolean {
  if (held.has(key(userId, sessionId))) return false;
  held.set(key(userId, sessionId), stop);
  return true;
}

export function bbRelease(userId: number, sessionId: string): void {
  held.delete(key(userId, sessionId));
}

export async function bbStop(userId: number, sessionId: string): Promise<boolean> {
  const stop = held.get(key(userId, sessionId));
  if (!stop) return false;
  await stop();
  return true;
}
