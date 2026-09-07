"use client";

/**
 * The food library: what the user has entered off packaging.
 *
 * Editing happens in place rather than on another screen, because the thing
 * being corrected is usually a single mistyped number and the row it belongs
 * to is the context for it.
 *
 * Each row says how many times the food has been used, which is not
 * decoration: it is what decides whether "Remove" deletes the food or
 * retires it, and saying so before the tap is better than explaining it
 * afterwards.
 */

import { useActionState, useState } from "react";

import {
  deleteCustomFoodAction,
  type CustomFoodState,
} from "@/app/(app)/recipes/food-actions";
import { CustomFoodForm } from "@/components/custom-food-form";
import { PendingButton } from "@/components/pending-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { CachedFood } from "@/lib/food/types";

export type CustomFoodRow = CachedFood & { useCount: number };

export function CustomFoodLibrary({ foods }: { foods: CustomFoodRow[] }) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  return (
    <div className="space-y-4">
      {foods.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nothing here yet. Add the things you eat that no database knows
          about — a local bakery&rsquo;s bread, a supplement, whatever your
          gym sells.
        </p>
      ) : (
        <ul className="divide-y">
          {foods.map((food) => (
            <li key={food.id} className="space-y-2 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{food.name}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {food.brand ? `${food.brand} · ` : ""}
                    {Math.round(food.nutrients.kcal)} kcal / 100 g ·{" "}
                    {Math.round(food.nutrients.protein_g)}P{" "}
                    {Math.round(food.nutrients.carbs_g)}C{" "}
                    {Math.round(food.nutrients.fat_g)}F
                    {food.useCount > 0
                      ? ` · used ${food.useCount === 1 ? "once" : `${food.useCount} times`}`
                      : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-expanded={editingId === food.id}
                    aria-label={`Edit ${food.name}`}
                    onClick={() =>
                      setEditingId((open) => (open === food.id ? null : food.id))
                    }
                  >
                    Edit
                  </Button>
                  <RemoveFood food={food} />
                </div>
              </div>

              {editingId === food.id ? (
                <div className="bg-muted/40 rounded-md p-3">
                  <CustomFoodForm
                    food={food}
                    submitLabel="Save changes"
                    onCancel={() => setEditingId(null)}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <div className="bg-muted/40 rounded-md p-3">
          <CustomFoodForm
            onCancel={() => setCreating(false)}
            onSaved={() => setCreating(false)}
          />
        </div>
      ) : (
        <Button type="button" variant="secondary" onClick={() => setCreating(true)}>
          Add a food
        </Button>
      )}
    </div>
  );
}

/**
 * Remove, with the consequence stated first.
 *
 * A food nobody has eaten is deleted; one that history points at is retired
 * and its entries are left exactly as they are. The button says which will
 * happen, so "Remove" never has to be undone — and there is no undo.
 */
function RemoveFood({ food }: { food: CustomFoodRow }) {
  const [state, formAction] = useActionState<CustomFoodState, FormData>(
    deleteCustomFoodAction,
    {},
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="foodId" value={food.id} />
      <PendingButton
        type="submit"
        size="sm"
        variant="ghost"
        aria-label={
          food.useCount > 0
            ? `Retire ${food.name}, keeping the entries that use it`
            : `Delete ${food.name}`
        }
      >
        Remove
      </PendingButton>
      {state.error ? (
        <Alert variant="destructive" className="mt-2">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {state.ok && state.notice ? (
        <Alert className="mt-2">
          <AlertDescription>{state.notice}</AlertDescription>
        </Alert>
      ) : null}
    </form>
  );
}
