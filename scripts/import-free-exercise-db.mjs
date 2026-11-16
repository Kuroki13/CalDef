#!/usr/bin/env node
/**
 * Extends the exercise catalogue from free-exercise-db (spec §16.3).
 *
 *   Source   https://github.com/yuhonas/free-exercise-db
 *   Licence  The Unlicense — public domain dedication (LICENSE.md), which
 *            covers the exercise DATA used here.
 *   Media    NOT used. The repository states no licence for its images, so
 *            none is copied, linked or hot-linked. Entries are text only.
 *
 * Usage:
 *   node scripts/import-free-exercise-db.mjs <path to dist/exercises.json> \
 *        supabase/migrations/<version>_exercise_catalogue_fedb.sql
 *
 * Writes src/lib/training/data/exercises-fedb.json (what was kept, and what
 * the tests check) and the seed migration.
 *
 * What it does to the source, all of it mechanical:
 *   - maps muscles, equipment and category onto CalDef's vocabulary;
 *   - decides what a set records from category and equipment;
 *   - joins the instruction steps and cuts at a sentence end under 1000
 *     characters;
 *   - DROPS an entry whose name is already a CalDef exercise or one of its
 *     aliases, so the same movement is not listed twice — and carries that
 *     entry's force and mechanic over to the CalDef exercise instead.
 * Nothing is invented: no exercise, variant or figure is added.
 *
 * Slugs are `fx-<source id>`, permanent, and cannot collide with CalDef's.
 */

import { readFileSync, writeFileSync } from "node:fs";

const [, , sourcePath, out] = process.argv;
if (!sourcePath || !out?.startsWith("supabase/migrations/")) {
  throw new Error("Usage: import-free-exercise-db.mjs <exercises.json> supabase/migrations/<file>.sql");
}

const fold = (s) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const MUSCLE = {
  abdominals: "core", adductors: "hips", abductors: "hips", quadriceps: "quads",
  lats: "back", "middle back": "back", "lower back": "back", traps: "back",
  neck: "shoulders", hamstrings: "hamstrings", biceps: "biceps", shoulders: "shoulders",
  chest: "chest", calves: "calves", glutes: "glutes", triceps: "triceps", forearms: "forearms",
};
const EQUIPMENT = {
  "body only": "bodyweight", kettlebells: "kettlebell", bands: "band", "e-z curl bar": "barbell",
  dumbbell: "dumbbell", barbell: "barbell", machine: "machine", cable: "cable",
  "medicine ball": "other", "exercise ball": "other", "foam roll": "other", other: "other",
};

const own = JSON.parse(readFileSync("src/lib/training/data/exercises.json", "utf8"));
const ownByName = new Map();
for (const e of own) for (const n of [e.name, ...e.aliases]) ownByName.set(fold(n), e.slug);

function cue(steps) {
  const text = steps.join(" ").replace(/\s+/g, " ").trim();
  if (text.length <= 1000) return text;
  const cut = text.slice(0, 1000);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".) "));
  return end > 200 ? cut.slice(0, end + 1) : cut.slice(0, 997) + "…";
}

const kept = [];
const enrich = [];
const seen = new Set();
for (const e of JSON.parse(readFileSync(sourcePath, "utf8"))) {
  const name = e.name.replace(/\s+/g, " ").trim();
  const key = fold(name);
  const twin = ownByName.get(key);
  if (twin) {
    if (e.force || e.mechanic) enrich.push({ slug: twin, force: e.force ?? null, mechanic: e.mechanic ?? null });
    continue;
  }
  if (seen.has(key)) continue; // the source lists a few names twice
  seen.add(key);

  const muscle = MUSCLE[e.primaryMuscles[0]];
  if (!muscle) throw new Error(`Unmapped muscle "${e.primaryMuscles[0]}" on ${e.id}`);
  const loose = e.category === "stretching" || e.category === "plyometrics" || e.category === "cardio";
  const equipment = e.equipment === null ? (loose ? "bodyweight" : "other") : EQUIPMENT[e.equipment];
  if (!equipment) throw new Error(`Unmapped equipment "${e.equipment}" on ${e.id}`);

  // What a set records. Time for cardio, stretching, foam rolling and
  // bodyweight holds; reps for unloaded movements; weight × reps otherwise.
  const timed = e.category === "cardio" || e.category === "stretching" || e.equipment === "foam roll" ||
    (e.force === "static" && equipment === "bodyweight");
  const measure = timed ? "duration" : equipment === "bodyweight" ? "reps" : "weight_reps";

  const slug = "fx-" + e.id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  kept.push({
    slug, name,
    muscle_group: e.category === "cardio" ? "cardio" : muscle,
    secondary_muscles: [...new Set(e.secondaryMuscles.map((m) => MUSCLE[m]).filter((m) => m && m !== muscle))],
    equipment, measure,
    force: e.force ?? null, mechanic: e.mechanic ?? null,
    instructions: cue(e.instructions),
  });
}
if (new Set(kept.map((e) => e.slug)).size !== kept.length) throw new Error("Duplicate slug after mapping");

writeFileSync("src/lib/training/data/exercises-fedb.json", JSON.stringify(kept, null, 1) + "\n");

const q = (s) => (s === null ? "null" : `'${s.replaceAll("'", "''")}'`);
const arr = (a) => (a.length ? `array[${a.map(q).join(", ")}]` : "'{}'");
writeFileSync(out, `-- CalDef — exercise catalogue, second source (spec §16.3).
--
-- GENERATED by scripts/import-free-exercise-db.mjs. Do not edit by hand.
--
-- ${kept.length} exercises from free-exercise-db
-- (https://github.com/yuhonas/free-exercise-db), released into the public
-- domain under The Unlicense. Data only: the repository states no licence
-- for its images, so no media is included or referenced.
--
-- Entries whose name CalDef's own catalogue already had were left out; ${enrich.length}
-- of those passed their force and mechanic to the CalDef exercise instead.
--
-- Upsert on slug, like the first seed; \`measure\` is never changed on
-- conflict, because logged sets depend on it.

insert into public.exercises
  (slug, name, muscle_group, secondary_muscles, equipment, measure, force, mechanic, source, instructions)
values
${kept.map((e) => `  (${q(e.slug)}, ${q(e.name)}, ${q(e.muscle_group)}, ${arr(e.secondary_muscles)}, ${q(e.equipment)}, ${q(e.measure)}, ${q(e.force)}, ${q(e.mechanic)}, 'free-exercise-db', ${q(e.instructions)})`).join(",\n")}
on conflict (slug) where slug is not null do update
  set name              = excluded.name,
      muscle_group      = excluded.muscle_group,
      secondary_muscles = excluded.secondary_muscles,
      equipment         = excluded.equipment,
      force             = excluded.force,
      mechanic          = excluded.mechanic,
      source            = excluded.source,
      instructions      = excluded.instructions;

-- CalDef's own exercises: where the public-domain source describes the same
-- movement, take its push/pull and compound/isolation, which "find an
-- alternative" uses. Only fills blanks.
update public.exercises e
   set force = coalesce(e.force, v.force), mechanic = coalesce(e.mechanic, v.mechanic)
  from (values
${enrich.map((e) => `    (${q(e.slug)}, ${q(e.force)}, ${q(e.mechanic)})`).join(",\n")}
  ) as v(slug, force, mechanic)
 where e.slug = v.slug and e.user_id is null;
`);
console.log(`${kept.length} kept, ${enrich.length} matched CalDef's own -> ${out}`);
