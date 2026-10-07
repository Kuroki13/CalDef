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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MAX_EXTRA_SERVINGS } from "@/lib/food/custom-input";
import type { CachedFood } from "@/lib/food/types";

type Basis = "per_100g" | "per_100ml" | "per_serving";
type ExtraRow = { key: number; label: string; amount: string };

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

  const [basis, setBasis] = useState<Basis>(
    food?.basisUnit === "ml" ? "per_100ml" : "per_100g",
  );
  // Only consulted per serving; the per-100 panels already say which unit.
  const [servingUnit, setServingUnit] = useState<"g" | "ml">(
    food?.basisUnit === "ml" ? "ml" : "g",
  );
  const measure =
    basis === "per_100ml" ? "ml" : basis === "per_100g" ? "g" : servingUnit;

  // Every serving but the main one, so an edit shows what is already there.
  // Keys are local and only for React; the server pairs rows by position.
  // Initial rows take their index, so new ones start past the cap.
  const nextKey = useRef(MAX_EXTRA_SERVINGS);
  const [extras, setExtras] = useState<ExtraRow[]>(() =>
    (food?.servings ?? [])
      .filter((serving) => serving !== defaultServing)
      .slice(0, MAX_EXTRA_SERVINGS)
      .map((serving, index) => ({
        key: index,
        label: serving.label,
        amount: String(serving.grams),
      })),
  );
  const handledFood = useRef<number | null>(null);
  // Notify the parent after commit, never update another component in render.
  useEffect(() => {
    if (state.food && state.food.id !== handledFood.current) {
      handledFood.current = state.food.id;
      onSaved?.(state.food);
    }
  }, [state.food, onSaved]);

  const unit =
    basis === "per_100g"
      ? "per 100 g"
      : basis === "per_100ml"
        ? "per 100 ml"
        : "per serving";

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
          onValueChange={(value) => setBasis(value as Basis)}
        >
          <SelectTrigger id={`food-basis-${food?.id ?? "new"}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="per_100g">per 100 g</SelectItem>
            <SelectItem value="per_100ml">per 100 ml (drinks)</SelectItem>
            <SelectItem value="per_serving">per serving</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">
          Copy whichever column the packet prints. Per-serving figures are
          converted when they are saved, so you never do that sum yourself.
        </p>
      </div>

      {basis === "per_serving" ? (
        <div className="space-y-1">
          <Label
            htmlFor={`food-serving-unit-${food?.id ?? "new"}`}
            className="text-xs"
          >
            A serving is measured in
          </Label>
          <Select
            name="servingUnit"
            value={servingUnit}
            onValueChange={(value) => setServingUnit(value as "g" | "ml")}
          >
            <SelectTrigger id={`food-serving-unit-${food?.id ?? "new"}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="g">grams (a bar, a pot)</SelectItem>
              <SelectItem value="ml">millilitres (a can, a bottle)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : (
        <input type="hidden" name="servingUnit" value={measure} />
      )}

      <div className="grid grid-cols-2 gap-3">
        <NumberField
          id={`food-serving-grams-${food?.id ?? "new"}`}
          name="servingGrams"
          label={measure === "ml" ? "One serving holds" : "One serving weighs"}
          suffix={measure}
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

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          Other ways you eat it{" "}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </legend>
        <p className="text-muted-foreground text-xs">
          Name a portion and its size — &ldquo;1 pot&rdquo;, 160 {measure} —
          and you can log it as that later instead of weighing.
        </p>
        {extras.map((row, index) => (
          <div key={row.key} className="flex items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <Label
                htmlFor={`food-extra-label-${food?.id ?? "new"}-${row.key}`}
                className="text-xs"
              >
                Portion name
              </Label>
              <Input
                id={`food-extra-label-${food?.id ?? "new"}-${row.key}`}
                name="extraServingLabel"
                maxLength={120}
                defaultValue={row.label}
                placeholder="e.g. 1 pot"
              />
            </div>
            <div className="w-28 space-y-1">
              <Label
                htmlFor={`food-extra-amount-${food?.id ?? "new"}-${row.key}`}
                className="text-xs"
              >
                Size <span className="text-muted-foreground">({measure})</span>
              </Label>
              <Input
                id={`food-extra-amount-${food?.id ?? "new"}-${row.key}`}
                name="extraServingAmount"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                defaultValue={row.amount}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Remove portion ${index + 1}`}
              onClick={() =>
                setExtras((rows) => rows.filter((r) => r.key !== row.key))
              }
            >
              Remove
            </Button>
          </div>
        ))}
        {extras.length < MAX_EXTRA_SERVINGS ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              setExtras((rows) => [
                ...rows,
                { key: nextKey.current++, label: "", amount: "" },
              ])
            }
          >
            Add a portion
          </Button>
        ) : null}
      </fieldset>

      <div className="space-y-1">
        <Label
          htmlFor={`food-notes-${food?.id ?? "new"}`}
          className="text-xs"
        >
          Notes <span className="text-muted-foreground">(optional, only you see these)</span>
        </Label>
        <Textarea
          id={`food-notes-${food?.id ?? "new"}`}
          name="notes"
          maxLength={500}
          rows={2}
          defaultValue={food?.notes ?? ""}
          placeholder="e.g. the 0% one from the Thursday market"
        />
      </div>

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
