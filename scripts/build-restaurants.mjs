#!/usr/bin/env node
/**
 * Builds `src/lib/food/data/restaurants.json` from official restaurant
 * nutrition (spec §13L/§13M).
 *
 * Inputs, all in scripts/restaurant-sources/ and all official:
 *   subway-canada-2026-10.json     Subway Canada PDF "October 2026", extracted
 *                                  (owner's handoff, verified row by row
 *                                  against an independent PDF extraction)
 *   aw-canada-2026-10-08.json      A&W Canada official menu API, captured
 *                                  2026-10-08 (verified against the live API)
 *   fiveguys-canada-2023-12.json   Five Guys Canada component sheet "CA
 *                                  12-2023", transcribed and verified row by row
 *
 * Usage: node scripts/build-restaurants.mjs
 *
 * Rules:
 * - Only rows with a positive published serving weight and published
 *   energy, protein, carbohydrate and fat. Nothing is estimated, and a
 *   missing figure is never read as zero.
 * - Figures stay per published serving here; the app converts to per 100 g
 *   by arithmetic (value × 100 / grams), which is conversion, not new data.
 * - No global doubling rule: a Subway 6" item is labelled as the 6" serving,
 *   and a footlong is two of them, which is what the PDF says it is.
 */

import { readFileSync, writeFileSync } from "node:fs";

const dir = "scripts/restaurant-sources";
const read = (f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));

const complete = (r) =>
  r.serving_grams > 0 && [r.kcal, r.protein_g, r.carbs_g, r.fat_g].every((v) => typeof v === "number");

