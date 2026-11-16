#!/usr/bin/env node
/**
 * Builds the exercise catalogue (spec §16) from `scripts/exercise-catalogue.txt`.
 *
 * Writes:
 *   src/lib/training/data/exercises.json   what the tests check
 *   the seed migration named on the command line
 *
 * Usage: node scripts/build-exercises.mjs supabase/migrations/<version>_exercise_catalogue.sql
 *
 * The seed is an upsert on `slug`, so growing the catalogue later is: add
 * rows to the text file, run this with a NEW migration file name, commit.
 * A slug is never renamed or removed — logged sessions point at it.
 */

import { readFileSync, writeFileSync } from "node:fs";

const MEASURES = { wr: "weight_reps", r: "reps", d: "duration", dd: "distance_duration" };
const GROUPS = ["chest", "back", "shoulders", "biceps", "triceps", "forearms", "core",
  "quads", "hamstrings", "glutes", "hips", "calves", "full_body", "cardio"];
const EQUIPMENT = ["bodyweight", "dumbbell", "barbell", "kettlebell", "machine", "cable", "band", "other"];

const out = process.argv[2];
if (!out?.startsWith("supabase/migrations/")) {
  throw new Error("Pass the seed migration path, e.g. supabase/migrations/20261116000002_exercise_catalogue.sql");
}

/**
 * Push, pull or hold; compound or isolation — what "find an alternative"
 * ranks by. Authored here with the catalogue, by rule and by exception:
 *
 *   force     by the muscle the exercise targets (pressing muscles push,
 *             pulling muscles pull), a timed exercise is a hold, and the
 *             exceptions below are named one by one;
 *   mechanic  compound when the catalogue lists supporting muscles for it,
 *             isolation when it lists none.
 *
 * Cardio and whole-body conditioning get neither: the words do not apply.
 */
const PULL_EXCEPTIONS = new Set([
  "band-pull-apart", "reverse-dumbbell-fly", "reverse-pec-deck", "face-pull", "upright-row",
  "sumo-deadlift", "hip-thrust", "machine-hip-thrust", "glute-bridge", "single-leg-glute-bridge",
  "cable-kickback", "cable-pull-through", "kettlebell-swing", "donkey-kick", "hip-adduction-machine",
  "crunch", "sit-up", "bicycle-crunch", "hanging-leg-raise", "hanging-knee-raise", "lying-leg-raise",
  "russian-twist", "cable-crunch", "machine-crunch", "cable-woodchop", "v-up", "toes-to-bar",
  "dead-bug", "bird-dog", "ab-wheel-rollout",
]);
const PUSH_EXCEPTIONS = new Set(["back-extension"]);
const PUSH_GROUPS = new Set(["chest", "shoulders", "triceps", "quads", "calves", "glutes", "hips"]);
const PULL_GROUPS = new Set(["back", "biceps", "forearms", "hamstrings", "core"]);

function movement(slug, group, measure, secondary) {
  if (group === "cardio" || group === "full_body") return { force: null, mechanic: null };
  if (measure === "duration" || measure === "distance_duration") {
    return { force: "static", mechanic: secondary.length ? "compound" : "isolation" };
  }
  const force = PULL_EXCEPTIONS.has(slug) ? "pull"
    : PUSH_EXCEPTIONS.has(slug) ? "push"
    : PUSH_GROUPS.has(group) ? "push"
    : PULL_GROUPS.has(group) ? "pull" : null;
  return { force, mechanic: secondary.length ? "compound" : "isolation" };
}

const list = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);
const seen = new Set();
const exercises = [];

for (const [n, raw] of readFileSync("scripts/exercise-catalogue.txt", "utf8").split("\n").entries()) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const parts = line.split("|").map((p) => p.trim());
  const fail = (why) => { throw new Error(`exercise-catalogue.txt line ${n + 1}: ${why}`); };
  if (parts.length !== 8) fail(`expected 8 fields, found ${parts.length}`);
  const [slug, name, aliases, group, secondary, equipment, measure, cue] = parts;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) fail(`bad slug "${slug}"`);
  if (seen.has(slug)) fail(`duplicate slug "${slug}"`);
  seen.add(slug);
  if (!GROUPS.includes(group)) fail(`unknown muscle group "${group}"`);
  if (!EQUIPMENT.includes(equipment)) fail(`unknown equipment "${equipment}"`);
  if (!MEASURES[measure]) fail(`unknown measure "${measure}"`);
  const secondaryMuscles = list(secondary);
  for (const m of secondaryMuscles) {
    if (!GROUPS.includes(m) || m === "full_body" || m === "cardio") fail(`unknown secondary muscle "${m}"`);
  }
  if (!name || !cue) fail("name and cue are required");
  exercises.push({
    slug, name, aliases: list(aliases), muscle_group: group,
    secondary_muscles: secondaryMuscles, equipment, measure: MEASURES[measure],
    ...movement(slug, group, MEASURES[measure], secondaryMuscles),
    instructions: cue,
  });
}

writeFileSync("src/lib/training/data/exercises.json", JSON.stringify(exercises, null, 1) + "\n");

const q = (s) => `'${s.replaceAll("'", "''")}'`;
const arr = (a) => (a.length ? `array[${a.map(q).join(", ")}]` : "'{}'");
const rows = exercises.map((e) =>
  `  (${q(e.slug)}, ${q(e.name)}, ${arr(e.aliases)}, ${q(e.muscle_group)}, ${arr(e.secondary_muscles)}, ${q(e.equipment)}, ${q(e.measure)}, ${e.force ? q(e.force) : "null"}, ${e.mechanic ? q(e.mechanic) : "null"}, ${q(e.instructions)})`);

writeFileSync(out, `-- CalDef — exercise catalogue seed (spec §16).
--
-- GENERATED by scripts/build-exercises.mjs from scripts/exercise-catalogue.txt.
-- Do not edit by hand: change the text file and generate a new migration.
--
-- ${exercises.length} exercises, written for CalDef. Names are common gym
-- vocabulary; the cues are our own wording. No third-party dataset or media.
--
-- An upsert on slug: running it again changes nothing, and a later seed can
-- correct a cue or add exercises without touching what sessions refer to.
-- \`measure\` is deliberately NOT updated on conflict: what a set of an
-- exercise records must not change under sessions that already logged it.

insert into public.exercises
  (slug, name, aliases, muscle_group, secondary_muscles, equipment, measure, force, mechanic, instructions)
values
${rows.join(",\n")}
on conflict (slug) where slug is not null do update
  set name              = excluded.name,
      aliases           = excluded.aliases,
      muscle_group      = excluded.muscle_group,
      secondary_muscles = excluded.secondary_muscles,
      equipment         = excluded.equipment,
      force             = excluded.force,
      mechanic          = excluded.mechanic,
      instructions      = excluded.instructions;
`);

console.log(`${exercises.length} exercises -> src/lib/training/data/exercises.json and ${out}`);
