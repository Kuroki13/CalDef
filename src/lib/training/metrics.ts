/**
 * What the numbers of a session mean (spec §16.6).
 *
 * Pure arithmetic over stored sets. The rules that keep it honest:
 *
 * - Only COMPLETED sets count. A planned set is not history.
 * - Volume (weight × reps) exists only for `weight_reps` exercises. A plank
 *   has no volume, and a run has none either; they are never given one.
 * - Progress is always per exercise. Two machines, two variants, two
 *   exercises: nothing here adds or compares across them.
 * - An estimated one-rep max is an ESTIMATE (Epley), named as one wherever
 *   it is shown, and is not computed beyond 12 reps, where the formula
 *   stops meaning much.
 */

import type { Measure, SetValues, WorkoutSet } from "@/lib/training/types";

export type DoneSet = SetValues & { completedAt: string | null };

export const isDone = (set: { completedAt: string | null }): boolean =>
  set.completedAt !== null;

/** weight × reps for one set, or null where that is not a meaningful figure. */
export function setVolumeKg(measure: Measure, set: SetValues): number | null {
  if (measure !== "weight_reps") return null;
  if (set.weightKg === null || set.reps === null) return null;
  return set.weightKg * set.reps;
}

/** Total volume of the completed sets, or null for a measure that has none. */
export function volumeKg(measure: Measure, sets: readonly DoneSet[]): number | null {
  if (measure !== "weight_reps") return null;
  let total = 0;
  for (const set of sets) {
    if (!isDone(set)) continue;
    total += setVolumeKg(measure, set) ?? 0;
  }
  return total;
}

/** The most reps the Epley estimate is offered for. */
export const E1RM_MAX_REPS = 12;

/**
 * Estimated one-rep max (Epley: w × (1 + reps / 30)).
 *
 * A single is its own max. Null when there is no load, no reps, or more
 * reps than the formula is trusted for.
 */
