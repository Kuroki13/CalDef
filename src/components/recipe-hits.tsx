"use client";

/**
 * The user's own recipes that answer a search (spec §13G).
 *
 * Above the database results, because "Mom's Chicken Maqlouba" is what
 * "maqlouba" means to the person typing it — while everything below stays
 * one tap away, so another interpretation is always choosable. Logged in
 * servings through the Recipes screen's own form; a recipe's weight is the
 * raw weight of its ingredients, which is not what a cooked plate weighs,
 * so grams are not offered here.
 */

import { useState } from "react";

import { LogRecipeForm } from "@/app/(app)/recipes/library-forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { MealType } from "@/lib/diary";
import type { LearnedHit, RecipeHit } from "@/lib/food/types";

export function RecipeHits({
  recipes,
  logDate,
  mealTypes,
  searchedFor = null,
  learned = [],
  onForget,
}: {
  recipes: RecipeHit[];
  logDate: string;
  mealTypes: MealType[];
  /** What was typed, so logging from here teaches the app (§13I). */
  searchedFor?: string | null;
  /** Recipes this phrase has come to mean, with the id that forgets each. */
  learned?: LearnedHit[];
  onForget?: (vocabularyId: number) => void;
}) {
  const [open, setOpen] = useState<number | null>(recipes.length === 1 ? recipes[0].id : null);
  const learnedFor = (recipeId: number) =>
    learned.find((pick) => pick.recipeId === recipeId) ?? null;

  return (
    <section aria-labelledby="recipe-hits-heading" className="space-y-1">
      <p id="recipe-hits-heading" className="text-sm font-medium">
        Your recipes
      </p>
      <ul className="divide-y rounded-lg border">
        {recipes.map((recipe) => (
          <li key={recipe.id} className="space-y-2 px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{recipe.name}</p>
                {learnedFor(recipe.id) && searchedFor ? (
                  <p className="text-xs font-medium">
                    Your usual for &ldquo;{searchedFor}&rdquo;
                  </p>
                ) : null}
                <p className="text-muted-foreground text-xs">
                  {Math.round(recipe.kcalPerServing)} kcal ·{" "}
                  {Math.round(recipe.proteinPerServing)} g protein a serving · makes{" "}
                  {recipe.servings}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Badge variant="secondary">{recipe.isFamily ? "Family" : "Recipe"}</Badge>
                {learnedFor(recipe.id) && onForget ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Stop putting ${recipe.name} first for “${searchedFor ?? ""}”`}
                    onClick={() => onForget((learnedFor(recipe.id) as LearnedHit).vocabularyId)}
                  >
                    Not this
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-expanded={open === recipe.id}
                  aria-label={`Log ${recipe.name}`}
                  onClick={() => setOpen((id) => (id === recipe.id ? null : recipe.id))}
                >
                  {open === recipe.id ? "Close" : "Log"}
                </Button>
              </div>
            </div>
            {open === recipe.id ? (
              <LogRecipeForm
                recipeId={recipe.id}
                logDate={logDate}
                mealTypes={mealTypes}
                cookedWeightG={recipe.cookedWeightG}
                servings={recipe.servings}
                searchedFor={searchedFor}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
