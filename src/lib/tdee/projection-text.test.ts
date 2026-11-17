import { describe, expect, it } from "vitest";

import { describeProjection, plural } from "@/lib/tdee/projection-text";

const base = {
  projectedEndWeightKg: 103.43,
  stretchTargetKg: 99,
  finalGoalWeightKg: 90,
  daysToFinalGoal: 7,
  daysRemaining: 1,
  rate: -0.8,
};

describe("describeProjection — the sentence on Today and on the phase page", () => {
  it("gives weights to the tenth", () => {
    const text = describeProjection(base);
    expect(text).toContain("103.4 kg by the end of this phase");
    expect(text).toContain("99.0 kg would need");
    expect(text).toContain("90.0 kg is");
  });

  it("never says '1 weeks' or '1 days'", () => {
    const text = describeProjection(base);
    expect(text).toContain("1 day from now");
    expect(text).toContain("about 1 week away");
    expect(text).not.toMatch(/\b1 (weeks|days)\b/);
  });

  it("says 'less than a week' rather than '0 weeks'", () => {
    expect(describeProjection({ ...base, daysToFinalGoal: 3 })).toContain("less than a week away");
  });

  it("explains the absence of a projection instead of inventing one", () => {
    expect(describeProjection({ ...base, rate: null })).toMatch(/more weigh-ins/);
    expect(describeProjection({ ...base, rate: 0.1 })).toMatch(/flat or rising/);
  });
});

describe("plural", () => {
  it("counts", () => {
    expect(plural(1, "week")).toBe("1 week");
    expect(plural(2, "week")).toBe("2 weeks");
    expect(plural(0, "day")).toBe("0 days");
  });
});
