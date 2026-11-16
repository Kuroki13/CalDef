/**
 * Timers that survive the phone being locked.
 *
 * A browser stops or slows `setInterval` in a background tab, so a counter
 * that adds one every second is wrong the moment the app comes back. These
 * never count: they subtract two clock readings. The interval in the UI
 * only decides how often the screen repaints.
 */

/** Whole seconds since `startedAt` (ISO or epoch ms). Never negative. */
export function elapsedSeconds(startedAt: string | number, now: number): number {
  const start = typeof startedAt === "number" ? startedAt : Date.parse(startedAt);
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, Math.floor((now - start) / 1000));
}

/** Whole seconds until `endsAt` (epoch ms), rounded up; 0 once it has passed. */
export function remainingSeconds(endsAt: number, now: number): number {
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

export type RestTimer = {
  /** Epoch ms at which the rest is over. */
  endsAt: number;
  /** What it was started for, in seconds — for the progress bar. */
  totalSeconds: number;
  /** The session exercise it follows, so the UI can say which. */
  sessionExerciseId: number | null;
  /**
   * Set while paused: the seconds that were left. A paused timer has no
   * meaningful end time, so `endsAt` is ignored until it is resumed.
   */
  pausedRemaining?: number | null;
};

/** Seconds left on a rest, running or paused. */
export function restRemaining(timer: RestTimer, now: number): number {
  return timer.pausedRemaining != null
    ? timer.pausedRemaining
    : remainingSeconds(timer.endsAt, now);
}

export const isPaused = (timer: RestTimer): boolean => timer.pausedRemaining != null;

export function pauseRest(timer: RestTimer, now: number): RestTimer {
  if (isPaused(timer)) return timer;
  return { ...timer, pausedRemaining: remainingSeconds(timer.endsAt, now) };
}

export function resumeRest(timer: RestTimer, now: number): RestTimer {
  if (timer.pausedRemaining == null) return timer;
  return { ...timer, endsAt: now + timer.pausedRemaining * 1000, pausedRemaining: null };
}

export function startRest(
  seconds: number,
  now: number,
  sessionExerciseId: number | null = null,
): RestTimer | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return { endsAt: now + seconds * 1000, totalSeconds: seconds, sessionExerciseId };
}

/** Adds (or, negative, removes) time. Never ends in the past by doing so. */
export function adjustRest(timer: RestTimer, deltaSeconds: number, now: number): RestTimer {
  if (timer.pausedRemaining != null) {
    return {
      ...timer,
      pausedRemaining: Math.max(0, timer.pausedRemaining + deltaSeconds),
      totalSeconds: Math.max(1, timer.totalSeconds + deltaSeconds),
    };
  }
  const endsAt = Math.max(now, timer.endsAt + deltaSeconds * 1000);
  return {
    ...timer,
    endsAt,
    totalSeconds: Math.max(1, timer.totalSeconds + deltaSeconds),
  };
}

/** Reads a stored timer back, refusing anything that is not one. */
export function parseRestTimer(raw: string | null): RestTimer | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { endsAt, totalSeconds, sessionExerciseId, pausedRemaining } = value as Record<string, unknown>;
    if (typeof endsAt !== "number" || !Number.isFinite(endsAt)) return null;
    if (typeof totalSeconds !== "number" || !(totalSeconds > 0)) return null;
    return {
      endsAt,
      totalSeconds,
      sessionExerciseId: typeof sessionExerciseId === "number" ? sessionExerciseId : null,
      pausedRemaining:
        typeof pausedRemaining === "number" && pausedRemaining >= 0 ? pausedRemaining : null,
    };
  } catch {
    return null;
  }
}
