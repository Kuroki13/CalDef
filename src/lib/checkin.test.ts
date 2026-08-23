import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/diary", () => ({ getDailyTotals: vi.fn() }));
vi.mock("@/lib/weight", () => ({ getWeightHistory: vi.fn() }));

const { CHECKIN_INTERVAL_DAYS, isAdjustmentDue } = await import(
  "@/lib/checkin"
);

describe("isAdjustmentDue — 'adjust targets weekly at most' (spec 6)", () => {
  it("is due when no target has ever been set", () => {
    expect(isAdjustmentDue(null, "2026-08-23")).toBe(true);
  });

  it("is not due the day after a target was set", () => {
    expect(isAdjustmentDue("2026-08-22", "2026-08-23")).toBe(false);
  });

  it("is not due anywhere inside the week", () => {
    for (let day = 1; day < CHECKIN_INTERVAL_DAYS; day++) {
      const date = `2026-08-${String(1 + day).padStart(2, "0")}`;
      expect(isAdjustmentDue("2026-08-01", date)).toBe(false);
    }
  });

  it("is due exactly seven days later", () => {
    expect(isAdjustmentDue("2026-08-01", "2026-08-08")).toBe(true);
  });

  it("stays due once the week has passed", () => {
    expect(isAdjustmentDue("2026-08-01", "2026-09-15")).toBe(true);
  });

  it("is not due for a date before the last target", () => {
    // Viewing an earlier day must not trigger an adjustment.
    expect(isAdjustmentDue("2026-08-23", "2026-08-10")).toBe(false);
  });
});
