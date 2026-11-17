import { describe, expect, it } from "vitest";

import { fold, hasStrongMatch, terms } from "@/lib/food/text-match";

const named = (...names: string[]) => names.map((name) => ({ name }));

describe("fold — French ligatures (oeuf / œuf / OEUF / Œuf)", () => {
  it("folds every spelling of oeuf to the same word", () => {
    for (const spelling of ["oeuf", "œuf", "OEUF", "Œuf", "ŒUF", "Oeuf"]) {
      expect(fold(spelling), spelling).toBe("oeuf");
    }
  });
  it("writes out ligatures inside words and keeps accent folding", () => {
    expect(fold("Bœuf bourguignon")).toBe("boeuf bourguignon");
    expect(fold("Cœur de laitue")).toBe("coeur de laitue");
    expect(fold("Œufs brouillés")).toBe("oeufs brouilles");
    expect(fold("Nævus")).toBe("naevus");
    expect(fold("Crème brûlée")).toBe("creme brulee");
  });
  it("leaves Arabic as it was (§13A)", () => {
    expect(fold("لبنة")).toBe(fold("لبنة"));
    expect(fold("مقلوبة")).toBe("مقلوبه");
  });
  it("meets either spelling in the strong-match test, without loosening it", () => {
    expect(hasStrongMatch("œuf dur", named("Oeuf dur, cuit"))).toBe(true);
    expect(hasStrongMatch("oeuf dur", named("Œufs durs bio"))).toBe(true);
    expect(hasStrongMatch("œuf poché", named("Boeuf haché"))).toBe(false);
  });
});

describe("fold", () => {
  it("reduces punctuation providers use and users do not type", () => {
    expect(fold("Chicken, breast, boneless")).toBe("chicken breast boneless");
  });

  it("folds accents, because the branded data is multilingual", () => {
    expect(fold("Dubaï chocolate")).toBe("dubai chocolate");
  });
});

describe("terms", () => {
  it("splits a query into the words that have to be accounted for", () => {
    expect(terms("  Chicken   Maqlouba ")).toEqual(["chicken", "maqlouba"]);
  });
});

describe("hasStrongMatch", () => {
  it("is false when results share only one word with the query", () => {
    // The case this exists for. A search for the dish returns chicken
    // spread, chicken fat and chicken frankfurters: eight results, none of
    // them the thing that was asked for.
    expect(
      hasStrongMatch("chicken maqlouba", named(
        "Chicken spread",
        "Fat, chicken",
        "Frankfurter, chicken",
        "Fast foods, chicken tenders",
      )),
    ).toBe(false);
  });

  it("is false when there are no results at all", () => {
    expect(hasStrongMatch("chicken maqlouba", [])).toBe(false);
  });

  it("is true when something accounts for every word", () => {
    expect(
      hasStrongMatch("chicken breast", named(
        "Chicken, breast, boneless, skinless, raw",
        "Chicken spread",
      )),
    ).toBe(true);
  });

  it("matches across a brand as well as a name", () => {
    expect(
      hasStrongMatch("fage yogurt", [
        { name: "Total 5% Fat Greek Yogurt", brand: "FAGE" },
      ]),
    ).toBe(true);
  });

  it("treats a one-word query as matched, whatever came back", () => {
    // "chicken" really does match chicken spread. Offering to draft a recipe
    // for a bare ingredient would be noise, not help.
    expect(hasStrongMatch("chicken", named("Chicken spread"))).toBe(true);
    expect(hasStrongMatch("chicken", [])).toBe(true);
  });

  it("ignores the punctuation on either side of the comparison", () => {
    expect(
      hasStrongMatch("chicken, breast", named("Chicken breast, raw")),
    ).toBe(true);
  });
});
