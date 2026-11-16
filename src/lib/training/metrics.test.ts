import { describe, expect, it } from "vitest";

import {
  bestSet,
  estimatedOneRepMaxKg,
  isCompletable,
  loadConvention,
  newRecords,
  personalRecords,
  progressSeries,
  sessionSummary,
  setVolumeKg,
  volumeKg,
  type DoneSet,
  type ExerciseSessionRecord,
} from "@/lib/training/metrics";

const done = (weightKg: number | null, reps: number | null, extra: Partial<DoneSet> = {}): DoneSet => ({
  weightKg, reps, durationS: null, distanceM: null,
  completedAt: "2026-11-01T10:00:00Z", ...extra,
});
const planned = (weightKg: number | null, reps: number | null): DoneSet => ({
  ...done(weightKg, reps), completedAt: null,
});

describe("volume", () => {
  it("is weight × reps, for weight × reps exercises only", () => {
    expect(setVolumeKg("weight_reps", done(80, 8))).toBe(640);
    expect(setVolumeKg("reps", done(null, 12))).toBeNull();
    expect(setVolumeKg("duration", done(null, null, { durationS: 60 }))).toBeNull();
    expect(setVolumeKg("distance_duration", done(null, null, { distanceM: 5000 }))).toBeNull();
  });

  it("counts completed sets and ignores planned ones", () => {
    expect(volumeKg("weight_reps", [done(80, 8), done(80, 6), planned(80, 8)])).toBe(1120);
  });

  it("is not a number at all for a plank or a run", () => {
    expect(volumeKg("duration", [done(null, null, { durationS: 90 })])).toBeNull();
    expect(volumeKg("distance_duration", [done(null, null, { distanceM: 3000 })])).toBeNull();
  });
});

describe("estimatedOneRepMaxKg", () => {
  it("is the weight itself for a single", () => {
    expect(estimatedOneRepMaxKg(100, 1)).toBe(100);
  });

  it("follows Epley", () => {
    expect(estimatedOneRepMaxKg(100, 10)).toBeCloseTo(133.33, 2);
    expect(estimatedOneRepMaxKg(80, 5)).toBeCloseTo(93.33, 2);
  });

  it("declines beyond 12 reps, with no load, or with nothing to go on", () => {
    expect(estimatedOneRepMaxKg(40, 20)).toBeNull();
    expect(estimatedOneRepMaxKg(0, 10)).toBeNull();
    expect(estimatedOneRepMaxKg(null, 5)).toBeNull();
    expect(estimatedOneRepMaxKg(50, null)).toBeNull();
  });
});

describe("bestSet", () => {
  it("is the heaviest, then the most reps", () => {
    expect(bestSet("weight_reps", [done(80, 8), done(85, 5), done(85, 6)])).toMatchObject({ weightKg: 85, reps: 6 });
  });

  it("never picks a set that was not done", () => {
    expect(bestSet("weight_reps", [planned(200, 1), done(60, 10)])).toMatchObject({ weightKg: 60 });
    expect(bestSet("weight_reps", [planned(200, 1)])).toBeNull();
  });

  it("means most reps, longest, or furthest for the other measures", () => {
    expect(bestSet("reps", [done(null, 9), done(null, 12)])).toMatchObject({ reps: 12 });
    expect(bestSet("duration", [done(null, null, { durationS: 45 }), done(null, null, { durationS: 70 })])).toMatchObject({ durationS: 70 });
    expect(
      bestSet("distance_duration", [
        done(null, null, { distanceM: 5000, durationS: 1700 }),
        done(null, null, { distanceM: 5000, durationS: 1620 }),
        done(null, null, { distanceM: 3000, durationS: 900 }),
      ]),
    ).toMatchObject({ distanceM: 5000, durationS: 1620 });
  });
});

const record = (sessionId: number, date: string, sets: DoneSet[]): ExerciseSessionRecord => ({ sessionId, date, sets });

describe("progressSeries", () => {
  it("is one point per session, oldest first, on the best set", () => {
    const series = progressSeries("weight_reps", [
      record(2, "2026-11-08T10:00:00Z", [done(82.5, 8), done(82.5, 7)]),
      record(1, "2026-11-01T10:00:00Z", [done(80, 8), done(80, 8)]),
    ]);
    expect(series.map((p) => [p.sessionId, p.value, p.reps, p.volumeKg])).toEqual([
      [1, 80, 8, 1280],
      [2, 82.5, 8, 1237.5],
    ]);
  });

  it("leaves out a session with nothing completed rather than plotting zero", () => {
    expect(progressSeries("weight_reps", [record(1, "2026-11-01T10:00:00Z", [planned(80, 8)])])).toEqual([]);
  });

  it("plots seconds for a timed exercise and has no volume for it", () => {
    const [point] = progressSeries("duration", [record(1, "2026-11-01T10:00:00Z", [done(null, null, { durationS: 75 })])]);
    expect(point).toMatchObject({ value: 75, reps: null, volumeKg: null });
  });
});

