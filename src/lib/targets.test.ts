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

const {
  getOrCreateDailyTarget,
  governorForSource,
  shouldRecomputeTarget,
  targetLabel,
} = await import("@/lib/targets");

const { todayInTimeZone } = await import("@/lib/dates");
const { getExpenditure } = await import("@/lib/expenditure");
const { getActivePhase, phaseCoversDate } = await import("@/lib/phase");
const { getAccountSetup } = await import("@/lib/profile");
const { createClient } = await import("@/lib/supabase/server");

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

/**
 * The régime rule at the level the app actually uses it.
 *
 * `shouldRecomputeTarget` is a pure policy and was always right; what was
 * wrong was that a stored row for the date short-circuited before the policy
 * was ever consulted, so starting or ending a phase part-way through a day
 * did nothing until the next one. These exercise the read-through.
 */
describe("getOrCreateDailyTarget — a régime change lands on the day it happens", () => {
  type StoredRow = {
    user_id?: string;
    target_date: string;
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    basis_tdee_kcal: number | null;
    source: string;
  };

  const today = todayInTimeZone("UTC");
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayIso = yesterday.toISOString().slice(0, 10);

  function fakeSupabase(rows: StoredRow[]) {
    const written: StoredRow[] = [];
    const client = {
      from: () => ({
        select: () => ({
          eq: (_column: string, date: string) => ({
            maybeSingle: async () => ({
              data: rows.find((row) => row.target_date === date) ?? null,
              error: null,
            }),
          }),
          lt: (_column: string, date: string) => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({
                  data:
                    rows
                      .filter((row) => row.target_date < date)
                      .sort((a, b) => a.target_date.localeCompare(b.target_date))
                      .at(-1) ?? null,
                  error: null,
                }),
              }),
            }),
          }),
        }),
        upsert: async (values: StoredRow) => {
          written.push(values);
          const at = rows.findIndex(
            (row) => row.target_date === values.target_date,
          );
          if (at === -1) rows.push(values);
          else rows[at] = values;
          return { error: null };
        },
      }),
    };
    return { client, written };
  }

  function storedRow(date: string, source: string): StoredRow {
    return {
      target_date: date,
      calories: 2015,
      protein_g: 179,
      carbs_g: 184,
      fat_g: 63,
      basis_tdee_kcal: 2800,
      source,
    };
  }

  function setUpAccount() {
    vi.mocked(getAccountSetup).mockResolvedValue({
      profile: {
        id: "11111111-1111-4111-8111-111111111111",
        timezone: "UTC",
        height_cm: 180,
        birth_date: "1995-01-01",
        sex: "male",
      },
      goal: {
        goal_type: "lose_fat",
        protein_g_per_kg: 1.6,
        activity_level: "moderate",
        final_goal_weight_kg: 90,
      },
      latestWeightKg: 110,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    vi.mocked(getExpenditure).mockResolvedValue({
      tdeeKcal: 2800,
      formulaTdeeKcal: 2800,
      baselineWeightKg: 110,
      estimate: { isPublishable: false },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  }

  function runningPhase() {
    vi.mocked(getActivePhase).mockResolvedValue({
      phase: {
        start_date: today,
        end_date: "2099-01-01",
        stretch_target_kg: null,
        final_goal_weight_kg: 90,
        duration_days: 56,
      },
      milestones: [],
      hasElapsed: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    vi.mocked(phaseCoversDate).mockReturnValue(true);
  }

  function noPhase() {
    vi.mocked(getActivePhase).mockResolvedValue(null);
    vi.mocked(phaseCoversDate).mockReturnValue(false);
  }

  it("adopts the phase target on the day the phase starts", async () => {
    setUpAccount();
    runningPhase();
    const { client, written } = fakeSupabase([storedRow(today, "initial")]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createClient).mockResolvedValue(client as any);

    const target = await getOrCreateDailyTarget(today);

    expect(target?.source).toBe("phase");
    expect(target?.label).toBe("2-Month Cut target");
    // The superseded row is replaced, not left behind for an insert to
    // bounce off as a duplicate.
    expect(written).toHaveLength(1);
    expect(written[0].source).toBe("phase");
  });

  it("falls back to the everyday target on the day the phase ends", async () => {
    setUpAccount();
    noPhase();
    const { client, written } = fakeSupabase([storedRow(today, "phase")]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createClient).mockResolvedValue(client as any);

    const target = await getOrCreateDailyTarget(today);

    expect(governorForSource(target!.source)).toBe("everyday");
    expect(target?.fellBackFromPhase).toBe(true);
    expect(written).toHaveLength(1);
  });

  it("leaves a stored day alone when the régime has not changed", async () => {
    setUpAccount();
    noPhase();
    const { client, written } = fakeSupabase([storedRow(today, "initial")]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createClient).mockResolvedValue(client as any);

    const target = await getOrCreateDailyTarget(today);

    expect(target?.calories).toBe(2015);
    expect(target?.source).toBe("initial");
    expect(written).toHaveLength(0);
  });

  it("never rewrites a past day, even when a phase now covers it", async () => {
    setUpAccount();
    runningPhase();
    const { client, written } = fakeSupabase([storedRow(yesterdayIso, "initial")]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createClient).mockResolvedValue(client as any);

    const target = await getOrCreateDailyTarget(yesterdayIso);

    // What the user was actually working to that day stands.
    expect(target?.source).toBe("initial");
    expect(target?.calories).toBe(2015);
    expect(written).toHaveLength(0);
  });
});
