"use client";

/**
 * Quick Add (spec §12G): "Dinner out — 750 kcal, 45 g protein".
 *
 * For when there is no food to find: a meal out, a friend's cooking, a
 * number from a menu. The form says plainly that what it records is the
 * user's own estimate, and so does the diary afterwards. It creates no food;
 * if this is something eaten often, adding it as a food is the better path,
 * and the form says so.
 *
 * Once added it gives way to its result and an explicit "Add another", so a
 * second tap cannot log it twice.
 */

import { useActionState, useState } from "react";

import {
  quickAddAction,
  type QuickAddState,
} from "@/app/(app)/diary/quick-add-actions";
import { PendingButton } from "@/components/pending-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MealType } from "@/lib/diary";
import { QUICK_ADD_MAX_KCAL } from "@/lib/quick-add-input";

type Props = {
  logDate: string;
  mealTypes: MealType[];
  onCancel?: () => void;
};

export function QuickAddForm(props: Props) {
  const [round, setRound] = useState(0);
  return <Inner key={round} {...props} onAnother={() => setRound((r) => r + 1)} />;
}

function NumberField({
  name,
  label,
  required = false,
  max,
}: {
  name: string;
  label: string;
  required?: boolean;
  max: number;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={`quick-${name}`} className="text-xs">
        {label}
      </Label>
      <Input
        id={`quick-${name}`}
        name={name}
        type="number"
        inputMode="decimal"
        step="any"
        min="0"
        max={max}
        required={required}
      />
    </div>
  );
}

function Inner({
  logDate,
  mealTypes,
  onCancel,
  onAnother,
}: Props & { onAnother: () => void }) {
  const [state, formAction] = useActionState<QuickAddState, FormData>(
    quickAddAction,
    {},
  );

  if (state.ok) {
    return (
      <div className="space-y-2">
        <Alert>
          <AlertDescription>{state.notice}</AlertDescription>
        </Alert>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={onAnother}>
            Add another
          </Button>
          {onCancel ? (
            <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
              Done
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <p className="text-muted-foreground text-sm">
        Your own estimate, for when there is no food to find. It is logged
        as an estimate, not as verified nutrition, and it does not become a
        food — for something you eat often, add it as your own food instead.
      </p>
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <input type="hidden" name="logDate" value={logDate} />

      <div className="space-y-1">
        <Label htmlFor="quick-label" className="text-xs">
          What was it
        </Label>
        <Input
          id="quick-label"
          name="label"
          required
          maxLength={120}
          placeholder="e.g. Dinner out"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <NumberField name="kcal" label="Calories (kcal)" required max={QUICK_ADD_MAX_KCAL} />
        <NumberField name="protein_g" label="Protein (g, optional)" max={1000} />
        <NumberField name="carbs_g" label="Carbs (g, optional)" max={1000} />
        <NumberField name="fat_g" label="Fat (g, optional)" max={1000} />
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label htmlFor="quick-meal" className="text-xs">
            Meal
          </Label>
          <Select name="mealTypeId" defaultValue={String(mealTypes[0]?.id ?? "")}>
            <SelectTrigger id="quick-meal">
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
        <PendingButton type="submit" pendingLabel="Adding…">
          Add estimate
        </PendingButton>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
