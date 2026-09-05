import { describe, expect, it } from "vitest";

import { MAX_FOOD_TEXT, toFoodText, trustedFoodText } from "@/lib/llm/food-text";

describe("toFoodText — what it accepts", () => {
  it("accepts an ordinary description of food", () => {
    const result = toFoodText("200g grilled chicken breast and 150g rice");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("200g grilled chicken breast and 150g rice");
    }
  });

  it("collapses whitespace so the prompt is not padded", () => {
    const result = toFoodText("  two   eggs \n and  toast  ");
    expect(result.ok && result.value).toBe("two eggs and toast");
  });

  it("keeps quantities, which are short numbers", () => {
    for (const text of ["1500 g rice", "2000 kcal of pasta", "1 tbsp oil"]) {
      expect(toFoodText(text).ok, text).toBe(true);
    }
  });

  it("keeps a branded product whose name contains digits", () => {
    expect(toFoodText("Dubai chocolate 100g").ok).toBe(true);
  });
});

describe("toFoodText — what it refuses", () => {
  const cases: Array<[string, string, string]> = [
    ["an email address", "log this for alex@example.com", "email"],
    ["a link", "the recipe at https://example.com/x", "url"],
    [
      "a user id",
      "user 6eb72e72-72b4-480c-a3b6-368e9c9e9ddb ate rice",
      "identifier",
    ],
    [
      "a session token",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w",
      "identifier",
    ],
    ["a phone number", "call me on 0612345678 about lunch", "identifier"],
    ["a barcode", "product 3017624010701", "identifier"],
  ];

  for (const [what, text, reason] of cases) {
    it(`refuses ${what}`, () => {
      const result = toFoodText(text);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe(reason);
    });
  }

  it("refuses empty text", () => {
    const result = toFoodText("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("empty");
  });

  it("refuses text longer than the cap rather than truncating it", () => {
    const result = toFoodText("rice ".repeat(MAX_FOOD_TEXT));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("too-long");
  });

  it("says what to remove, without repeating the value back", () => {
    const result = toFoodText("me@example.com had eggs");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("email address");
      expect(result.message).not.toContain("me@example.com");
    }
  });
});

describe("trustedFoodText", () => {
  it("passes through a product name a provider gave us", () => {
    // Would be refused as an identifier if it went through toFoodText, which
    // is exactly why the two are separate functions.
    expect(trustedFoodText("Chocolate bar 3017624010701")).toBe(
      "Chocolate bar 3017624010701",
    );
  });

  it("still bounds the length", () => {
    expect(trustedFoodText("x".repeat(5000))).toHaveLength(MAX_FOOD_TEXT);
  });
});
