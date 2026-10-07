"use client";

/**
 * My Foods — what this person has already made theirs (spec §12B).
 *
 * One list at a time, chosen by a row of filters, rather than seven stacked
 * sections: on a phone, seven headings is a scroll past six things to reach
 * the one wanted. Filters with nothing in them are not shown at all, so a
 * new account sees no empty "Scanned (0)".
 *
 * A food chosen here goes to exactly the same portion-and-log step as a
 * search result — this is a faster way to *find* a food, never a second way
 * to log one. Recipes and saved meals log through the same forms the
 * Recipes screen uses, for the same reason.
 */

import { useState } from "react";

import {
  LogRecipeForm,
  LogSavedMealForm,
} from "@/app/(app)/recipes/library-forms";
import { ServingHint } from "@/components/portion-macros";
import { SourceBadge } from "@/components/source-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MealType } from "@/lib/diary";
import { per100Label } from "@/lib/food/basis";
import type { LibraryMeal, LibraryRecipe, PersonalLibrary } from "@/lib/food/library-types";
import { fold, terms } from "@/lib/food/text-match";
import type { Food } from "@/lib/food/types";

export type LibraryView =
  | "recent"
  | "frequent"
  | "favorites"
  | "custom"
  | "scanned"
  | "recipes"
  | "meals";

export const VIEW_LABELS: Record<LibraryView, string> = {
  recent: "Recent",
  frequent: "Frequent",
  favorites: "Favourites",
  custom: "Yours",
  scanned: "Scanned",
  recipes: "Recipes",
  meals: "Meals",
};

const ORDER: LibraryView[] = [
  "recent",
  "frequent",
  "favorites",
  "custom",
  "scanned",
  "recipes",
  "meals",
];

/** The filters worth showing: those with something in them, in a fixed order. */
export function availableViews(library: PersonalLibrary): LibraryView[] {
  return ORDER.filter((view) => library[view].length > 0);
}

/** Every typed word must appear in the name or brand, accents ignored. */
export function matchesFilter(
  item: { name: string; brand?: string | null },
  filter: string,
): boolean {
  const wanted = terms(filter);
  if (wanted.length === 0) return true;
  const haystack = fold(`${item.name} ${item.brand ?? ""}`);
  return wanted.every((term) => haystack.includes(term));
}

export function MyFoods({
  library,
  logDate,
  mealTypes,
  onChoose,
}: {
  library: PersonalLibrary;
  logDate: string;
  mealTypes: MealType[];
  onChoose: (food: Food) => void;
}) {
  const views = availableViews(library);
  const [view, setView] = useState<LibraryView | null>(views[0] ?? null);
  const [filter, setFilter] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const current = view && views.includes(view) ? view : (views[0] ?? null);

  const visible = current
    ? (library[current] as { name: string; brand?: string | null }[]).filter(
        (item) => matchesFilter(item, filter),
      )
    : [];

  if (!current) {
    return (
      <p className="text-muted-foreground text-sm">
        Nothing here yet. Foods you log, star, scan or add yourself will
        collect here, so next time they are one tap away instead of a search.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div
        role="group"
        aria-label="Show"
        className="flex flex-wrap gap-1"
      >
        {views.map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={option === current ? "secondary" : "ghost"}
            aria-pressed={option === current}
            onClick={() => {
              setView(option);
              setOpenId(null);
            }}
          >
            {VIEW_LABELS[option]}
          </Button>
        ))}
      </div>

      <Input
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder={`Filter ${VIEW_LABELS[current].toLowerCase()}`}
        aria-label="Filter my foods"
      />

      {visible.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nothing in {VIEW_LABELS[current].toLowerCase()} matches that. Search
          looks further.
        </p>
      ) : current === "recipes" ? (
        <ul className="divide-y">
          {(visible as LibraryRecipe[]).map((recipe) => (
            <LibraryRow
              key={`recipe:${recipe.id}`}
              title={recipe.name}
              detail={
                recipe.hasIngredients
                  ? `${Math.round(recipe.kcalPerServing)} kcal a serving · makes ${recipe.servings}`
                  : "No ingredients yet — add them on the Recipes screen"
              }
              open={openId === `recipe:${recipe.id}`}
              onToggle={
                recipe.hasIngredients
                  ? () =>
                      setOpenId((id) =>
                        id === `recipe:${recipe.id}` ? null : `recipe:${recipe.id}`,
                      )
                  : undefined
              }
            >
              <LogRecipeForm
                recipeId={recipe.id}
                logDate={logDate}
                mealTypes={mealTypes}
              />
            </LibraryRow>
          ))}
        </ul>
      ) : current === "meals" ? (
        <ul className="divide-y">
          {(visible as LibraryMeal[]).map((meal) => (
            <LibraryRow
              key={`meal:${meal.id}`}
              title={meal.name}
              detail={`${meal.itemCount} item${meal.itemCount === 1 ? "" : "s"} · ${Math.round(meal.kcal)} kcal`}
              open={openId === `meal:${meal.id}`}
              onToggle={
                meal.itemCount > 0
                  ? () =>
                      setOpenId((id) =>
                        id === `meal:${meal.id}` ? null : `meal:${meal.id}`,
                      )
                  : undefined
              }
            >
              <LogSavedMealForm
                savedMealId={meal.id}
                logDate={logDate}
                mealTypes={mealTypes}
                defaultMealTypeId={meal.defaultMealTypeId}
              />
            </LibraryRow>
          ))}
        </ul>
      ) : (
        <ul className="divide-y">
          {(visible as Food[]).map((food) => (
            <li key={`${food.source}:${food.sourceId}`}>
              <button
                type="button"
                onClick={() => onChoose(food)}
                className="hover:bg-accent/50 flex w-full items-center justify-between gap-3 rounded-md px-2 py-3 text-left"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {food.name}
                  </span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {food.brand ? `${food.brand} · ` : ""}
                    {Math.round(food.nutrients.kcal)} kcal / {per100Label(food)}
                    <ServingHint food={food} />
                  </span>
                </span>
                <SourceBadge food={food} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A recipe or meal: a summary line, and its log form when opened. */
function LibraryRow({
  title,
  detail,
  open,
  onToggle,
  children,
}: {
  title: string;
  detail: string;
  open: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
}) {
  return (
    <li className="space-y-2 py-3">
      <div className="flex items-start justify-between gap-3 px-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{title}</p>
          <p className="text-muted-foreground truncate text-xs">{detail}</p>
        </div>
        {onToggle ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-expanded={open}
            aria-label={`Log ${title}`}
            onClick={onToggle}
          >
            {open ? "Close" : "Log"}
          </Button>
        ) : null}
      </div>
      {open ? <div className="px-2">{children}</div> : null}
    </li>
  );
}
