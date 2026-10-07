"use client";

/**
 * "Log again" and "Copy from yesterday" (spec §12E).
 *
 * Both post to the same action, which re-logs through the ordinary paths
 * (`lib/repeat.ts`), so neither form ever carries a calorie figure.
 *
 * Duplicate submissions are prevented twice over: the submit button disables
 * while the request is in flight (ARCHITECTURE invariant 11), and once it has
 * succeeded the form is replaced by what was added, with no button left to
 * press again. Repeating it on purpose means opening it afresh.
 */

import { useActionState, useState } from "react";

import {
  repeatEntriesAction,
  type RepeatState,
} from "@/app/(app)/diary/repeat-actions";
import { PendingButton } from "@/components/pending-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DiaryEntry, MealType } from "@/lib/diary";

/** What the amount is counted in, for the label beside it. */
function unitWord(
  entry: Pick<DiaryEntry, "unit" | "servingLabel"> & { isEstimate?: boolean },
): string {
  // An estimate is repeated as a multiple of itself: 1 is the same again.
  if (entry.isEstimate) return "times";
  if (entry.unit === "serving") return entry.servingLabel?.trim() || "servings";
  return entry.unit;
}

function Done({ state }: { state: RepeatState }) {
  return (
    <Alert>
      <AlertDescription>{state.notice}</AlertDescription>
    </Alert>
  );
}

function Failure({ state }: { state: RepeatState }) {
  return state.error ? (
    <Alert variant="destructive">
      <AlertDescription>{state.error}</AlertDescription>
    </Alert>
  ) : null;
}

/** One entry, again — on any day, into any meal, in whatever amount. */
export function LogAgainForm({
  entry,
  mealTypes,
  defaultDate,
}: {
  entry: DiaryEntry;
  mealTypes: MealType[];
  /** Today, normally: you repeat a food because you are eating it now. */
  defaultDate: string;
}) {
  const [state, formAction] = useActionState<RepeatState, FormData>(
    repeatEntriesAction,
    {},
  );

  if (state.ok) return <Done state={state} />;

  const id = `again-${entry.id}`;
  return (
    <form action={formAction} className="space-y-3">
      <Failure state={state} />
      <input type="hidden" name="includeAll" value="true" />
      <input type="hidden" name="entryId" value={entry.id} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor={`${id}-amount`} className="text-xs">
            Amount <span className="text-muted-foreground">({unitWord(entry)})</span>
          </Label>
          <Input
            id={`${id}-amount`}
            name="amount"
            type="number"
            inputMode="decimal"
            step="any"
            min="0.01"
            required
            defaultValue={entry.amount}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-date`} className="text-xs">
            Day
          </Label>
          <Input
            id={`${id}-date`}
            name="logDate"
            type="date"
            required
            defaultValue={defaultDate}
          />
        </div>
        <div className="col-span-2 space-y-1 sm:col-span-1">
          <Label htmlFor={`${id}-meal`} className="text-xs">
            Meal
          </Label>
          <Select name="mealTypeId" defaultValue={String(entry.meal_type_id)}>
            <SelectTrigger id={`${id}-meal`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {mealTypes.map((meal) => (
                <SelectItem key={meal.id} value={String(meal.id)}>
                  {meal.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <PendingButton type="submit" size="sm" pendingLabel="Adding…">
        Log {entry.foodName} again
      </PendingButton>
    </form>
  );
}

/**
 * Yesterday's meal, onto this day: every item ticked, every amount
 * editable, nothing logged until the button is pressed.
 */
export function CopyMealForm({
  entries,
  mealTypeId,
  mealName,
  logDate,
}: {
  entries: DiaryEntry[];
  mealTypeId: number;
  mealName: string;
  logDate: string;
}) {
  const [state, formAction] = useActionState<RepeatState, FormData>(
    repeatEntriesAction,
    {},
  );
  const [ticked, setTicked] = useState(() => new Set(entries.map((e) => e.id)));

  if (state.ok) return <Done state={state} />;

  return (
    <form action={formAction} className="space-y-3">
      <Failure state={state} />
      <input type="hidden" name="logDate" value={logDate} />
      <input type="hidden" name="mealTypeId" value={mealTypeId} />

      <ul className="divide-y">
        {entries.map((entry) => {
          const id = `copy-${mealTypeId}-${entry.id}`;
          return (
            <li key={entry.id} className="flex items-center gap-3 py-2">
              <input type="hidden" name="entryId" value={entry.id} />
              <input
                id={id}
                type="checkbox"
                name="include"
                value={entry.id}
                checked={ticked.has(entry.id)}
                onChange={(event) =>
                  setTicked((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(entry.id);
                    else next.delete(entry.id);
                    return next;
                  })
                }
                className="size-4"
              />
              <Label htmlFor={id} className="min-w-0 flex-1 truncate text-sm font-normal">
                {entry.foodName}
              </Label>
              <Input
                name="amount"
                type="number"
                inputMode="decimal"
                step="any"
                min="0.01"
                defaultValue={entry.amount}
                aria-label={`Amount of ${entry.foodName} (${unitWord(entry)})`}
                className="w-24"
              />
              <span className="text-muted-foreground w-16 truncate text-xs">
                {unitWord(entry)}
              </span>
            </li>
          );
        })}
      </ul>

      <PendingButton
        type="submit"
        size="sm"
        pendingLabel="Adding…"
        disabled={ticked.size === 0}
      >
        Add {ticked.size} to {mealName}
      </PendingButton>
    </form>
  );
}

/**
 * The per-meal "Copy from yesterday" control: a button, then the form.
 *
 * Shown only when yesterday had something in this meal, so it is never a
 * button that opens onto nothing.
 */
export function CopyFromYesterday(props: {
  entries: DiaryEntry[];
  mealTypeId: number;
  mealName: string;
  logDate: string;
}) {
  const [open, setOpen] = useState(false);
  const kcal = props.entries.reduce((sum, e) => sum + e.kcal, 0);

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open
          ? "Close"
          : `Same as the day before? ${props.entries.length} item${props.entries.length === 1 ? "" : "s"}, ${Math.round(kcal)} kcal`}
      </button>
      {open ? <CopyMealForm {...props} /> : null}
    </div>
  );
}
