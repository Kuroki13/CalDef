"use server";

/**
 * Every write of the training module.
 *
 * Each action: checks there is a signed-in user, parses its input
 * (`lib/training/input.ts`), and writes as that user — so RLS, not this
 * file, is what stops one account reaching another's rows. The checks made
 * here on top are about meaning, not ownership: a set of a finished session
 * is history and is not edited through the live-session path.
 *
 * Nothing here calls a model, and nothing here touches a calorie target.
 */

import { revalidatePath } from "next/cache";

import { createClient, requireUserId } from "@/lib/supabase/server";
import {
  clampCompletedAt,
  customExerciseSchema,
  firstIssue,
  notesSchema,
  positiveId,
  restSchema,
  setSchema,
  startSchema,
  templateSchema,
} from "@/lib/training/input";
import { isCompletable, type ExerciseSessionRecord } from "@/lib/training/metrics";
import { getPreviousPerformance } from "@/lib/training/store";
import { isMeasure, type SessionExercise, type WorkoutSet } from "@/lib/training/types";
import { z } from "zod";

export type ActionResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

const GENERIC = "That could not be saved. Please try again.";

function revalidateTraining() {
  revalidatePath("/training", "layout");
  revalidatePath("/dashboard");
}

// ------------------------------------------------------------------ exercises

export async function createExerciseAction(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  const parsed = customExerciseSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const userId = await requireUserId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("exercises")
    .insert({
      user_id: userId,
      name: parsed.data.name,
      muscle_group: parsed.data.muscleGroup,
      equipment: parsed.data.equipment,
      measure: parsed.data.measure,
      instructions: parsed.data.instructions || null,
    })
    .select("id")
    .single();
  if (error) return fail(GENERIC);

  revalidateTraining();
  return { ok: true, id: data.id };
}

/**
 * Edits one of the user's own exercises.
 *
 * How it is measured cannot change once it exists: sessions already logged
 * recorded weight and reps, or a time, and a different measure would make
 * its own history unreadable. Create a new exercise instead.
 */
export async function updateExerciseAction(
  id: unknown,
  input: unknown,
): Promise<ActionResult> {
  const exerciseId = positiveId.safeParse(id);
  const parsed = customExerciseSchema.omit({ measure: true }).safeParse(input);
  if (!exerciseId.success) return fail(GENERIC);
  if (!parsed.success) return fail(firstIssue(parsed.error));

  await requireUserId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("exercises")
    .update({
      name: parsed.data.name,
      muscle_group: parsed.data.muscleGroup,
      equipment: parsed.data.equipment,
      instructions: parsed.data.instructions || null,
    })
    .eq("id", exerciseId.data)
    .select("id");
  if (error) return fail(GENERIC);
  // The catalogue is not editable; RLS made the update touch nothing.
  if (!data || data.length === 0) return fail("That exercise cannot be edited.");

  revalidateTraining();
  return { ok: true };
}

/**
 * Removes one of the user's own exercises.
 *
 * Deleted outright when nothing refers to it. Where a template or a logged
 * session does, it is retired instead — hidden from the picker, kept for
 * the history that points at it.
 */
export async function removeExerciseAction(
  id: unknown,
): Promise<ActionResult<{ archived: boolean }>> {
  const exerciseId = positiveId.safeParse(id);
  if (!exerciseId.success) return fail(GENERIC);

  await requireUserId();
  const supabase = await createClient();
  const deleted = await supabase
    .from("exercises")
    .delete()
    .eq("id", exerciseId.data)
    .select("id");

  if (!deleted.error) {
    if (!deleted.data || deleted.data.length === 0) {
      return fail("That exercise cannot be removed.");
    }
    revalidateTraining();
    return { ok: true, archived: false };
  }

  // 23503: something still points at it.
  if (deleted.error.code !== "23503") return fail(GENERIC);
  const archived = await supabase
    .from("exercises")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", exerciseId.data)
    .select("id");
  if (archived.error || !archived.data || archived.data.length === 0) return fail(GENERIC);

  revalidateTraining();
  return { ok: true, archived: true };
}

