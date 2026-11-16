/**
 * What the server accepts for the training module.
 *
 * Every action parses its input here before touching the database. The
 * database has the same bounds as check constraints; these exist so a bad
 * value gets a sentence a person can read instead of a constraint name.
 *
 * Everything is already in stored units (kg, m, s) by the time it arrives:
 * the browser converts from the user's display units, and nothing here
 * needs to know which system that was.
 */

import { z } from "zod";

import { EQUIPMENT, MEASURES, MUSCLE_GROUPS } from "@/lib/training/types";

const id = z.number().int().positive();
const nullable = <T extends z.ZodTypeAny>(schema: T) => schema.nullable();

const weightKg = z.number().min(0).max(2000);
const reps = z.number().int().min(0).max(1000);
const durationS = z.number().int().min(0).max(86400);
const distanceM = z.number().min(0).max(1_000_000);

export const customExerciseSchema = z.object({
  name: z.string().trim().min(1, "Give the exercise a name.").max(120),
  muscleGroup: z.enum(MUSCLE_GROUPS),
  equipment: z.enum(EQUIPMENT),
  measure: z.enum(MEASURES),
  instructions: z.string().trim().max(1000).optional(),
});
export type CustomExerciseInput = z.infer<typeof customExerciseSchema>;

const templateItemSchema = z
  .object({
    exerciseId: id,
    targetSets: z.number().int().min(1).max(20),
    repMin: nullable(z.number().int().min(1).max(1000)),
    repMax: nullable(z.number().int().min(1).max(1000)),
    targetWeightKg: nullable(weightKg),
    targetDurationS: nullable(z.number().int().min(1).max(86400)),
    restSeconds: z.number().int().min(0).max(3600),
    notes: nullable(z.string().trim().max(500)),
  })
  .refine(
    (item) => item.repMin === null || item.repMax === null || item.repMin <= item.repMax,
    { message: "The lower rep target cannot be above the upper one." },
  );

export const templateSchema = z.object({
  id: nullable(id),
  name: z.string().trim().min(1, "Give the workout a name.").max(80),
  notes: nullable(z.string().trim().max(1000)),
  items: z
    .array(templateItemSchema)
    .min(1, "Add at least one exercise.")
    .max(40, "A workout can hold at most 40 exercises."),
});
export type TemplateInput = z.infer<typeof templateSchema>;

/** The latest a "completed at" may claim to be, relative to the server. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export const setSchema = z.object({
  setId: id,
  weightKg: nullable(weightKg),
  reps: nullable(reps),
  durationS: nullable(durationS),
  distanceM: nullable(distanceM),
  /**
   * When the set was ticked, by the phone's clock — the phone may have been
   * offline at the time, and that moment is the true one. Refused if it
   * claims to be in the future.
   */
  completedAt: nullable(
    z.iso.datetime({ offset: true }).refine(
      (value) => Date.parse(value) <= Date.now() + CLOCK_SKEW_MS,
      { message: "A set cannot be completed in the future." },
    ),
  ),
});
export type SetInput = z.infer<typeof setSchema>;

export const startSchema = z.object({
  token: z.uuid(),
  templateId: nullable(id),
  fromSessionId: nullable(id),
  name: nullable(z.string().trim().max(80)),
});
export type StartInput = z.infer<typeof startSchema>;

export const positiveId = id;

export const notesSchema = z.string().trim().max(2000);
export const restSchema = z.number().int().min(0).max(3600);

/** The first problem, as one sentence. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "That does not look right.";
}
