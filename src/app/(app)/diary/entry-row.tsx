"use client";

import { useActionState, useState } from "react";

import {
  deleteEntry,
  updateEntryAmount,
  type DiaryActionState,
} from "@/app/(app)/diary/actions";
import { toggleFavoriteAction } from "@/app/(app)/recipes/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DiaryEntry } from "@/lib/diary";
import { describePortion } from "@/lib/nutrition/units";

export function EntryRow({ entry }: { entry: DiaryEntry }) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState<
    DiaryActionState,
    FormData
  >(updateEntryAmount, {});

  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{entry.foodName}</p>
        <p className="text-muted-foreground truncate text-xs">
          {entry.foodBrand ? `${entry.foodBrand} · ` : ""}
          {describePortion(entry.amount, entry.unit, entry.servingLabel)}
          {entry.unit !== "g" ? ` · ${Math.round(entry.grams)} g` : ""}
          {" · "}
          {Math.round(entry.protein_g)}P {Math.round(entry.carbs_g)}C{" "}
          {Math.round(entry.fat_g)}F
        </p>
        {state.error ? (
          <p className="text-destructive text-xs">{state.error}</p>
        ) : null}
      </div>

      {editing ? (
        <form action={formAction} className="flex items-center gap-2">
          <input type="hidden" name="entryId" value={entry.id} />
          <Input
            name="amount"
            type="number"
            inputMode="decimal"
            step="any"
            min="0.01"
            defaultValue={entry.amount}
            className="w-24"
            aria-label={`Amount for ${entry.foodName}`}
          />
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "…" : "Save"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex items-center gap-1">
          <span className="text-sm tabular-nums">
            {Math.round(entry.kcal)} kcal
          </span>
          {/* A recipe entry has no single food, so there is nothing to star. */}
          {entry.foodId !== null ? (
            <form action={toggleFavoriteAction}>
              <input type="hidden" name="foodId" value={entry.foodId} />
              <input
                type="hidden"
                name="favorite"
                value={String(entry.isFavorite)}
              />
              <Button
                type="submit"
                size="sm"
                variant="ghost"
                aria-label={
                  entry.isFavorite
                    ? `Unstar ${entry.foodName}`
                    : `Star ${entry.foodName}`
                }
                aria-pressed={entry.isFavorite}
              >
                {entry.isFavorite ? "★" : "☆"}
              </Button>
            </form>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setEditing(true)}
            aria-label={`Edit ${entry.foodName}`}
          >
            Edit
          </Button>
          <form action={deleteEntry}>
            <input type="hidden" name="entryId" value={entry.id} />
            <Button
              type="submit"
              size="sm"
              variant="ghost"
              aria-label={`Remove ${entry.foodName}`}
            >
              Remove
            </Button>
          </form>
        </div>
      )}
    </li>
  );
}