// ------------------------------------------------------------------ templates

export async function saveTemplateAction(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));

  await requireUserId();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_workout_template", {
    // The generated type marks every argument required; null is "new".
    p_id: parsed.data.id as number,
    p_name: parsed.data.name,
    p_notes: (parsed.data.notes || null) as string,
    p_items: parsed.data.items.map((item) => ({
      exercise_id: item.exerciseId,
      target_sets: item.targetSets,
      rep_min: item.repMin,
      rep_max: item.repMax,
      target_weight_kg: item.targetWeightKg,
      target_duration_s: item.targetDurationS,
      rest_seconds: item.restSeconds,
      notes: item.notes || null,
    })),
  });
  if (error) {
    // 42501: an exercise in the list is not one this user can see.
    if (error.code === "42501") return fail("One of those exercises is not available.");
    if (error.code === "P0002") return fail("That workout no longer exists.");
    return fail(GENERIC);
  }

  revalidateTraining();
  return { ok: true, id: data };
}

export async function deleteTemplateAction(id: unknown): Promise<ActionResult> {
  const templateId = positiveId.safeParse(id);
  if (!templateId.success) return fail(GENERIC);

  await requireUserId();
  const supabase = await createClient();
  // Sessions started from it keep their own copy; their link becomes null.
  const { error } = await supabase
    .from("workout_templates")
    .delete()
    .eq("id", templateId.data);
  if (error) return fail(GENERIC);

  revalidateTraining();
  return { ok: true };
}

export async function duplicateTemplateAction(
  id: unknown,
): Promise<ActionResult<{ id: number }>> {
  const templateId = positiveId.safeParse(id);
  if (!templateId.success) return fail(GENERIC);

  await requireUserId();
  const supabase = await createClient();
  const { data: source, error } = await supabase
    .from("workout_templates")
    .select("name, notes, workout_template_exercises(*)")
    .eq("id", templateId.data)
    .maybeSingle();
  if (error || !source) return fail("That workout no longer exists.");

  const copy = await supabase.rpc("save_workout_template", {
    p_id: null as unknown as number,
    p_name: `${source.name} (copy)`.slice(0, 80),
    p_notes: source.notes as string,
    p_items: [...source.workout_template_exercises]
      .sort((a, b) => a.position - b.position)
      .map((item) => ({
        exercise_id: item.exercise_id,
        target_sets: item.target_sets,
        rep_min: item.rep_min,
        rep_max: item.rep_max,
        target_weight_kg: item.target_weight_kg,
        target_duration_s: item.target_duration_s,
        rest_seconds: item.rest_seconds,
        notes: item.notes,
      })),
  });
  if (copy.error) return fail(GENERIC);

  revalidateTraining();
  return { ok: true, id: copy.data };
}

// ------------------------------------------------------------------- sessions

/**
 * Starts a session, or returns the one already running.
 *
 * The token comes from the browser, made when "Start" was tapped. A double
 * tap or a retried request carries the same token and gets the same session
 * (`start_workout`, migration 20261116000001). `resumed` is true when a
 * different session was already in progress and is being opened instead.
 */
export async function startWorkoutAction(
  input: unknown,
): Promise<ActionResult<{ sessionId: number; resumed: boolean }>> {
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return fail(GENERIC);

  await requireUserId();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_workout", {
    p_token: parsed.data.token,
    p_name: (parsed.data.name || null) as string,
    p_template_id: parsed.data.templateId as number,
    p_from_session: parsed.data.fromSessionId as number,
    // The plan link (migration 20261118000003). The database links only a
    // plan of this user, for this workout, not already carried out.
    p_schedule_id: (parsed.data.scheduleId ?? null) as number,
  });
  if (error) {
    if (error.code === "P0002") return fail("That workout no longer exists.");
    return fail("The session could not be started. Please try again.");
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return fail("The session could not be started. Please try again.");

  revalidateTraining();
  return { ok: true, sessionId: row.session_id, resumed: row.resumed };
}

export type SaveSetResult =
  | { ok: true }
  | { ok: false; retry: false; error: string };

