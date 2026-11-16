"use client";

/**
 * Building or editing a reusable workout ("Push A").
 *
 * The whole template is edited in the browser and saved in one request —
 * `save_workout_template` replaces its exercises atomically, so a save
 * either lands entirely or not at all, and a half-edited plan is never what
 * a session gets started from.
 *
 * Editing a template never changes a session that was already done: a
 * session carries its own copy (ARCHITECTURE invariant 18).
 */

import {
  ArrowDown,
  ArrowUp,
  Plus,
  Repeat,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { saveTemplateAction } from "@/app/(app)/training/actions";
import { PendingButton } from "@/components/pending-button";
import { ExercisePickerSheet } from "@/components/training/exercise-picker";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  formatClock,
  parseClock,
  weightFromDisplay,
  weightToDisplay,
  weightUnit,
} from "@/lib/training/format";
import {
  EQUIPMENT_LABEL,
  MUSCLE_LABEL,
  type Exercise,
  type WorkoutTemplate,
} from "@/lib/training/types";
import type { UnitSystem } from "@/lib/units";

/** One row of the editor. Numbers are kept as typed until saving. */
type Row = {
  /** Stable across reorders, for React. */
  key: string;
  exercise: Exercise;
  sets: string;
  repMin: string;
  repMax: string;
  weight: string;
  duration: string;
  rest: string;
  notes: string;
};

let nextKey = 0;
const newKey = () => `row-${nextKey++}`;

function blankRow(exercise: Exercise): Row {
  return {
    key: newKey(),
    exercise,
    sets: "3",
    repMin: "",
    repMax: "",
    weight: "",
    duration: "",
    rest: exercise.measure === "weight_reps" ? "90" : "60",
    notes: "",
  };
}

