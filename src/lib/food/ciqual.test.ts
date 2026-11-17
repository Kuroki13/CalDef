import { describe, expect, it } from "vitest";

import data from "@/lib/food/data/ciqual.json";
import { ciqualProvider, searchCiqual } from "@/lib/food/ciqual";
import { textMatch } from "@/lib/food/personal-rank";

describe("Ciqual — the bundled table (§13J)", () => {
  it("is the 2025 edition under the open licence, with its foods", () => {
    expect(data.edition).toBe("2025-11-19");
    expect(data.licence).toMatch(/Etalab 2\.0/);
    expect(data.foods.length).toBeGreaterThan(3000);
  });

  it("holds no food without energy and the three macros — no invented zeros", () => {
    for (const row of data.foods as unknown[][]) {
      for (const i of [3, 4, 5, 6]) expect(typeof row[i]).toBe("number");
    }
  });
});

describe("searchCiqual", () => {
  it("finds the French foods USDA lacks, with ANSES's own figures", () => {
    const [croissant] = searchCiqual("croissant");
    expect(croissant).toMatchObject({
      source: "ciqual",
      name: "Croissant, sans précision (aliment moyen)",
      isVerified: true,
      nutrients: { kcal: 417, protein_g: 6.56, carbs_g: 46.2, fat_g: 22.1 },
    });
    for (const q of ["quiche lorraine", "tartiflette", "fromage blanc", "petit suisse", "gratin dauphinois"]) {
      expect(searchCiqual(q).length, q).toBeGreaterThan(0);
    }
  });

  it("names a result in the language the query used, keeping the other", () => {
    const [english] = searchCiqual("maple syrup");
    expect(english.name).toBe("Maple syrup");
    expect(english.description).toBe("Sirop d'érable");
    const [french] = searchCiqual("sirop d'érable");
    expect(french.name).toBe("Sirop d'érable");
  });

  it("ignores accents, so 'taboule' finds taboulé", () => {
    expect(searchCiqual("taboule")[0].name).toMatch(/^Taboulé/);
  });

  it("finds Ciqual's 'oeuf' and 'boeuf' however the ligature is typed", () => {
    // Ciqual writes "oeuf" and "boeuf"; an iPhone's French keyboard writes
    // "œuf" and "bœuf". Both must reach the same rows, in the same order.
    const names = (q: string) => searchCiqual(q).map((f) => f.name);
    expect(names("œuf dur")).toEqual(names("oeuf dur"));
    expect(names("OEUF dur")).toEqual(names("oeuf dur"));
    expect(names("Œuf dur").length).toBeGreaterThan(0);
    expect(names("bœuf côte")).toEqual(names("boeuf cote"));
    expect(names("bœuf côte")[0]).toMatch(/^Boeuf/);
  });

  it("finds nothing for nonsense, and nothing for nothing", () => {
    expect(searchCiqual("zzqx")).toEqual([]);
    expect(searchCiqual("   ")).toEqual([]);
  });

  it("answers as a provider that cannot be down", async () => {
    const result = await ciqualProvider.search({ text: "croissant" });
    expect(result.ok).toBe(true);
    expect(result.source).toBe("ciqual");
  });

  it("lets ranking read the other language, so a cached French row answers an English query", () => {
    const [french] = searchCiqual("sirop d'érable");
    expect(textMatch(french, "maple syrup").coverage).toBe(1);
  });
});
