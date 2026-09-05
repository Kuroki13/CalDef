import type { Metadata } from "next";

import {
  deleteRecipeAction,
  deleteSavedMealAction,
  removeIngredientAction,
  toggleFavoriteAction,
} from "@/app/(app)/recipes/actions";
import {
  AddIngredientsForm,
  CreateRecipeForm,
  CreateSavedMealForm,
  LogFavoriteForm,
  LogRecipeForm,
  LogSavedMealForm,
} from "@/app/(app)/recipes/library-forms";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { todayInTimeZone } from "@/lib/dates";
import { getDiaryDay } from "@/lib/diary";
import { getFavorites } from "@/lib/favorites";
import { describePortion } from "@/lib/nutrition/units";
import { getAccountSetup } from "@/lib/profile";
import { listRecipes } from "@/lib/recipes";
import { listSavedMeals } from "@/lib/saved-meals";

export const metadata: Metadata = { title: "Recipes & meals · CalDef" };

export default async function RecipesPage() {
  const { profile } = await getAccountSetup();
  // The layout guarantees setup is complete before this renders.
  if (!profile) return null;

  const today = todayInTimeZone(profile.timezone);

  const [day, recipes, savedMeals, favorites] = await Promise.all([
    getDiaryDay(today),
    listRecipes(),
    listSavedMeals(),
    getFavorites(),
  ]);

  const entryOptions = day.entries.map((entry) => ({
    id: entry.id,
    label: `${entry.foodName} · ${describePortion(entry.amount, entry.unit, entry.servingLabel)} · ${Math.round(entry.kcal)} kcal`,
  }));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Recipes &amp; meals
        </h1>
        <p className="text-muted-foreground text-sm">
          Things you eat often, saved once so logging them takes one action.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Favourites</CardTitle>
          <CardDescription>
            Foods you have starred. Star anything from a diary entry.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {favorites.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nothing starred yet.
            </p>
          ) : (
            <ul className="divide-y">
              {favorites.map((food) => (
                <li key={food.id} className="space-y-2 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{food.name}</p>
                      <p className="text-muted-foreground truncate text-xs">
                        {food.brand ? `${food.brand} · ` : ""}
                        {Math.round(food.nutrients.kcal)} kcal / 100 g
                      </p>
                    </div>
                    <form action={toggleFavoriteAction}>
                      <input type="hidden" name="foodId" value={food.id} />
                      <input type="hidden" name="favorite" value="true" />
                      <Button
                        type="submit"
                        size="sm"
                        variant="ghost"
                        aria-label={`Unstar ${food.name}`}
                      >
                        Unstar
                      </Button>
                    </form>
                  </div>
                  <LogFavoriteForm
                    foodId={food.id}
                    logDate={today}
                    mealTypes={day.mealTypes}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Saved meals</CardTitle>
          <CardDescription>
            A group of foods logged together. Each item lands in your diary as
            its own entry.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {savedMeals.length > 0 ? (
            <ul className="space-y-4">
              {savedMeals.map(({ meal, items, totals }) => (
                <li key={meal.id} className="space-y-2 border-b pb-4 last:border-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{meal.name}</p>
                      <p className="text-muted-foreground text-xs">
                        {items.length} item{items.length === 1 ? "" : "s"} ·{" "}
                        {Math.round(totals.kcal)} kcal ·{" "}
                        {Math.round(totals.protein_g)} g protein
                      </p>
                      <p className="text-muted-foreground truncate text-xs">
                        {items.map((i) => i.foodName).join(", ")}
                      </p>
                    </div>
                    <form action={deleteSavedMealAction}>
                      <input type="hidden" name="savedMealId" value={meal.id} />
                      <Button type="submit" size="sm" variant="ghost">
                        Delete
                      </Button>
                    </form>
                  </div>
                  <LogSavedMealForm
                    savedMealId={meal.id}
                    logDate={today}
                    mealTypes={day.mealTypes}
                    defaultMealTypeId={meal.default_meal_type_id}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">
              No saved meals yet.
            </p>
          )}

          <div className="border-t pt-4">
            <h3 className="mb-3 text-sm font-medium">Save today&rsquo;s food</h3>
            <CreateSavedMealForm
              entries={entryOptions}
              mealTypes={day.mealTypes}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recipes</CardTitle>
          <CardDescription>
            A composed dish. Logs as a single entry, with nutrition divided by
            the servings it makes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {recipes.length > 0 ? (
            <ul className="space-y-4">
              {recipes.map(({ recipe, ingredients, perServing }) => (
                <li key={recipe.id} className="space-y-2 border-b pb-4 last:border-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{recipe.name}</p>
                      <p className="text-muted-foreground text-xs">
                        Makes {recipe.servings} ·{" "}
                        {Math.round(perServing.kcal)} kcal and{" "}
                        {Math.round(perServing.protein_g)} g protein per serving
                      </p>
                    </div>
                    <form action={deleteRecipeAction}>
                      <input type="hidden" name="recipeId" value={recipe.id} />
                      <Button type="submit" size="sm" variant="ghost">
                        Delete
                      </Button>
                    </form>
                  </div>

                  {ingredients.length > 0 ? (
                    <ul className="text-muted-foreground space-y-1 text-xs">
                      {ingredients.map((ing) => (
                        <li
                          key={ing.id}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="truncate">
                            {ing.foodName} ·{" "}
                            {describePortion(
                              ing.amount,
                              ing.unit,
                              ing.servingLabel,
                            )}{" "}
                            · {Math.round(ing.macros.kcal)} kcal
                          </span>
                          <form action={removeIngredientAction}>
                            <input
                              type="hidden"
                              name="ingredientId"
                              value={ing.id}
                            />
                            <button
                              type="submit"
                              className="hover:text-foreground underline"
                            >
                              remove
                            </button>
                          </form>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground text-xs">
                      No ingredients yet — this recipe cannot be logged until it
                      has some.
                    </p>
                  )}

                  <AddIngredientsForm
                    recipeId={recipe.id}
                    entries={entryOptions}
                  />

                  {ingredients.length > 0 ? (
                    <LogRecipeForm
                      recipeId={recipe.id}
                      logDate={today}
                      mealTypes={day.mealTypes}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">No recipes yet.</p>
          )}

          <div className="border-t pt-4">
            <h3 className="mb-3 text-sm font-medium">New recipe</h3>
            <CreateRecipeForm entries={entryOptions} />
          </div>
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs">
        CalDef provides estimates for personal tracking. It is not medical or
        dietary advice.
      </p>
    </div>
  );
}