/**
 * Makes a set equal to what the browser holds. Safe to send twice.
 *
 * Refuses a set that is not part of a session in progress: a finished
 * session is history. A refusal is final (`retry: false`), so the browser's
 * queue reports it instead of resending it forever; a network failure
 * never reaches here and is retried by the queue.
 */
export async function saveSetAction(input: unknown): Promise<SaveSetResult> {
  const parsed = setSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, retry: false, error: firstIssue(parsed.error) };
  }

  await requireUserId();
  const supabase = await createClient();

  const { data: owner, error: ownerError } = await supabase
    .from("workout_sets")
    .select("id, workout_session_exercises!inner(workout_sessions!inner(status))")
    .eq("id", parsed.data.setId)
    .maybeSingle();
  if (ownerError) throw new Error(ownerError.message);
  if (!owner) {
    return { ok: false, retry: false, error: "That set no longer exists." };
  }
  if (owner.workout_session_exercises.workout_sessions.status !== "in_progress") {
    return { ok: false, retry: false, error: "That session is already finished." };
  }

  const { error } = await supabase
    .from("workout_sets")
    .update({
      weight_kg: parsed.data.weightKg,
      reps: parsed.data.reps,
      duration_s: parsed.data.durationS,
      distance_m: parsed.data.distanceM,
      completed_at: clampCompletedAt(parsed.data.completedAt),
    })
    .eq("id", parsed.data.setId);
  // A database failure is worth another attempt: throwing makes the queue
  // keep the save and retry it.
  if (error) throw new Error(error.message);

  return { ok: true };
}

function rowToSet(row: {
  id: number; position: number; weight_kg: number | null; reps: number | null;
  duration_s: number | null; distance_m: number | null; completed_at: string | null;
}): WorkoutSet {
  return {
    id: row.id,
    position: row.position,
    weightKg: row.weight_kg === null ? null : Number(row.weight_kg),
    reps: row.reps,
    durationS: row.duration_s,
    distanceM: row.distance_m === null ? null : Number(row.distance_m),
    completedAt: row.completed_at,
  };
}

const addSetSchema = z.object({
  sessionExerciseId: positiveId,
  position: z.number().int().min(0).max(49),
  weightKg: z.number().min(0).max(2000).nullable(),
  durationS: z.number().int().min(0).max(86400).nullable(),
});

/**
 * Adds a planned set at a position. Adding the same position twice — a
 * double tap, a retry — adds it once and returns the set that is there.
 */
export async function addSetAction(
  input: unknown,
): Promise<ActionResult<{ set: WorkoutSet }>> {
  const parsed = addSetSchema.safeParse(input);
  if (!parsed.success) return fail("That set could not be added.");

  await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase.from("workout_sets").upsert(
    {
      session_exercise_id: parsed.data.sessionExerciseId,
      position: parsed.data.position,
      weight_kg: parsed.data.weightKg,
      duration_s: parsed.data.durationS,
    },
    { onConflict: "session_exercise_id,position", ignoreDuplicates: true },
  );
  if (error) return fail("That set could not be added.");

  const { data, error: readError } = await supabase
    .from("workout_sets")
    .select("*")
    .eq("session_exercise_id", parsed.data.sessionExerciseId)
    .eq("position", parsed.data.position)
    .maybeSingle();
  if (readError || !data) return fail("That set could not be added.");

  return { ok: true, set: rowToSet(data) };
}

export async function removeSetAction(id: unknown): Promise<ActionResult> {
  const setId = positiveId.safeParse(id);
  if (!setId.success) return fail(GENERIC);

  await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase.from("workout_sets").delete().eq("id", setId.data);
  if (error) return fail("That set could not be removed.");
  return { ok: true };
}

const addExercisesSchema = z.object({
  sessionId: positiveId,
  exerciseIds: z.array(positiveId).min(1).max(20),
});

/** How many planned sets a freshly added exercise starts with. */
const DEFAULT_SETS = 3;

/**
 * Adds exercises to the session in progress — and only to the session.
 * The template it was started from is not changed.
 */
