/**
 * Turning stored training values into what the screen says, and back.
 *
 * Stored: kilograms, metres, seconds. Shown: the user's unit system —
 * kg and km, or lb and miles. Conversion happens here, at the edge, so no
 * calculation has to know which system was picked.
 */

import { kgToLb, lbToKg, type UnitSystem } from "@/lib/units";
import type { Measure, SetValues } from "@/lib/training/types";

const METRES_PER_MILE = 1609.344;

export const weightUnit = (units: UnitSystem) => (units === "imperial" ? "lb" : "kg");
export const distanceUnit = (units: UnitSystem) => (units === "imperial" ? "mi" : "km");

/** Trims a figure to at most `places` decimals, without trailing zeros. */
function trim(value: number, places: number): string {
  return Number(value.toFixed(places)).toString();
}

export function weightToDisplay(kg: number, units: UnitSystem): number {
  // Plates come in 0.25 kg / 0.5 lb at the finest; two decimals shows
  // either exactly.
  return Number((units === "imperial" ? kgToLb(kg) : kg).toFixed(2));
}

export function weightFromDisplay(value: number, units: UnitSystem): number {
  // Three decimals of a kilogram: enough that a weight typed in pounds
  // comes back as the same number of pounds (135 lb must not read 134.99).
  return Number((units === "imperial" ? lbToKg(value) : value).toFixed(3));
}

export function distanceToDisplay(metres: number, units: UnitSystem): number {
  return Number((metres / (units === "imperial" ? METRES_PER_MILE : 1000)).toFixed(2));
}

export function distanceFromDisplay(value: number, units: UnitSystem): number {
  return Number((value * (units === "imperial" ? METRES_PER_MILE : 1000)).toFixed(1));
}

export function formatWeight(kg: number, units: UnitSystem): string {
  return `${trim(weightToDisplay(kg, units), 2)} ${weightUnit(units)}`;
}

export function formatDistance(metres: number, units: UnitSystem): string {
  return `${trim(distanceToDisplay(metres, units), 2)} ${distanceUnit(units)}`;
}

/** 75 → "1:15", 3725 → "1:02:05". */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** 3725 → "1 h 02 min", 600 → "10 min". For a whole session's length. */
export function formatLength(totalSeconds: number): string {
  const minutes = Math.max(0, Math.round(totalSeconds / 60));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/**
 * "1:15" or "75" or "1:02:05" → seconds. Null for anything else.
 * A bare number is seconds, which is what a timed set is usually given in.
 */
export function parseClock(text: string): number | null {
  const value = text.trim();
  if (value === "") return null;
  if (/^\d+$/.test(value)) return Number(value);
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, h, m, s] = match;
  if (Number(s) > 59 || (h !== undefined && Number(m) > 59)) return null;
  return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s);
}

/** One set in a line: "80 kg × 8", "12 reps", "1:30", "5 km in 27:10". */
export function describeSet(measure: Measure, set: SetValues, units: UnitSystem): string {
  switch (measure) {
    case "weight_reps": {
      if (set.weightKg === null && set.reps === null) return "—";
      const weight = set.weightKg === null ? "—" : formatWeight(set.weightKg, units);
      return `${weight} × ${set.reps ?? "—"}`;
    }
    case "reps":
      return set.reps === null ? "—" : `${set.reps} ${set.reps === 1 ? "rep" : "reps"}`;
    case "duration":
      return set.durationS === null ? "—" : formatClock(set.durationS);
    case "distance_duration": {
      const distance = set.distanceM === null ? null : formatDistance(set.distanceM, units);
      const time = set.durationS === null ? null : formatClock(set.durationS);
      if (distance && time) return `${distance} in ${time}`;
      return distance ?? time ?? "—";
    }
  }
}

/** "8–12 reps", "10 reps", or nothing when no target was set. */
export function describeRepTarget(repMin: number | null, repMax: number | null): string | null {
  if (repMin === null && repMax === null) return null;
  if (repMin !== null && repMax !== null && repMin !== repMax) return `${repMin}–${repMax} reps`;
  return `${repMin ?? repMax} reps`;
}
