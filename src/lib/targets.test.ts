import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  requireUserId: vi.fn(),
}));
vi.mock("@/lib/expenditure", () => ({ getExpenditure: vi.fn() }));
vi.mock("@/lib/phase", () => ({
  getActivePhase: vi.fn(),
  phaseCoversDate: vi.fn(),
}));
vi.mock("@/lib/profile", () => ({ getAccountSetup: vi.fn() }));
vi.mock("@/lib/checkin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/checkin")>(
    "@/lib/checkin",
  );
  return { isAdjustmentDue: actual.isAdjustmentDue, recordWeeklyCheckin: vi.fn() };
});
vi.mock("@/lib/diary", () => ({ getDailyTotals: vi.fn() }));
vi.mock("@/lib/weight", () => ({ getWeightHistory: vi.fn(), trendByDate: vi.fn() }));

const { governorForSource, shouldRecomputeTarget, targetLabel } = await import(
  "@/lib/targets"
);

describe("targetLabel — one target at a time, and it is named", () => {
  it("names the phase target", () => {
    expect(targetLabel("phase")).toBe("2-Month Cut target");
  });

  it("names every everyday source the same way", () => {
    // The user does not care whether it was the initial target or a weekly
    // adjustment — only which régime is in force.
    expect(targetLabel("initial")).toBe("Daily target");
    expect(targetLabel("weekly_adjustment")).toBe("Daily target");
    expect(targetLabel("manual")).toBe("Daily target");
  });
});

describe("governorForSource", () => {
  it("maps phase to phase and everything else to everyday", () => {
    expect(governorForSource("phase")).toBe("phase");
    expect(governorForSource("initial")).toBe("everyday");
    expect(governorForSource("weekly_adjustment")).toBe("everyday");
  });
});

describe("shouldRecomputeTarget — weekly cadence", () => {
  it("recomputes when there is no previous target", () => {
    expect(
      shouldRecomputeTarget({
        previousSource: null,
        previousDate: null,
        governor: "everyday",
        date: "2026-08-23",
      }),
    ).toBe(true);
  });

  it("carries forward inside the week", () => {
    expect(
      shouldRecomputeTarget({
        previousSource: "weekly_adjustment",
        previousDate: "2026-08-17",
        governor: "everyday",
        date: "2026-08-23",
      }),
    ).toBe(false);
  });

  it("recomputes at seven days", () => {
    expect(
      shouldRecomputeTarget({
        previousSource: "weekly_adjustment",
        previousDate: "2026-08-16",
        governor: "everyday",
        date: "2026-08-23",
      }),
    ).toBe(true);
  });

  it("holds a phase target inside the week too", () => {
    // The phase must not become a back door around the cadence: this is the
    // exact reactivity that smoothing and the weekly gate exist to prevent.
    expect(
      shouldRecomputeTarget({
        previousSource: "phase",
        previousDate: "2026-08-22",
        governor: "phase",
        date: "2026-08-23",
      }),
    ).toBe(false);
  });

  it("recomputes a phase target once its week is up", () => {
    expect(
      shouldRecomputeTarget({
        previousSource: "phase",
        previousDate: "2026-08-16",
        governor: "phase",
        date: "2026-08-23",
      }),
    ).toBe(true);
  });
});

describe("shouldRecomputeTarget — a change of régime is an event", () => {
  it("adopts a phase target immediately when a phase starts", () => {
    // Starting a phase must not wait out the rest of the week to matter.
    expect(
      shouldRecomputeTarget({
        previousSource: "weekly_adjustment",
        previousDate: "2026-08-22",
        governor: "phase",
        date: "2026-08-23",
      }),
    ).toBe(true);
  });

  it("falls back immediately when a phase ends", () => {
    // And a phase that has ended must not keep governing after it stopped.
    expect(
      shouldRecomputeTarget({
        previousSource: "phase",
        previousDate: "2026-08-22",
        governor: "everyday",
        date: "2026-08-23",
      }),
    ).toBe(true);
  });

  it("treats the switch as an event even on the very next day", () => {
    expect(
      shouldRecomputeTarget({
        previousSource: "phase",
        previousDate: "2026-08-23",
        governor: "everyday",
        date: "2026-08-24",
      }),
    ).toBe(true);
  });
});
