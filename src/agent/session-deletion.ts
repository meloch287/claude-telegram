export interface DeletionSession { sessionId: string; cwd: string }
export interface DeletionDependencies {
  info(userId: number, id: string): Promise<DeletionSession | null>;
  busy(userId: number): boolean;
  detach(userId: number, ids: string[]): Promise<void>;
  erase(userId: number, id: string): Promise<void>;
  refresh(userId: number): Promise<void>;
}
export function createSessionDeletion(deps: DeletionDependencies) {
  const pending = new Set<number>();
  return {
    busy: (uid: number) => pending.has(uid),
    async remove(uid: number, input: string[]) {
      if (!Number.isSafeInteger(uid) || uid <= 0) throw new Error("Недоступный профиль.");
      if (pending.has(uid)) throw new Error("Удаление уже выполняется. Подожди немного.");
      const ids = [...new Set(input)];
      if (!ids.length || ids.length > 100 || ids.some(id => !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))) throw new Error("Выбери чаты через /delete заново.");
      pending.add(uid);
      try {
        if (deps.busy(uid)) throw new Error("Дождись завершения задач Claude. Остановить основную задачу — /stop, фоновые — /bg.");
        for (const id of ids) if (!(await deps.info(uid, id))) throw new Error("Один из чатов уже недоступен. Открой /delete заново.");
        if (deps.busy(uid)) throw new Error("В Claude выполняется задача. Заверши её и повтори /delete.");
        await deps.detach(uid, ids);
        const deleted: string[] = [], failed: string[] = [];
        for (const id of ids) {
          try { await deps.erase(uid, id); deleted.push(id); }
          catch { failed.push(id); }
        }
        let mirrorUpdated = true;
        if (deleted.length) {
          try { await deps.refresh(uid); } catch { mirrorUpdated = false; }
        }
        return { deleted, failed, mirrorUpdated };
      } finally { pending.delete(uid); }
    },
  };
}