export async function addSessionExercisesAction(
  input: unknown,
): Promise<
  ActionResult<{
    exercises: SessionExercise[];
    /** Last time's sets of each added exercise, so "Previous" is not blank. */
    previous: Record<number, ExerciseSessionRecord>;
  }>
> {
  const parsed = addExercisesSchema.safeParse(input);
  if (!parsed.success) return fail("Those exercises could not be added.");

  await requireUserId();
  const supabase = await createClient();

  const [{ data: session }, { data: found }, { data: last }] = await Promise.all([
    supabase
      .from("workout_sessions")
      .select("id, status")
      .eq("id", parsed.data.sessionId)
      .maybeSingle(),
    supabase.from("exercises").select("*").in("id", parsed.data.exerciseIds),
    supabase
      .from("workout_session_exercises")
      .select("position")
      .eq("session_id", parsed.data.sessionId)
      .order("position", { ascending: false })
      .limit(1),
  ]);
  if (!session || session.status !== "in_progress") {
    return fail("That session is not in progress.");
  }
  const byId = new Map((found ?? []).map((row) => [row.id, row]));
  const chosen = parsed.data.exerciseIds.flatMap((id) => byId.get(id) ?? []);
  if (chosen.length === 0) return fail("Those exercises are not available.");

  let position = (last?.[0]?.position ?? -1) + 1;
  if (position + chosen.length > 100) return fail("A session can hold at most 100 exercises.");

  const { data: added, error } = await supabase
    .from("workout_session_exercises")
    .insert(
      chosen.map((exercise) => ({
        session_id: parsed.data.sessionId,
        exercise_id: exercise.id,
        exercise_name: exercise.name,
        measure: exercise.measure,
        muscle_group: exercise.muscle_group,
        equipment: exercise.equipment,
        position: position++,
      })),
    )
    .select("*");
  if (error || !added) return fail("Those exercises could not be added.");

  const { data: sets, error: setsError } = await supabase
    .from("workout_sets")
    .insert(
      added.flatMap((row) =>
        Array.from({ length: DEFAULT_SETS }, (_, i) => ({
          session_exercise_id: row.id,
          position: i,
        })),
      ),
    )
    .select("*");
  // The exercises are there even if their starting sets are not; a set can
  // be added by hand, so this is reported as a success with what exists.
  const setRows = setsError || !sets ? [] : sets;

  // Shown beside the new rows straight away. If it cannot be read the
  // exercises are still added; "Previous" is then empty until a reload.
  const previous = await getPreviousPerformance(
    chosen.map((exercise) => exercise.id),
    parsed.data.sessionId,
  ).catch(() => ({}));

  return {
    ok: true,
    previous,
    exercises: added
      .sort((a, b) => a.position - b.position)
      .map((row) => ({
        id: row.id,
        exerciseId: row.exercise_id,
        name: row.exercise_name,
        measure: isMeasure(row.measure) ? row.measure : "weight_reps",
        muscleGroup: row.muscle_group,
        equipment: row.equipment,
        position: row.position,
        restSeconds: row.rest_seconds,
        repMin: row.rep_min,
        repMax: row.rep_max,
        targetWeightKg: null,
        notes: row.notes,
        sets: setRows
          .filter((set) => set.session_exercise_id === row.id)
          .sort((a, b) => a.position - b.position)
          .map(rowToSet),
      })),
  };
}

const replaceSchema = z.object({
  sessionExerciseId: positiveId,
  exerciseId: positiveId,
});

/**
 * Swaps one exercise of the session for another — the bench is taken, so
 * dumbbells today. Sets already completed belong to the old exercise and
 * would be nonsense under the new one, so the swap is refused once any set
 * is done: finish it as it is and add the other exercise instead.
 */
export async function replaceSessionExerciseAction(
  input: unknown,
): Promise<
  ActionResult<{
    exercise: SessionExercise;
    previous: Record<number, ExerciseSessionRecord>;
  }>
