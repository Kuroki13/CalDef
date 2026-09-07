"use client";

/**
 * The label, typed in.
 *
 * One form for creating and for editing, because they are the same act with
 * a different starting point — and because two forms would be two places for
 * the per-serving arithmetic to go subtly differently.
 *
 * The figures are sent as they appear on the packet, with a note of which
 * panel they came from. Converting "per 45 g serving" into per-100 g is the
 * server's job (`lib/food/custom-input.ts`), so the number the user checks
 * against the packet is the number they typed.
 */

import { useActionState, useEffect, useRef, useState } from "react";

import {
  saveCustomFoodAction,
  type CustomFoodState,
} from "@/app/(app)/recipes/food-actions";
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
import type { CachedFood } from "@/lib/food/types";

type Props = {
  /** Set when editing; absent when creating. */
  food?: CachedFood;
  /** Called once with the saved food — the diary logs it immediately. */
  onSaved?: (food: CachedFood) => void;
  onCancel?: () => void;
  submitLabel?: string;
};

function NumberField({
  id,
  name,
  label,
  defaultValue,
  required = false,
  suffix,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue?: number | null;
  required?: boolean;
  suffix?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
        {suffix ? (
          <span className="text-muted-foreground"> ({suffix})</span>
        ) : null}
      </Label>
      <Input
        id={id}
        name={name}
        type="number"
        inputMode="decimal"
        step="any"
        min="0"
        required={required}
        defaultValue={defaultValue ?? undefined}
      />
    </div>
  );
}

export function CustomFoodForm({
  food,
  onSaved,
  onCancel,
  submitLabel = "Save this food",
}: Props) {
  const [state, formAction] = useActionState<CustomFoodState, FormData>(
    saveCustomFoodAction,
    {},
  );

  // A food being edited already holds per-100 g figures, so that is the
  // panel the form starts on. Its serving, if it has one, is offered back
  // as a serving rather than as the basis — changing what a portion weighs
  // must not silently rescale nutrition the user did not retype.
  const defaultServing =
    food?.servings.find((serving) => serving.isDefault) ??
    food?.servings[0] ??
    null;

  const [basis, setBasis] = useState<"per_100g" | "per_serving">("per_100g");
  const handledFood = useRef<number | null>(null);
  // Notify the parent after commit, never update another component in render.
  useEffect(() => {
    if (state.food && state.food.id !== handledFood.current) {
      handledFood.current = state.food.id;
      onSaved?.(state.food);
    }
  }, [state.food, onSaved]);

  const unit = basis === "per_100g" ? "per 100 g" : "per serving";

  return (
    <form action={formAction} className="space-y-4">
      {food ? <input type="hidden" name="foodId" value={food.id} /> : null}

      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {state.ok && state.notice ? (
        <Alert>
          <AlertDescription>{state.notice}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor={`food-name-${food?.id ?? "new"}`} className="text-xs">
            Name
          </Label>
          <Input
            id={`food-name-${food?.id ?? "new"}`}
            name="name"
            required
            maxLength={300}
            defaultValue={food?.name}
            placeholder="e.g. Protein flapjack"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`food-brand-${food?.id ?? "new"}`} className="text-xs">
            Brand <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id={`food-brand-${food?.id ?? "new"}`}
            name="brand"
            maxLength={200}
            defaultValue={food?.brand ?? ""}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor={`food-basis-${food?.id ?? "new"}`} className="text-xs">
          The figures below are
        </Label>
        <Select
          name="basis"
          value={basis}
          onValueChange={(value) => setBasis(value as typeof basis)}
        >
          <SelectTrigger id={`food-basis-${food?.id ?? "new"}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="per_100g">per 100 g</SelectItem>
            <SelectItem value="per_serving">per serving</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">
          Copy whichever column the packet prints. Per-serving figures are
          converted to per 100 g when they are saved.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <NumberField
          id={`food-serving-grams-${food?.id ?? "new"}`}
          name="servingGrams"
          label="One serving weighs"
          suffix="g"
          required={basis === "per_serving"}
          defaultValue={defaultServing?.grams ?? null}
        />
        <div className="space-y-1">
          <Label
            htmlFor={`food-serving-label-${food?.id ?? "new"}`}
            className="text-xs"
          >
            Called <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id={`food-serving-label-${food?.id ?? "new"}`}
            name="servingLabel"
            maxLength={120}
            defaultValue={defaultServing?.label ?? ""}
            placeholder="e.g. 1 bar"
          />
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Nutrition {unit}</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumberField
            id={`food-kcal-${food?.id ?? "new"}`}
            name="kcal"
            label="Calories"
            suffix="kcal"
            required
            defaultValue={food?.nutrients.kcal}
          />
          <NumberField
            id={`food-protein-${food?.id ?? "new"}`}
            name="protein_g"
            label="Protein"
            suffix="g"
            required
            defaultValue={food?.nutrients.protein_g}
          />
          <NumberField
            id={`food-carbs-${food?.id ?? "new"}`}
            name="carbs_g"
            label="Carbs"
            suffix="g"
            required
            defaultValue={food?.nutrients.carbs_g}
          />
          <NumberField
            id={`food-fat-${food?.id ?? "new"}`}
            name="fat_g"
            label="Fat"
            suffix="g"
            required
            defaultValue={food?.nutrients.fat_g}
          />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumberField
            id={`food-fiber-${food?.id ?? "new"}`}
            name="fiber_g"
            label="Fibre"
            suffix="g"
            defaultValue={food?.nutrients.fiber_g ?? null}
          />
          <NumberField
            id={`food-sugar-${food?.id ?? "new"}`}
            name="sugar_g"
            label="Sugar"
            suffix="g"
            defaultValue={food?.nutrients.sugar_g ?? null}
          />
          <NumberField
            id={`food-satfat-${food?.id ?? "new"}`}
            name="sat_fat_g"
            label="Sat. fat"
            suffix="g"
            defaultValue={food?.nutrients.sat_fat_g ?? null}
          />
          <NumberField
            id={`food-sodium-${food?.id ?? "new"}`}
            name="sodium_mg"
            label="Sodium"
            suffix="mg"
            defaultValue={food?.nutrients.sodium_mg ?? null}
          />
        </div>
      </fieldset>

      <div className="space-y-1">
        <Label
          htmlFor={`food-barcode-${food?.id ?? "new"}`}
          className="text-xs"
        >
          Barcode <span className="text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id={`food-barcode-${food?.id ?? "new"}`}
          name="barcode"
          inputMode="numeric"
          defaultValue={food?.barcode ?? ""}
          placeholder="Scanning this number will find your own version"
        />
      </div>

      <div className="flex gap-2">
        <PendingButton type="submit" pendingLabel="Saving…">
          {submitLabel}
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
