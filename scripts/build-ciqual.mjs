#!/usr/bin/env node
/**
 * Builds `src/lib/food/data/ciqual.json` from the official Ciqual release.
 *
 * Source: ANSES, Table de composition nutritionnelle des aliments Ciqual
 * 2025, Recherche Data Gouv, doi:10.57745/RDMHWY, Licence Ouverte /
 * Etalab 2.0 (reuse allowed with attribution). See docs/DATASET_EVALUATION.md.
 *
 * Usage: node scripts/build-ciqual.mjs <dir containing the 2025 XML files>
 *   alim_*.xml (foods), compo_*.xml (values), const_*.xml (components)
 *
 * The app never downloads or parses the 69 MB XML: this script reduces it,
 * once per edition, to the few figures CalDef stores per food, and the
 * result is committed. Re-run it when ANSES publishes a new edition.
 *
 * Value rules, deliberately conservative:
 *   "6,56"   → 6.56   (decimal comma)
 *   "traces" → 0
 *   "< 0,5"  → 0      (below detection; never the detection limit itself)
 *   "-" / "" → missing
 * A food missing its energy figure, or any of protein, carbohydrate or fat,
 * is left out entirely: logging it would put an invented zero in a diary.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: node scripts/build-ciqual.mjs <xml dir>");
  process.exit(1);
}
const pick = (prefix) => {
  // ANSES names them alim_2025_11_03.xml etc.; a renamed local copy such as
  // ciqual_alim.xml is fine too. The food-group file (alim_grp_…) is not
  // the food list and is skipped.
  const base = prefix.replace(/_$/, "");
  const name = readdirSync(dir).find(
    (f) => new RegExp(`(^|_)${base}[_.]`).test(f) && !f.includes("_grp") && f.endsWith(".xml"),
  );
  if (!name) throw new Error(`No ${prefix}*.xml in ${dir}`);
  return readFileSync(join(dir, name), "utf8");
};

// The files are simple, flat XML; a full parser would be a dependency for
// nothing. Each record is one <ALIM> or <COMPO> element with leaf children.
function records(xml, tag) {
  const out = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
  for (const m of xml.matchAll(re)) {
    const row = {};
    for (const f of m[1].matchAll(/<(\w+)(?:\s[^>]*)?>([\s\S]*?)<\/\1>|<(\w+)[^>]*\/>/g)) {
      if (f[1]) row[f[1]] = f[2].trim();
      else row[f[3]] = "";
    }
    out.push(row);
  }
  return out;
}

const decode = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&apos;/g, "'").replace(/&quot;/g, '"');

function value(raw) {
  const t = decode(raw ?? "").trim().toLowerCase();
  if (t === "" || t === "-") return null;
  if (t === "traces" || t.startsWith("<")) return 0;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

const COMPONENTS = {
  328: "kcal", // Energy, Regulation EU No 1169/2011 (kcal/100g) — what packets print
  25000: "protein_g",
  31000: "carbs_g",
  40000: "fat_g",
  34100: "fiber_g",
  32000: "sugar_g",
  40302: "sat_fat_g",
  10110: "sodium_mg",
};

const foods = records(pick("alim_"), "ALIM").map((a) => ({
  code: a.alim_code,
  fr: decode(a.alim_nom_fr ?? ""),
  en: decode(a.alim_nom_eng ?? ""),
}));

const values = new Map();
for (const c of records(pick("compo_"), "COMPO")) {
  const key = COMPONENTS[Number(c.const_code)];
  if (!key) continue;
  const row = values.get(c.alim_code) ?? {};
  row[key] = value(c.teneur);
  values.set(c.alim_code, row);
}

const kept = [];
let dropped = 0;
for (const food of foods) {
  const v = values.get(food.code) ?? {};
  if ([v.kcal, v.protein_g, v.carbs_g, v.fat_g].some((x) => x === null || x === undefined)) {
    dropped += 1;
    continue;
  }
  if (v.kcal > 1000) {
    dropped += 1;
    continue;
  }
  // Compact positional rows: code, French, English, then the eight figures.
  kept.push([
    food.code, food.fr, food.en,
    v.kcal, v.protein_g, v.carbs_g, v.fat_g,
    v.fiber_g ?? null, v.sugar_g ?? null, v.sat_fat_g ?? null, v.sodium_mg ?? null,
  ]);
}

const out = {
  source: "ANSES, Table de composition nutritionnelle des aliments Ciqual 2025",
  doi: "10.57745/RDMHWY",
  licence: "Licence Ouverte / Etalab 2.0",
  edition: "2025-11-19",
  columns: ["code", "fr", "en", "kcal", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugar_g", "sat_fat_g", "sodium_mg"],
  foods: kept,
};
writeFileSync("src/lib/food/data/ciqual.json", JSON.stringify(out));
console.log(`Ciqual: kept ${kept.length}, left out ${dropped} with a missing core figure.`);
