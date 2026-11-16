import { describe, expect, it } from "vitest";

import {
  describeRepTarget,
  describeSet,
  distanceFromDisplay,
  distanceToDisplay,
  formatClock,
  formatLength,
  formatWeight,
  parseClock,
  weightFromDisplay,
  weightToDisplay,
} from "@/lib/training/format";

const blank = { weightKg: null, reps: null, durationS: null, distanceM: null };

describe("units", () => {
  it("stores kilograms and shows the user's unit", () => {
    expect(weightToDisplay(100, "metric")).toBe(100);
    expect(weightToDisplay(100, "imperial")).toBe(220.46);
    expect(formatWeight(82.5, "metric")).toBe("82.5 kg");
    expect(formatWeight(100, "imperial")).toBe("220.46 lb");
  });

  it("round-trips a typed plate weight without drifting", () => {
    for (const lb of [45, 135, 225, 2.5, 312.5]) {
      expect(weightToDisplay(weightFromDisplay(lb, "imperial"), "imperial")).toBe(lb);
    }
    expect(weightFromDisplay(82.5, "metric")).toBe(82.5);
  });

  it("stores metres and shows kilometres or miles", () => {
    expect(distanceToDisplay(5000, "metric")).toBe(5);
    expect(distanceFromDisplay(5, "metric")).toBe(5000);
    expect(distanceToDisplay(distanceFromDisplay(3.1, "imperial"), "imperial")).toBe(3.1);
  });
});

describe("clock", () => {
  it("formats seconds", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(75)).toBe("1:15");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatLength(600)).toBe("10 min");
    expect(formatLength(3725)).toBe("1 h 02 min");
  });

  it("parses what a person types", () => {
    expect(parseClock("90")).toBe(90);
    expect(parseClock("1:30")).toBe(90);
    expect(parseClock("1:02:05")).toBe(3725);
    expect(parseClock("")).toBeNull();
    expect(parseClock("1:75")).toBeNull();
    expect(parseClock("abc")).toBeNull();
  });
});

describe("describeSet", () => {
  it("reads each measure its own way", () => {
    expect(describeSet("weight_reps", { ...blank, weightKg: 80, reps: 8 }, "metric")).toBe("80 kg × 8");
    expect(describeSet("reps", { ...blank, reps: 12 }, "metric")).toBe("12 reps");
    expect(describeSet("reps", { ...blank, reps: 1 }, "metric")).toBe("1 rep");
    expect(describeSet("duration", { ...blank, durationS: 90 }, "metric")).toBe("1:30");
    expect(describeSet("distance_duration", { ...blank, distanceM: 5000, durationS: 1630 }, "metric")).toBe("5 km in 27:10");
    expect(describeSet("weight_reps", blank, "metric")).toBe("—");
  });
});

describe("describeRepTarget", () => {
  it("shows a range, a single figure, or nothing", () => {
    expect(describeRepTarget(8, 12)).toBe("8–12 reps");
    expect(describeRepTarget(10, 10)).toBe("10 reps");
    expect(describeRepTarget(10, null)).toBe("10 reps");
    expect(describeRepTarget(null, null)).toBeNull();
  });
});
