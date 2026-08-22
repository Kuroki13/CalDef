/**
 * The formula-based starting estimate.
 *
 * Mifflin-St Jeor with an activity multiplier. This is only ever a seed: the
 * spec is explicit that "formula estimates are a starting point, not the
 * truth", and `adaptive.ts` replaces this figure with one derived from real
 * intake and weight trend as soon as there is enough data to justify it.
 */

/** Matches the `public.sex_type` enum. */
export type Sex = "male" | "female" | "other";

/** Matches the `public.activity_level` enum. */
export type ActivityLevel =
  | "sedentary"
  | "light"
  | "moderate"
  | "very"
  | "extra";

/** Conventional Harris-Benedict style multipliers. */
export const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  very: 1.725,
  extra: 1.9,
};

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: "Sedentary",
  light: "Lightly active",
  moderate: "Moderately active",
  very: "Very active",
  extra: "Extremely active",
};

export type BmrInput = {
  weightKg: number;
  heightCm: number;
  age: number;
  sex: Sex;
};

/**
 * Mifflin-St Jeor resting metabolic rate.
 *
 * The equation is defined for male and female only. `other` takes the mean of
 * the two constants rather than defaulting to either, which keeps the result
 * unbiased for a user who has not disclosed a binary sex — and the figure is
 * a seed that gets corrected from observed data regardless.
 */
export function bmr({ weightKg, heightCm, age, sex }: BmrInput): number {
  if (weightKg <= 0 || heightCm <= 0 || age < 0) {
    throw new Error("BMR inputs must be positive.");
  }

  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  const constant = sex === "male" ? 5 : sex === "female" ? -161 : -78;
  return round1(base + constant);
}

/** Resting rate scaled by activity. The seed expenditure figure. */
export function formulaTdee(
  input: BmrInput,
  activity: ActivityLevel,
): number {
  return round1(bmr(input) * ACTIVITY_MULTIPLIERS[activity]);
}

/** Whole years, from ISO `YYYY-MM-DD` strings. */
export function ageFromBirthDate(birthDate: string, today: string): number {
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