> {
  const parsed = replaceSchema.safeParse(input);
  if (!parsed.success) return fail("That exercise could not be replaced.");

  await requireUserId();
  const supabase = await createClient();
  const [{ data: current }, { data: next }] = await Promise.all([
    supabase
      .from("workout_session_exercises")
      .select("*, workout_sets(*), workout_sessions!inner(id, status)")
      .eq("id", parsed.data.sessionExerciseId)
      .maybeSingle(),
    supabase.from("exercises").select("*").eq("id", parsed.data.exerciseId).maybeSingle(),
  ]);
  if (!current || !next) return fail("That exercise is not available.");
  if (current.workout_sessions.status !== "in_progress") {
    return fail("That session is not in progress.");
  }
  if (current.workout_sets.some((set) => set.completed_at !== null)) {
    return fail("This exercise already has completed sets. Add the other exercise instead.");
  }

  const { error } = await supabase
    .from("workout_session_exercises")
    .update({
      exercise_id: next.id,
      exercise_name: next.name,
      measure: next.measure,
      muscle_group: next.muscle_group,
      equipment: next.equipment,
      // Targets were written for the old exercise.
      rep_min: null,
      rep_max: null,
      target_weight_kg: null,
    })
    .eq("id", current.id);
  if (error) return fail("That exercise could not be replaced.");

  // Planned values (a target weight) were for the old exercise too.
  const { data: sets } = await supabase
    .from("workout_sets")
    .update({ weight_kg: null, reps: null, duration_s: null, distance_m: null })
    .eq("session_exercise_id", current.id)
    .select("*");

  const previous = await getPreviousPerformance(
    [next.id],
    current.workout_sessions.id,
  ).catch(() => ({}));

  return {
    ok: true,
    previous,
    exercise: {
      id: current.id,
      exerciseId: next.id,
      name: next.name,
      measure: isMeasure(next.measure) ? next.measure : "weight_reps",
      muscleGroup: next.muscle_group,
      equipment: next.equipment,
      position: current.position,
      restSeconds: current.rest_seconds,
      repMin: null,
      repMax: null,
      targetWeightKg: null,
      notes: current.notes,
      sets: (sets ?? current.workout_sets)
        .sort((a, b) => a.position - b.position)
        .map((row) => rowToSet({ ...row, weight_kg: null, reps: null, duration_s: null, distance_m: null })),
    },
  };
}

export async function removeSessionExerciseAction(id: unknown): Promise<ActionResult> {
  const sessionExerciseId = positiveId.safeParse(id);
  if (!sessionExerciseId.success) return fail(GENERIC);

  await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("workout_session_exercises")
    .delete()
    .eq("id", sessionExerciseId.data);
  if (error) return fail("That exercise could not be removed.");
  return { ok: true };
}

const exerciseDetailsSchema = z.object({
  sessionExerciseId: positiveId,
  notes: z.string().trim().max(500).nullable().optional(),
  restSeconds: restSchema.optional(),
});

/** Notes and rest time of one exercise, in this session only. */
export async function updateSessionExerciseAction(input: unknown): Promise<ActionResult> {
  const parsed = exerciseDetailsSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const patch: { notes?: string | null; rest_seconds?: number } = {};
  if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes || null;
  if (parsed.data.restSeconds !== undefined) patch.rest_seconds = parsed.data.restSeconds;
  if (Object.keys(patch).length === 0) return { ok: true };

  await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("workout_session_exercises")
    .update(patch)
    .eq("id", parsed.data.sessionExerciseId);
  if (error) return fail(GENERIC);
  return { ok: true };
}

export async function updateSessionNotesAction(
  id: unknown,
  notes: unknown,
): Promise<ActionResult> {
  const sessionId = positiveId.safeParse(id);
  const parsed = notesSchema.safeParse(notes);
  if (!sessionId.success) return fail(GENERIC);
  if (!parsed.success) return fail("That note is too long.");

  await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("workout_sessions")
    .update({ notes: parsed.data || null })
    .eq("id", sessionId.data);
  if (error) return fail(GENERIC);

  revalidatePath(`/training/history/${sessionId.data}`);
  return { ok: true };
}

