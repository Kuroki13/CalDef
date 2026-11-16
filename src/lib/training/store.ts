import "server-only";

/**
 * Reads for the training module.
 *
 * Every query here runs as the signed-in user, so RLS decides what comes
 * back: the shared catalogue plus that user's own rows, and nothing else.
 * Rows are turned into the module's own shapes (`types.ts`) on the way out,
 * so no page handles a database row directly.
 */

import { createClient } from "@/lib/supabase/server";
import type { ExerciseSessionRecord } from "@/lib/training/metrics";
import {
  isEquipment,
  isMeasure,
  isMuscleGroup,
  type Exercise,
  type Measure,
  type SessionExercise,
  type WorkoutSession,
  type WorkoutSet,
  type WorkoutTemplate,
} from "@/lib/training/types";
import type { Tables } from "@/types/database";

const num = (value: number | string | null): number | null =>
  value === null ? null : Number(value);

function toExercise(row: Tables<"exercises">): Exercise {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    aliases: row.aliases,
    muscleGroup: isMuscleGroup(row.muscle_group) ? row.muscle_group : "full_body",
    secondaryMuscles: row.secondary_muscles,
    equipment: isEquipment(row.equipment) ? row.equipment : "other",
    measure: isMeasure(row.measure) ? row.measure : "weight_reps",
    instructions: row.instructions,
    custom: row.user_id !== null,
  };
}

const toMeasure = (value: string): Measure => (isMeasure(value) ? value : "weight_reps");

function toSet(row: Tables<"workout_sets">): WorkoutSet {
  return {
    id: row.id,
    position: row.position,
    weightKg: num(row.weight_kg),
    reps: row.reps,
    durationS: row.duration_s,
    distanceM: num(row.distance_m),
    completedAt: row.completed_at,
  };
}

type SessionExerciseRow = Tables<"workout_session_exercises"> & {
  workout_sets: Tables<"workout_sets">[];
};

function toSessionExercise(row: SessionExerciseRow): SessionExercise {
  return {
    id: row.id,
    exerciseId: row.exercise_id,
    name: row.exercise_name,
    measure: toMeasure(row.measure),
    muscleGroup: row.muscle_group,
    equipment: row.equipment,
    position: row.position,
    restSeconds: row.rest_seconds,
    repMin: row.rep_min,
    repMax: row.rep_max,
    targetWeightKg: num(row.target_weight_kg),
    notes: row.notes,
    sets: [...row.workout_sets].sort((a, b) => a.position - b.position).map(toSet),
  };
}

type SessionRow = Tables<"workout_sessions"> & {
  workout_session_exercises: SessionExerciseRow[];
};

function toSession(row: SessionRow): WorkoutSession {
  return {
    id: row.id,
    name: row.name,
    status: row.status === "completed" ? "completed" : "in_progress",
    startedAt: row.started_at,
    endedAt: row.ended_at,
    notes: row.notes,
    templateId: row.template_id,
    exercises: [...row.workout_session_exercises]
      .sort((a, b) => a.position - b.position || a.id - b.id)
      .map(toSessionExercise),
  };
}

const SESSION_SELECT = "*, workout_session_exercises(*, workout_sets(*))";

/** The catalogue and the user's own exercises, without retired ones. */
export async function listExercises(): Promise<Exercise[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("exercises")
    .select("*")
    .is("archived_at", null)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map(toExercise);
}

/** One exercise the user can see — including a retired one, for its history. */
export async function getExercise(
  id: number,
): Promise<(Exercise & { archived: boolean }) | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("exercises")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { ...toExercise(data), archived: data.archived_at !== null } : null;
}

type TemplateRow = Tables<"workout_templates"> & {
  workout_template_exercises: (Tables<"workout_template_exercises"> & {
    exercises: Pick<Tables<"exercises">, "name" | "measure"> | null;
  })[];
};

function toTemplate(row: TemplateRow): WorkoutTemplate {
  return {
    id: row.id,
    name: row.name,
    notes: row.notes,
    updatedAt: row.updated_at,
    items: [...row.workout_template_exercises]
      .sort((a, b) => a.position - b.position)
      .map((item) => ({
        exerciseId: item.exercise_id,
        exerciseName: item.exercises?.name ?? "Exercise",
        measure: toMeasure(item.exercises?.measure ?? "weight_reps"),
        targetSets: item.target_sets,
        repMin: item.rep_min,
        repMax: item.rep_max,
        targetWeightKg: num(item.target_weight_kg),
        targetDurationS: item.target_duration_s,
        restSeconds: item.rest_seconds,
        notes: item.notes,
      })),
  };
}

