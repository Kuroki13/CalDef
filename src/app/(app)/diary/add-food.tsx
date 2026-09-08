"use client";

/**
 * Search, choose a portion, log.
 *
 * The chosen food is carried back to the server action as JSON in a hidden
 * field. It is re-validated there and used only to seed the cache — the
 * entry's own macros are computed from the stored nutrient row, so nothing
 * typed or tampered with here can change a calorie figure.
 */

import { useActionState, useState } from "react";

import { logFood, type DiaryActionState } from "@/app/(app)/diary/actions";
import { BarcodeScanner } from "@/components/barcode-scanner";
import { DescribeDish } from "@/components/describe-dish";
import { CustomFoodForm } from "@/components/custom-food-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { PendingButton } from "@/components/pending-button";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PortionMacros, ServingHint } from "@/components/portion-macros";
import { hasStrongMatch } from "@/lib/food/text-match";
import type { Food } from "@/lib/food/types";
import type { MealType } from "@/lib/diary";

type SearchState = {
  status: "idle" | "loading" | "done" | "error";
  foods: Food[];
  notice: string | null;
  error: string | null;
};

const IDLE: SearchState = {
  status: "idle",
  foods: [],
  notice: null,
  error: null,
};

export function AddFood({
  logDate,
  mealTypes,
  aiReady = false,
}: {
  logDate: string;
  mealTypes: MealType[];
  /** Whether the assistant can be asked to draft a dish it did not find. */
  aiReady?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>(IDLE);
  const [chosen, setChosen] = useState<Food | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [creatingFood, setCreatingFood] = useState(false);

  /**
   * Resolves a scanned code through our own route.
   *
   * A 404 here means the product genuinely is not in Open Food Facts, which
   * is a normal outcome of scanning — the user is told so and left on the
   * search box rather than being shown an error.
   */
  async function lookupBarcode(code: string) {
    setScannerOpen(false);
    setSearch({ ...IDLE, status: "loading" });

    try {
      const response = await fetch(
        `/api/foods/barcode?code=${encodeURIComponent(code)}`,
      );
      const body = await response.json();

      if (response.ok && body.food) {
        setSearch(IDLE);
        setChosen(body.food);
        return;
      }

      setSearch({
        status: "done",
        foods: [],
        notice: null,
        error:
          body.error ??
          `Nothing found for barcode ${code}. Try searching by name.`,
      });
    } catch {
      setSearch({
        status: "error",
        foods: [],
        notice: null,
        error: "Could not reach the product database.",
      });
    }
  }

  const [state, formAction] = useActionState<DiaryActionState, FormData>(
    logFood,
    {},
  );

  // Clearing the selection after a successful log returns the form to the
  // search box, which is where the next entry starts.
  //
  // Adjusted during render rather than in an effect: React re-runs this
  // component immediately without painting the intermediate state, whereas
  // an effect would paint the stale form first and then cascade a second
  // render. `handledOk` makes it fire once per successful submission.
  const [handledOk, setHandledOk] = useState(false);
  if (Boolean(state.ok) !== handledOk) {
    setHandledOk(Boolean(state.ok));
    if (state.ok) {
      setChosen(null);
      setQuery("");
      setSearch(IDLE);
    }
  }

  async function runSearch(event: React.FormEvent) {
    event.preventDefault();
    const text = query.trim();
    if (text.length < 2) return;

    setSearch({ ...IDLE, status: "loading" });
    try {
      const response = await fetch(
        `/api/foods/search?q=${encodeURIComponent(text)}`,
      );
      const body = await response.json();

      if (!response.ok) {
        setSearch({
          status: "error",
          foods: [],
          notice: null,
          error: body.error ?? "Search failed.",
        });
        return;
      }

      setSearch({
        status: "done",
        foods: body.foods ?? [],
        notice: body.notice ?? null,
        error: null,
      });
    } catch {
      setSearch({
        status: "error",
        foods: [],
        notice: null,
        error: "Could not reach the search service.",
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add food</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!chosen ? (
          <>
            {scannerOpen ? (
              <BarcodeScanner
                onDetected={lookupBarcode}
                onCancel={() => setScannerOpen(false)}
              />
            ) : creatingFood ? (
              /* Saving jumps straight to the portion fields: someone adds a
                 food because they are about to eat it. */
              <CustomFoodForm
                onCancel={() => setCreatingFood(false)}
                onSaved={(food) => {
                  setCreatingFood(false);
                  setSearch(IDLE);
                  setChosen(food);
                }}
              />
            ) : (
              <form onSubmit={runSearch} className="flex gap-2">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search foods, e.g. chicken breast"
                  aria-label="Search foods"
                />
                <PendingButton
                  type="submit"
                  pending={search.status === "loading"}
                  pendingLabel="Searching…"
                >
                  Search
                </PendingButton>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setScannerOpen(true)}
                >
                  Scan
                </Button>
              </form>
            )}

            {search.error ? (
              <Alert variant="destructive">
                <AlertDescription>{search.error}</AlertDescription>
              </Alert>
            ) : null}

            {search.notice ? (
              <Alert>
                <AlertDescription>{search.notice}</AlertDescription>
              </Alert>
            ) : null}

            {/*
              Offered when the results are useless, not only when there are
              none — which is the case that actually happens. "Chicken
              maqlouba" returns chicken spread, chicken fat and chicken
              frankfurters: eight results, none of them the dish. The test is
              whether anything accounts for every word that was typed.
            */}
            {search.status === "done" &&
            !hasStrongMatch(query, search.foods) ? (
              <div className="space-y-2">
                <p className="text-muted-foreground text-sm">
                  {search.foods.length === 0
                    ? "Nothing found."
                    : "Nothing here looks like what you asked for."}{" "}
                  Try a simpler description, add it yourself from the packet,
                  or — for something home-cooked —{" "}
                  {aiReady
                    ? "have the assistant draft the ingredients."
                    : "build it as a recipe on the Recipes screen, one ingredient at a time."}
                </p>
                {/* The dish name is what was searched for, so the draft
                    starts from what the user already typed. */}
                {aiReady ? <DescribeDish initialDish={query} /> : null}
              </div>
            ) : null}

            {!creatingFood && !scannerOpen ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setCreatingFood(true)}
              >
                Add your own food
              </Button>
            ) : null}

            <ul className="divide-y">
              {search.foods.map((food) => (
                <li key={`${food.source}:${food.sourceId}`}>
                  <button
                    type="button"
                    onClick={() => setChosen(food)}
                    className="hover:bg-accent/50 flex w-full items-center justify-between gap-3 rounded-md px-2 py-3 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {food.name}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {food.brand ? `${food.brand} · ` : ""}
                        {Math.round(food.nutrients.kcal)} kcal / 100 g
                        {/* Per 100 g compares two foods fairly; the serving
                            says what you would actually eat. */}
                        <ServingHint food={food} />
                      </span>
                    </span>
                    <SourceBadge food={food} />
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <form action={formAction} className="space-y-4">
            <input type="hidden" name="logDate" value={logDate} />
            <input type="hidden" name="food" value={JSON.stringify(chosen)} />

            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{chosen.name}</p>
                <p className="text-muted-foreground truncate text-sm">
                  {chosen.brand ? `${chosen.brand} · ` : ""}
                  {Math.round(chosen.nutrients.kcal)} kcal / 100 g
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setChosen(null)}
              >
                Change
              </Button>
            </div>

            {state.error ? (
              <Alert variant="destructive">
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            ) : null}

            <PortionFields food={chosen} mealTypes={mealTypes} />

            <PendingButton
              type="submit"
              className="w-full"
              pendingLabel="Adding…"
            >
              Add to diary
            </PendingButton>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function SourceBadge({ food }: { food: Food }) {
  if (food.source === "usda") {
    return (
      <Badge variant={food.isVerified ? "default" : "secondary"}>
        {food.isVerified ? "USDA verified" : "USDA"}
      </Badge>
    );
  }
  if (food.source === "off") {
    // Community-contributed. The spec requires not presenting it as verified.
    return <Badge variant="outline">Community</Badge>;
  }
  return <Badge variant="secondary">Yours</Badge>;
}

function PortionFields({
  food,
  mealTypes,
}: {
  food: Food;
  mealTypes: MealType[];
}) {
  const [unit, setUnit] = useState<"g" | "ml" | "serving">("g");
  const defaultServing =
    food.servings.find((s) => s.isDefault) ?? food.servings[0] ?? null;
  const [servingLabel, setServingLabel] = useState(
    defaultServing?.label ?? "",
  );
  // Controlled so the figures below can follow it. It was uncontrolled, and
  // the cost of the portion only appeared in the diary after logging.
  const [amount, setAmount] = useState("100");

  const chosenServing =
    food.servings.find((s) => s.label === servingLabel) ?? defaultServing;

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-2">
        <Label htmlFor="amount">Amount</Label>
        <Input
          id="amount"
          name="amount"
          type="number"
          inputMode="decimal"
          step="any"
          min="0.01"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="unit">Unit</Label>
        <Select
          name="unit"
          value={unit}
          onValueChange={(v) => setUnit(v as typeof unit)}
        >
          <SelectTrigger id="unit">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="g">grams</SelectItem>
            <SelectItem value="ml">millilitres</SelectItem>
            {food.servings.length > 0 ? (
              <SelectItem value="serving">serving</SelectItem>
            ) : null}
          </SelectContent>
        </Select>
      </div>

      {unit === "serving" ? (
        <div className="col-span-2 space-y-2">
          <Label htmlFor="servingLabel">Serving</Label>
          <Select
            name="servingLabel"
            value={servingLabel}
            onValueChange={setServingLabel}
          >
            <SelectTrigger id="servingLabel">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {food.servings.map((serving) => (
                <SelectItem key={serving.label} value={serving.label}>
                  {serving.label} ({serving.grams} g)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {/*
        What this portion costs, before it is logged rather than after.
        Same component, same wording, same arithmetic as the AI review and
        the recipe draft — and the same `toGrams`/`scaleNutrients` the
        server uses to write the row.
      */}
      <div className="col-span-2 rounded-md border p-3">
        <PortionMacros
          food={food}
          amount={Number(amount)}
          unit={unit}
          serving={unit === "serving" ? chosenServing : null}
        />
      </div>

      <div className="col-span-2 space-y-2">
        <Label htmlFor="mealTypeId">Meal</Label>
        <Select name="mealTypeId" defaultValue={String(mealTypes[0]?.id ?? "")}>
          <SelectTrigger id="mealTypeId">
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
    </div>
  );
}
