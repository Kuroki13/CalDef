"use client";

/**
 * Choosing exercises: search, two filters, tick as many as wanted.
 *
 * The whole list is already in the browser (a couple of hundred short
 * rows), so searching is instant and works with no connection — which is
 * the state a phone in a gym basement is usually in.
 *
 * When what is typed finds nothing, the answer is not a dead end: the
 * exercise can be created on the spot with the name already filled in.
 */

import { Check, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { createExerciseAction } from "@/app/(app)/training/actions";
import { PendingButton } from "@/components/pending-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { searchExercises } from "@/lib/training/search";
import {
  EQUIPMENT,
  EQUIPMENT_LABEL,
  MEASURES,
  MEASURE_LABEL,
  MUSCLE_GROUPS,
  MUSCLE_LABEL,
  type Equipment,
  type Exercise,
  type Measure,
  type MuscleGroup,
} from "@/lib/training/types";
import { cn } from "@/lib/utils";

const PICKER_PAGE = 40;

const SELECT_CLASS =
  "border-input bg-card h-10 w-full rounded-lg border px-3 text-base md:text-sm";

/** A filter as a row of chips that scrolls sideways under a thumb. */
function Chips<T extends string>({
  label,
  options,
  labels,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T | null;
  onChange: (value: T | null) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]"
    >
      {options.map((option) => {
        const active = value === option;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? null : option)}
            className={cn(
              "min-h-9 shrink-0 rounded-full border px-3 text-sm font-medium transition-colors",
              active
                ? "border-foreground bg-foreground text-background"
                : "bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {labels[option]}
          </button>
        );
      })}
    </div>
  );
}