export function estimatedOneRepMaxKg(weightKg: number | null, reps: number | null): number | null {
  if (weightKg === null || reps === null) return null;
  if (weightKg <= 0 || reps < 1 || reps > E1RM_MAX_REPS) return null;
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

/**
 * The best completed set of a list, by what "best" means for the measure:
 * heaviest (then most reps), most reps, longest, or furthest.
 */
export function bestSet<T extends DoneSet>(measure: Measure, sets: readonly T[]): T | null {
  const key = (set: T): [number, number] => {
    switch (measure) {
      case "weight_reps":
        return [set.weightKg ?? -1, set.reps ?? -1];
      case "reps":
        return [set.reps ?? -1, 0];
      case "duration":
        return [set.durationS ?? -1, 0];
      case "distance_duration":
        // Further is better; for the same distance, faster is.
        return [set.distanceM ?? -1, -(set.durationS ?? Number.MAX_SAFE_INTEGER)];
    }
  };
  let best: T | null = null;
  let bestKey: [number, number] = [-1, -1];
  for (const set of sets) {
    if (!isDone(set)) continue;
    const k = key(set);
    if (k[0] < 0) continue;
    if (best === null || k[0] > bestKey[0] || (k[0] === bestKey[0] && k[1] > bestKey[1])) {
      best = set;
      bestKey = k;
    }
  }
  return best;
}

/** One past session of one exercise. */
export type ExerciseSessionRecord = {
  sessionId: number;
  /** ISO timestamp of the session's start. */
  date: string;
  sets: DoneSet[];
};

export type ProgressPoint = {
  sessionId: number;
  date: string;
  /** The headline figure for this measure, in stored units. */
  value: number;
  /** Reps of the best set, for a weight × reps exercise. */
  reps: number | null;
  volumeKg: number | null;
};

/**
 * One point per session, oldest first: the best set's weight, reps, time
 * or distance, depending on the measure. Sessions with no usable completed
 * set are left out rather than plotted as zero.
 */
export function progressSeries(
  measure: Measure,
  records: readonly ExerciseSessionRecord[],
): ProgressPoint[] {
  const points: ProgressPoint[] = [];
  for (const record of records) {
    const best = bestSet(measure, record.sets);
    if (!best) continue;
    const value =
      measure === "weight_reps" ? best.weightKg
      : measure === "reps" ? best.reps
      : measure === "duration" ? best.durationS
      : best.distanceM;
    if (value === null) continue;
    points.push({
      sessionId: record.sessionId,
      date: record.date,
      value,
      reps: measure === "weight_reps" ? best.reps : null,
      volumeKg: volumeKg(measure, record.sets),
    });
  }
  return points.sort((a, b) => a.date.localeCompare(b.date));
}

export type PersonalRecord = {
  kind:
    | "heaviest"
    | "estimated_1rm"
    | "best_volume"
    | "most_reps"
    | "longest"
    | "furthest";
  /** In stored units: kg, reps, seconds or metres. */
  value: number;
  /** Reps of the set, where the record is a weight. */
  reps: number | null;
  date: string;
  sessionId: number;
  /** True for a figure that was computed from a formula, not lifted. */
  estimated: boolean;
};

/**
 * The records the data can actually support, for one exercise.
 *
 * Earliest session wins a tie, so a record is dated when it was first set.
 * Returns nothing for an exercise with no completed sets — a record is
 * never invented.
 */
export function personalRecords(
  measure: Measure,
  records: readonly ExerciseSessionRecord[],
): PersonalRecord[] {
  const ordered = [...records].sort((a, b) => a.date.localeCompare(b.date));
  const best = new Map<PersonalRecord["kind"], PersonalRecord>();
  const offer = (candidate: PersonalRecord) => {
    const current = best.get(candidate.kind);
    if (!current || candidate.value > current.value) best.set(candidate.kind, candidate);
  };

  for (const record of ordered) {
    const base = { date: record.date, sessionId: record.sessionId };
    for (const set of record.sets) {
      if (!isDone(set)) continue;
      if (measure === "weight_reps") {
        if (set.weightKg !== null && set.weightKg > 0 && set.reps !== null && set.reps >= 1) {
          offer({ ...base, kind: "heaviest", value: set.weightKg, reps: set.reps, estimated: false });
          const e1rm = estimatedOneRepMaxKg(set.weightKg, set.reps);
          if (e1rm !== null) {
            offer({ ...base, kind: "estimated_1rm", value: e1rm, reps: set.reps, estimated: set.reps > 1 });
          }
        }
      } else if (measure === "reps") {
        if (set.reps !== null && set.reps > 0) {
          offer({ ...base, kind: "most_reps", value: set.reps, reps: null, estimated: false });
        }
      } else if (measure === "duration") {
        if (set.durationS !== null && set.durationS > 0) {
          offer({ ...base, kind: "longest", value: set.durationS, reps: null, estimated: false });
        }
      } else {
        if (set.distanceM !== null && set.distanceM > 0) {
          offer({ ...base, kind: "furthest", value: set.distanceM, reps: null, estimated: false });
        }
        if (set.durationS !== null && set.durationS > 0) {
          offer({ ...base, kind: "longest", value: set.durationS, reps: null, estimated: false });
        }
      }
    }
    const volume = volumeKg(measure, record.sets);
    if (volume !== null && volume > 0) {
      offer({ ...base, kind: "best_volume", value: volume, reps: null, estimated: false });
    }
  }

  const order: PersonalRecord["kind"][] = [
    "heaviest", "estimated_1rm", "best_volume", "most_reps", "furthest", "longest",
  ];
  return order.flatMap((kind) => best.get(kind) ?? []);
}

/** Does this set have what its measure needs to count as done? */
export function isCompletable(measure: Measure, set: SetValues): boolean {
  switch (measure) {
    case "weight_reps":
      return set.weightKg !== null && set.reps !== null && set.reps >= 1;
    case "reps":
      return set.reps !== null && set.reps >= 1;
    case "duration":
      return set.durationS !== null && set.durationS >= 1;
    case "distance_duration":
      return (
        (set.distanceM !== null && set.distanceM > 0) ||
        (set.durationS !== null && set.durationS >= 1)
      );
  }
}

/** Counts across a whole session, for a summary line. */
export function sessionSummary(
  exercises: readonly { measure: Measure; sets: readonly WorkoutSet[] }[],
): { exercises: number; sets: number; volumeKg: number } {
  let sets = 0;
  let volume = 0;
  let withWork = 0;
  for (const exercise of exercises) {
    const done = exercise.sets.filter(isDone);
    if (done.length > 0) withWork += 1;
    sets += done.length;
    volume += volumeKg(exercise.measure, done) ?? 0;
  }
  return { exercises: withWork, sets, volumeKg: volume };
}
