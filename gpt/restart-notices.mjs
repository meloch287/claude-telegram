export const RESTART_NOTICE =
  "♻️ Был передеплой, задача прервалась. Диалог и файлы сохранены.\n\nНажми «Продолжить» или открой /continue.";

export async function notifyRestarted(api, users, running, allowed, clear, checkpoint = () => null) {
  const statuses = new Map(running.map((task) => [task.chat_id, task.message_id]));
  for (const uid of new Set([...users, ...statuses.keys()])) {
    if (!allowed(uid)) {
      clear(uid);
      continue;
    }
    try {
      const task = checkpoint(uid);
      await api.sendMessage(uid, RESTART_NOTICE, task ? {reply_markup:{inline_keyboard:[[{text:"Продолжить",callback_data:"recover:"+task.id}]]}} : {});
      if (statuses.has(uid)) await api.deleteMessage(uid, statuses.get(uid)).catch(() => {});
      clear(uid);
    } catch {
      // Preserve the durable notice for the next startup if Telegram is unavailable.
      console.warn("Restart notice delivery failed");
    }
  }
}
