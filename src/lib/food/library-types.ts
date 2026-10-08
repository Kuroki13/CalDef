/**
 * The personal library's shapes, apart from the server code that fills
 * them, so the client component that shows the library can name them
 * without reaching into a `server-only` module.
 */

import type { CachedFood } from "@/lib/food/types";
import type { UsualPortion } from "@/lib/nutrition/typical-portion";

export type LibraryRecipe = {
  id: number;
  name: string;
  servings: number;
  kcalPerServing: number;
  /** An empty recipe cannot be logged, and is offered no button. */
  hasIngredients: boolean;
  isFamily: boolean;
  /** What the finished dish weighed, which lets it be logged in grams. */
  cookedWeightG: number | null;
};

/**
 * A family food is a recipe or a custom food the owner marked (§13H) —
 * there is no family-food table, by the spec's own instruction. `name`
 * and `brand` sit at the top so the list can be filtered like any other.
 */
export type FamilyItem =
  | { kind: "recipe"; id: string; name: string; brand?: null; recipe: LibraryRecipe }
  | { kind: "food"; id: string; name: string; brand: string | null; food: CachedFood };

export type LibraryMeal = {
  id: number;
  name: string;
  itemCount: number;
  kcal: number;
  defaultMealTypeId: number | null;
  /** What the meal holds, so its amounts can be changed at log time (§12F). */
  items: {
    id: number;
    foodName: string;
    amount: number;
    unit: "g" | "ml" | "serving";
    servingLabel: string | null;
  }[];
};

export type PersonalLibrary = {
  recent: CachedFood[];
  frequent: CachedFood[];
  favorites: CachedFood[];
  custom: CachedFood[];
  scanned: CachedFood[];
  recipes: LibraryRecipe[];
  meals: LibraryMeal[];
  /** Household dishes: marked recipes first, then marked foods (§13H). */
  family: FamilyItem[];
  /**
   * The user's usual amount of each food they have a habit with (§12D),
   * keyed by `foods.id`. A plain object rather than a Map so it survives
   * being handed to a client component.
   */
  usual: Record<number, UsualPortion>;
};

export const LIBRARY_LISTS = [
  "recent",
  "frequent",
  "favorites",
  "family",
  "custom",
  "scanned",
  "recipes",
  "meals",
] as const;

export const EMPTY_LIBRARY: PersonalLibrary = {
  recent: [],
  frequent: [],
  favorites: [],
  custom: [],
  scanned: [],
  recipes: [],
  meals: [],
  family: [],
  usual: {},
};

/** Whether there is anything to show — decides which tab opens first. */
export function libraryIsEmpty(library: PersonalLibrary): boolean {
  return LIBRARY_LISTS.every((list) => library[list].length === 0);
}
