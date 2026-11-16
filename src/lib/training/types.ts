/**
 * The vocabulary of the training module (spec §16).
 *
 * Plain values, no I/O: shared by the server, the browser and the tests.
 * The lists here are the same ones the database checks
 * (`supabase/migrations/20261116000001_training.sql`), and a test holds the
 * catalogue to them.
 */

export const MUSCLE_GROUPS = [
  "chest", "back", "shoulders", "biceps", "triceps", "forearms", "core",
  "quads", "hamstrings", "glutes", "hips", "calves", "full_body", "cardio",
] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export const EQUIPMENT = [
  "bodyweight", "dumbbell", "barbell", "kettlebell", "machine", "cable",
  "band", "other",
] as const;
export type Equipment = (typeof EQUIPMENT)[number];

/**
 * What one set of an exercise records.
 *
 * This decides which fields a set shows, and which figures mean anything
 * for it: volume (weight × reps) exists only for `weight_reps`.
 */
export const MEASURES = [
  "weight_reps", "reps", "duration", "distance_duration",
] as const;
export type Measure = (typeof MEASURES)[number];

export const MUSCLE_LABEL: Record<MuscleGroup, string> = {
  chest: "Chest", back: "Back", shoulders: "Shoulders", biceps: "Biceps",
  triceps: "Triceps", forearms: "Forearms", core: "Core", quads: "Quads",
  hamstrings: "Hamstrings", glutes: "Glutes", hips: "Hips", calves: "Calves",
  full_body: "Full body", cardio: "Cardio",
};

export const EQUIPMENT_LABEL: Record<Equipment, string> = {
  bodyweight: "Bodyweight", dumbbell: "Dumbbell", barbell: "Barbell",
  kettlebell: "Kettlebell", machine: "Machine", cable: "Cable", band: "Band",
  other: "Other",
};

export const MEASURE_LABEL: Record<Measure, string> = {
  weight_reps: "Weight × reps",
  reps: "Reps only",
  duration: "Time",
  distance_duration: "Distance + time",
};

export const isMuscleGroup = (v: string): v is MuscleGroup =>
  (MUSCLE_GROUPS as readonly string[]).includes(v);
export const isEquipment = (v: string): v is Equipment =>
  (EQUIPMENT as readonly string[]).includes(v);
export const isMeasure = (v: string): v is Measure =>
  (MEASURES as readonly string[]).includes(v);

export type Exercise = {
  id: number;
  /** Catalogue exercises have a slug; a user's own do not. */
  slug: string | null;
  name: string;
  aliases: string[];
  muscleGroup: MuscleGroup;
  secondaryMuscles: string[];
  equipment: Equipment;
  measure: Measure;
  instructions: string | null;
  /** True for one the user created. */
  custom: boolean;
  /** Push, pull or a hold — where known. Never guessed. */
  force: Force | null;
  /** Several joints or one — where known. */
  mechanic: Mechanic | null;
  /** Where a catalogue entry came from; null = written for CalDef. */
  source: string | null;
};

export type Force = "push" | "pull" | "static";
export type Mechanic = "compound" | "isolation";

/** One set as stored: kilograms, metres, seconds. */
export type SetValues = {
  weightKg: number | null;
  reps: number | null;
  durationS: number | null;
  distanceM: number | null;
};

export type WorkoutSet = SetValues & {
  id: number;
  position: number;
  /** ISO timestamp, or null while the set is only planned. */
  completedAt: string | null;
};

export type SessionExercise = {
  id: number;
  exerciseId: number;
  name: string;
  measure: Measure;
  muscleGroup: string;
  equipment: string;
  position: number;
  restSeconds: number;
  repMin: number | null;
  repMax: number | null;
  targetWeightKg: number | null;
  notes: string | null;
  sets: WorkoutSet[];
};

export type WorkoutSession = {
  id: number;
  name: string;
  status: "in_progress" | "completed";
  startedAt: string;
  endedAt: string | null;
  notes: string | null;
  templateId: number | null;
  exercises: SessionExercise[];
};

export type TemplateItem = {
  exerciseId: number;
  targetSets: number;
  repMin: number | null;
  repMax: number | null;
  targetWeightKg: number | null;
  targetDurationS: number | null;
  restSeconds: number;
  notes: string | null;
};

export type WorkoutTemplate = {
  id: number;
  name: string;
  notes: string | null;
  updatedAt: string;
  /** The programme it is filed under, if any. */
  programId: number | null;
  /** Primary muscle groups of its exercises, most used first. */
  muscles: MuscleGroup[];
  items: (TemplateItem & { exerciseName: string; measure: Measure })[];
};

export type WorkoutProgram = { id: number; name: string };

/** A workout planned for a date. */
export type ScheduledWorkout = {
  id: number;
  /** ISO date, in the user's own calendar. */
  date: string;
  templateId: number;
  name: string;
  exerciseCount: number;
};
