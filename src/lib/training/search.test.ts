import { describe, expect, it } from "vitest";

import catalogue from "@/lib/training/data/exercises.json";
import { foldText, searchExercises } from "@/lib/training/search";
import {
  EQUIPMENT,
  MEASURES,
  MUSCLE_GROUPS,
  type Exercise,
} from "@/lib/training/types";

const exercises: Exercise[] = catalogue.map((row, i) => ({
  id: i + 1,
  slug: row.slug,
  name: row.name,
  aliases: row.aliases,
  muscleGroup: row.muscle_group as Exercise["muscleGroup"],
  secondaryMuscles: row.secondary_muscles,
  equipment: row.equipment as Exercise["equipment"],
  measure: row.measure as Exercise["measure"],
  instructions: row.instructions,
  custom: false,
  force: null,
  mechanic: null,
  source: null,
}));

const names = (query: string, extra = {}) =>
  searchExercises(exercises, { query, ...extra }).map((e) => e.name);

describe("the catalogue", () => {
  it("has unique, well-formed slugs and only values the database accepts", () => {
    const slugs = new Set(catalogue.map((e) => e.slug));
    expect(slugs.size).toBe(catalogue.length);
    for (const e of catalogue) {
      expect(e.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(MUSCLE_GROUPS).toContain(e.muscle_group);
      expect(EQUIPMENT).toContain(e.equipment);
      expect(MEASURES).toContain(e.measure);
      expect(e.name.trim().length).toBeGreaterThan(0);
      expect(e.instructions.length).toBeLessThanOrEqual(1000);
      for (const m of e.secondary_muscles) {
        expect(MUSCLE_GROUPS).toContain(m);
        expect(m).not.toBe(e.muscle_group);
      }
    }
  });

  it("covers every muscle group, every equipment type and every measure", () => {
    for (const group of MUSCLE_GROUPS) {
      expect(catalogue.some((e) => e.muscle_group === group), group).toBe(true);
    }
    for (const equipment of EQUIPMENT) {
      expect(catalogue.some((e) => e.equipment === equipment), equipment).toBe(true);
    }
    for (const measure of MEASURES) {
      expect(catalogue.some((e) => e.measure === measure), measure).toBe(true);
    }
  });

  it("is big enough to build real sessions from", () => {
    expect(catalogue.length).toBeGreaterThanOrEqual(150);
  });
});

describe("foldText", () => {
  it("ignores case, accents and punctuation", () => {
    expect(foldText("Développé Couché")).toBe("developpe couche");
    expect(foldText("  Farmer's   Carry ")).toBe("farmer s carry");
  });
});

describe("searchExercises", () => {
  it("finds by name whatever the case", () => {
    expect(names("BENCH PRESS")[0]).toBe("Barbell Bench Press");
  });

  it("finds by alias, with or without accents", () => {
    expect(names("developpe couche")).toContain("Barbell Bench Press");
    expect(names("Développé couché")).toContain("Barbell Bench Press");
    expect(names("rdl")[0]).toBe("Romanian Deadlift");
    expect(names("tractions")).toContain("Pull-Up");
  });

  it("needs every word typed, in any order", () => {
    expect(names("press incline dumbbell")).toContain("Incline Dumbbell Press");
    expect(names("press banana")).toEqual([]);
  });

  it("puts an exact name above names that merely contain it", () => {
    expect(names("plank")[0]).toBe("Plank");
    expect(names("deadlift")[0]).toBe("Deadlift");
  });

  it("filters by muscle group, targets first, then secondary work", () => {
    const chest = searchExercises(exercises, { muscleGroup: "chest" });
    expect(chest.length).toBeGreaterThan(10);
    const firstSecondary = chest.findIndex((e) => e.muscleGroup !== "chest");
    expect(chest.slice(0, firstSecondary).every((e) => e.muscleGroup === "chest")).toBe(true);
    expect(chest.slice(firstSecondary).every((e) => e.secondaryMuscles.includes("chest"))).toBe(true);
  });

  it("filters by equipment, and combines filters with text", () => {
    const bands = searchExercises(exercises, { equipment: "band" });
    expect(bands.length).toBeGreaterThan(5);
    expect(bands.every((e) => e.equipment === "band")).toBe(true);
    expect(names("curl", { equipment: "cable" })).toEqual(["Cable Curl"]);
  });

  it("returns everything, alphabetically, when nothing is asked", () => {
    const all = searchExercises(exercises, {});
    expect(all).toHaveLength(exercises.length);
    expect(all[0].name.localeCompare(all[1].name)).toBeLessThanOrEqual(0);
  });
});