/**
 * Finishes the session. The caller has already flushed every pending save;
 * the answer here is the database's confirmation, and only after it does
 * the screen say "finished".
 *
 * `empty` means nothing was completed — there is nothing to record, and
 * the choice offered is to keep going or to discard.
 */
export async function finishWorkoutAction(
  id: unknown,
): Promise<ActionResult | { ok: false; error: string; empty: true }> {
  const sessionId = positiveId.safeParse(id);
  if (!sessionId.success) return fail(GENERIC);

  await requireUserId();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finish_workout", {
    p_session_id: sessionId.data,
  });
  if (error) return fail("The session could not be finished. Please try again.");
  if (data === "empty") {
    return {
      ok: false,
      empty: true,
      error: "No set is ticked yet. Tick what you did, or discard the session.",
    };
  }
  if (data !== "completed") return fail("That session no longer exists.");

  revalidateTraining();
  return { ok: true };
}

/** Abandons the session in progress: it is deleted, sets and all. */
export async function discardWorkoutAction(id: unknown): Promise<ActionResult> {
  const sessionId = positiveId.safeParse(id);
  if (!sessionId.success) return fail(GENERIC);

  await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("workout_sessions")
    .delete()
    .eq("id", sessionId.data)
    .eq("status", "in_progress");
  if (error) return fail("The session could not be discarded. Please try again.");

  revalidateTraining();
  return { ok: true };
}

/** Deletes a completed session from history. */
export async function deleteSessionAction(id: unknown): Promise<ActionResult> {
  const sessionId = positiveId.safeParse(id);
  if (!sessionId.success) return fail(GENERIC);

  await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("workout_sessions")
    .delete()
    .eq("id", sessionId.data)
    .eq("status", "completed");
  if (error) return fail("The session could not be deleted. Please try again.");

  revalidateTraining();
  return { ok: true };
}

// ----------------------------------------------------------------- programmes

const programName = z.string().trim().min(1, "Give the programme a name.").max(80);

export async function createProgramAction(
  name: unknown,
): Promise<ActionResult<{ id: number }>> {
  const parsed = programName.safeParse(name);
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const userId = await requireUserId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workout_programs")
    .insert({ user_id: userId, name: parsed.data })
    .select("id")
    .single();
  if (error) return fail(GENERIC);

  revalidateTraining();
  return { ok: true, id: data.id };
}

/** Deletes a programme. Its workouts are released, not deleted. */
export async function deleteProgramAction(id: unknown): Promise<ActionResult> {
  const programId = positiveId.safeParse(id);
  if (!programId.success) return fail(GENERIC);

  await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase.from("workout_programs").delete().eq("id", programId.data);
  if (error) return fail(GENERIC);

  revalidateTraining();
  return { ok: true };
}

const assignSchema = z.object({ templateId: positiveId, programId: positiveId.nullable() });

/** Files a workout under a programme, or takes it out of one (null). */
export async function assignProgramAction(input: unknown): Promise<ActionResult> {
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return fail(GENERIC);

  await requireUserId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workout_templates")
    .update({ program_id: parsed.data.programId })
    .eq("id", parsed.data.templateId)
    .select("id");
  // 42501: the programme is not this user's.
  if (error) return fail(error.code === "42501" ? "That programme is not available." : GENERIC);
  if (!data || data.length === 0) return fail("That workout no longer exists.");

  revalidateTraining();
  return { ok: true };
}

// ------------------------------------------------------------------- planning

const planSchema = z.object({ templateId: positiveId, date: z.iso.date() });

/**
 * Plans a workout for a date. Planning the same workout on the same day
 * again changes nothing. A plan is a note to oneself: it starts nothing and
 * changes no target.
 */
export async function scheduleWorkoutAction(input: unknown): Promise<ActionResult> {
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return fail("Choose a valid date.");

  const userId = await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase.from("workout_schedule").upsert(
    { user_id: userId, template_id: parsed.data.templateId, scheduled_on: parsed.data.date },
    { onConflict: "user_id,template_id,scheduled_on", ignoreDuplicates: true },
  );
  if (error) return fail(error.code === "42501" ? "That workout is not available." : GENERIC);

  revalidateTraining();
  return { ok: true };
}