const slugify = (s) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---- Subway: the section decides what kind of thing a row is.
function subwayKind(headers) {
  const h = headers.join(" || ");
  if (/Breakfast Wraps/.test(h)) return { kind: "breakfast wrap", unit: "wrap" };
  if (/Breakfast Ciabatta/.test(h)) return { kind: "breakfast ciabatta", unit: "sandwich" };
  if (/6" Italian, scrambled egg/.test(h)) return { kind: '6" breakfast sub', unit: '6" sub' };
  if (/Snackwiches/.test(h)) return { kind: "Snackwich", unit: "Snackwich" };
  if (/Classics Wraps/.test(h)) return { kind: "wrap", unit: "wrap" };
  if (/SALADS|Regional Salads/.test(h)) return { kind: "salad", unit: "salad" };
  if (/Power Bowls/.test(h)) return { kind: "power bowl", unit: "bowl" };
  if (/Fresh Fit/.test(h)) return { kind: '6" Fresh Fit sub', unit: '6" sub' };
  if (/6" (Steak|Chicken|Classics|Deli|Veggie) Subs/.test(h)) return { kind: '6" sub', unit: '6" sub' };
  if (/Breads/.test(h)) return { kind: '6" bread', unit: '6" bread' };
  if (/amounts on 6-inch sandwich or wrap/.test(h)) return { kind: 'sauce, amount on a 6" sub', unit: "portion" };
  if (/Seasonings/.test(h)) return { kind: 'seasoning, amount on a 6" sub', unit: "portion" };
  if (/Vegetables \(amount/.test(h)) return { kind: 'vegetable, amount on a 6" sub', unit: "portion" };
  if (/Cheese \(amount/.test(h)) return { kind: 'cheese, amount on a 6" sub', unit: "portion" };
  if (/Individual Proteins/.test(h)) return { kind: 'protein, amount on a 6" sub', unit: "portion" };
  if (/Cookies & Desserts/.test(h)) return { kind: "dessert", unit: "item" };
  if (/Sides/.test(h)) return { kind: "side", unit: "side" };
  if (/Soup/.test(h)) return { kind: "soup, 8 oz bowl", unit: "bowl" };
  return { kind: "item", unit: "item" };
}

function buildSubway() {
  const src = read("subway-canada-2026-10.json");
  const items = [];
  let skipped = 0;
  for (const r of src.rows) {
    if (!complete(r)) { skipped++; continue; }
    const { kind, unit } = subwayKind(r.context_headers);
    const name = r.name.replace(/[®™]/g, "").trim();
    items.push({
      slug: `${slugify(name)}--${slugify(kind)}`,
      name: `${name} — ${kind}`,
      serving: `1 ${unit} (${r.serving_grams} g)`,
      grams: r.serving_grams,
      n: [r.kcal, r.protein_g, r.carbs_g, r.fat_g, r.fiber_g ?? null, r.sugar_g ?? null, r.saturated_fat_g ?? null, r.sodium_mg ?? null],
    });
  }
  return {
    id: "subway", name: "Subway", aliases: ["subway", "subways"],
    source_url: src.source_url, document_label: src.document_label, reviewed: src.reviewed_date,
    note: 'Values are for the 6" serving where the menu says so; a footlong is two 6" servings, as Subway states.',
    items, skipped,
  };
}

function buildAw() {
  const src = read("aw-canada-2026-10-08.json");
  const bySlug = new Map();
  let skipped = 0;
  for (const r of src.rows) {
    if (!complete(r)) { skipped++; continue; }
    if (bySlug.has(r.slug)) continue; // the Value and Featured lists repeat items
    const name = r.name.replace(/[®™]/g, "").trim();
    bySlug.set(r.slug, {
      slug: r.slug,
      name,
      serving: `1 serving (${r.serving_grams} g)`,
      grams: r.serving_grams,
      n: [r.kcal, r.protein_g, r.carbs_g, r.fat_g, r.fiber_g ?? null, r.sugar_g ?? null, r.saturated_fat_g ?? null, r.sodium_mg ?? null],
      fr: (r.name_fr ?? "").replace(/[®™]/g, "").trim() || null,
    });
  }
  return {
    id: "aw", name: "A&W", aliases: ["a&w", "a & w", "a and w", "a w", "anw"],
    source_url: "https://web.aw.ca/api/menu/", document_label: "A&W Canada official menu API",
    reviewed: src.reviewed_date,
    note: "Standard items as published; customisations are not calculated.",
    items: [...bySlug.values()], skipped,
  };
}

function buildFiveGuys() {
  const src = read("fiveguys-canada-2023-12.json");
  return {
    id: "fiveguys", name: "Five Guys", aliases: ["five guys", "5 guys", "fiveguys", "5guys"],
    source_url: src.source_url, document_label: src.document_label, reviewed: src.reviewed_date,
    note: src.note,
    items: src.rows.map(([slug, en, fr, g, kcal, fat, sat, na, carb, fib, sug, pro]) => ({
      slug, name: en, fr, serving: `1 portion (${g} g)`, grams: g,
      n: [kcal, pro, carb, fat, fib, sug, sat, na],
    })),
    skipped: 0,
  };
}

/**
 * A published row that cannot be physically true is left out and reported,
 * never corrected: Five Guys lists its chocolate mix-in as 50 g containing
 * 55 g of carbohydrate. One of those two numbers is wrong, and choosing
 * which would be inventing data.
 */
function impossible(item) {
  const per100 = (v) => (v === null ? null : (v * 100) / item.grams);
  const [kcal, ...macros] = item.n;
  return per100(kcal) > 1000 || macros.slice(0, 6).some((v) => v !== null && per100(v) > 100);
}

const chains = [buildSubway(), buildAw(), buildFiveGuys()];
for (const c of chains) {
  const bad = c.items.filter(impossible);
  c.items = c.items.filter((i) => !impossible(i));
  c.excluded = bad.map((i) => ({ slug: i.slug, name: i.name, reason: "Published figures exceed the item's own weight." }));
  console.log(
    `${c.name}: ${c.items.length} items, ${c.skipped} left out without a weight or a core figure` +
      (bad.length ? `, ${bad.length} left out as physically impossible: ${bad.map((i) => i.name).join(", ")}` : "") +
      ".",
  );
}

writeFileSync(
  "src/lib/food/data/restaurants.json",
  JSON.stringify({
    columns: ["kcal", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugar_g", "sat_fat_g", "sodium_mg"],
    chains: chains.map((c) => { const out = { ...c }; delete out.skipped; return out; }),
  }),
);

// The Five Guys builder's parts, for its live total on screen (§13M). Only
// what the preview needs; the server logs each part from the full catalogue.
const fiveGuys = chains.find((c) => c.id === "fiveguys");
writeFileSync(
  "src/lib/food/data/fiveguys-parts.json",
  JSON.stringify(fiveGuys.items.map((i) => ({ slug: i.slug, name: i.name, grams: i.grams, kcal: i.n[0], protein_g: i.n[1], carbs_g: i.n[2], fat_g: i.n[3] }))),
);
