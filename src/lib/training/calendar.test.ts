import { describe, expect, it } from "vitest";

import {
  isMonth,
  monthGrid,
  monthLabel,
  shiftMonth,
  weekOf,
  weeklyFrequency,
} from "@/lib/training/calendar";

const marks = {
  done: [{ id: 1, name: "Push A", date: "2026-11-14" }, { id: 2, name: "Pull A", date: "2026-11-16" }],
  planned: [{ id: 9, templateId: 3, name: "Legs", date: "2026-11-18" }],
};

describe("weekOf", () => {
  it("is Monday to Sunday of the week the date falls in", () => {
    const week = weekOf("2026-11-18", "2026-11-16", marks);
    expect(week.map((d) => d.date)).toEqual([
      "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22",
    ]);
    expect(week[0]).toMatchObject({ isToday: true, done: [{ id: 2, name: "Pull A" }] });
    expect(week[2].planned).toEqual([{ id: 9, templateId: 3, name: "Legs" }]);
    expect(week[1]).toMatchObject({ done: [], planned: [] });
  });
});

describe("monthGrid", () => {
  it("covers the month in whole weeks and marks the padding days", () => {
    const grid = monthGrid("2026-11", "2026-11-16", marks);
    expect(grid[0][0].date).toBe("2026-10-26");
    expect(grid.at(-1)!.at(-1)!.date).toBe("2026-12-06");
    expect(grid.every((week) => week.length === 7)).toBe(true);
    expect(grid[0][0].inMonth).toBe(false);
    expect(grid[0][6]).toMatchObject({ date: "2026-11-01", inMonth: true, day: 1 });
    const day14 = grid.flat().find((d) => d.date === "2026-11-14")!;
    expect(day14.done).toEqual([{ id: 1, name: "Push A" }]);
  });

  it("handles a February in a leap year", () => {
    const days = monthGrid("2028-02", "2028-02-10", { done: [], planned: [] }).flat().filter((d) => d.inMonth);
    expect(days).toHaveLength(29);
  });
});

describe("months", () => {
  it("shifts across a year boundary and names itself", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(monthLabel("2026-11")).toBe("November 2026");
    expect(isMonth("2026-11")).toBe(true);
    expect(isMonth("2026-13")).toBe(false);
    expect(isMonth("november")).toBe(false);
  });
});

describe("weeklyFrequency", () => {
  it("counts sessions per week, oldest first, with zeros for weeks off", () => {
    const counts = weeklyFrequency(["2026-11-03", "2026-11-07", "2026-11-14", "2026-11-16"], "2026-11-16", 4);
    expect(counts).toEqual([
      { weekStart: "2026-10-26", sessions: 0 },
      { weekStart: "2026-11-02", sessions: 2 },
      { weekStart: "2026-11-09", sessions: 1 },
      { weekStart: "2026-11-16", sessions: 1 },
    ]);
  });

  it("ignores sessions outside the window", () => {
    expect(weeklyFrequency(["2025-01-01"], "2026-11-16", 2).every((w) => w.sessions === 0)).toBe(true);
  });
});
