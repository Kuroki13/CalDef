/**
 * "Find an alternative" (spec §16.9): the bench is taken, what else works
 * the same thing?
 *
 * The rules are explicit and there are no others:
 *
 *   MUST   target the same primary muscle group;
 *   MUST   record the same thing (weight × reps, reps, time…), so the
 *          session's sets still make sense;
 *   MUST   use the chosen equipment, when one is chosen;
 *   THEN   ranked: same movement direction (push / pull / hold) where both
 *          are known, same kind (compound / isolation) where both are
 *          known, shared secondary muscles, a name that shares its
 *          movement words ("bench press" with "bench press"), and the
 *          user's own exercises first among equals.
 *
 * It suggests; it never substitutes. The user picks, and the alternative
 * is a different exercise with its own history — a dumbbell press does not
 * continue a barbell press's records.
 */

import type { Equipment, Exercise } from "@/lib/training/types";

export type Alternative<T extends Exercise = Exercise> = {
  exercise: T;
  /** Why it is offered, in the order the reasons were scored. */
  reasons: string[];
};

export function findAlternatives<T extends Exercise>(
  target: Exercise,
  all: readonly T[],
  options: { equipment?: Equipment | null; limit?: number } = {},
): Alternative<T>[] {
  const { equipment = null, limit = 12 } = options;
  const scored: { alternative: Alternative<T>; score: number }[] = [];
  const targetWords = movementWords(target.name);

  for (const exercise of all) {
    if (exercise.id === target.id) continue;
    if (exercise.muscleGroup !== target.muscleGroup) continue;
    if (exercise.measure !== target.measure) continue;
    if (equipment && exercise.equipment !== equipment) continue;

    let score = 0;
    const reasons: string[] = [];
    if (target.force && exercise.force) {
      if (exercise.force === target.force) {
        score += 4;
        reasons.push(`Same ${target.force === "static" ? "kind of hold" : `${target.force} movement`}`);
      } else {
        score -= 3;
      }
    }
    if (target.mechanic && exercise.mechanic) {
      if (exercise.mechanic === target.mechanic) {
        score += 3;
        reasons.push(target.mechanic === "compound" ? "Also a compound lift" : "Also an isolation move");
      } else {
        score -= 1;
      }
    }
    const shared = exercise.secondaryMuscles.filter((m) => target.secondaryMuscles.includes(m)).length;
    if (shared > 0) {
      score += Math.min(shared, 2);
      reasons.push("Works the same supporting muscles");
    }
    // "Dumbbell Bench Press" is closer to "Barbell Bench Press" than a
    // pullover is: count the movement words the two names share.
    const words = movementWords(exercise.name);
    const common = [...targetWords].filter((word) => words.has(word)).length;
    score += Math.min(common, 3) * 1.5;
    if (exercise.equipment !== target.equipment) reasons.push("Different equipment");
    if (exercise.custom) score += 0.5;

    scored.push({ alternative: { exercise, reasons }, score });
  }

  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.alternative.exercise.name.localeCompare(b.alternative.exercise.name),
    )
    .slice(0, limit)
    .map((entry) => entry.alternative);
}

/** Words that name equipment or grip, not the movement. */
const NOT_MOVEMENT = new Set([
  "barbell", "dumbbell", "dumbbells", "cable", "machine", "band", "bands", "kettlebell",
  "smith", "ez", "bar", "with", "the", "a", "of", "on", "to", "and", "grip", "medium",
  "wide", "close", "narrow", "one", "arm", "single", "two", "alternating", "alternate",
  "seated", "standing", "lying",
]);

function movementWords(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((word) => word.length > 1 && !NOT_MOVEMENT.has(word)),
  );
}
