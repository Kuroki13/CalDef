"use client";

import { useActionState } from "react";

import {
  addIngredientsAction,
  createRecipeAction,
  createSavedMealAction,
  logFavoriteAction,
  logRecipeAction,
  logSavedMealAction,
  type LibraryState,
} from "@/app/(app)/recipes/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PendingButton } from "@/components/pending-button";
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

type EntryOption = { id: number; label: string };

function Feedback({ state }: { state: LibraryState }) {
  if (state.error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{state.error}</AlertDescription>
      </Alert>
    );
  }
  if (state.notice) {
    return (
      <Alert>
        <AlertDescription>{state.notice}</AlertDescription>
      </Alert>
    );
  }
  return null;
}

/**
 * Entries are picked from a day already logged rather than searched afresh.
 *
 * That matches how the need arises — you eat the same breakfast three days
 * running and want it back as one action — and it means every ingredient is
 * already a cached food with a nutrient row.
 */
function EntryPicker({ entries }: { entries: EntryOption[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Log some food today first — recipes and meals are built from entries
        already in your diary.
      </p>
    );
  }

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Include today&rsquo;s entries</legend>
      {entries.map((entry) => (
        <label key={entry.id} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="entryId"
            value={entry.id}
            className="size-4"
          />
          {entry.label}
        </label>
      ))}
    </fieldset>
  );
}

/** Collapses the checkbox group into the comma-separated field zod expects. */
function collapseEntryIds(formData: FormData): FormData {
  const ids = formData.getAll("entryId").map(String);
  formData.delete("entryId");
  formData.set("entryIds", ids.join(","));
  return formData;
}

export function CreateRecipeForm({ entries }: { entries: EntryOption[] }) {
  const [state, formAction] = useActionState<LibraryState, FormData>(
    (prev, formData) => createRecipeAction(prev, collapseEntryIds(formData)),
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <Feedback state={state} />

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="recipe-name">Name</Label>
          <Input id="recipe-name" name="name" required maxLength={120} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="recipe-servings">Servings it makes</Label>
          <Input
            id="recipe-servings"
            name="servings"
            type="number"
            step="any"
            min="0.1"
            defaultValue={1}
            required
          />
        </div>
      </div>

      <EntryPicker entries={entries} />

      <PendingButton type="submit" className="w-full" pendingLabel="Creating…">
        Create recipe
      </PendingButton>
    </form>
  );
}

export function CreateSavedMealForm({
  entries,
  mealTypes,
}: {
  entries: EntryOption[];
  mealTypes: MealType[];
}) {
  const [state, formAction] = useActionState<LibraryState, FormData>(
    (prev, formData) => createSavedMealAction(prev, collapseEntryIds(formData)),
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <Feedback state={state} />

      <div className="space-y-2">
        <Label htmlFor="meal-name">Name</Label>
        <Input id="meal-name" name="name" required maxLength={120} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="meal-default">Usually eaten at</Label>
        <Select
          name="defaultMealTypeId"
          defaultValue={String(mealTypes[0]?.id ?? "")}
        >
          <SelectTrigger id="meal-default">
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

      <EntryPicker entries={entries} />

      <PendingButton type="submit" className="w-full" pendingLabel="Saving…">
        Save this meal
      </PendingButton>
    </form>
  );
}

export function LogRecipeForm({
  recipeId,
  logDate,
  mealTypes,
}: {
  recipeId: number;
  logDate: string;
  mealTypes: MealType[];
}) {
  const [state, formAction] = useActionState<LibraryState, FormData>(
    logRecipeAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-3">
      <Feedback state={state} />
      <input type="hidden" name="recipeId" value={recipeId} />
      <input type="hidden" name="logDate" value={logDate} />

      <div className="flex items-end gap-2">
        <div className="w-24 space-y-1">
          <Label htmlFor={`servings-${recipeId}`} className="text-xs">
            Servings
          </Label>
          <Input
            id={`servings-${recipeId}`}
            name="servings"
            type="number"
            step="any"
            min="0.1"
            defaultValue={1}
          />
        </div>
        <div className="flex-1 space-y-1">
          <Label htmlFor={`meal-${recipeId}`} className="text-xs">
            Meal
          </Label>
          <Select name="mealTypeId" defaultValue={String(mealTypes[0]?.id ?? "")}>
            <SelectTrigger id={`meal-${recipeId}`}>
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
        <PendingButton type="submit" pendingLabel="Logging…">
          Log
        </PendingButton>
      </div>
    </form>
  );
}

