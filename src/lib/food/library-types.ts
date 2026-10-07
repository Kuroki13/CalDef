/**
 * The personal library's shapes, apart from the server code that fills
 * them, so the client component that shows the library can name them
 * without reaching into a `server-only` module.
 */

import type { CachedFood } from "@/lib/food/types";

export type LibraryRecipe = {
  id: number;
  name: string;
  servings: number;
  kcalPerServing: number;
  /** An empty recipe cannot be logged, and is offered no button. */
  hasIngredients: boolean;
};

export type LibraryMeal = {
  id: number;
  name: string;
  itemCount: number;
  kcal: number;
  defaultMealTypeId: number | null;
};

export type PersonalLibrary = {
  recent: CachedFood[];
  frequent: CachedFood[];
  favorites: CachedFood[];
  custom: CachedFood[];
  scanned: CachedFood[];
  recipes: LibraryRecipe[];
  meals: LibraryMeal[];
};

export const EMPTY_LIBRARY: PersonalLibrary = {
  recent: [],
  frequent: [],
  favorites: [],
  custom: [],
  scanned: [],
  recipes: [],
  meals: [],
};

/** Whether there is anything to show — decides which tab opens first. */
export function libraryIsEmpty(library: PersonalLibrary): boolean {
  return Object.values(library).every((list) => list.length === 0);
}
