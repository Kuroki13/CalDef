import { describe, expect, it } from "vitest";

import {
  type AdaptiveInput,
  describeEstimate,
  estimateAdaptiveTdee,
} from "@/lib/tdee/adaptive";

/** A window with ample data, so sufficiency gates are out of the way. */
const sufficient = (over: Partial<AdaptiveInput> = {}): AdaptiveInput => ({
  meanIntakeKcal: 2250,
  trendChangeKg: -3.6,
  days: 28,
  weighInDays: 26,
  loggedDays: 26,
  priorTdeeKcal: 3357,
  ...over,
});

describe("estimateAdaptiveTdee — sufficiency gates", () => {
  it("withholds an estimate before the minimum span", () => {
    const r = estimateAdaptiveTdee(sufficient({ days: 10, weighInDays: 9, loggedDays: 9 }));
    expect(r.method).toBe("formula");
    expect(r.isPublishable).toBe(false);
    expect(r.estimatedTdeeKcal).toBe(3357);
    expect(r.reason).toContain("14 days");
  });

  it("withholds without enough weigh-ins", () => {
    const r = estimateAdaptiveTdee(sufficient({ weighInDays: 4 }));
    expect(r.method).toBe("formula");
    expect(r.reason).toContain("weigh-ins");
  });

  it("withholds without enough logged days", () => {
    const r = estimateAdaptiveTdee(sufficient({ loggedDays: 3 }));
    expect(r.method).toBe("formula");
    expect(r.reason).toContain("logged days");
  });

  it("leaves the prior estimate untouched when withholding", () => {
    const r = estimateAdaptiveTdee(sufficient({ days: 2, weighInDays: 1, loggedDays: 1 }));
    expect(r.estimatedTdeeKcal).toBe(3357);
    expect(r.observedTdeeKcal).toBeNull();
  });
});

describe("estimateAdaptiveTdee — the energy balance", () => {
  it("derives expenditure from intake plus the tissue change", () => {
    // 2250 kcal eaten, 3.6 kg lost over 28 days.
    // 3.6 × 7700 / 28 = 990 kcal/day of deficit -> 3240 kcal expenditure.
    const r = estimateAdaptiveTdee(sufficient());
    expect(r.observedTdeeKcal).toBeCloseTo(3240, 0);
    expect(r.method).toBe("adaptive");
  });

  it("reads weight gain as expenditure below intake", () => {
    const r = estimateAdaptiveTdee(
      sufficient({ meanIntakeKcal: 3000, trendChangeKg: 1 }),
    );
    expect(r.observedTdeeKcal!).toBeLessThan(3000);
  });

  it("moves deliberately rather than jumping to the observation", () => {
    const r = estimateAdaptiveTdee(sufficient());
    // Prior 3357, observed 3240 — the published figure sits between them,
    // much closer to the prior.
    expect(r.estimatedTdeeKcal).toBeLessThan(3357);
    expect(r.estimatedTdeeKcal).toBeGreaterThan(3240);
  });

  it("never publishes an implausible figure", () => {
    // An unlogged fortnight read as near-fasting.
    const r = estimateAdaptiveTdee(
      sufficient({ meanIntakeKcal: 200, trendChangeKg: 0 }),
    );
    expect(r.method).toBe("formula");
    expect(r.isPublishable).toBe(false);
    expect(r.reason).toContain("plausible range");
  });
});

describe("estimateAdaptiveTdee — confidence", () => {
  it("is high with a long, well-covered window", () => {
    const r = estimateAdaptiveTdee(sufficient({ days: 28, weighInDays: 26, loggedDays: 26 }));
    expect(r.confidence).toBe("high");
    expect(r.isPublishable).toBe(true);
  });

  it("is medium with a shorter or patchier window", () => {
    const r = estimateAdaptiveTdee(sufficient({ days: 21, weighInDays: 14, loggedDays: 14 }));
    expect(r.confidence).toBe("medium");
    expect(r.isPublishable).toBe(true);
  });

  it("is low with thin coverage, and low confidence cannot move a target", () => {
    const r = estimateAdaptiveTdee(sufficient({ days: 16, weighInDays: 9, loggedDays: 11 }));
    expect(r.confidence).toBe("low");
    expect(r.isPublishable).toBe(false);
    // A low-confidence estimate is still computed and shown...
    expect(r.observedTdeeKcal).not.toBeNull();
    // ...but it does not shift the published figure.
    expect(r.estimatedTdeeKcal).toBe(3357);
  });
});

describe("estimateAdaptiveTdee — early-phase damping (spec 8.9)", () => {
  it("barely moves the estimate inside the water-weight window", () => {
    const early = estimateAdaptiveTdee(sufficient({ phaseDayIndex: 5 }));
    const later = estimateAdaptiveTdee(sufficient({ phaseDayIndex: 40 }));

    const earlyShift = Math.abs(early.estimatedTdeeKcal - 3357);
    const laterShift = Math.abs(later.estimatedTdeeKcal - 3357);

    expect(earlyShift).toBeLessThan(laterShift);
    expect(early.reason).toContain("glycogen and water");
  });

  it("stops damping once the phase is past its first fortnight", () => {
    const r = estimateAdaptiveTdee(sufficient({ phaseDayIndex: 20 }));
    expect(r.reason).not.toContain("glycogen");
  });
});

describe("describeEstimate", () => {
  it("phrases the comparison the way the spec asks (§6)", () => {
    const r = estimateAdaptiveTdee(
      sufficient({ meanIntakeKcal: 2250, trendChangeKg: -2.0, days: 28 }),
    );
    const text = describeEstimate(r, 3357);
    expect(text).toContain("closer to");
    expect(text).toContain("3357");
  });

  it("says so plainly when still on the formula estimate", () => {
    const r = estimateAdaptiveTdee(sufficient({ days: 3, weighInDays: 2, loggedDays: 2 }));
    expect(describeEstimate(r, 3357)).toContain("starting estimate");
  });

  it("does not manufacture a difference when there is not one", () => {
    const r = estimateAdaptiveTdee(
      sufficient({ meanIntakeKcal: 3357, trendChangeKg: 0 }),
    );
    expect(describeEstimate(r, 3357)).toContain("tracking close to");
  });
});