export function LogSavedMealForm({
  savedMealId,
  logDate,
  mealTypes,
  defaultMealTypeId,
}: {
  savedMealId: number;
  logDate: string;
  mealTypes: MealType[];
  defaultMealTypeId: number | null;
}) {
  const [state, formAction] = useActionState<LibraryState, FormData>(
    logSavedMealAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-3">
      <Feedback state={state} />
      <input type="hidden" name="savedMealId" value={savedMealId} />
      <input type="hidden" name="logDate" value={logDate} />

      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label htmlFor={`saved-meal-${savedMealId}`} className="text-xs">
            Meal
          </Label>
          <Select
            name="mealTypeId"
            defaultValue={String(defaultMealTypeId ?? mealTypes[0]?.id ?? "")}
          >
            <SelectTrigger id={`saved-meal-${savedMealId}`}>
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
        <PendingButton type="submit" pendingLabel="Logging…">
          Log
        </PendingButton>
      </div>
    </form>
  );
}

/**
 * Adds today's entries to a recipe that already exists.
 *
 * Rendered per recipe, so the checkbox `id`s are namespaced by recipe — two
 * of these on one page would otherwise share label targets.
 */
export function AddIngredientsForm({
  recipeId,
  entries,
}: {
  recipeId: number;
  entries: EntryOption[];
}) {
  const [state, formAction] = useActionState<LibraryState, FormData>(
    (prev, formData) => addIngredientsAction(prev, collapseEntryIds(formData)),
    {},
  );

  if (entries.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        Log the ingredients in today&rsquo;s diary first, then add them here.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-2">
      <Feedback state={state} />
      <input type="hidden" name="recipeId" value={recipeId} />

      <fieldset className="space-y-1">
        <legend className="text-xs font-medium">
          Add from today&rsquo;s diary
        </legend>
        {entries.map((entry) => (
          <label
            key={entry.id}
            className="flex items-center gap-2 text-xs"
            htmlFor={`ingredient-${recipeId}-${entry.id}`}
          >
            <input
              id={`ingredient-${recipeId}-${entry.id}`}
              type="checkbox"
              name="entryId"
              value={entry.id}
              className="size-4"
            />
            {entry.label}
          </label>
        ))}
      </fieldset>

      <PendingButton
        type="submit"
        size="sm"
        variant="secondary"
        pendingLabel="Adding…"
      >
        Add ingredients
      </PendingButton>
    </form>
  );
}

/**
 * Logs a starred food in one step.
 *
 * Grams rather than servings: the row above it quotes kcal per 100 g, so the
 * amount the user types is against the number they can already see.
 */
export function LogFavoriteForm({
  foodId,
  logDate,
  mealTypes,
}: {
  foodId: number;
  logDate: string;
  mealTypes: MealType[];
}) {
  const [state, formAction] = useActionState<LibraryState, FormData>(
    logFavoriteAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-2">
      <Feedback state={state} />
      <input type="hidden" name="foodId" value={foodId} />
      <input type="hidden" name="logDate" value={logDate} />

      <div className="flex items-end gap-2">
        <div className="w-20 space-y-1">
          <Label htmlFor={`favorite-grams-${foodId}`} className="text-xs">
            Grams
          </Label>
          <Input
            id={`favorite-grams-${foodId}`}
            name="grams"
            type="number"
            step="any"
            min="0.1"
            defaultValue={100}
          />
        </div>
        <div className="flex-1 space-y-1">
          <Label htmlFor={`favorite-meal-${foodId}`} className="text-xs">
            Meal
          </Label>
          <Select name="mealTypeId" defaultValue={String(mealTypes[0]?.id ?? "")}>
            <SelectTrigger id={`favorite-meal-${foodId}`}>
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
        <PendingButton type="submit" size="sm" pendingLabel="Logging…">
          Log
        </PendingButton>
      </div>
    </form>
  );
}
