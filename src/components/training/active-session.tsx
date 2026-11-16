"use client";

/**
 * The session in progress — the screen used at the gym, one-handed.
 *
 * What it promises, and how:
 *
 * - Nothing typed is lost. Every change to a set goes into a save queue
 *   (`lib/training/save-queue.ts`) that sends it, keeps it if the network
 *   fails, and mirrors what is waiting to this device's storage — so a
 *   refresh, or the tab being closed while offline, sends it next time.
 * - The save state shown is the real one: "Saved" only when the server has
 *   every change, "Not saved" with a retry while anything is still waiting.
 * - The session is only called finished once the database has confirmed
 *   it, and that is only asked after every pending save has landed.
 * - Times are clock subtraction (`lib/training/timer.ts`), right again the
 *   moment the phone wakes.
 *
 * Adding, replacing or removing an exercise here changes this session and
 * never the template it came from.
 */

import {
  Check,
  CircleAlert,
  CloudOff,
  EllipsisVertical,
  Plus,
  Repeat,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  addSessionExercisesAction,
  addSetAction,
  discardWorkoutAction,
  finishWorkoutAction,
  removeSessionExerciseAction,
  removeSetAction,
  replaceSessionExerciseAction,
  saveSetAction,
  updateSessionExerciseAction,
  updateSessionNotesAction,
} from "@/app/(app)/training/actions";
import { PendingButton, Spinner } from "@/components/pending-button";
import { ExercisePickerSheet } from "@/components/training/exercise-picker";
import { REST_DONE_LINGER_MS, RestTimerBar } from "@/components/training/rest-timer";
import {
  fromDraft,
  toDraft,
  valuesToText,
  type SetDraft,
} from "@/components/training/set-draft";
import { useIsClient, useNow } from "@/components/training/use-now";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  describeRepTarget,
  describeSet,
  distanceUnit,
  formatClock,
  formatWeight,
  weightUnit,
} from "@/lib/training/format";
import type { SetInput } from "@/lib/training/input";
import { isCompletable, type ExerciseSessionRecord } from "@/lib/training/metrics";
import {
  SaveQueue,
  type QueueState,
  type QueueStorage,
} from "@/lib/training/save-queue";
import {
  adjustRest,
  elapsedSeconds,
  parseRestTimer,
  startRest,
  type RestTimer,
} from "@/lib/training/timer";
import type {
  Exercise,
  Measure,
  SessionExercise,
  SetValues,
  WorkoutSession,
} from "@/lib/training/types";
import type { UnitSystem } from "@/lib/units";
import { cn } from "@/lib/utils";

type DraftExercise = Omit<SessionExercise, "sets"> & { sets: SetDraft[] };

const STORAGE_PREFIX = "caldef.session.";
const REST_OPTIONS = [0, 30, 45, 60, 90, 120, 150, 180, 240, 300];

function browserStorage(key: string): QueueStorage | null {
  try {
    const store = window.localStorage;
    return {
      read: () => store.getItem(key),
      write: (value) => (value === null ? store.removeItem(key) : store.setItem(key, value)),
    };
  } catch {
    return null;
  }
}

/** Leftovers of sessions that are no longer the one in progress. */
function forgetOtherSessions(sessionId: number) {
  try {
    const keep = `${STORAGE_PREFIX}${sessionId}.`;
    const stale: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(STORAGE_PREFIX) && !key.startsWith(keep)) stale.push(key);
    }
    for (const key of stale) window.localStorage.removeItem(key);
  } catch {
    // Storage unavailable: nothing to tidy.
  }
}

type Props = {
  session: WorkoutSession;
  previous: Record<number, ExerciseSessionRecord>;
  exercises: Exercise[];
  units: UnitSystem;
  /** True when "Start" opened a session that was already running. */
  resumed: boolean;
};

/**
 * Rendered in the browser only: its first state is read from this device's
 * storage (unsent saves, a running rest timer), which the server cannot
 * know and must not guess at.
 */
export function ActiveSession(props: Props) {
  const isClient = useIsClient();
  if (!isClient) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-10 text-sm">
        <Spinner className="size-4" /> Opening your session…
      </div>
    );
  }
  return <ActiveSessionLive {...props} />;
}

