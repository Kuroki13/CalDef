/**
 * Saving a session as it is typed, without losing or duplicating anything.
 *
 * At the gym the connection drops and people type fast. So:
 *
 * - Each set has at most ONE save waiting. Typing again replaces it — the
 *   latest value is the only one worth sending.
 * - Saves go out one at a time, in order. Two requests for the same set
 *   can never race and land in the wrong order.
 * - A save that fails stays queued and is retried; nothing is dropped.
 *   The status says so honestly ("not saved") until it gets through.
 * - A save that the server REFUSES (bad value) is not retried forever: it
 *   is dropped and reported, because sending it again cannot work.
 * - What is waiting is mirrored to storage, so a refresh or a closed tab
 *   while offline sends it on the next visit.
 *
 * Saving a set is "make it equal to this", so sending one twice is safe.
 *
 * No timers and no DOM in here: the sender, the storage and the listener
 * are injected, which is what lets the tests drive it exactly.
 */

export type SaveStatus = "saved" | "saving" | "unsaved";

export type SendResult =
  /** Stored. */
  | { ok: true }
  /** Did not get through — worth trying again. */
  | { ok: false; retry: true }
  /** The server said no — trying again cannot work. */
  | { ok: false; retry: false; error: string };

export type QueueStorage = {
  read(): string | null;
  write(value: string | null): void;
};

export type QueueState = {
  status: SaveStatus;
  /** How many saves are waiting or in flight. */
  pending: number;
  /** The last refusal, until the next successful save. */
  error: string | null;
};

export class SaveQueue<T> {
  private waiting = new Map<string, T>();
  private order: string[] = [];
  private inFlight: string | null = null;
  private failed = false;
  private error: string | null = null;
  private idle: (() => void)[] = [];

  constructor(
    private readonly send: (key: string, value: T) => Promise<SendResult>,
    private readonly storage: QueueStorage | null,
    private readonly onChange: (state: QueueState) => void,
  ) {
    this.restore();
  }

  get state(): QueueState {
    const pending = this.waiting.size + (this.inFlight !== null ? 1 : 0);
    return {
      status: pending === 0 ? "saved" : this.failed ? "unsaved" : "saving",
      pending,
      error: this.error,
    };
  }

  /** Queues `value` as the latest state of `key`, replacing any waiting one. */
  push(key: string, value: T): void {
    if (!this.waiting.has(key)) this.order.push(key);
    this.waiting.set(key, value);
    this.persist();
    this.emit();
    void this.drain();
  }

  /** Forgets anything waiting for these keys (the thing they save is gone). */
  discard(keys: readonly string[]): void {
    for (const key of keys) {
      if (this.waiting.delete(key)) {
        this.order = this.order.filter((k) => k !== key);
      }
    }
    this.persist();
    this.emit();
  }

  /** Tries again now — called when the connection returns, or by hand. */
  retry(): void {
    this.failed = false;
    this.emit();
    void this.drain();
  }

  /**
   * Resolves true once everything has been stored, false if a save failed
   * and is still waiting. Finishing a session waits on this.
   */
  async flush(): Promise<boolean> {
    this.failed = false;
    void this.drain();
    if (this.waiting.size === 0 && this.inFlight === null) return true;
    await new Promise<void>((resolve) => this.idle.push(resolve));
    return this.waiting.size === 0 && this.inFlight === null;
  }

  private async drain(): Promise<void> {
    if (this.inFlight !== null || this.failed) return;

    while (this.order.length > 0) {
      const key = this.order[0];
      const value = this.waiting.get(key) as T;
      this.order.shift();
      this.waiting.delete(key);
      this.inFlight = key;
      this.emit();

      let result: SendResult;
      try {
        result = await this.send(key, value);
      } catch {
        result = { ok: false, retry: true };
      }
      this.inFlight = null;

      if (result.ok) {
        this.error = null;
      } else if (result.retry) {
        // Put it back at the front — unless something newer for the same
        // key arrived meanwhile, which is the one to send instead.
        if (!this.waiting.has(key)) {
          this.waiting.set(key, value);
          this.order.unshift(key);
        }
        this.failed = true;
        this.persist();
        this.emit();
        this.settle();
        return;
      } else {
        this.error = result.error;
      }
      this.persist();
      this.emit();
    }
    this.settle();
  }

  private settle(): void {
    const waiters = this.idle;
    this.idle = [];
    for (const resolve of waiters) resolve();
  }

  private emit(): void {
    this.onChange(this.state);
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.write(
        this.order.length === 0
          ? null
          : JSON.stringify(this.order.map((key) => [key, this.waiting.get(key)])),
      );
    } catch {
      // Storage full or unavailable: the queue still works in memory.
    }
  }

  private restore(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.read();
      if (!raw) return;
      const entries: unknown = JSON.parse(raw);
      if (!Array.isArray(entries)) return;
      for (const entry of entries) {
        if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
        this.waiting.set(entry[0], entry[1] as T);
        this.order.push(entry[0]);
      }
    } catch {
      // Unreadable leftovers are not worth failing a session over.
    }
  }

  /** Sends whatever was restored from storage. Call once after mounting. */
  resume(): void {
    if (this.order.length > 0) {
      this.emit();
      void this.drain();
    }
  }
}
