import { describe, expect, it } from "vitest";

import { fromDraft, toDraft, type SetDraft } from "@/components/training/set-draft";

const draft = (fields: Partial<SetDraft>): SetDraft => ({
  id: 1, position: 0, weight: "", reps: "", duration: "", distance: "",
  completedAt: null, ...fields,
});

describe("set drafts", () => {
  it("turns what was typed into stored units", () => {
    expect(fromDraft(draft({ weight: "82,5", reps: "8" }), "weight_reps", "metric")).toEqual({
      weightKg: 82.5, reps: 8, durationS: null, distanceM: null,
    });
    expect(fromDraft(draft({ weight: "135", reps: "5" }), "weight_reps", "imperial")?.weightKg).toBe(61.235);
    expect(fromDraft(draft({ duration: "1:30" }), "duration", "metric")?.durationS).toBe(90);
    expect(fromDraft(draft({ distance: "5", duration: "27:10" }), "distance_duration", "metric")).toEqual({
      weightKg: null, reps: null, durationS: 1630, distanceM: 5000,
    });
  });

  it("treats an empty field as nothing, not zero", () => {
    expect(fromDraft(draft({}), "weight_reps", "metric")).toEqual({
      weightKg: null, reps: null, durationS: null, distanceM: null,
    });
  });

  it("refuses the whole set when one field does not parse", () => {
    expect(fromDraft(draft({ weight: "abc", reps: "8" }), "weight_reps", "metric")).toBeNull();
    expect(fromDraft(draft({ weight: "80", reps: "8.5" }), "weight_reps", "metric")).toBeNull();
    expect(fromDraft(draft({ weight: "-5", reps: "8" }), "weight_reps", "metric")).toBeNull();
    expect(fromDraft(draft({ duration: "1:99" }), "duration", "metric")).toBeNull();
    expect(fromDraft(draft({ weight: "99999", reps: "1" }), "weight_reps", "metric")).toBeNull();
  });

  it("ignores fields the measure does not use", () => {
    // Left over from before the exercise was swapped for a timed one.
    expect(fromDraft(draft({ weight: "80", reps: "8", duration: "45" }), "duration", "metric")).toEqual({
      weightKg: null, reps: null, durationS: 45, distanceM: null,
    });
  });

  it("shows a stored set in the user's units, and round-trips it", () => {
    const stored = { id: 4, position: 2, weightKg: 61.235, reps: 5, durationS: null, distanceM: null, completedAt: null };
    const shown = toDraft(stored, "imperial");
    expect(shown.weight).toBe("135");
    expect(fromDraft(shown, "weight_reps", "imperial")?.weightKg).toBe(61.235);
  });
});
