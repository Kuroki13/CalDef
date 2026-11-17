import { describe, expect, it } from "vitest";

import { structureInstructions } from "@/lib/training/instructions";

// free-exercise-db's Ab Crunch Machine, as the catalogue holds it.
const AB_CRUNCH =
  "Select a light resistance and sit down on the ab machine placing your feet under the pads provided and grabbing the top handles. Your arms should be bent at a 90 degree angle as you rest the triceps on the pads provided. This will be your starting position. At the same time, begin to lift the legs up as you crunch your upper torso. Breathe out as you perform this movement. Tip: Be sure to use a slow and controlled motion. Concentrate on using your abs to move the weight while relaxing your legs and feet. After a second pause, slowly return to the starting position as you breathe in. Repeat the movement for the prescribed amount of repetitions.";

describe("structureInstructions", () => {
  it("files the Ab Crunch Machine cue under set up, move and return", () => {
    const { parts, tips } = structureInstructions(AB_CRUNCH);
    expect(parts.map((p) => p.title)).toEqual(["Set up", "Move", "Return"]);
    expect(parts[0].steps).toHaveLength(3);
    expect(parts[1].steps[0]).toMatch(/^At the same time/);
    expect(parts[2].steps[0]).toMatch(/slowly return/);
    expect(tips).toContain("Be sure to use a slow and controlled motion.");
    expect(tips.some((t) => t.startsWith("Breathe out"))).toBe(true);
  });

  it("drops the sentence that only says to repeat, and invents nothing", () => {
    const all = structureInstructions(AB_CRUNCH);
    const text = [...all.parts.flatMap((p) => p.steps), ...all.tips].join(" ");
    expect(text).not.toMatch(/prescribed amount/);
    for (const sentence of text.split(/(?<=\.)\s/)) expect(AB_CRUNCH).toContain(sentence.trim());
  });

  it("numbers a short cue with no recognisable structure", () => {
    const { parts } = structureInstructions(
      "Lower the bar to mid-chest with shoulder blades pinched, then press until the elbows are straight.",
    );
    expect(parts).toEqual([{ title: null, steps: [expect.stringMatching(/^Lower the bar/)] }]);
  });

  it("has nothing to say about nothing", () => {
    expect(structureInstructions(null)).toEqual({ parts: [], tips: [] });
  });
});
