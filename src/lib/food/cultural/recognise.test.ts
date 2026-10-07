import { describe, expect, it } from "vitest";

import { DISHES } from "@/lib/food/cultural/dictionary";
import { latinKey } from "@/lib/food/cultural/normalize";
import { namesDish, recognise } from "@/lib/food/cultural/recognise";

const ids = (text: string) => recognise(text).map((r) => r.dish.id);
const only = (text: string) => {
  const found = recognise(text);
  expect(found).toHaveLength(1);
  return found[0];
};

describe("§15.1 Language — every spelling reaches the same concept", () => {
  it.each(["maqlouba", "maqluba", "makloubeh", "maqlooba", "ma2loubeh", "مقلوبة", "المقلوبة", "مَقْلُوبَة", "Maqlouba"])(
    "%s is maqluba",
    (spelling) => {
      expect(ids(spelling)).toEqual(["maqluba"]);
    },
  );

  it("knows hummus however it is written", () => {
    for (const spelling of ["hummus", "houmous", "7ummus", "hommos", "حمص"]) {
      expect(ids(spelling)).toEqual(["hummus"]);
    }
  });
});

describe("§15.1 Mixed language", () => {
  it("reads 'À midi 8 warak enab viande' as meat-stuffed grape leaves", () => {
    const found = only("À midi 8 warak enab viande");
    expect(found.dish.id).toBe("warak-enab");
    expect(found.variant?.id).toBe("meat");
    expect(found.searchAs).toBe("stuffed grape leaves with meat");
  });

  it("finds three dishes in one mixed Arabic and Latin sentence (§13F)", () => {
    expect(ids("اكلت اليوم 400g maqlouba و شوي لبن")).toEqual(["maqluba", "laban"]);
    expect(ids("akalet ma2loubeh djej w warak 3enab")).toEqual(["maqluba", "warak-enab"]);
  });

  it("takes the variant from Arabizi beside the dish", () => {
    const found = only("ma2loubeh djej");
    expect(found.variant?.id).toBe("chicken");
    expect(found.searchAs).toBe("chicken maqluba");
  });

  it("takes the variant from Arabic, with the conjunction glued on", () => {
    expect(only("مقلوبة دجاج").variant?.id).toBe("chicken");
    expect(ids("حمص ومقلوبة")).toEqual(["hummus", "maqluba"]);
  });
});

describe("§15.1 Ambiguity — never silently assume", () => {
  it("leaves the variant of plain 'warak enab' open", () => {
    const found = only("warak enab");
    expect(found.variant).toBeNull();
    expect(found.variantOpen).toBe(true);
    expect(found.searchAs).toBe("stuffed grape leaves");
  });

  it("lets a name that means one variant decide it — yalanji has no meat", () => {
    expect(only("yalanji").variant?.id).toBe("vegetarian");
  });

  it("does not ask about variants a dish does not have", () => {
    expect(only("falafel").variantOpen).toBe(false);
  });
});

describe("recognition does not overreach", () => {
  it("keeps laban and labneh apart, though they differ by a letter or two", () => {
    expect(latinKey("laban")).not.toBe(latinKey("labneh"));
    expect(ids("laban")).toEqual(["laban"]);
    expect(ids("labneh")).toEqual(["labneh"]);
  });

  it("does not hear 'ful' in 'full fat'", () => {
    expect(ids("full fat yogurt")).toEqual([]);
    expect(ids("ful medames")).toEqual(["foul"]);
  });

  it("does not mistake the raw ingredient for the dish", () => {
    // "Grape leaves, canned" is what the dish is wrapped in, not the dish:
    // counting it as warak enab put it above real stuffed grape leaves.
    expect(ids("Grape leaves, canned")).toEqual([]);
    expect(ids("Lebanese Stuffed Grape Leaves With Meat")).toEqual(["warak-enab"]);
  });

  it("finds nothing in an ordinary English food", () => {
    expect(ids("chicken breast")).toEqual([]);
    expect(ids("200 g basmati rice")).toEqual([]);
  });

  it("tolerates a one-letter slip in a long name, and nothing looser", () => {
    expect(ids("shawerma")).toEqual(["shawarma"]);
    expect(ids("fattouche")).toEqual(["fattoush"]);
  });
});

describe("namesDish — a food's own name", () => {
  it("matches the user's own spelling of a dish", () => {
    expect(namesDish("Mom's Maqlouba", "maqluba")).toBe(true);
    expect(namesDish("Chicken breast", "maqluba")).toBe(false);
  });
});

describe("the dictionary itself", () => {
  it("holds no nutrition — identity only (§13B)", () => {
    const json = JSON.stringify(DISHES);
    expect(json).not.toMatch(/kcal|protein|calorie|carb|fat_g/i);
  });

  it("covers the §13C list it was built from", () => {
    for (const id of ["maqluba", "musakhan", "maftoul", "warak-enab", "kibbeh", "shish-tawook", "shawarma", "falafel", "hummus", "moutabal", "baba-ghanoush", "labneh", "fattoush", "tabbouleh", "manakish", "fatayer", "molokhia", "kofta", "kabsa", "mansaf", "koshari", "foul", "msabbaha", "couscous", "merguez"]) {
      expect(DISHES.some((d) => d.id === id)).toBe(true);
    }
  });

  it("has no alias claimed by two dishes", () => {
    const seen = new Map<string, string>();
    for (const dish of DISHES) {
      for (const alias of [dish.name, ...dish.aliases]) {
        const key = alias.toLowerCase();
        const owner = seen.get(key);
        expect(owner === undefined || owner === dish.id, `${alias}: ${owner} and ${dish.id}`).toBe(true);
        seen.set(key, dish.id);
      }
    }
  });
});
