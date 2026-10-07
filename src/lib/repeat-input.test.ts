import { describe, expect, it } from "vitest";

import { parseRepeatForm } from "@/lib/repeat-input";

const form = (pairs: [string, string][]) => {
  const data = new FormData();
  for (const [k, v] of pairs) data.append(k, v);
  return data;
};

const target: [string, string][] = [["logDate", "2026-10-07"], ["mealTypeId", "1"]];

describe("parseRepeatForm", () => {
  it("keeps ticked rows only, each with its own amount", () => {
    const parsed = parseRepeatForm(
      form([
        ...target,
        ["entryId", "11"], ["amount", "150"],
        ["entryId", "12"], ["amount", "1"],
        ["entryId", "13"], ["amount", "40"],
        ["include", "11"], ["include", "13"],
      ]),
    );
    expect(parsed).toEqual({
      logDate: "2026-10-07",
      mealTypeId: 1,
      items: [
        { entryId: 11, amount: 150 },
        { entryId: 13, amount: 40 },
      ],
    });
  });

  it("takes a single entry without a checkbox", () => {
    const parsed = parseRepeatForm(
      form([...target, ["includeAll", "true"], ["entryId", "11"], ["amount", "2"]]),
    );
    expect(parsed).toMatchObject({ items: [{ entryId: 11, amount: 2 }] });
  });

  it("refuses an unticked form rather than logging nothing quietly", () => {
    const parsed = parseRepeatForm(form([...target, ["entryId", "11"], ["amount", "2"]]));
    expect(parsed).toEqual({ error: "Tick at least one item to log." });
  });

  it("refuses a ticked row with no amount", () => {
    const parsed = parseRepeatForm(
      form([...target, ["entryId", "11"], ["amount", ""], ["include", "11"]]),
    );
    expect("error" in parsed).toBe(true);
  });

  it("refuses a missing or malformed day", () => {
    const parsed = parseRepeatForm(
      form([["logDate", "yesterday"], ["mealTypeId", "1"], ["includeAll", "true"], ["entryId", "1"], ["amount", "1"]]),
    );
    expect(parsed).toEqual({ error: "Choose a day and a meal." });
  });
});
