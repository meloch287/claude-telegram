/** Deadline includes reading the response body, not only response headers. */
export async function fetchJson(url, options = {}, timeoutMs = 12000) {
  const controller = new globalThis.AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (response.status === 401)
      throw new Error("Открой мини-апп заново из бота — Telegram-сессия истекла.");
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.error || `Ошибка сервера: ${response.status}`);
      error.code = result.code;
      throw error;
    }
    return result;
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error("Сервер не ответил за 12 секунд. Проверь соединение и нажми «Повторить».", {
        cause: error,
      });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
