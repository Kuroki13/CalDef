import { describe, expect, it } from "vitest";

import {
  adjustRest,
  elapsedSeconds,
  parseRestTimer,
  remainingSeconds,
  startRest,
} from "@/lib/training/timer";

const T0 = Date.parse("2026-11-16T10:00:00Z");

describe("timers are clock subtraction, not counting", () => {
  it("knows how long a session has run from its start time alone", () => {
    expect(elapsedSeconds("2026-11-16T10:00:00Z", T0 + 65_000)).toBe(65);
    expect(elapsedSeconds("2026-11-16T10:00:00Z", T0 - 5_000)).toBe(0);
    expect(elapsedSeconds("nonsense", T0)).toBe(0);
  });

  it("is right after twenty minutes in the background, with no ticks in between", () => {
    const rest = startRest(90, T0, 7)!;
    expect(remainingSeconds(rest.endsAt, T0)).toBe(90);
    expect(remainingSeconds(rest.endsAt, T0 + 30_000)).toBe(60);
    // The phone was locked: nothing ran. The answer is still correct.
    expect(remainingSeconds(rest.endsAt, T0 + 20 * 60_000)).toBe(0);
  });

  it("does not start a rest of zero", () => {
    expect(startRest(0, T0)).toBeNull();
    expect(startRest(Number.NaN, T0)).toBeNull();
  });

  it("adds and removes time without ending in the past", () => {
    const rest = startRest(60, T0)!;
    expect(remainingSeconds(adjustRest(rest, 30, T0).endsAt, T0)).toBe(90);
    expect(remainingSeconds(adjustRest(rest, -90, T0 + 10_000).endsAt, T0 + 10_000)).toBe(0);
  });

  it("survives a reload through storage, and refuses junk", () => {
    const rest = startRest(120, T0, 3)!;
    expect(parseRestTimer(JSON.stringify(rest))).toEqual(rest);
    expect(parseRestTimer(null)).toBeNull();
    expect(parseRestTimer("{")).toBeNull();
    expect(parseRestTimer('{"endsAt":"soon","totalSeconds":60}')).toBeNull();
    expect(parseRestTimer('{"endsAt":1,"totalSeconds":0}')).toBeNull();
  });
});