function ActiveSessionLive({ session, previous, exercises: catalogue, units, resumed }: Props) {
  const router = useRouter();
  const now = useNow(500);
  const queueKey = `${STORAGE_PREFIX}${session.id}.queue`;
  const restKey = `${STORAGE_PREFIX}${session.id}.rest`;

  const [saveState, setSaveState] = useState<QueueState>({
    status: "saved", pending: 0, error: null,
  });
  const [queue] = useState(
    () =>
      new SaveQueue<SetInput>(
        async (_key, value) => saveSetAction(value),
        browserStorage(queueKey),
        setSaveState,
      ),
  );

  const [items, setItems] = useState<DraftExercise[]>(() => {
    // Saves a previous visit could not send are newer than what the server
    // returned: show them, so the screen matches what was typed.
    const unsent = new Map<number, SetInput>();
    try {
      const raw = window.localStorage.getItem(queueKey);
      for (const entry of raw ? (JSON.parse(raw) as [string, SetInput][]) : []) {
        if (entry?.[1]?.setId) unsent.set(entry[1].setId, entry[1]);
      }
    } catch {
      // Unreadable: the server's copy stands.
    }
    return session.exercises.map((exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => {
        const pending = unsent.get(set.id);
        return toDraft(
          pending
            ? { ...set, weightKg: pending.weightKg, reps: pending.reps, durationS: pending.durationS, distanceM: pending.distanceM, completedAt: pending.completedAt }
            : set,
          units,
        );
      }),
    }));
  });
  const [catalogueList, setCatalogueList] = useState(catalogue);
  const [rest, setRestState] = useState<RestTimer | null>(() => {
    try {
      return parseRestTimer(window.localStorage.getItem(restKey));
    } catch {
      return null;
    }
  });
  const [notes, setNotes] = useState(session.notes ?? "");
  const [picker, setPicker] = useState<{ replaceId: number | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const buzzedFor = useRef<number | null>(null);

  useEffect(() => {
    forgetOtherSessions(session.id);
    queue.resume();
    const retry = () => queue.retry();
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [queue, session.id]);

  // A short buzz when the rest ends — only while the app is open, which is
  // the only time a web page is allowed to.
  useEffect(() => {
    if (!rest || now < rest.endsAt || buzzedFor.current === rest.endsAt) return;
    buzzedFor.current = rest.endsAt;
    if (now - rest.endsAt < 2000) navigator.vibrate?.(200);
  }, [rest, now]);

  function setRest(next: RestTimer | null) {
    setRestState(next);
    try {
      if (next) window.localStorage.setItem(restKey, JSON.stringify(next));
      else window.localStorage.removeItem(restKey);
    } catch {
      // The timer still runs in memory.
    }
  }

  /** What a blank set would most plausibly be: last time's, or the set above. */
  function suggestion(exercise: DraftExercise, index: number): SetValues | null {
    const last = previous[exercise.exerciseId];
    if (last && last.sets.length > 0) {
      return last.sets[Math.min(index, last.sets.length - 1)];
    }
    for (let i = index - 1; i >= 0; i--) {
      const above = fromDraft(exercise.sets[i], exercise.measure, units);
      if (above && isCompletable(exercise.measure, above)) return above;
    }
    return null;
  }

  function applySet(exerciseId: number, draft: SetDraft, measure: Measure) {
    setItems((current) =>
      current.map((exercise) =>
        exercise.id === exerciseId
          ? { ...exercise, sets: exercise.sets.map((s) => (s.id === draft.id ? draft : s)) }
          : exercise,
      ),
    );
    const values = fromDraft(draft, measure, units);
    // A field that does not parse is shown as invalid and not sent; the
    // last good value stays on the server until it is fixed.
    if (!values) return;
    queue.push(`set:${draft.id}`, { setId: draft.id, ...values, completedAt: draft.completedAt });
  }

  function toggleSet(exercise: DraftExercise, index: number) {
    setError(null);
    const draft = exercise.sets[index];
    if (draft.completedAt) {
      applySet(exercise.id, { ...draft, completedAt: null }, exercise.measure);
      return;
    }

    let filled = draft;
    let values = fromDraft(filled, exercise.measure, units);
    if (!values) {
      setError(`${exercise.name}, set ${index + 1}: check the figures first.`);
      return;
    }
    if (!isCompletable(exercise.measure, values)) {
      // Ticking an empty set means "same as suggested" — one tap, no typing.
      const guess = suggestion(exercise, index);
      if (guess) {
        const text = valuesToText(guess, units);
        filled = {
          ...draft,
          weight: draft.weight || text.weight,
          reps: draft.reps || text.reps,
          duration: draft.duration || text.duration,
          distance: draft.distance || text.distance,
        };
        values = fromDraft(filled, exercise.measure, units);
      }
    }
    if (!values || !isCompletable(exercise.measure, values)) {
      setError(`${exercise.name}, set ${index + 1}: enter what you did, then tick it.`);
      return;
    }

    const at = Date.now();
    applySet(exercise.id, { ...filled, completedAt: new Date(at).toISOString() }, exercise.measure);
    setRest(startRest(exercise.restSeconds, at, exercise.id));
  }

  async function run<T>(key: string, work: () => Promise<T>): Promise<T | null> {
    setBusy(key);
    setError(null);
    try {
      return await work();
    } catch {
      setError("No connection — that change was not made. Your sets are kept on this phone.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function addSet(exercise: DraftExercise) {
    const lastSet = exercise.sets.at(-1);
    const position = (lastSet?.position ?? -1) + 1;
    const carry = lastSet ? fromDraft(lastSet, exercise.measure, units) : null;
    const result = await run(`add-set:${exercise.id}`, () =>
      addSetAction({
        sessionExerciseId: exercise.id,
        position,
        // The next set usually repeats the load of the last one.
        weightKg: carry?.weightKg ?? null,
        durationS: null,
      }),
    );
    if (!result) return;
    if (!result.ok) return setError(result.error);
    setItems((current) =>
      current.map((e) =>
        e.id === exercise.id && !e.sets.some((s) => s.id === result.set.id)
          ? { ...e, sets: [...e.sets, toDraft(result.set, units)] }
          : e,
      ),
    );
  }

  async function removeLastSet(exercise: DraftExercise) {
    const last = exercise.sets.at(-1);
    if (!last) return;
    queue.discard([`set:${last.id}`]);
    const result = await run(`remove-set:${exercise.id}`, () => removeSetAction(last.id));
    if (!result) return;
    if (!result.ok) return setError(result.error);
    setItems((current) =>
      current.map((e) =>
        e.id === exercise.id ? { ...e, sets: e.sets.filter((s) => s.id !== last.id) } : e,
      ),
    );
  }

  async function removeExercise(exercise: DraftExercise) {
    queue.discard(exercise.sets.map((s) => `set:${s.id}`));
    const result = await run(`remove:${exercise.id}`, () => removeSessionExerciseAction(exercise.id));
    if (!result) return;
    if (!result.ok) return setError(result.error);
    setItems((current) => current.filter((e) => e.id !== exercise.id));
  }

  async function picked(chosen: Exercise[]) {
    const target = picker;
    if (!target || chosen.length === 0) return;
    if (target.replaceId !== null) {
      const replaceId = target.replaceId;
      const result = await run("picker", () =>
        replaceSessionExerciseAction({ sessionExerciseId: replaceId, exerciseId: chosen[0].id }),
      );
      if (!result) return;
      if (!result.ok) {
        setPicker(null);
        return setError(result.error);
      }
      queue.discard(result.exercise.sets.map((s) => `set:${s.id}`));
      setItems((current) =>
        current.map((e) =>
          e.id === replaceId
            ? { ...result.exercise, sets: result.exercise.sets.map((s) => toDraft(s, units)) }
            : e,
        ),
      );
    } else {
      const result = await run("picker", () =>
        addSessionExercisesAction({ sessionId: session.id, exerciseIds: chosen.map((e) => e.id) }),
      );
      if (!result) return;
      if (!result.ok) {
        setPicker(null);
        return setError(result.error);
      }
      setItems((current) => [
        ...current,
        ...result.exercises
          .filter((added) => !current.some((e) => e.id === added.id))
          .map((e) => ({ ...e, sets: e.sets.map((s) => toDraft(s, units)) })),
      ]);
    }
    setPicker(null);
  }

  async function saveExerciseDetails(
    exercise: DraftExercise,
    change: { notes?: string | null; restSeconds?: number },
  ) {
    setItems((current) =>
      current.map((e) =>
        e.id === exercise.id
          ? { ...e, notes: change.notes !== undefined ? change.notes : e.notes, restSeconds: change.restSeconds ?? e.restSeconds }
          : e,
      ),
    );
    const result = await run(`details:${exercise.id}`, () =>
      updateSessionExerciseAction({ sessionExerciseId: exercise.id, ...change }),
    );
    if (result && !result.ok) setError(result.error);
  }

  async function finish() {
    setFinishing(true);
    setError(null);
    try {
      // Every set has to be on the server before the session is closed over it.
      const flushed = await queue.flush();
      if (!flushed) {
        setError("Some sets are not saved yet. Check your connection, then finish again — nothing is lost.");
        return;
      }
      if ((session.notes ?? "") !== notes.trim()) {
        const noted = await updateSessionNotesAction(session.id, notes);
        if (!noted.ok) return setError(noted.error);
      }
      const result = await finishWorkoutAction(session.id);
      if (!result.ok) return setError(result.error);
      setRest(null);
      router.push(`/training/history/${session.id}?done=1`);
      router.refresh();
    } catch {
      setError("No connection. The session is not finished yet — your sets are kept, try again.");
    } finally {
      setFinishing(false);
    }
  }

  async function discard() {
    const result = await run("discard", () => discardWorkoutAction(session.id));
    if (!result) return;
    if (!result.ok) return setError(result.error);
    queue.discard(items.flatMap((e) => e.sets.map((s) => `set:${s.id}`)));
    setRest(null);
    router.push("/training");
    router.refresh();
  }

  const doneSets = items.reduce((n, e) => n + e.sets.filter((s) => s.completedAt).length, 0);
  const totalSets = items.reduce((n, e) => n + e.sets.length, 0);
  const showRest = rest !== null && now < rest.endsAt + REST_DONE_LINGER_MS;
  const restLabel = rest ? (items.find((e) => e.id === rest.sessionExerciseId)?.name ?? null) : null;

  return (
    <div className={cn("space-y-5", showRest ? "pb-20" : "")}>
      <header className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">Session in progress</p>
            <h1 className="truncate text-[1.75rem] leading-tight font-bold tracking-tight">
              {session.name}
            </h1>
          </div>
          <SaveBadge state={saveState} onRetry={() => queue.retry()} />
        </div>
        <dl className="grid grid-cols-2 gap-4 rounded-2xl border bg-card p-4">
          <div>
            <dt className="eyebrow">Time</dt>
            <dd className="figure text-2xl" role="timer" aria-label="Session time">
              {formatClock(elapsedSeconds(session.startedAt, now))}
            </dd>
          </div>
          <div>
            <dt className="eyebrow">Sets done</dt>
            <dd className="figure text-2xl">
              {doneSets}
              <span className="text-muted-foreground text-base font-medium"> / {totalSets}</span>
            </dd>
          </div>
        </dl>
        {resumed ? (
          <Alert>
            <AlertDescription>
              You already had this session in progress, so it was opened
              instead of starting a new one. Finish or discard it first.
            </AlertDescription>
          </Alert>
        ) : null}
      </header>

      {saveState.error ? (
        <Alert variant="destructive">
          <AlertDescription>A set was not accepted: {saveState.error}</AlertDescription>
        </Alert>
      ) : null}

      {items.length === 0 ? (
        <p className="text-muted-foreground rounded-2xl border border-dashed px-4 py-8 text-center text-sm">
          No exercises yet. Add the first one below.
        </p>
      ) : null}

      <ol className="space-y-4">
        {items.map((exercise, exerciseIndex) => {
          const last = previous[exercise.exerciseId];
          const target = [
            describeRepTarget(exercise.repMin, exercise.repMax),
            exercise.targetWeightKg === null ? null : formatWeight(exercise.targetWeightKg, units),
          ].filter(Boolean).join(" · ");
          return (
            <li key={exercise.id} className="rounded-2xl border bg-card">
              <div className="flex items-start gap-2 p-4 pb-2">
                <span className="bg-accent text-accent-foreground mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums">
                  {exerciseIndex + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold leading-snug">{exercise.name}</h2>
                  {target ? (
                    <p className="text-muted-foreground text-xs">Target: {target}</p>
                  ) : null}
                  <p className="text-muted-foreground text-xs">
                    {last
                      ? `Last time: ${last.sets.map((s) => describeSet(exercise.measure, s, units)).join(", ")}`
                      : "First time logging this exercise."}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={`Options for ${exercise.name}`}>
                      <EllipsisVertical />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setPicker({ replaceId: exercise.id })}>
                      <Repeat aria-hidden /> Replace exercise
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => void removeExercise(exercise)}
                    >
                      <Trash2 aria-hidden /> Remove from session
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <SetTable
                exercise={exercise}
                units={units}
                placeholderFor={(index) => {
                  const guess = suggestion(exercise, index);
                  return guess ? valuesToText(guess, units) : null;
                }}
                onChange={(draft) => applySet(exercise.id, draft, exercise.measure)}
                onToggle={(index) => toggleSet(exercise, index)}
              />

              <div className="flex flex-wrap items-center gap-2 px-4 pt-1 pb-3">
                <PendingButton
                  type="button"
                  variant="secondary"
                  pending={busy === `add-set:${exercise.id}`}
                  disabled={exercise.sets.length >= 50}
                  onClick={() => void addSet(exercise)}
                >
                  <Plus aria-hidden /> Add set
                </PendingButton>
                {exercise.sets.length > 0 ? (
                  <PendingButton
                    type="button"
                    variant="ghost"
                    pending={busy === `remove-set:${exercise.id}`}
                    onClick={() => void removeLastSet(exercise)}
                  >
                    Remove last set
                  </PendingButton>
                ) : null}
                <label className="text-muted-foreground ml-auto flex items-center gap-2 text-xs">
                  Rest
                  <select
                    className="border-input bg-card text-foreground h-10 rounded-lg border px-2 text-base md:text-sm"
                    value={exercise.restSeconds}
                    onChange={(event) =>
                      void saveExerciseDetails(exercise, { restSeconds: Number(event.target.value) })
                    }
                  >
                    {[...new Set([...REST_OPTIONS, exercise.restSeconds])]
                      .sort((a, b) => a - b)
                      .map((seconds) => (
                        <option key={seconds} value={seconds}>
                          {seconds === 0 ? "Off" : formatClock(seconds)}
                        </option>
                      ))}
                  </select>
                </label>
              </div>

              <div className="border-t px-4 py-3">
                <Input
                  aria-label={`Note for ${exercise.name}`}
                  defaultValue={exercise.notes ?? ""}
                  maxLength={500}
                  placeholder="Note for this exercise"
                  onBlur={(event) => {
                    const value = event.target.value.trim() || null;
                    if (value !== (exercise.notes ?? null)) {
                      void saveExerciseDetails(exercise, { notes: value });
                    }
                  }}
                />
              </div>
            </li>
          );
        })}
      </ol>

      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full"
        onClick={() => setPicker({ replaceId: null })}
      >
        <Plus aria-hidden /> Add exercise
      </Button>

      <div className="space-y-1.5">
        <label htmlFor="session-notes" className="eyebrow">Session notes</label>
        <Textarea
          id="session-notes"
          value={notes}
          maxLength={2000}
          placeholder="How it went, anything to remember next time"
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>

      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <PendingButton
          type="button"
          size="lg"
          className="w-full"
          pending={finishing}
          pendingLabel="Saving and finishing…"
          onClick={() => void finish()}
        >
          <Check aria-hidden /> Finish workout
        </PendingButton>
        <Button
          type="button"
          variant="ghost"
          className="text-destructive w-full"
          onClick={() => setConfirmDiscard(true)}
        >
          Discard session
        </Button>
      </div>

      <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard this session?</DialogTitle>
            <DialogDescription>
              Everything entered in it is deleted and nothing goes to your
              history. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirmDiscard(false)}>
              Keep going
            </Button>
            <PendingButton
              type="button"
              variant="destructive"
              pending={busy === "discard"}
              pendingLabel="Discarding…"
              onClick={() => void discard()}
            >
              Discard
            </PendingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ExercisePickerSheet
        open={picker !== null}
        onOpenChange={(open) => (open ? null : setPicker(null))}
        exercises={catalogueList}
        single={picker?.replaceId != null}
        title={picker?.replaceId != null ? "Replace exercise" : "Add exercises"}
        pending={busy === "picker"}
        onPick={(chosen) => void picked(chosen)}
        onCreated={(exercise) => setCatalogueList((current) => [...current, exercise])}
      />

      {showRest && rest ? (
        <RestTimerBar
          timer={rest}
          now={now}
          label={restLabel}
          onAdjust={(delta) => setRest(adjustRest(rest, delta, Date.now()))}
          onDismiss={() => setRest(null)}
        />
      ) : null}
    </div>
  );
}

/** The honest state of saving, always in the same corner. */
function SaveBadge({ state, onRetry }: { state: QueueState; onRetry: () => void }) {
  if (state.status === "unsaved") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="bg-destructive/10 text-destructive flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold"
      >
        <CloudOff className="size-4" aria-hidden />
        Not saved · Retry
      </button>
    );
  }
  return (
    <p
      role="status"
      className="text-muted-foreground flex min-h-10 shrink-0 items-center gap-1.5 text-xs font-medium"
    >
      {state.status === "saving" ? (
        <>
          <Spinner className="size-3.5" /> Saving…
        </>
      ) : (
        <>
          <Check className="text-success size-4" aria-hidden /> Saved
        </>
      )}
    </p>
  );
}

