import { describe, expect, it } from "vitest";

import { isFulfilled, openPlans } from "@/lib/training/plans";

const plan = { templateId: 3, date: "2026-11-16", createdAt: "2026-11-15T20:00:00.000Z" };
const session = (over = {}) => ({
  templateId: 3, date: "2026-11-16", startedAt: "2026-11-16T18:00:00.000Z", ...over,
});

describe("isFulfilled", () => {
  it("is fulfilled by a session of that workout, that day, after the plan was made", () => {
    expect(isFulfilled(plan, [session()])).toBe(true);
  });

  it("is not fulfilled by another workout, another day, or a free session", () => {
    expect(isFulfilled(plan, [session({ templateId: 4 })])).toBe(false);
    expect(isFulfilled(plan, [session({ date: "2026-11-15" })])).toBe(false);
    expect(isFulfilled(plan, [session({ templateId: null })])).toBe(false);
    expect(isFulfilled(plan, [])).toBe(false);
  });

  it("is not swallowed by a session done before it was planned", () => {
    // Did Push A this morning, then planned it again for tonight.
    const tonight = { ...plan, createdAt: "2026-11-16T19:00:00.000Z" };
    expect(isFulfilled(tonight, [session()])).toBe(false);
    expect(isFulfilled(tonight, [session({ startedAt: "2026-11-16T21:00:00.000Z" })])).toBe(true);
  });
});

describe("openPlans", () => {
  it("keeps what is still to do, in order", () => {
    const other = { templateId: 4, date: "2026-11-17", createdAt: "2026-11-15T20:00:00.000Z" };
    expect(openPlans([plan, other], [session()])).toEqual([other]);
  });
});
