import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A stand-in for the Supabase client: every `from()` hands back the next
 * prepared answer and records what was asked of it. The real isolation
 * between users is the database's (supabase/tests/training.sql); what is
 * tested here is what the actions accept, send and report.
 */
type Answer = { data?: unknown; error?: { code?: string; message?: string } | null };
type Call = { table: string; ops: [string, unknown[]][] };

const answers: Answer[] = [];
const calls: Call[] = [];
const rpc = vi.fn();

function builder(table: string) {
  const call: Call = { table, ops: [] };
  calls.push(call);
  const answer = answers.shift() ?? { data: null, error: null };
  const result = { data: answer.data ?? null, error: answer.error ?? null };
  const chain: Record<string, unknown> = {};
  for (const op of ["select", "eq", "in", "is", "order", "limit", "update", "insert", "delete", "upsert"]) {
    chain[op] = (...args: unknown[]) => {
      call.ops.push([op, args]);
      return chain;
    };
  }
  chain.maybeSingle = async () => result;
  chain.single = async () => result;
  chain.then = (resolve: (value: typeof result) => unknown) => resolve(result);
  return chain;
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  requireUserId: async () => "user-a",
  createClient: async () => ({ from: (table: string) => builder(table), rpc }),
}));

const getPreviousPerformance = vi.fn(async () => ({}));
vi.mock("@/lib/training/store", () => ({
  getPreviousPerformance: (...args: unknown[]) => getPreviousPerformance(...(args as [])),
}));

const actions = await import("@/app/(app)/training/actions");

const op = (call: Call, name: string) => call.ops.find(([n]) => n === name)?.[1];

beforeEach(() => {
  answers.length = 0;
  calls.length = 0;
  rpc.mockReset();
});

const item = (over = {}) => ({
  exerciseId: 5, targetSets: 3, repMin: 8, repMax: 12, targetWeightKg: 80,
  targetDurationS: null, restSeconds: 90, notes: null, ...over,
});

describe("saveTemplateAction", () => {
  it("creates a template in one atomic call, in the order given", async () => {
    rpc.mockResolvedValue({ data: 11, error: null });
    const result = await actions.saveTemplateAction({
      id: null, name: "  Push A ", notes: null,
      items: [item(), item({ exerciseId: 9, repMin: null, repMax: null, targetWeightKg: null })],
    });

    expect(result).toEqual({ ok: true, id: 11 });
    expect(rpc).toHaveBeenCalledOnce();
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("save_workout_template");
    expect(args.p_id).toBeNull();
    expect(args.p_name).toBe("Push A");
    expect(args.p_items.map((i: { exercise_id: number }) => i.exercise_id)).toEqual([5, 9]);
    expect(args.p_items[0]).toMatchObject({ target_sets: 3, rep_min: 8, rep_max: 12, target_weight_kg: 80, rest_seconds: 90 });
  });

  it("updates an existing template by id", async () => {
    rpc.mockResolvedValue({ data: 11, error: null });
    await actions.saveTemplateAction({ id: 11, name: "Push A", notes: "Heavy", items: [item()] });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_id: 11, p_notes: "Heavy" });
  });

  it("refuses bad input before the database is asked anything", async () => {
    const bad = [
      { id: null, name: "", notes: null, items: [item()] },
      { id: null, name: "Push A", notes: null, items: [] },
      { id: null, name: "Push A", notes: null, items: [item({ repMin: 12, repMax: 8 })] },
      { id: null, name: "Push A", notes: null, items: [item({ targetSets: 0 })] },
      { id: null, name: "Push A", notes: null, items: [item({ targetWeightKg: -5 })] },
      { id: null, name: "Push A", notes: null, items: [item({ restSeconds: 99999 })] },
      { id: null, name: "Push A", notes: null, items: [item({ exerciseId: "5; drop table" })] },
      "not an object",
    ];
    for (const input of bad) {
      const result = await actions.saveTemplateAction(input);
      expect(result.ok, JSON.stringify(input)).toBe(false);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("says so when an exercise is not one this user may use", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    const result = await actions.saveTemplateAction({ id: null, name: "Push A", notes: null, items: [item()] });
    expect(result).toEqual({ ok: false, error: "One of those exercises is not available." });
  });

  it("reports a template that is gone, or someone else's, as not existing", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0002" } });
    const result = await actions.saveTemplateAction({ id: 999, name: "Push A", notes: null, items: [item()] });
    expect(result).toEqual({ ok: false, error: "That workout no longer exists." });
  });
});

