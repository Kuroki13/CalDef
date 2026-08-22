import { describe, expect, it } from "vitest";

import {
  cmToInch,
  formatMass,
  inchToCm,
  kgToDisplay,
  kgToLb,
  lbToKg,
  lengthToCm,
  massToKg,
} from "./units";

describe("mass conversion", () => {
  it("uses the exact international pound", () => {
    expect(lbToKg(1)).toBeCloseTo(0.45359237, 10);
    expect(kgToLb(1)).toBeCloseTo(2.2046226, 6);
  });

  it("round-trips without drift", () => {
    expect(kgToLb(lbToKg(246.5))).toBeCloseTo(246.5, 10);
    expect(lbToKg(kgToLb(111.8))).toBeCloseTo(111.8, 10);
  });

  it("converts the spec's starting weight", () => {
    // 111.8 kg is the documented starting point in PRODUCT_SPEC section 8.1.
    expect(kgToLb(111.8)).toBeCloseTo(246.48, 2);
  });

  it("passes metric values through untouched", () => {
    expect(massToKg(111.8, "metric")).toBe(111.8);
    expect(kgToDisplay(111.8, "metric")).toBe(111.8);
  });

  it("interprets imperial input as pounds", () => {
    expect(massToKg(246.48, "imperial")).toBeCloseTo(111.8, 2);
  });
});

describe("length conversion", () => {
  it("uses the exact inch", () => {
    expect(inchToCm(1)).toBe(2.54);
    expect(cmToInch(2.54)).toBeCloseTo(1, 10);
  });

  it("converts a realistic height", () => {
    expect(inchToCm(70)).toBeCloseTo(177.8, 6);
    expect(lengthToCm(70, "imperial")).toBeCloseTo(177.8, 6);
    expect(lengthToCm(178, "metric")).toBe(178);
  });
});

describe("formatMass", () => {
  it("labels the unit it actually rendered", () => {
    expect(formatMass(111.8, "metric")).toBe("111.8 kg");
    expect(formatMass(111.8, "imperial")).toBe("246.5 lb");
  });
});
