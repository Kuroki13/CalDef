/**
 * A set as it is being typed.
 *
 * The inputs hold text, in the user's units; the database holds numbers, in
 * kilograms, metres and seconds. This file is the only place the two meet:
 * `toDraft` for showing a stored set, `fromDraft` for saving what was typed.
 * A field that does not parse makes the whole set unsaveable until it is
 * fixed — half a set is never sent.
 */

import {
  distanceFromDisplay,
  distanceToDisplay,
  formatClock,
  parseClock,
  weightFromDisplay,
  weightToDisplay,
} from "@/lib/training/format";
import type { Measure, SetValues, WorkoutSet } from "@/lib/training/types";
import type { UnitSystem } from "@/lib/units";

export type SetDraft = {
  id: number;
  position: number;
  weight: string;
  reps: string;
  duration: string;
  distance: string;
  completedAt: string | null;
};

export function toDraft(set: WorkoutSet, units: UnitSystem): SetDraft {
  return {
    id: set.id,
    position: set.position,
    ...valuesToText(set, units),
    completedAt: set.completedAt,
  };
}

export function valuesToText(
  values: SetValues,
  units: UnitSystem,
): Pick<SetDraft, "weight" | "reps" | "duration" | "distance"> {
  return {
    weight: values.weightKg === null ? "" : String(weightToDisplay(values.weightKg, units)),
    reps: values.reps === null ? "" : String(values.reps),
    duration: values.durationS === null ? "" : formatClock(values.durationS),
    distance: values.distanceM === null ? "" : String(distanceToDisplay(values.distanceM, units)),
  };
}

function decimal(text: string, max: number): number | null | undefined {
  const value = text.trim().replace(",", ".");
  if (value === "") return null;
  if (!/^\d+(\.\d+)?$/.test(value)) return undefined;
  const n = Number(value);
  return n <= max ? n : undefined;
}

function whole(text: string, max: number): number | null | undefined {
  const value = text.trim();
  if (value === "") return null;
  if (!/^\d+$/.test(value)) return undefined;
  const n = Number(value);
  return n <= max ? n : undefined;
}

/**
 * The stored values a draft stands for, or null if any field of it does not
 * parse. Only the fields the measure uses are read; the others are null, so
 * a value typed before an exercise was swapped can never ride along.
 */
export function fromDraft(
  draft: SetDraft,
  measure: Measure,
  units: UnitSystem,
): SetValues | null {
  const usesWeight = measure === "weight_reps";
  const usesReps = measure === "weight_reps" || measure === "reps";
  const usesDuration = measure === "duration" || measure === "distance_duration";
  const usesDistance = measure === "distance_duration";

  const weight = usesWeight ? decimal(draft.weight, 4500) : null;
  const reps = usesReps ? whole(draft.reps, 1000) : null;
  const distance = usesDistance ? decimal(draft.distance, 1000) : null;
  let duration: number | null | undefined = null;
  if (usesDuration) {
    duration = draft.duration.trim() === "" ? null : (parseClock(draft.duration) ?? undefined);
    if (typeof duration === "number" && duration > 86400) duration = undefined;
  }

  if (weight === undefined || reps === undefined || distance === undefined || duration === undefined) {
    return null;
  }
  return {
    weightKg: weight === null ? null : weightFromDisplay(weight, units),
    reps,
    durationS: duration,
    distanceM: distance === null ? null : distanceFromDisplay(distance, units),
  };
}
