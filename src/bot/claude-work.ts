// Includes downloads and voice transcription before an SDK session becomes busy.
const pending = new Map<number, number>();
export const hasClaudeWork = (uid: number) => (pending.get(uid) ?? 0) > 0;
export function beginClaudeWork(uid: number): () => void {
  pending.set(uid, (pending.get(uid) ?? 0) + 1);
  return () => {
    const left = (pending.get(uid) ?? 1) - 1;
    if (left) pending.set(uid, left); else pending.delete(uid);
  };
}