const moveSchema = z.object({ id: positiveId, date: z.iso.date() });

/** Moves one planned occurrence to another day. The workout is untouched. */
export async function moveScheduledAction(input: unknown): Promise<ActionResult> {
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return fail("Choose a valid date.");

  await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("workout_schedule")
    .update({ scheduled_on: parsed.data.date })
    .eq("id", parsed.data.id);
  // 23505: it is already planned on that day — which is what was asked for.
  if (error && error.code !== "23505") return fail(GENERIC);
  if (error) {
    await supabase.from("workout_schedule").delete().eq("id", parsed.data.id);
  }

  revalidateTraining();
  return { ok: true };
}

/** Cancels one planned occurrence. The workout is untouched. */
export async function cancelScheduledAction(id: unknown): Promise<ActionResult> {
  const scheduleId = positiveId.safeParse(id);
  if (!scheduleId.success) return fail(GENERIC);

  await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase.from("workout_schedule").delete().eq("id", scheduleId.data);
  if (error) return fail(GENERIC);

  revalidateTraining();
  return { ok: true };
}

// ---------------------------------------------------------------- corrections

const correctionSchema = setSchema.omit({ completedAt: true });

/**
 * Corrects a set of a FINISHED session — a typo noticed afterwards.
 *
 * The live path (`saveSetAction`) refuses finished sessions; this one
 * accepts only them. The set stays completed, at the time it was done: a
 * correction changes what was recorded, not when. The corrected values
 * must still be a complete set for what the exercise measures, so history
 * never holds half a set.
 */
export async function correctSetAction(input: unknown): Promise<ActionResult> {
  const parsed = correctionSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));

  await requireUserId();
  const supabase = await createClient();
  const { data: owner } = await supabase
    .from("workout_sets")
    .select("id, workout_session_exercises!inner(measure, session_id, workout_sessions!inner(status))")
    .eq("id", parsed.data.setId)
    .maybeSingle();
  if (!owner) return fail("That set no longer exists.");
  const parent = owner.workout_session_exercises;
  if (parent.workout_sessions.status !== "completed") {
    return fail("That session is still in progress.");
  }
  const measure = isMeasure(parent.measure) ? parent.measure : "weight_reps";
  if (!isCompletable(measure, parsed.data)) {
    return fail("Enter the full set — every figure this exercise records.");
  }

  const { error } = await supabase
    .from("workout_sets")
    .update({
      weight_kg: parsed.data.weightKg,
      reps: parsed.data.reps,
      duration_s: parsed.data.durationS,
      distance_m: parsed.data.distanceM,
    })
    .eq("id", parsed.data.setId);
  if (error) return fail(GENERIC);

  revalidateTraining();
  return { ok: true };
}

const appendSchema = z.object({ templateId: positiveId, exerciseId: positiveId });

/**
 * Adds one exercise to the end of a workout, from the exercise's own page.
 * Three sets and the default rest; the editor is where the rest is set.
 */
export async function appendTemplateExerciseAction(input: unknown): Promise<ActionResult> {
  const parsed = appendSchema.safeParse(input);
  if (!parsed.success) return fail(GENERIC);

  await requireUserId();
  const supabase = await createClient();
  const { data: last, error: readError } = await supabase
    .from("workout_template_exercises")
    .select("position")
    .eq("template_id", parsed.data.templateId)
    .order("position", { ascending: false })
    .limit(1);
  if (readError) return fail(GENERIC);
  const position = (last?.[0]?.position ?? -1) + 1;
  if (position > 39) return fail("That workout is full.");

  const { error } = await supabase.from("workout_template_exercises").insert({
    template_id: parsed.data.templateId,
    exercise_id: parsed.data.exerciseId,
    position,
  });
  if (error) {
    return fail(error.code === "42501" ? "That workout or exercise is not available." : GENERIC);
  }

  revalidateTraining();
  return { ok: true };
}