function SetTable({
  exercise,
  units,
  placeholderFor,
  onChange,
  onToggle,
}: {
  exercise: DraftExercise;
  units: UnitSystem;
  placeholderFor: (index: number) => Pick<SetDraft, "weight" | "reps" | "duration" | "distance"> | null;
  onChange: (draft: SetDraft) => void;
  onToggle: (index: number) => void;
}) {
  const { measure } = exercise;
  const columns: { field: "weight" | "reps" | "duration" | "distance"; label: string; mode: "decimal" | "numeric" | "text" }[] =
    measure === "weight_reps"
      ? [
          { field: "weight", label: weightUnit(units), mode: "decimal" },
          { field: "reps", label: "Reps", mode: "numeric" },
        ]
      : measure === "reps"
        ? [{ field: "reps", label: "Reps", mode: "numeric" }]
        : measure === "duration"
          ? [{ field: "duration", label: "Time", mode: "text" }]
          : [
              { field: "distance", label: distanceUnit(units), mode: "decimal" },
              { field: "duration", label: "Time", mode: "text" },
            ];

  if (exercise.sets.length === 0) {
    return <p className="text-muted-foreground px-4 py-2 text-sm">No sets. Add one below.</p>;
  }

  return (
    <div className="px-4" role="group" aria-label={`Sets of ${exercise.name}`}>
      <div className="eyebrow flex items-center gap-2 pb-1">
        <span className="w-7 text-center">Set</span>
        {columns.map((column) => (
          <span key={column.field} className="flex-1 text-center">{column.label}</span>
        ))}
        <span className="w-12 text-center">Done</span>
      </div>
      <ul className="space-y-2 pb-2">
        {exercise.sets.map((set, index) => {
          const done = set.completedAt !== null;
          const invalid = fromDraft(set, measure, units) === null;
          const hint = placeholderFor(index);
          return (
            <li key={set.id} className="flex items-center gap-2">
              <span className="text-muted-foreground w-7 text-center text-sm font-semibold tabular-nums">
                {index + 1}
              </span>
              {columns.map((column) => (
                <Input
                  key={column.field}
                  aria-label={`${exercise.name} set ${index + 1} ${column.label}`}
                  aria-invalid={invalid || undefined}
                  inputMode={column.mode}
                  enterKeyHint="done"
                  autoComplete="off"
                  value={set[column.field]}
                  placeholder={hint?.[column.field] || (column.field === "duration" ? "0:00" : "–")}
                  onChange={(event) => onChange({ ...set, [column.field]: event.target.value })}
                  onFocus={(event) => event.target.select()}
                  className={cn(
                    "h-12 flex-1 text-center text-lg font-semibold tabular-nums md:text-base",
                    done ? "border-success/40 bg-success/10" : "",
                  )}
                />
              ))}
              <button
                type="button"
                aria-pressed={done}
                aria-label={`${exercise.name} set ${index + 1} ${done ? "done — tap to undo" : "mark done"}`}
                onClick={() => onToggle(index)}
                className={cn(
                  "flex size-12 shrink-0 items-center justify-center rounded-xl border transition-colors",
                  done
                    ? "border-success bg-success text-white"
                    : "border-input bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {invalid ? <CircleAlert className="text-destructive size-5" aria-hidden /> : <Check className="size-6" aria-hidden />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
