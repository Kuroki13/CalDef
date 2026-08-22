/**
 * The adaptive expenditure estimate.
 *
 * The idea in one line: if you ate a known average and your smoothed weight
 * moved a known amount, your real expenditure follows by conservation of
 * energy — no formula required.
 *
 *     expenditure ≈ mean_intake + (trend_change_kg × 7700) / days
 *
 * Losing weight makes `trend_change_kg` negative, which adds to intake: you
 * burned more than you ate by exactly the deficit the tissue change implies.
 *
 * The arithmetic is trivial. Everything below it is the part that matters —
 * refusing to publish an estimate the data cannot support. See ARCHITECTURE §6.
 */

import {
  type Confidence,
  KCAL_PER_KG,
  SUFFICIENCY,
} from "@/lib/tdee/constants";

export type AdaptiveInput = {
  /** Mean daily intake over the window, across *elapsed* days. */
  meanIntakeKcal: number;
  /** Smoothed trend change over the window. Negative means losing. */
  trendChangeKg: number;
  /** Days the window spans. */
  days: number;
  /** Days in the window carrying a weigh-in. */
  weighInDays: number;
  /** Days in the window carrying at least one food log. */
  loggedDays: number;
  /** The previous estimate to blend against — formula or earlier adaptive. */
  priorTdeeKcal: number;
  /**
   * Days elapsed in the current cut phase, when one is running. The first
   * fortnight of a phase is dominated by glycogen and water, so an estimate
   * drawn from it is damped hard toward the prior (spec 8.9).
   */
  phaseDayIndex?: number | null;
};

export type AdaptiveEstimate = {
  /** The figure to publish and store. */
  estimatedTdeeKcal: number;
  /** The unblended observation, kept for transparency and debugging. */
  observedTdeeKcal: number | null;
  method: "formula" | "adaptive";
  confidence: Confidence;
  /** True when the estimate may drive a target adjustment. */
  isPublishable: boolean;
  /** Plain-language reason, shown when an estimate is withheld or damped. */
  reason: string;
  daysOfData: number;
};

/**
 * Weight given to the new observation when blending with the prior.
 *
 * Low on purpose. Expenditure genuinely drifts — adaptive thermogenesis,
 * changing activity — but the *measurement* is far noisier than the
 * underlying quantity, so the estimate should move deliberately rather than
 * chase each week's arithmetic.
 */
const BLEND_WEIGHT: Record<Confidence, number> = {
  low: 0,
  medium: 0.25,
  high: 0.4,
};

/** Damping applied while a phase is still in its water-weight window. */
const EARLY_PHASE_DAMPING = 0.3;

export function estimateAdaptiveTdee(input: AdaptiveInput): AdaptiveEstimate {
  const {
    meanIntakeKcal,
    trendChangeKg,
    days,
    weighInDays,
    loggedDays,
    priorTdeeKcal,
    phaseDayIndex,
  } = input;

  const withheld = (reason: string): AdaptiveEstimate => ({
    estimatedTdeeKcal: round1(priorTdeeKcal),
    observedTdeeKcal: null,
    method: "formula",
    confidence: "low",
    isPublishable: false,
    reason,
    daysOfData: days,
  });

  if (days < SUFFICIENCY.minDays) {
    return withheld(
      `Needs ${SUFFICIENCY.minDays} days of data; ${days} so far.`,
    );
  }
  if (weighInDays < SUFFICIENCY.minWeighIns) {
    return withheld(
      `Needs ${SUFFICIENCY.minWeighIns} weigh-ins in the window; ${weighInDays} so far.`,
    );
  }
  if (loggedDays < SUFFICIENCY.minLoggedDays) {
    return withheld(
      `Needs ${SUFFICIENCY.minLoggedDays} logged days in the window; ${loggedDays} so far.`,
    );
  }

  // Conservation of energy over the window.
  const observed = meanIntakeKcal + (-trendChangeKg * KCAL_PER_KG) / days;

  // A wildly implausible figure means the inputs are wrong — an unlogged
  // week read as fasting, or a scale in the wrong units — not that the user
  // burns 900 kcal a day. Fall back rather than publish nonsense.
  if (observed < 800 || observed > 10000) {
    return withheld(
      "The observed figure is outside a plausible range, so the previous " +
        "estimate stands. Check that intake and weigh-ins are complete.",
    );
  }

  const confidence = confidenceFor(days, weighInDays, loggedDays);
  let weight = BLEND_WEIGHT[confidence];
  let reason =
    `Derived from ${loggedDays} logged days and ${weighInDays} weigh-ins ` +
    `over ${days} days.`;

  const inEarlyPhase =
    typeof phaseDayIndex === "number" &&
    phaseDayIndex >= 0 &&
    phaseDayIndex < SUFFICIENCY.dampenedPhaseDays;

  if (inEarlyPhase) {
    weight *= EARLY_PHASE_DAMPING;
    reason =
      "Early in the phase, weight loss is mostly glycogen and water, so " +
      "this estimate is being adjusted cautiously.";
  }

  const blended = priorTdeeKcal + weight * (observed - priorTdeeKcal);

  return {
    estimatedTdeeKcal: round1(blended),
    observedTdeeKcal: round1(observed),
    method: "adaptive",
    confidence,
    // A low-confidence estimate is shown but must not move a target.
    isPublishable: confidence !== "low",
    reason,
    daysOfData: days,
  };
}

function confidenceFor(
  days: number,
  weighInDays: number,
  loggedDays: number,
): Confidence {
  const coverage = Math.min(weighInDays / days, loggedDays / days);
  if (days >= 28 && coverage >= 0.8) return "high";
  if (days >= 21 && coverage >= 0.6) return "medium";
  return "low";
}

/**
 * How the estimate is phrased to the user.
 *
 * The spec asks for exactly this comparison — "your actual expenditure looks
 * closer to X than the Y we assumed" (§6).
 */
export function describeEstimate(
  estimate: AdaptiveEstimate,
  formulaTdeeKcal: number,
): string {
  if (estimate.method === "formula" || !estimate.observedTdeeKcal) {
    return `Still using the starting estimate of ${Math.round(formulaTdeeKcal)} kcal. ${estimate.reason}`;
  }

  const actual = Math.round(estimate.estimatedTdeeKcal);
  const assumed = Math.round(formulaTdeeKcal);
  if (Math.abs(actual - assumed) < 25) {
    return `Your expenditure is tracking close to the ${assumed} kcal we assumed.`;
  }
  return `Your actual expenditure looks closer to ${actual} kcal than the ${assumed} kcal we assumed.`;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
