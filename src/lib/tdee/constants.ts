/**
 * The constants the expenditure and safety layers agree on.
 *
 * ARCHITECTURE §6 requires the energy-density constant to live in exactly one
 * place; the rate bands sit beside it because feasibility, guardrails and
 * milestones must all classify a rate identically or the app contradicts
 * itself between screens.
 */

/**
 * Energy density of body mass, kcal per kg.
 *
 * The conventional figure for fat tissue. Real loss is a mix of fat, glycogen
 * and water, so this is an approximation that holds over weeks and not over
 * days — which is precisely why the trend, not the scale, feeds it.
 */
export const KCAL_PER_KG = 7700;

/** Rate guardrail thresholds, as a fraction of bodyweight per week (spec 8.3). */
export const RATE_BANDS = {
  slow: 0.005,
  typical: 0.01,
  aggressive: 0.0125,
} as const;

export type RateClassification =
  | "slow"
  | "typical"
  | "aggressive"
  | "very_aggressive";

/**
 * The band the app is willing to *recommend*, as a fraction of bodyweight
 * per week.
 *
 * The upper bound is the top of the "typical effective" band, so a
 * recommendation never crosses into "aggressive" on its own. For the spec's
 * 111.8 kg starting point this yields 0.84–1.12 kg/week, and over 8 weeks a
 * recommended end-of-phase range of ~103–105 kg — the figures in spec 8.1.
 */
export const RECOMMENDED_RATE = {
  min: 0.0075,
  max: 0.01,
} as const;

/**
 * Floors on a recommended calorie target.
 *
 * `daily_targets.calories` carries a `check (calories between 800 and 10000)`
 * as a structural backstop; these are the values the domain layer applies
 * first, so the database constraint should never actually be the thing that
 * stops a bad number. Spec 8.2 is explicit that arithmetic producing 1600
 * kcal is not a reason to recommend 1600 kcal.
 */
export const CALORIE_FLOOR = {
  /** Never recommend below this, whatever the target date demands. */
  absolute: 1200,
  /** Nor below this share of estimated expenditure — a 40% deficit cap. */
  fractionOfTdee: 0.6,
} as const;

/** Data sufficiency gates for publishing an adaptive estimate (ARCHITECTURE §6). */
export const SUFFICIENCY = {
  /** Below this many days of data the formula estimate stands. */
  minDays: 14,
  minWeighIns: 8,
  minLoggedDays: 10,
  /** Days of a phase treated as water-weight noise (spec 8.9). */
  dampenedPhaseDays: 14,
} as const;

/** Confidence tiers, mirroring the `public.confidence_level` enum. */
export type Confidence = "low" | "medium" | "high";
