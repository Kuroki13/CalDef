import { describe, expect, it } from "vitest";

import { findAlternatives } from "@/lib/training/alternatives";
import type { Exercise } from "@/lib/training/types";

let id = 0;
const ex = (name: string, over: Partial<Exercise> = {}): Exercise => ({
  id: ++id, slug: null, name, aliases: [], muscleGroup: "chest", secondaryMuscles: [],
  equipment: "barbell", measure: "weight_reps", instructions: null, custom: false,
  force: null, mechanic: null, source: null, ...over,
});

const bench = ex("Barbell Bench Press", { force: "push", mechanic: "compound", secondaryMuscles: ["triceps", "shoulders"] });
const dbPress = ex("Dumbbell Bench Press", { equipment: "dumbbell", force: "push", mechanic: "compound", secondaryMuscles: ["triceps", "shoulders"] });
const fly = ex("Dumbbell Fly", { equipment: "dumbbell", force: "push", mechanic: "isolation" });
const pushUp = ex("Push-Up", { equipment: "bodyweight", measure: "reps", force: "push", mechanic: "compound" });
const row = ex("Barbell Row", { muscleGroup: "back", force: "pull", mechanic: "compound" });
const unknown = ex("Chest Machine", { equipment: "machine" });
const all = [bench, dbPress, fly, pushUp, row, unknown];

const names = (...args: Parameters<typeof findAlternatives>) => findAlternatives(...args).map((a) => a.exercise.name);

describe("findAlternatives", () => {
  it("never offers the exercise itself, another muscle group, or another kind of set", () => {
    const found = names(bench, all);
    expect(found).not.toContain("Barbell Bench Press");
    expect(found).not.toContain("Barbell Row");
    // A push-up records reps only; swapping it in would orphan the weights.
    expect(found).not.toContain("Push-Up");
  });

  it("ranks the closest movement first", () => {
    expect(names(bench, all)).toEqual(["Dumbbell Bench Press", "Dumbbell Fly", "Chest Machine"]);
  });

  it("keeps to the equipment asked for", () => {
    expect(names(bench, all, { equipment: "machine" })).toEqual(["Chest Machine"]);
    expect(names(bench, all, { equipment: "cable" })).toEqual([]);
  });

  it("does not hold unknown movement data against an exercise, nor invent a reason from it", () => {
    const [machine] = findAlternatives(bench, [unknown]);
    expect(machine.reasons).toEqual(["Different equipment"]);
  });

  it("says why each one is offered", () => {
    const [first] = findAlternatives(bench, all);
    expect(first.reasons).toEqual([
      "Same push movement",
      "Also a compound lift",
      "Works the same supporting muscles",
      "Different equipment",
    ]);
  });

  it("respects the limit", () => {
    expect(findAlternatives(bench, all, { limit: 1 })).toHaveLength(1);
  });

  it("puts the same movement on other equipment ahead of a different movement", () => {
    const pullover = ex("Bent-Arm Pullover", { equipment: "dumbbell", force: "push", mechanic: "compound" });
    const incline = ex("Incline Dumbbell Bench Press", { equipment: "dumbbell", force: "push", mechanic: "compound" });
    expect(names(bench, [pullover, incline])).toEqual(["Incline Dumbbell Bench Press", "Bent-Arm Pullover"]);
  });
});
