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
  RecipeSettingsForm,
} from "@/app/(app)/recipes/library-forms";
import { CustomFoodLibrary } from "@/app/(app)/recipes/custom-foods";
import { PendingButton } from "@/components/pending-button";
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
import {
  listArchivedCustomFoods,
  listCustomFoods,
} from "@/lib/food/custom";
import { describePortion } from "@/lib/nutrition/units";
import { getAccountSetup } from "@/lib/profile";
import { listRecipes } from "@/lib/recipes";
import { listSavedMeals } from "@/lib/saved-meals";
import { per100Label } from "@/lib/food/basis";

export const metadata: Metadata = { title: "Recipes & meals · CalDef" };

export default async function RecipesPage() {
  const { profile } = await getAccountSetup();
  // The layout guarantees setup is complete before this renders.
  if (!profile) return null;

  const today = todayInTimeZone(profile.timezone);

  const [day, recipes, savedMeals, favorites, customFoods, retiredFoods] =
    await Promise.all([
    getDiaryDay(today),
    listRecipes(),
    listSavedMeals(),
    getFavorites(),
    listCustomFoods(),
    listArchivedCustomFoods(),
  ]);

  // A Quick Add has no food behind it, so it cannot be an ingredient or a
  // meal item; offering it would only produce an error.
  const entryOptions = day.entries.filter((entry) => !entry.isEstimate).map((entry) => ({
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

      <Card id="your-foods">
        <CardHeader>
          <CardTitle>Your foods</CardTitle>
          <CardDescription>
            Foods you entered from their packaging. They appear in search
            alongside USDA and Open Food Facts, and only you can see them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CustomFoodLibrary foods={customFoods} retired={retiredFoods} />
        </CardContent>
      </Card>

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
                        {Math.round(food.nutrients.kcal)} kcal / {per100Label(food)}
                      </p>
                    </div>
                    <form action={toggleFavoriteAction}>
                      <input type="hidden" name="foodId" value={food.id} />
                      <input type="hidden" name="favorite" value="true" />
                      <PendingButton
                        type="submit"
                        size="sm"
                        variant="ghost"
                        aria-label={`Unstar ${food.name}`}
                      >
                        Unstar
                      </PendingButton>
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
                      <PendingButton
                        type="submit"
                        size="sm"
                        variant="ghost"
                        pendingLabel="Deleting…"
                      >
                        Delete
                      </PendingButton>
                    </form>
                  </div>
                  <LogSavedMealForm
                    savedMealId={meal.id}
                    logDate={today}
                    mealTypes={day.mealTypes}
                    defaultMealTypeId={meal.default_meal_type_id}
                    items={items.map((item) => ({
                      id: item.id,
                      foodName: item.foodName,
                      amount: item.amount,
                      unit: item.unit,
                      servingLabel: item.servingLabel,
                    }))}
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
                      {/* Provenance, months later: which half of this was
                          estimated and which half was looked up. */}
                      {recipe.ai_drafted_at ? (
                        <p className="text-muted-foreground text-xs">
                          Ingredient list drafted by the assistant on{" "}
                          {recipe.ai_drafted_at.slice(0, 10)} and confirmed by
                          you. The nutrition above is computed from the matched
                          foods, not from the assistant.
                        </p>
                      ) : null}
                    </div>
                    <form action={deleteRecipeAction}>
                      <input type="hidden" name="recipeId" value={recipe.id} />
                      <PendingButton
                        type="submit"
                        size="sm"
                        variant="ghost"
                        pendingLabel="Deleting…"
                      >
                        Delete
                      </PendingButton>
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
                            <PendingButton
                              type="submit"
                              variant="link"
                              size="xs"
                              className="text-muted-foreground hover:text-foreground h-auto px-0 underline"
                            >
                              remove
                            </PendingButton>
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

                  <RecipeSettingsForm
                    recipeId={recipe.id}
                    isFamily={recipe.is_family}
                    cookedWeightG={
                      recipe.cooked_weight_g === null ? null : Number(recipe.cooked_weight_g)
                    }
                  />

                  {ingredients.length > 0 ? (
                    <LogRecipeForm
                      recipeId={recipe.id}
                      logDate={today}
                      mealTypes={day.mealTypes}
                      cookedWeightG={
                        recipe.cooked_weight_g === null ? null : Number(recipe.cooked_weight_g)
                      }
                      servings={Number(recipe.servings)}
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
