/**
 * Finding an exercise by what someone types.
 *
 * Case and accents are ignored ("developpe couche" finds "Développé
 * couché"), every word typed has to be found somewhere in the name or an
 * alias, and a name match ranks above an alias match. Pure, so the picker
 * in the browser and the tests agree.
 */

import type { Equipment, Exercise, MuscleGroup } from "@/lib/training/types";

/** Lowercase, accents removed, punctuation to spaces. */
export function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type ExerciseFilter = {
  query?: string;
  muscleGroup?: MuscleGroup | null;
  equipment?: Equipment | null;
};

/** 0 = no match. Higher is a better match. */
function score(exercise: Exercise, words: string[], phrase: string): number {
  const name = foldText(exercise.name);
  const aliases = exercise.aliases.map(foldText);
  const haystack = [name, ...aliases].join(" ");
  if (!words.every((word) => haystack.includes(word))) return 0;

  if (name === phrase) return 100;
  if (aliases.includes(phrase)) return 90;
  if (name.startsWith(phrase)) return 80;
  if (words.every((word) => name.includes(word))) return 60;
  if (aliases.some((alias) => alias.startsWith(phrase))) return 50;
  return 30;
}

/**
 * Exercises that pass the filters, best match first; alphabetical where
 * nothing was typed or matches tie. A muscle filter also finds exercises
 * that work the muscle secondarily, after those that target it.
 */
export function searchExercises<T extends Exercise>(
  exercises: readonly T[],
  { query = "", muscleGroup = null, equipment = null }: ExerciseFilter,
): T[] {
  const phrase = foldText(query);
  const words = phrase.split(" ").filter(Boolean);

  const ranked: { exercise: T; rank: number }[] = [];
  for (const exercise of exercises) {
    if (equipment && exercise.equipment !== equipment) continue;

    let muscleRank = 0;
    if (muscleGroup) {
      if (exercise.muscleGroup === muscleGroup) muscleRank = 2;
      else if (exercise.secondaryMuscles.includes(muscleGroup)) muscleRank = 1;
      else continue;
    }

    const textRank = words.length === 0 ? 1 : score(exercise, words, phrase);
    if (textRank === 0) continue;
    ranked.push({ exercise, rank: textRank * 10 + muscleRank });
  }

  return ranked
    .sort(
      (a, b) =>
        b.rank - a.rank || a.exercise.name.localeCompare(b.exercise.name),
    )
    .map((entry) => entry.exercise);
}
