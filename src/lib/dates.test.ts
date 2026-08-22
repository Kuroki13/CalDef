import { describe, expect, it } from "vitest";

import {
  addDays,
  dateRange,
  daysBetween,
  isIsoDate,
  startOfIsoWeek,
  todayInTimeZone,
} from "./dates";

describe("isIsoDate", () => {
  it("accepts real dates", () => {
    expect(isIsoDate("2026-08-10")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true); // leap year
  });

  it("rejects malformed and impossible dates", () => {
    expect(isIsoDate("2026-8-10")).toBe(false);
    expect(isIsoDate("not-a-date")).toBe(false);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2023-02-29")).toBe(false); // not a leap year
  });
});

describe("todayInTimeZone", () => {
  it("resolves the local calendar day, not the UTC one", () => {
    // 22:30 UTC is already the next day in Auckland and still the same day
    // in New York. This is exactly the case that makes a diary entry land
    // on the wrong date.
    const instant = new Date("2026-08-10T22:30:00Z");
    expect(todayInTimeZone("Pacific/Auckland", instant)).toBe("2026-08-11");
    expect(todayInTimeZone("America/New_York", instant)).toBe("2026-08-10");
    expect(todayInTimeZone("UTC", instant)).toBe("2026-08-10");
  });

  it("falls back to UTC for an unusable timezone", () => {
    const instant = new Date("2026-08-10T22:30:00Z");
    expect(todayInTimeZone("Not/AZone", instant)).toBe("2026-08-10");
  });
});

describe("addDays and daysBetween", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
  });

  it("spans a 56-day phase", () => {
    // The spec's 8-week phase, from PRODUCT_SPEC section 8.
    const end = addDays("2026-08-10", 56);
    expect(end).toBe("2026-10-05");
    expect(daysBetween("2026-08-10", end)).toBe(56);
  });

  it("is negative going backwards", () => {
    expect(daysBetween("2026-08-10", "2026-08-03")).toBe(-7);
  });
});

describe("dateRange", () => {
  it("is inclusive at both ends", () => {
    expect(dateRange("2026-08-10", "2026-08-13")).toEqual([
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
    ]);
  });

  it("is empty when the range is inverted", () => {
    expect(dateRange("2026-08-13", "2026-08-10")).toEqual([]);
  });
});

describe("startOfIsoWeek", () => {
  it("returns the Monday on or before the date", () => {
    expect(startOfIsoWeek("2026-08-10")).toBe("2026-08-10"); // a Monday
    expect(startOfIsoWeek("2026-08-16")).toBe("2026-08-10"); // the Sunday after
    expect(startOfIsoWeek("2026-08-09")).toBe("2026-08-03"); // previous Sunday
  });
});
