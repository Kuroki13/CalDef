import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  requireUserId: vi.fn(),
}));
vi.mock("@/lib/weight", () => ({ trendByDate: vi.fn() }));

const { phaseCoversDate } = await import("@/lib/phase");

const phase = {
  start_date: "2026-08-22",
  end_date: "2026-10-17",
} as Parameters<typeof phaseCoversDate>[0];

describe("phaseCoversDate", () => {
  it("covers the start date", () => {
    expect(phaseCoversDate(phase, "2026-08-22")).toBe(true);
  });

  it("covers days inside the window", () => {
    expect(phaseCoversDate(phase, "2026-09-15")).toBe(true);
  });

  it("does not cover the day before it starts", () => {
    // Looking back at an earlier diary day must not pull the phase target
    // onto a day the phase did not govern.
    expect(phaseCoversDate(phase, "2026-08-21")).toBe(false);
  });

  it("does not cover the end date itself", () => {
    // end_date is exclusive: day 56 is the last covered day, and the phase
    // is over on the date stamped as its end.
    expect(phaseCoversDate(phase, "2026-10-17")).toBe(false);
    expect(phaseCoversDate(phase, "2026-10-16")).toBe(true);
  });

  it("does not cover days after it ends", () => {
    expect(phaseCoversDate(phase, "2026-11-01")).toBe(false);
  });
});