export function ExerciseList({
  exercises,
  selected,
  onToggle,
  onCreated,
  emptyHint,
}: {
  exercises: readonly Exercise[];
  /** Ids ticked so far. */
  selected: readonly number[];
  onToggle: (exercise: Exercise) => void;
  /** Called with a newly created exercise, which is then also ticked. */
  onCreated: (exercise: Exercise) => void;
  emptyHint?: string;
}) {
  const [query, setQuery] = useState("");
  const [muscle, setMuscle] = useState<MuscleGroup | null>(null);
  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const [creating, setCreating] = useState(false);
  // Show a screenful; the rest on request. A new search starts at the top.
  const [shown, setShown] = useState(PICKER_PAGE);
  const filterKey = `${query}|${muscle}|${equipment}`;
  const [lastKey, setLastKey] = useState(filterKey);
  if (filterKey !== lastKey) {
    setLastKey(filterKey);
    setShown(PICKER_PAGE);
  }

  const results = useMemo(
    () => searchExercises(exercises, { query, muscleGroup: muscle, equipment }),
    [exercises, query, muscle, equipment],
  );

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search exercises"
          aria-label="Search exercises"
          className="pl-9"
          autoComplete="off"
          enterKeyHint="search"
        />
      </div>
      <Chips
        label="Muscle group"
        options={MUSCLE_GROUPS}
        labels={MUSCLE_LABEL}
        value={muscle}
        onChange={setMuscle}
      />
      <Chips
        label="Equipment"
        options={EQUIPMENT}
        labels={EQUIPMENT_LABEL}
        value={equipment}
        onChange={setEquipment}
      />

      <p className="text-muted-foreground text-xs" aria-live="polite">
        {results.length} {results.length === 1 ? "exercise" : "exercises"}
        {emptyHint && results.length > 0 ? ` · ${emptyHint}` : ""}
      </p>

      {results.length > 0 ? (
        <ul className="divide-y rounded-xl border bg-card">
          {results.slice(0, shown).map((exercise) => {
            const ticked = selected.includes(exercise.id);
            return (
              <li key={exercise.id}>
                <button
                  type="button"
                  aria-pressed={ticked}
                  onClick={() => onToggle(exercise)}
                  className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full border",
                      ticked
                        ? "border-foreground bg-foreground text-volt"
                        : "border-input",
                    )}
                  >
                    {ticked ? <Check className="size-4" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {exercise.name}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {MUSCLE_LABEL[exercise.muscleGroup]} ·{" "}
                      {EQUIPMENT_LABEL[exercise.equipment]}
                      {exercise.custom ? " · Yours" : ""}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-muted-foreground rounded-xl border border-dashed px-4 py-6 text-center text-sm">
          Nothing matches. You can create it below.
        </p>
      )}

      {results.length > shown ? (
        <Button
          type="button"
          variant="secondary"
          className="w-full rounded-full"
          onClick={() => setShown((n) => n + PICKER_PAGE)}
        >
          Show {Math.min(PICKER_PAGE, results.length - shown)} more of {results.length - shown}
        </Button>
      ) : null}

      {creating ? (
        <CreateExerciseForm
          initialName={query}
          initialMuscle={muscle}
          initialEquipment={equipment}
          onCancel={() => setCreating(false)}
          onCreated={(exercise) => {
            setCreating(false);
            setQuery("");
            onCreated(exercise);
          }}
        />
      ) : (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => setCreating(true)}
        >
          <Plus aria-hidden />
          Create an exercise
        </Button>
      )}
    </div>
  );
}

export function CreateExerciseForm({
  initialName = "",
  initialMuscle = null,
  initialEquipment = null,
  onCancel,
  onCreated,
}: {
  initialName?: string;
  initialMuscle?: MuscleGroup | null;
  initialEquipment?: Equipment | null;
  onCancel?: () => void;
  onCreated: (exercise: Exercise) => void;
}) {
  const [name, setName] = useState(initialName);
  const [muscleGroup, setMuscleGroup] = useState<MuscleGroup>(initialMuscle ?? "chest");
  const [equipment, setEquipment] = useState<Equipment>(initialEquipment ?? "bodyweight");
  const [measure, setMeasure] = useState<Measure>("weight_reps");
  const [instructions, setInstructions] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const result = await createExerciseAction({
        name, muscleGroup, equipment, measure, instructions,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onCreated({
        id: result.id,
        slug: null,
        name: name.trim(),
        aliases: [],
        muscleGroup,
        secondaryMuscles: [],
        equipment,
        measure,
        instructions: instructions.trim() || null,
        custom: true,
        force: null,
        mechanic: null,
        source: null,
      });
    } catch {
      setError("No connection. The exercise was not created.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border bg-card p-3">
      <p className="text-sm font-semibold">New exercise</p>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="new-exercise-name">Name</Label>
        <Input
          id="new-exercise-name"
          value={name}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="new-exercise-muscle">Muscle group</Label>
          <select
            id="new-exercise-muscle"
            className={SELECT_CLASS}
            value={muscleGroup}
            onChange={(event) => setMuscleGroup(event.target.value as MuscleGroup)}
          >
            {MUSCLE_GROUPS.map((group) => (
              <option key={group} value={group}>{MUSCLE_LABEL[group]}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-exercise-equipment">Equipment</Label>
          <select
            id="new-exercise-equipment"
            className={SELECT_CLASS}
            value={equipment}
            onChange={(event) => setEquipment(event.target.value as Equipment)}
          >
            {EQUIPMENT.map((item) => (
              <option key={item} value={item}>{EQUIPMENT_LABEL[item]}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="new-exercise-measure">What a set records</Label>
        <select
          id="new-exercise-measure"
          className={SELECT_CLASS}
          value={measure}
          onChange={(event) => setMeasure(event.target.value as Measure)}
        >
          {MEASURES.map((item) => (
            <option key={item} value={item}>{MEASURE_LABEL[item]}</option>
          ))}
        </select>
        <p className="text-muted-foreground text-xs">
          This cannot be changed later, because logged sets depend on it.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="new-exercise-cue">Notes (optional)</Label>
        <Input
          id="new-exercise-cue"
          value={instructions}
          maxLength={1000}
          onChange={(event) => setInstructions(event.target.value)}
          placeholder="Setup, seat position, a cue"
        />
      </div>
      <div className="flex gap-2">
        {onCancel ? (
          <Button type="button" variant="ghost" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <PendingButton
          type="button"
          className="flex-1"
          pending={pending}
          pendingLabel="Creating…"
          disabled={name.trim().length === 0}
          onClick={submit}
        >
          Create
        </PendingButton>
      </div>
    </div>
  );
}

/**
 * The picker as a sheet over the current screen: choose, then "Add".
 * `single` turns it into "pick one", for replacing an exercise.
 */
export function ExercisePickerSheet({
  open,
  onOpenChange,
  exercises,
  onPick,
  onCreated,
  single = false,
  title = "Add exercises",
  pending = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exercises: readonly Exercise[];
  onPick: (picked: Exercise[]) => void;
  /** Lets the parent add a just-created exercise to its own list. */
  onCreated: (exercise: Exercise) => void;
  single?: boolean;
  title?: string;
  pending?: boolean;
}) {
  const [selected, setSelected] = useState<Exercise[]>([]);

  // Start clean each time the sheet opens — adjusted during render, so a
  // previous selection is never painted first.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSelected([]);
  }

  function toggle(exercise: Exercise) {
    if (single) {
      onPick([exercise]);
      return;
    }
    setSelected((current) =>
      current.some((e) => e.id === exercise.id)
        ? current.filter((e) => e.id !== exercise.id)
        : [...current, exercise],
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        // The height has to be set with the same `data-[side=bottom]`
        // variant the sheet uses for its own `h-auto`, or that wins and
        // the sheet grows as tall as the whole list — pushing the search
        // field and the filters off the top of the screen, out of reach.
        className="flex flex-col gap-0 rounded-t-2xl data-[side=bottom]:h-[92dvh] data-[side=bottom]:max-h-[92dvh] lg:data-[side=bottom]:mx-auto lg:data-[side=bottom]:max-w-2xl"
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {single
              ? "Tap the exercise to use instead."
              : "Tick the ones you want, then add them."}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
          <ExerciseList
            exercises={exercises}
            selected={selected.map((e) => e.id)}
            onToggle={toggle}
            onCreated={(exercise) => {
              onCreated(exercise);
              if (single) onPick([exercise]);
              else setSelected((current) => [...current, exercise]);
            }}
          />
        </div>
        {single ? null : (
          <div className="pb-safe border-t bg-card px-4 pt-3">
            <PendingButton
              type="button"
              size="lg"
              className="mb-3 w-full"
              pending={pending}
              pendingLabel="Adding…"
              disabled={selected.length === 0}
              onClick={() => onPick(selected)}
            >
              {selected.length === 0
                ? "Add"
                : `Add ${selected.length} ${selected.length === 1 ? "exercise" : "exercises"}`}
            </PendingButton>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
