/**
 * Очередь сообщений для streaming input режима Agent SDK.
 *
 * Смысл: `query({ prompt })` принимает AsyncIterable. Пока итератор не завершился,
 * сессия живёт и в неё можно доталкивать новые реплики пользователя. Так один
 * `query()` обслуживает весь диалог чата, а не по вызову на сообщение —
 * и `interrupt()` / `setPermissionMode()` остаются доступными.
 */
export class MessageQueue<T> implements AsyncIterable<T> {
  #buffer: T[] = [];
  #waiting: ((result: IteratorResult<T>) => void)[] = [];
  #closed = false;

  push(item: T): void {
    if (this.#closed) throw new Error("Очередь уже закрыта");
    const waiter = this.#waiting.shift();
    if (waiter) {
      waiter({ value: item, done: false });
    } else {
      this.#buffer.push(item);
    }
  }

  /** Завершает итератор — Agent SDK закроет сессию после текущего хода. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const waiter of this.#waiting.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  get closed(): boolean {
    return this.#closed;
  }

  get pending(): number {
    return this.#buffer.length;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      const buffered = this.#buffer.shift();
      if (buffered !== undefined) {
        yield buffered;
        continue;
      }
      if (this.#closed) return;
      const next = await new Promise<IteratorResult<T>>((resolve) => {
        this.#waiting.push(resolve);
      });
      if (next.done) return;
      yield next.value;
    }
  }
}