const intOrNull = (text: string): number | null => {
  const value = text.trim();
  if (value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : Number.NaN;
};

const decimalOrNull = (text: string): number | null => {
  const value = text.trim().replace(",", ".");
  if (value === "") return null;
  return Number(value);
};

export function TemplateEditor({
  template,
  exercises: initialExercises,
  units,
}: {
  /** Null for a new template. */
  template: WorkoutTemplate | null;
  exercises: Exercise[];
  units: UnitSystem;
}) {
  const router = useRouter();
  const [exercises, setExercises] = useState(initialExercises);
  const [name, setName] = useState(template?.name ?? "");
  const [notes, setNotes] = useState(template?.notes ?? "");
  const [rows, setRows] = useState<Row[]>(() => {
    if (!template) return [];
    const byId = new Map(initialExercises.map((e) => [e.id, e]));
    return template.items.flatMap((item) => {
      // A retired exercise is not in the list; keep it by what the template
      // knows of it, so opening the editor does not silently drop it.
      const exercise: Exercise = byId.get(item.exerciseId) ?? {
        id: item.exerciseId,
        slug: null,
        name: item.exerciseName,
        aliases: [],
        muscleGroup: "full_body",
        secondaryMuscles: [],
        equipment: "other",
        measure: item.measure,
        instructions: null,
        custom: true,
        force: null,
        mechanic: null,
        source: null,
      };
      return {
        key: newKey(),
        exercise,
        sets: String(item.targetSets),
        repMin: item.repMin === null ? "" : String(item.repMin),
        repMax: item.repMax === null ? "" : String(item.repMax),
        weight:
          item.targetWeightKg === null
            ? ""
            : String(weightToDisplay(item.targetWeightKg, units)),
        duration: item.targetDurationS === null ? "" : formatClock(item.targetDurationS),
        rest: String(item.restSeconds),
        notes: item.notes ?? "",
      };
    });
  });
  const [picker, setPicker] = useState<{ replaceKey: string | null } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  // What the editor looked like when it opened. Anything different is
  // unsaved work, and leaving with it is confirmed — by the browser when
  // the tab is closed or reloaded, and by Cancel here.
  // (Row keys are React's, not the workout's, so they are left out.)
  const snapshot = () =>
    JSON.stringify({ name, notes, rows: rows.map((row) => ({ ...row, key: "" })) });
  const [opened] = useState(snapshot);
  const dirty = !saved && opened !== snapshot();

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const patch = (key: string, change: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));

  function move(index: number, by: -1 | 1) {
    setRows((current) => {
      const target = index + by;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function picked(chosen: Exercise[]) {
    if (picker?.replaceKey) {
      const replacement = chosen[0];
      if (replacement) {
        setRows((current) =>
          current.map((row) =>
            row.key === picker.replaceKey
              ? {
                  ...blankRow(replacement),
                  key: row.key,
                  sets: row.sets,
                  rest: row.rest,
                  // Rep targets carry over where they still mean something.
                  repMin: replacement.measure === "weight_reps" || replacement.measure === "reps" ? row.repMin : "",
                  repMax: replacement.measure === "weight_reps" || replacement.measure === "reps" ? row.repMax : "",
                }
              : row,
          ),
        );
      }
    } else {
      setRows((current) => [...current, ...chosen.map(blankRow)]);
    }
    setPicker(null);
  }

  async function save() {
    setError(null);

    const items = [];
    for (const row of rows) {
      const label = row.exercise.name;
      const sets = intOrNull(row.sets);
      if (sets === null || !(sets >= 1 && sets <= 20)) {
        return setError(`${label}: sets must be a whole number from 1 to 20.`);
      }
      const repMin = intOrNull(row.repMin);
      const repMax = intOrNull(row.repMax);
      for (const reps of [repMin, repMax]) {
        if (reps !== null && !(reps >= 1 && reps <= 1000)) {
          return setError(`${label}: reps must be a whole number of at least 1.`);
        }
      }
      if (repMin !== null && repMax !== null && repMin > repMax) {
        return setError(`${label}: the lower rep target is above the upper one.`);
      }
      const weight = decimalOrNull(row.weight);
      if (weight !== null && !(weight >= 0 && weight <= 4000)) {
        return setError(`${label}: that weight does not look right.`);
      }
      const duration = row.duration.trim() === "" ? null : parseClock(row.duration);
      if (row.duration.trim() !== "" && (duration === null || duration < 1)) {
        return setError(`${label}: write the time as seconds or m:ss, e.g. 1:30.`);
      }
      const rest = intOrNull(row.rest) ?? 0;
      if (!(rest >= 0 && rest <= 3600)) {
        return setError(`${label}: rest must be between 0 and 3600 seconds.`);
      }

      const usesReps = row.exercise.measure === "weight_reps" || row.exercise.measure === "reps";
      items.push({
        exerciseId: row.exercise.id,
        targetSets: sets,
        repMin: usesReps ? (repMin ?? repMax) : null,
        repMax: usesReps ? (repMax ?? repMin) : null,
        targetWeightKg:
          row.exercise.measure === "weight_reps" && weight !== null
            ? weightFromDisplay(weight, units)
            : null,
        targetDurationS: row.exercise.measure === "duration" ? duration : null,
        restSeconds: rest,
        notes: row.notes.trim() || null,
      });
    }

    setPending(true);
    try {
      const result = await saveTemplateAction({
        id: template?.id ?? null,
        name,
        notes: notes.trim() || null,
        items,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      router.push("/training");
      router.refresh();
    } catch {
      setError("No connection. Nothing was saved — your changes are still here.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="bg-card space-y-4 rounded-2xl p-4">
        <div className="space-y-1.5">
          <Label htmlFor="template-name">Name</Label>
          <Input
            id="template-name"
            value={name}
            maxLength={80}
            placeholder="Push A"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="template-notes">Notes (optional)</Label>
          <Textarea
            id="template-notes"
            value={notes}
            maxLength={1000}
            placeholder="Warm-up, focus for this block…"
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
      </div>

      <section aria-label="Exercises" className="space-y-3">
        <h2 className="eyebrow">Exercises · {rows.length}</h2>

        {rows.length === 0 ? (
          <p className="text-muted-foreground rounded-2xl border border-dashed px-4 py-8 text-center text-sm">
            No exercises yet. Add the first one below.
          </p>
        ) : null}

        <ol className="space-y-3">
          {rows.map((row, index) => {
            const measure = row.exercise.measure;
            const usesReps = measure === "weight_reps" || measure === "reps";
            return (
              <li key={row.key} className="bg-card space-y-3 rounded-2xl p-4">
                <div className="flex items-start gap-2">
                  <span className="bg-accent text-accent-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{row.exercise.name}</p>
                    <p className="text-muted-foreground truncate text-xs">
                      {MUSCLE_LABEL[row.exercise.muscleGroup]} ·{" "}
                      {EQUIPMENT_LABEL[row.exercise.equipment]}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Field
                    id={`${row.key}-sets`}
                    label="Sets"
                    value={row.sets}
                    inputMode="numeric"
                    onChange={(sets) => patch(row.key, { sets })}
                  />
                  {usesReps ? (
                    <div className="space-y-1.5">
                      <Label htmlFor={`${row.key}-rep-min`}>Reps (range)</Label>
                      <div className="flex items-center gap-1.5">
                        <Input
                          id={`${row.key}-rep-min`}
                          aria-label={`${row.exercise.name}: lowest reps`}
                          inputMode="numeric"
                          placeholder="8"
                          value={row.repMin}
                          onChange={(e) => patch(row.key, { repMin: e.target.value })}
                        />
                        <span aria-hidden className="text-muted-foreground">–</span>
                        <Input
                          aria-label={`${row.exercise.name}: highest reps`}
                          inputMode="numeric"
                          placeholder="12"
                          value={row.repMax}
                          onChange={(e) => patch(row.key, { repMax: e.target.value })}
                        />
                      </div>
                    </div>
                  ) : null}
                  {measure === "weight_reps" ? (
                    <Field
                      id={`${row.key}-weight`}
                      label={`Weight (${weightUnit(units)})`}
                      value={row.weight}
                      inputMode="decimal"
                      placeholder="Optional"
                      onChange={(weight) => patch(row.key, { weight })}
                    />
                  ) : null}
                  {measure === "duration" ? (
                    <Field
                      id={`${row.key}-duration`}
                      label="Time"
                      value={row.duration}
                      inputMode="text"
                      placeholder="1:00"
                      onChange={(duration) => patch(row.key, { duration })}
                    />
                  ) : null}
                  <Field
                    id={`${row.key}-rest`}
                    label="Rest (s)"
                    value={row.rest}
                    inputMode="numeric"
                    onChange={(rest) => patch(row.key, { rest })}
                  />
                </div>

                <Input
                  aria-label={`Note for ${row.exercise.name}`}
                  value={row.notes}
                  maxLength={500}
                  placeholder="Note (optional)"
                  onChange={(e) => patch(row.key, { notes: e.target.value })}
                />

                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Move ${row.exercise.name} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Move ${row.exercise.name} down`}
                    disabled={index === rows.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setPicker({ replaceKey: row.key })}
                  >
                    <Repeat aria-hidden />
                    Replace
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-destructive ml-auto"
                    aria-label={`Remove ${row.exercise.name}`}
                    onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                  >
                    <Trash2 aria-hidden />
                    Remove
                  </Button>
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
          onClick={() => setPicker({ replaceKey: null })}
        >
          <Plus aria-hidden />
          Add exercises
        </Button>
      </section>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex gap-3">
        <Button
          type="button"
          variant="ghost"
          size="lg"
          className="flex-1"
          onClick={() => (dirty ? setConfirmLeave(true) : router.push("/training"))}
        >
          Cancel
        </Button>
        <PendingButton
          type="button"
          size="lg"
          className="flex-[2]"
          pending={pending}
          pendingLabel="Saving…"
          disabled={name.trim().length === 0 || rows.length === 0}
          onClick={save}
        >
          Save workout
        </PendingButton>
      </div>

      <Dialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave without saving?</DialogTitle>
            <DialogDescription>
              The changes you made to this workout have not been saved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirmLeave(false)}>
              Keep editing
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setSaved(true);
                router.push("/training");
              }}
            >
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ExercisePickerSheet
        open={picker !== null}
        onOpenChange={(open) => (open ? null : setPicker(null))}
        exercises={exercises}
        single={Boolean(picker?.replaceKey)}
        title={picker?.replaceKey ? "Replace exercise" : "Add exercises"}
        onPick={picked}
        onCreated={(exercise) => setExercises((current) => [...current, exercise])}
      />
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  inputMode,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputMode: "numeric" | "decimal" | "text";
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        inputMode={inputMode}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