describe("startWorkoutAction", () => {
  const token = "3f2b8c1e-5a4d-4e6f-8a9b-0c1d2e3f4a5b";

  it("sends the browser's token, so a retry reaches the same session", async () => {
    rpc.mockResolvedValue({ data: [{ session_id: 7, resumed: false }], error: null });
    const result = await actions.startWorkoutAction({ token, templateId: 11, fromSessionId: null, name: null });
    expect(result).toEqual({ ok: true, sessionId: 7, resumed: false });
    expect(rpc).toHaveBeenCalledWith("start_workout", {
      p_token: token, p_name: null, p_template_id: 11, p_from_session: null,
    });
  });

  it("passes on that a session was already running", async () => {
    rpc.mockResolvedValue({ data: [{ session_id: 3, resumed: true }], error: null });
    const result = await actions.startWorkoutAction({ token, templateId: 11, fromSessionId: null, name: null });
    expect(result).toMatchObject({ ok: true, sessionId: 3, resumed: true });
  });

  it("refuses a start without a real token", async () => {
    const result = await actions.startWorkoutAction({ token: "abc", templateId: 11, fromSessionId: null, name: null });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("saveSetAction", () => {
  const set = (over = {}) => ({
    setId: 21, weightKg: 80, reps: 8, durationS: null, distanceM: null,
    completedAt: "2026-11-16T10:00:00.000Z", ...over,
  });
  const inProgress = { data: { id: 21, workout_session_exercises: { workout_sessions: { status: "in_progress" } } } };

  it("writes the set as given", async () => {
    answers.push(inProgress, { error: null });
    expect(await actions.saveSetAction(set())).toEqual({ ok: true });
    expect(calls[1].table).toBe("workout_sets");
    expect(op(calls[1], "update")?.[0]).toEqual({
      weight_kg: 80, reps: 8, duration_s: null, distance_m: null,
      completed_at: "2026-11-16T10:00:00.000Z",
    });
    expect(op(calls[1], "eq")).toEqual(["id", 21]);
  });

  it("refuses impossible values for good, without touching the database", async () => {
    const bad = [
      set({ reps: -1 }),
      set({ reps: 8.5 }),
      set({ weightKg: -20 }),
      set({ weightKg: 99999 }),
      set({ durationS: 999999 }),
      set({ setId: 0 }),
      set({ weightKg: "80" }),
      set({ completedAt: "yesterday" }),
    ];
    for (const input of bad) {
      const result = await actions.saveSetAction(input);
      expect(result, JSON.stringify(input)).toMatchObject({ ok: false, retry: false });
    }
    expect(calls).toHaveLength(0);
  });

  it("refuses a set that is not there — deleted, or another user's", async () => {
    answers.push({ data: null });
    expect(await actions.saveSetAction(set())).toEqual({
      ok: false, retry: false, error: "That set no longer exists.",
    });
    expect(calls).toHaveLength(1); // looked up, never written
  });

  it("does not rewrite a finished session", async () => {
    answers.push({ data: { id: 21, workout_session_exercises: { workout_sessions: { status: "completed" } } } });
    expect(await actions.saveSetAction(set())).toMatchObject({ ok: false, retry: false });
    expect(calls).toHaveLength(1);
  });

  it("throws on a database failure, so the browser keeps the save and retries", async () => {
    answers.push(inProgress, { error: { message: "connection reset" } });
    await expect(actions.saveSetAction(set())).rejects.toThrow("connection reset");
  });

  it("keeps a set ticked on a phone whose clock runs fast, dated now instead", async () => {
    answers.push(inProgress, { error: null });
    const ahead = new Date(Date.now() + 3600_000).toISOString();
    expect(await actions.saveSetAction(set({ completedAt: ahead }))).toEqual({ ok: true });
    const stored = (op(calls[1], "update")?.[0] as { completed_at: string }).completed_at;
    expect(Date.parse(stored)).toBeLessThanOrEqual(Date.now());
    expect(Date.parse(stored)).toBeGreaterThan(Date.now() - 5000);
  });

  it("can un-complete a set", async () => {
    answers.push(inProgress, { error: null });
    await actions.saveSetAction(set({ completedAt: null }));
    expect(op(calls[1], "update")?.[0]).toMatchObject({ completed_at: null });
  });
});

describe("addSetAction", () => {
  it("adds by position without duplicating, and returns the set that is there", async () => {
    answers.push({ error: null }, { data: { id: 30, position: 3, weight_kg: 80, reps: null, duration_s: null, distance_m: null, completed_at: null } });
    const result = await actions.addSetAction({ sessionExerciseId: 4, position: 3, weightKg: 80, durationS: null });
    expect(result).toMatchObject({ ok: true, set: { id: 30, position: 3, weightKg: 80 } });
    expect(op(calls[0], "upsert")?.[1]).toEqual({
      onConflict: "session_exercise_id,position", ignoreDuplicates: true,
    });
  });

  it("refuses a position out of range", async () => {
    expect((await actions.addSetAction({ sessionExerciseId: 4, position: 50, weightKg: null, durationS: null })).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("finishWorkoutAction", () => {
  it("finishes once the database confirms it", async () => {
    rpc.mockResolvedValue({ data: "completed", error: null });
    expect(await actions.finishWorkoutAction(7)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("finish_workout", { p_session_id: 7 });
  });

  it("does not record a session in which nothing was done", async () => {
    rpc.mockResolvedValue({ data: "empty", error: null });
    expect(await actions.finishWorkoutAction(7)).toMatchObject({ ok: false, empty: true });
  });

  it("does not claim success when the database did not answer", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "timeout" } });
    expect(await actions.finishWorkoutAction(7)).toMatchObject({ ok: false });
    rpc.mockResolvedValue({ data: "not_found", error: null });
    expect(await actions.finishWorkoutAction(7)).toMatchObject({ ok: false });
  });
});

describe("discard and delete", () => {
  it("discards only a session in progress", async () => {
    answers.push({ error: null });
    expect((await actions.discardWorkoutAction(7)).ok).toBe(true);
    expect(calls[0].ops).toContainEqual(["eq", ["status", "in_progress"]]);
  });

  it("deletes from history only a completed session", async () => {
    answers.push({ error: null });
    expect((await actions.deleteSessionAction(7)).ok).toBe(true);
    expect(calls[0].ops).toContainEqual(["eq", ["status", "completed"]]);
  });
});

describe("custom exercises", () => {
  it("creates one owned by the signed-in user", async () => {
    answers.push({ data: { id: 501 } });
    const result = await actions.createExerciseAction({
      name: " Garage Sled Drag ", muscleGroup: "full_body", equipment: "other",
      measure: "distance_duration", instructions: "",
    });
    expect(result).toEqual({ ok: true, id: 501 });
    expect(op(calls[0], "insert")?.[0]).toEqual({
      user_id: "user-a", name: "Garage Sled Drag", muscle_group: "full_body",
      equipment: "other", measure: "distance_duration", instructions: null,
    });
  });

  it("refuses a measure or a muscle group that does not exist", async () => {
    for (const over of [{ measure: "calories" }, { muscleGroup: "wings" }, { equipment: "jetpack" }, { name: " " }]) {
      const result = await actions.createExerciseAction({
        name: "X", muscleGroup: "chest", equipment: "other", measure: "reps", ...over,
      });
      expect(result.ok).toBe(false);
    }
    expect(calls).toHaveLength(0);
  });

  it("never changes how an exercise is measured when editing it", async () => {
    answers.push({ data: [{ id: 501 }] });
    await actions.updateExerciseAction(501, {
      name: "Sled Drag", muscleGroup: "full_body", equipment: "other", measure: "reps",
    });
    expect(op(calls[0], "update")?.[0]).not.toHaveProperty("measure");
  });

  it("reports a catalogue exercise as not editable", async () => {
    answers.push({ data: [] }); // RLS made the update touch nothing
    const result = await actions.updateExerciseAction(1, { name: "Hacked", muscleGroup: "chest", equipment: "barbell" });
    expect(result).toEqual({ ok: false, error: "That exercise cannot be edited." });
  });

  it("deletes an unused exercise outright", async () => {
    answers.push({ data: [{ id: 501 }] });
    expect(await actions.removeExerciseAction(501)).toEqual({ ok: true, archived: false });
    expect(calls).toHaveLength(1);
  });

  it("retires an exercise that history points at instead of deleting it", async () => {
    answers.push({ error: { code: "23503" } }, { data: [{ id: 501 }] });
    expect(await actions.removeExerciseAction(501)).toEqual({ ok: true, archived: true });
    expect(op(calls[1], "update")?.[0]).toHaveProperty("archived_at");
  });
});

describe("the session's own exercises", () => {
  it("adds exercises with a snapshot of each, and never touches a template", async () => {
    answers.push(
      { data: { id: 7, status: "in_progress" } },
      { data: [{ id: 5, name: "Barbell Bench Press", measure: "weight_reps", muscle_group: "chest", equipment: "barbell" }] },
      { data: [{ position: 2 }] },
      { data: [{ id: 40, exercise_id: 5, exercise_name: "Barbell Bench Press", measure: "weight_reps", muscle_group: "chest", equipment: "barbell", position: 3, rest_seconds: 90, rep_min: null, rep_max: null, notes: null }] },
      { data: [0, 1, 2].map((p) => ({ id: 60 + p, session_exercise_id: 40, position: p, weight_kg: null, reps: null, duration_s: null, distance_m: null, completed_at: null })) },
    );
    const result = await actions.addSessionExercisesAction({ sessionId: 7, exerciseIds: [5] });

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.exercises[0]).toMatchObject({ id: 40, name: "Barbell Bench Press", position: 3 });
      expect(result.exercises[0].sets).toHaveLength(3);
    }
    expect(op(calls[3], "insert")?.[0]).toEqual([
      expect.objectContaining({ session_id: 7, exercise_id: 5, exercise_name: "Barbell Bench Press", position: 3 }),
    ]);
    expect(calls.map((c) => c.table)).not.toContain("workout_templates");
    expect(calls.map((c) => c.table)).not.toContain("workout_template_exercises");

    // And it brings last time's figures with it, for the "Previous" column.
    expect(getPreviousPerformance).toHaveBeenCalledWith([5], 7);
    expect(result).toHaveProperty("previous");
  });

  it("does not add to a finished session", async () => {
    answers.push({ data: { id: 7, status: "completed" } }, { data: [] }, { data: [] });
    const result = await actions.addSessionExercisesAction({ sessionId: 7, exerciseIds: [5] });
    expect(result).toEqual({ ok: false, error: "That session is not in progress." });
    expect(calls).toHaveLength(3); // three reads, no write
  });

  it("will not swap an exercise that already has completed sets", async () => {
    answers.push(
      { data: { id: 40, position: 0, rest_seconds: 90, notes: null, workout_sessions: { status: "in_progress" }, workout_sets: [{ id: 1, completed_at: "2026-11-16T10:00:00Z" }] } },
      { data: { id: 9, name: "Dumbbell Bench Press", measure: "weight_reps", muscle_group: "chest", equipment: "dumbbell" } },
    );
    const result = await actions.replaceSessionExerciseAction({ sessionExerciseId: 40, exerciseId: 9 });
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(2);
  });
});

describe("programmes and plans", () => {
  it("creates a programme owned by the signed-in user", async () => {
    answers.push({ data: { id: 3 } });
    expect(await actions.createProgramAction(" Push / Pull / Legs ")).toEqual({ ok: true, id: 3 });
    expect(op(calls[0], "insert")?.[0]).toEqual({ user_id: "user-a", name: "Push / Pull / Legs" });
    expect((await actions.createProgramAction("  ")).ok).toBe(false);
  });

  it("says so when a workout is filed under someone else's programme", async () => {
    answers.push({ error: { code: "42501" } });
    expect(await actions.assignProgramAction({ templateId: 11, programId: 99 })).toEqual({
      ok: false, error: "That programme is not available.",
    });
  });

  it("plans a workout once per day, however often it is asked", async () => {
    answers.push({ error: null });
    expect((await actions.scheduleWorkoutAction({ templateId: 11, date: "2026-11-20" })).ok).toBe(true);
    expect(op(calls[0], "upsert")).toEqual([
      { user_id: "user-a", template_id: 11, scheduled_on: "2026-11-20" },
      { onConflict: "user_id,template_id,scheduled_on", ignoreDuplicates: true },
    ]);
  });

  it("refuses a date that is not one", async () => {
    expect((await actions.scheduleWorkoutAction({ templateId: 11, date: "next friday" })).ok).toBe(false);
    expect((await actions.moveScheduledAction({ id: 4, date: "2026-02-31" })).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("moves or cancels an occurrence without touching the workout", async () => {
    answers.push({ error: null }, { error: null });
    await actions.moveScheduledAction({ id: 4, date: "2026-11-22" });
    await actions.cancelScheduledAction(4);
    expect(calls.map((c) => c.table)).toEqual(["workout_schedule", "workout_schedule"]);
    expect(op(calls[0], "update")?.[0]).toEqual({ scheduled_on: "2026-11-22" });
  });
});

describe("correctSetAction — fixing a finished session", () => {
  const owner = (status: string, measure = "weight_reps") => ({
    data: { id: 21, workout_session_exercises: { measure, session_id: 7, workout_sessions: { status } } },
  });
  const fix = (over = {}) => ({ setId: 21, weightKg: 82.5, reps: 8, durationS: null, distanceM: null, ...over });

  it("corrects the figures and leaves when the set was done alone", async () => {
    answers.push(owner("completed"), { error: null });
    expect((await actions.correctSetAction(fix())).ok).toBe(true);
    const update = op(calls[1], "update")?.[0] as Record<string, unknown>;
    expect(update).toEqual({ weight_kg: 82.5, reps: 8, duration_s: null, distance_m: null });
    expect(update).not.toHaveProperty("completed_at");
  });

  it("is not a back door into a session in progress", async () => {
    answers.push(owner("in_progress"));
    expect((await actions.correctSetAction(fix())).ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("will not leave half a set in history", async () => {
    answers.push(owner("completed"));
    expect((await actions.correctSetAction(fix({ reps: null }))).ok).toBe(false);
    answers.push(owner("completed", "duration"));
    expect((await actions.correctSetAction(fix({ weightKg: null, reps: null }))).ok).toBe(false);
  });

  it("refuses impossible figures and sets that are not there", async () => {
    expect((await actions.correctSetAction(fix({ weightKg: -1 }))).ok).toBe(false);
    answers.push({ data: null });
    expect((await actions.correctSetAction(fix())).ok).toBe(false);
  });
});
