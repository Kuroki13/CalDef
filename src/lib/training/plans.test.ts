import { describe, expect, it } from "vitest";

import { fulfilment, isFulfilled, openPlans } from "@/lib/training/plans";

const plan = { id: 50, templateId: 3, date: "2026-11-16", createdAt: "2026-11-15T20:00:00.000Z" };
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
    const other = { id: 51, templateId: 4, date: "2026-11-17", createdAt: "2026-11-15T20:00:00.000Z" };
    expect(openPlans([plan, other], [session()])).toEqual([other]);
  });
});

describe("the plan link (migration 20261118000003)", () => {
  // Two different workouts both called "Push A", planned the same day.
  const pushA1 = { id: 1, templateId: 10, date: "2026-11-18", createdAt: "2026-11-17T20:00:00.000Z" };
  const pushA2 = { id: 2, templateId: 11, date: "2026-11-18", createdAt: "2026-11-17T20:00:00.000Z" };
  const at = "2026-11-18T18:00:00.000Z";

  it("carries out only the occurrence the session names", () => {
    const done = [{ templateId: 10, date: "2026-11-18", startedAt: at, scheduleId: 1 }];
    expect(fulfilment(pushA1, done)).toBe("linked");
    expect(fulfilment(pushA2, done)).toBeNull();
    expect(openPlans([pushA1, pushA2], done)).toEqual([pushA2]);
  });

  it("is not carried out by a free session of the same name", () => {
    const free = [{ templateId: null, date: "2026-11-18", startedAt: at, scheduleId: null }];
    expect(openPlans([pushA1, pushA2], free)).toEqual([pushA1, pushA2]);
  });

  it("matches an older session without a link by the old rule, and says so", () => {
    const legacy = [{ templateId: 10, date: "2026-11-18", startedAt: at }];
    expect(fulfilment(pushA1, legacy)).toBe("inferred");
    expect(fulfilment(pushA2, legacy)).toBeNull();
  });

  it("never lets a session linked to one plan stand in for another by inference", () => {
    // Linked to a plan of the same workout on another day (it was moved).
    const linkedElsewhere = [{ templateId: 10, date: "2026-11-18", startedAt: at, scheduleId: 99 }];
    expect(fulfilment(pushA1, linkedElsewhere)).toBeNull();
  });

  it("is unchanged by a retried start, which reaches the same session", () => {
    const same = { templateId: 10, date: "2026-11-18", startedAt: at, scheduleId: 1 };
    expect(openPlans([pushA1], [same, same])).toEqual([]);
  });
});