describe("personalRecords", () => {
  const history = [
    record(1, "2026-10-01T10:00:00Z", [done(100, 5), done(100, 5)]),
    record(2, "2026-10-08T10:00:00Z", [done(105, 3), done(90, 10)]),
    record(3, "2026-10-15T10:00:00Z", [done(105, 3)]),
  ];

  it("finds the heaviest set, and dates it when it was first done", () => {
    const heaviest = personalRecords("weight_reps", history).find((r) => r.kind === "heaviest");
    expect(heaviest).toMatchObject({ value: 105, reps: 3, sessionId: 2, estimated: false });
  });

  it("marks an estimated max as an estimate, unless it was a true single", () => {
    const e1rm = personalRecords("weight_reps", history).find((r) => r.kind === "estimated_1rm");
    expect(e1rm?.value).toBeCloseTo(120, 5); // 90 × (1 + 10/30)
    expect(e1rm?.estimated).toBe(true);

    const single = personalRecords("weight_reps", [record(1, "2026-10-01T10:00:00Z", [done(140, 1)])]);
    expect(single.find((r) => r.kind === "estimated_1rm")).toMatchObject({ value: 140, estimated: false });
  });

  it("reports the best session volume", () => {
    const volume = personalRecords("weight_reps", history).find((r) => r.kind === "best_volume");
    expect(volume).toMatchObject({ value: 1215, sessionId: 2 });
  });

  it("gives a bodyweight exercise a rep record and nothing about weight", () => {
    const records = personalRecords("reps", [record(1, "2026-10-01T10:00:00Z", [done(null, 12), done(null, 15)])]);
    expect(records.map((r) => r.kind)).toEqual(["most_reps"]);
    expect(records[0].value).toBe(15);
  });

  it("gives a run distance and time records", () => {
    const records = personalRecords("distance_duration", [
      record(1, "2026-10-01T10:00:00Z", [done(null, null, { distanceM: 5000, durationS: 1650 })]),
    ]);
    expect(records.map((r) => r.kind)).toEqual(["furthest", "longest"]);
  });

  it("invents nothing when there is no completed set", () => {
    expect(personalRecords("weight_reps", [record(1, "2026-10-01T10:00:00Z", [planned(100, 5)])])).toEqual([]);
    expect(personalRecords("weight_reps", [])).toEqual([]);
  });
});

describe("isCompletable", () => {
  it("needs what the measure records", () => {
    const blank = { weightKg: null, reps: null, durationS: null, distanceM: null };
    expect(isCompletable("weight_reps", { ...blank, weightKg: 60, reps: 8 })).toBe(true);
    expect(isCompletable("weight_reps", { ...blank, weightKg: 0, reps: 8 })).toBe(true);
    expect(isCompletable("weight_reps", { ...blank, reps: 8 })).toBe(false);
    expect(isCompletable("weight_reps", { ...blank, weightKg: 60 })).toBe(false);
    expect(isCompletable("reps", { ...blank, reps: 0 })).toBe(false);
    expect(isCompletable("duration", { ...blank, durationS: 30 })).toBe(true);
    expect(isCompletable("distance_duration", { ...blank, distanceM: 1000 })).toBe(true);
    expect(isCompletable("distance_duration", blank)).toBe(false);
  });
});

describe("sessionSummary", () => {
  it("counts only what was done, and adds volume only where it exists", () => {
    const set = (id: number, s: DoneSet) => ({ ...s, id, position: id });
    expect(
      sessionSummary([
        { measure: "weight_reps", sets: [set(1, done(80, 8)), set(2, planned(80, 8))] },
        { measure: "duration", sets: [set(3, done(null, null, { durationS: 60 }))] },
        { measure: "weight_reps", sets: [set(4, planned(50, 10))] },
      ]),
    ).toEqual({ exercises: 2, sets: 2, volumeKg: 640 });
  });
});

describe("newRecords", () => {
  const first = record(1, "2026-10-01T10:00:00Z", [done(100, 5)]);

  it("is empty the first time an exercise is logged — nothing was beaten", () => {
    expect(newRecords("weight_reps", [first], 1)).toEqual([]);
  });

  it("names what this session beat", () => {
    const second = record(2, "2026-10-08T10:00:00Z", [done(105, 5)]);
    const kinds = newRecords("weight_reps", [first, second], 2).map((r) => r.kind);
    expect(kinds).toEqual(["heaviest", "estimated_1rm", "best_volume"]);
  });

  it("does not count a tie, or a session that did less", () => {
    expect(newRecords("weight_reps", [first, record(2, "2026-10-08T10:00:00Z", [done(100, 5)])], 2)).toEqual([]);
    expect(newRecords("weight_reps", [first, record(2, "2026-10-08T10:00:00Z", [done(90, 5)])], 2)).toEqual([]);
  });

  it("only compares with what came before, not with later sessions", () => {
    const later = record(3, "2026-10-15T10:00:00Z", [done(120, 5)]);
    const second = record(2, "2026-10-08T10:00:00Z", [done(105, 5)]);
    expect(newRecords("weight_reps", [first, second, later], 2).map((r) => r.kind)).toContain("heaviest");
  });
});

describe("loadConvention", () => {
  it("says what the weight field means where it is not obvious", () => {
    expect(loadConvention({ name: "Dumbbell Bench Press", equipment: "dumbbell" })).toMatch(/one dumbbell/);
    expect(loadConvention({ name: "Back Squat", equipment: "barbell" })).toMatch(/bar included/);
    expect(loadConvention({ name: "Assisted Pull-Up", equipment: "machine" })).toMatch(/less is harder/);
    expect(loadConvention({ name: "Weighted Dip", equipment: "other", slug: "weighted-dip" })).toMatch(/Added weight only/);
    expect(loadConvention({ name: "Leg Press", equipment: "machine" })).toBeNull();
  });
});
