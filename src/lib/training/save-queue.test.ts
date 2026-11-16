import { describe, expect, it, vi } from "vitest";

import {
  SaveQueue,
  type QueueState,
  type QueueStorage,
  type SendResult,
} from "@/lib/training/save-queue";

function memoryStorage(initial: string | null = null): QueueStorage & { value: string | null } {
  const box = {
    value: initial,
    read: () => box.value,
    write: (v: string | null) => { box.value = v; },
  };
  return box;
}

/** A sender whose every call waits until the test resolves it. */
function manualSender() {
  const calls: { key: string; value: unknown; resolve: (r: SendResult) => void }[] = [];
  const send = vi.fn(
    (key: string, value: unknown) =>
      new Promise<SendResult>((resolve) => calls.push({ key, value, resolve })),
  );
  return { send, calls };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("SaveQueue", () => {
  it("sends a save and reports saved once it lands", async () => {
    const { send, calls } = manualSender();
    const states: QueueState[] = [];
    const queue = new SaveQueue(send, null, (s) => states.push(s));

    queue.push("set:1", { reps: 8 });
    expect(queue.state.status).toBe("saving");
    calls[0].resolve({ ok: true });
    await tick();

    expect(queue.state).toEqual({ status: "saved", pending: 0, error: null });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps only the latest value for a set typed several times", async () => {
    const { send, calls } = manualSender();
    const queue = new SaveQueue(send, null, () => {});

    queue.push("set:1", { reps: 1 });   // goes out immediately
    queue.push("set:1", { reps: 12 });  // waits
    queue.push("set:1", { reps: 10 });  // replaces the one waiting
    calls[0].resolve({ ok: true });
    await tick();
    calls[1].resolve({ ok: true });
    await tick();

    expect(send.mock.calls.map((c) => c[1])).toEqual([{ reps: 1 }, { reps: 10 }]);
  });

  it("never has two saves in flight, so they cannot land out of order", async () => {
    const { send, calls } = manualSender();
    const queue = new SaveQueue(send, null, () => {});

    queue.push("set:1", 1);
    queue.push("set:2", 2);
    expect(send).toHaveBeenCalledTimes(1);
    calls[0].resolve({ ok: true });
    await tick();
    expect(send).toHaveBeenCalledTimes(2);
    expect(calls[1].key).toBe("set:2");
  });

  it("keeps a save that failed, says so, and sends it on retry", async () => {
    const { send, calls } = manualSender();
    const queue = new SaveQueue(send, null, () => {});

    queue.push("set:1", { reps: 8 });
    calls[0].resolve({ ok: false, retry: true });
    await tick();
    expect(queue.state).toMatchObject({ status: "unsaved", pending: 1 });

    queue.retry();
    calls[1].resolve({ ok: true });
    await tick();
    expect(queue.state.status).toBe("saved");
    expect(calls[1].value).toEqual({ reps: 8 });
  });

  it("treats a thrown network error as a failure to retry, not a loss", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ ok: true });
    const queue = new SaveQueue(send, null, () => {});

    queue.push("set:1", 1);
    await tick();
    expect(queue.state.status).toBe("unsaved");
    queue.retry();
    await tick();
    expect(queue.state.status).toBe("saved");
  });

  it("sends the newer value, not the failed one, when the set changed meanwhile", async () => {
    const { send, calls } = manualSender();
    const queue = new SaveQueue(send, null, () => {});

    queue.push("set:1", "old");
    queue.push("set:1", "new");
    calls[0].resolve({ ok: false, retry: true });
    await tick();
    queue.retry();
    await tick();

    expect(calls[1].value).toBe("new");
    calls[1].resolve({ ok: true });
    await tick();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("drops a save the server refuses, and reports why, instead of looping", async () => {
    const { send, calls } = manualSender();
    const queue = new SaveQueue(send, null, () => {});

    queue.push("set:1", { reps: -1 });
    calls[0].resolve({ ok: false, retry: false, error: "Reps cannot be negative." });
    await tick();

    expect(queue.state).toEqual({ status: "saved", pending: 0, error: "Reps cannot be negative." });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("flush resolves true only when everything is stored", async () => {
    const { send, calls } = manualSender();
    const queue = new SaveQueue(send, null, () => {});

    queue.push("set:1", 1);
    const flushed = queue.flush();
    calls[0].resolve({ ok: true });
    expect(await flushed).toBe(true);

    queue.push("set:2", 2);
    const second = queue.flush();
    calls[1].resolve({ ok: false, retry: true });
    expect(await second).toBe(false);
  });

  it("flush on an empty queue is immediately true", async () => {
    const queue = new SaveQueue(vi.fn(), null, () => {});
    expect(await queue.flush()).toBe(true);
  });

  it("mirrors what is waiting to storage and clears it when sent", async () => {
    const storage = memoryStorage();
    const { send, calls } = manualSender();
    const queue = new SaveQueue(send, storage, () => {});

    queue.push("set:1", { reps: 8 });
    calls[0].resolve({ ok: false, retry: true });
    await tick();
    expect(JSON.parse(storage.value!)).toEqual([["set:1", { reps: 8 }]]);

    queue.retry();
    calls[1].resolve({ ok: true });
    await tick();
    expect(storage.value).toBeNull();
  });

  it("sends what a previous visit left unsent — a refresh while offline loses nothing", async () => {
    const storage = memoryStorage(JSON.stringify([["set:4", { reps: 6 }]]));
    const send = vi.fn().mockResolvedValue({ ok: true });
    const queue = new SaveQueue(send, storage, () => {});

    expect(queue.state.pending).toBe(1);
    queue.resume();
    await tick();

    expect(send).toHaveBeenCalledWith("set:4", { reps: 6 });
    expect(storage.value).toBeNull();
  });

  it("ignores unreadable leftovers in storage", () => {
    const queue = new SaveQueue(vi.fn(), memoryStorage("{not json"), () => {});
    expect(queue.state.pending).toBe(0);
  });

  it("forgets saves for a set that was removed", async () => {
    const { send, calls } = manualSender();
    const queue = new SaveQueue(send, null, () => {});

    queue.push("set:1", 1);
    queue.push("set:2", 2);
    queue.discard(["set:2"]);
    calls[0].resolve({ ok: true });
    await tick();

    expect(send).toHaveBeenCalledTimes(1);
    expect(queue.state.status).toBe("saved");
  });
});