const TEMPLATE_SELECT = "*, workout_template_exercises(*, exercises(name, measure))";

export async function listTemplates(): Promise<WorkoutTemplate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workout_templates")
    .select(TEMPLATE_SELECT)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => toTemplate(row as TemplateRow));
}

export async function getTemplate(id: number): Promise<WorkoutTemplate | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workout_templates")
    .select(TEMPLATE_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toTemplate(data as TemplateRow) : null;
}

/** The session in progress, if there is one. There is never more than one. */
export async function getActiveSession(): Promise<WorkoutSession | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workout_sessions")
    .select(SESSION_SELECT)
    .eq("status", "in_progress")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toSession(data as SessionRow) : null;
}

/** Just enough of the session in progress to offer "Resume". */
export async function getActiveSessionSummary(): Promise<
  { id: number; name: string; startedAt: string } | null
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workout_sessions")
    .select("id, name, started_at")
    .eq("status", "in_progress")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { id: data.id, name: data.name, startedAt: data.started_at } : null;
}

export async function getSession(id: number): Promise<WorkoutSession | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workout_sessions")
    .select(SESSION_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toSession(data as SessionRow) : null;
}

/** Completed sessions, newest first. */
export async function listCompletedSessions(limit = 50): Promise<WorkoutSession[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workout_sessions")
    .select(SESSION_SELECT)
    .eq("status", "completed")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => toSession(row as SessionRow));
}

type HistoryRow = {
  exercise_id: number;
  workout_sets: Tables<"workout_sets">[];
  workout_sessions: { id: number; started_at: string; status: string };
};

/**
 * Every completed session of one exercise, oldest first.
 *
 * Keyed on the exercise's id, so a different machine or a different variant
 * — a different exercise — is never mixed in.
 */
export async function getExerciseHistory(
  exerciseId: number,
): Promise<ExerciseSessionRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workout_session_exercises")
    .select("exercise_id, workout_sets(*), workout_sessions!inner(id, started_at, status)")
    .eq("exercise_id", exerciseId)
    .eq("workout_sessions.status", "completed");
  if (error) throw new Error(error.message);
  return collectHistory((data ?? []) as unknown as HistoryRow[]).get(exerciseId) ?? [];
}

/**
 * The last completed session of each of these exercises — what the active
 * session shows as "last time". `excludeSessionId` keeps the session in
 * progress from being its own precedent.
 */
export async function getPreviousPerformance(
  exerciseIds: readonly number[],
  excludeSessionId: number | null,
): Promise<Record<number, ExerciseSessionRecord>> {
  if (exerciseIds.length === 0) return {};
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workout_session_exercises")
    .select("exercise_id, workout_sets(*), workout_sessions!inner(id, started_at, status)")
    .in("exercise_id", [...new Set(exerciseIds)])
    .eq("workout_sessions.status", "completed");
  if (error) throw new Error(error.message);

  const out: Record<number, ExerciseSessionRecord> = {};
  for (const [exerciseId, records] of collectHistory((data ?? []) as unknown as HistoryRow[])) {
    const last = records.filter((r) => r.sessionId !== excludeSessionId).at(-1);
    if (last) out[exerciseId] = last;
  }
  return out;
}

/**
 * Groups rows by exercise, one record per session, oldest first. An
 * exercise that appears twice in one session is one record with all its
 * sets.
 */
function collectHistory(rows: readonly HistoryRow[]): Map<number, ExerciseSessionRecord[]> {
  const byExercise = new Map<number, Map<number, ExerciseSessionRecord>>();
  for (const row of rows) {
    const sessions = byExercise.get(row.exercise_id) ?? new Map<number, ExerciseSessionRecord>();
    byExercise.set(row.exercise_id, sessions);
    const record = sessions.get(row.workout_sessions.id) ?? {
      sessionId: row.workout_sessions.id,
      date: row.workout_sessions.started_at,
      sets: [],
    };
    sessions.set(record.sessionId, record);
    record.sets.push(
      ...[...row.workout_sets]
        .sort((a, b) => a.position - b.position)
        .map(toSet)
        .filter((set) => set.completedAt !== null),
    );
  }
  const out = new Map<number, ExerciseSessionRecord[]>();
  for (const [exerciseId, sessions] of byExercise) {
    out.set(
      exerciseId,
      [...sessions.values()]
        .filter((record) => record.sets.length > 0)
        .sort((a, b) => a.date.localeCompare(b.date)),
    );
  }
  return out;
}
