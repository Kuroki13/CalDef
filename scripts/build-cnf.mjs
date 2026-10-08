#!/usr/bin/env node
/**
 * Builds `src/lib/food/data/cnf.json` from the official Canadian Nutrient
 * File release.
 *
 * Source: Health Canada, Canadian Nutrient File 2026, open.canada.ca dataset
 * 1b6139bd-ed7e-4043-bc28-ff00e10f3109, Open Government Licence – Canada
 * (reuse allowed with attribution). See docs/DATASET_EVALUATION.md.
 *
 * Usage: node scripts/build-cnf.mjs <dir containing the CNF CSV files>
 *
 * Only the foods **without a USDA NDB code** are kept — 1,195 of 5,993. The
 * other 80 % are USDA data under a second name, which CalDef already
 * searches; keeping them would duplicate foods blindly, which §13K forbids.
 *
 * Each kept food brings its household measures as servings, in grams, as
 * Health Canada published them ("1 pie (20 cm dia)" = 450 g). They are real
 * volume-to-weight conversions, better than the 1 g/ml fallback.
 *
 * Recipe compilations (source code 35) are kept but not marked verified:
 * computed from ingredients rather than analysed, they show as Estimated.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: node scripts/build-cnf.mjs <csv dir>");
  process.exit(1);
}

/** A small RFC 4180 reader: quoted fields, doubled quotes, commas inside. */
function readCsv(name) {
  const text = readFileSync(join(dir, name), "utf8").replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

const RECIPE_COMPILATION = "35";
const NUTRIENTS = { 208: "kcal", 203: "protein_g", 205: "carbs_g", 204: "fat_g", 291: "fiber_g", 269: "sugar_g", 606: "sat_fat_g", 307: "sodium_mg" };
const MAX_SERVINGS = 5;

const foods = readCsv("Food_Name.csv").filter((f) => !f.USDA_NDB_Code);
const wanted = new Set(foods.map((f) => f.Food_Code));

const amounts = new Map();
for (const a of readCsv("Nutrient_Amount.csv")) {
  if (!wanted.has(a.Food_Code)) continue;
  const key = NUTRIENTS[Number(a.Nutrient_Code)];
  if (!key) continue;
  const n = Number(a.Nutrient_Amount);
  if (!Number.isFinite(n)) continue;
  const row = amounts.get(a.Food_Code) ?? {};
  row[key] = Math.round(n * 100) / 100;
  amounts.set(a.Food_Code, row);
}

const measureName = new Map(
  readCsv("Measure_Name.csv").map((m) => [m.Measure_Code, m.Measure_Description_and_Unit_EN]),
);
const servings = new Map();
for (const c of readCsv("Measure_Weight_Conversion.csv")) {
  if (!wanted.has(c.Food_Code)) continue;
  const label = (measureName.get(c.Measure_Code) ?? "").trim();
  const grams = Number(c.Measure_Weight_Conversion);
  // "total refuse" is the inedible share, not a portion; a bare gram
  // amount ("140 g") adds nothing a gram field does not already say.
  if (!label || !(grams > 0) || /refuse/i.test(label) || /^\d+(\.\d+)?\s*g$/i.test(label)) continue;
  const list = servings.get(c.Food_Code) ?? [];
  if (list.length < MAX_SERVINGS && !list.some(([l]) => l === label)) {
    list.push([label, Math.round(grams * 10) / 10]);
  }
  servings.set(c.Food_Code, list);
}

const kept = [];
let dropped = 0;
for (const f of foods) {
  const v = amounts.get(f.Food_Code) ?? {};
  if ([v.kcal, v.protein_g, v.carbs_g, v.fat_g].some((x) => x === undefined) || v.kcal > 1000) {
    dropped += 1;
    continue;
  }
  kept.push([
    f.Food_Code, f.Food_Description_EN, f.Food_Description_FR,
    v.kcal, v.protein_g, v.carbs_g, v.fat_g,
    v.fiber_g ?? null, v.sugar_g ?? null, v.sat_fat_g ?? null, v.sodium_mg ?? null,
    f.Food_Source_Code !== RECIPE_COMPILATION,
    servings.get(f.Food_Code) ?? [],
  ]);
}

writeFileSync(
  "src/lib/food/data/cnf.json",
  JSON.stringify({
    source: "Health Canada, Canadian Nutrient File 2026",
    dataset: "open.canada.ca 1b6139bd-ed7e-4043-bc28-ff00e10f3109",
    licence: "Open Government Licence – Canada",
    edition: "2026-10-04",
    columns: ["code", "en", "fr", "kcal", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugar_g", "sat_fat_g", "sodium_mg", "verified", "servings"],
    foods: kept,
  }),
);
console.log(`CNF: kept ${kept.length} Canadian-original foods, left out ${dropped}.`);
