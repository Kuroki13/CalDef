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
import { DescribeMeal } from "@/components/describe-meal";
import { MyFoods } from "@/components/my-foods";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PendingButton } from "@/components/pending-button";
import { SourceBadge } from "@/components/source-badge";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { hasStrongMatch } from "@/lib/food/text-match";
import type { Food } from "@/lib/food/types";
import { describePortion } from "@/lib/nutrition/units";
import type { UsualPortion } from "@/lib/nutrition/typical-portion";
import type { MealType } from "@/lib/diary";
import {
  EMPTY_LIBRARY,
  libraryIsEmpty,
  type PersonalLibrary,
} from "@/lib/food/library-types";
import { amountUnit, formatAmount, per100Label } from "@/lib/food/basis";

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
  library = EMPTY_LIBRARY,
}: {
  logDate: string;
  mealTypes: MealType[];
  /** The user's own foods (§12B), offered before anything is searched. */
  library?: PersonalLibrary;
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
          <Tabs defaultValue={libraryIsEmpty(library) ? "search" : "mine"}>
            {/*
              Peers, deliberately. Writing a sentence is not what you do
              when search fails — it is what you do when you ate four things
              and would rather not run four searches. Behind a failure, the
              faster path was the invisible one.
            */}
            {/*
              My foods comes first and opens by default once there is
              anything in it (spec §12B): a food already eaten should be
              easier to reach than an obscure provider result, and the
              fastest way to reach it is not to search at all.
            */}
            <TabsList className="mb-3">
              <TabsTrigger value="mine">My foods</TabsTrigger>
              <TabsTrigger value="search">Search</TabsTrigger>
              {aiReady ? (
                <TabsTrigger value="describe">Describe a meal</TabsTrigger>
              ) : null}
            </TabsList>

            <TabsContent value="mine">
              <MyFoods
                library={library}
                logDate={logDate}
                mealTypes={mealTypes}
                onChoose={setChosen}
              />
            </TabsContent>

            <TabsContent value="describe">
              <DescribeMeal logDate={logDate} mealTypes={mealTypes} />
            </TabsContent>

            <TabsContent value="search" className="space-y-4">
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
                        {Math.round(food.nutrients.kcal)} kcal / {per100Label(food)}
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
            </TabsContent>
          </Tabs>
        ) : (
          <form action={formAction} className="space-y-4">
            <input type="hidden" name="logDate" value={logDate} />
            <input type="hidden" name="food" value={JSON.stringify(chosen)} />

            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{chosen.name}</p>
                <p className="text-muted-foreground truncate text-sm">
                  {chosen.brand ? `${chosen.brand} · ` : ""}
                  {Math.round(chosen.nutrients.kcal)} kcal / {per100Label(chosen)}
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

            <PortionFields
              food={chosen}
              mealTypes={mealTypes}
              usual={usualFor(chosen, library)}
            />

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

/**
 * The usual portion for a food, if the user has a habit with it — and only
 * if that portion can still be expressed: a serving the food no longer has
 * is not a suggestion anyone can act on.
 */
function usualFor(food: Food, library: PersonalLibrary): UsualPortion | null {
  const id = (food as { id?: number }).id;
  if (typeof id !== "number") return null;
  const usual = library.usual[id];
  if (!usual) return null;
  if (
    usual.unit === "serving" &&
    !food.servings.some((s) => s.label === usual.servingLabel)
  ) {
    return null;
  }
  return usual;
}

function PortionFields({
  food,
  mealTypes,
  usual = null,
}: {
  food: Food;
  mealTypes: MealType[];
  /** Offered on a tap, never applied by itself (§12D). */
  usual?: UsualPortion | null;
}) {
  // A drink starts in millilitres: its label is per 100 ml, and that is how
  // anyone pours one.
  const [unit, setUnit] = useState<"g" | "ml" | "serving">(amountUnit(food));
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

  const usingUsual =
    usual !== null &&
    unit === usual.unit &&
    Number(amount) === usual.amount &&
    (usual.unit !== "serving" || servingLabel === usual.servingLabel);

  return (
    <div className="grid grid-cols-2 gap-3">
      {usual ? (
        <p className="text-muted-foreground col-span-2 flex flex-wrap items-center gap-x-2 text-sm">
          <span>
            Your usual: about{" "}
            <span className="text-foreground font-medium tabular-nums">
              {usual.unit === "serving"
                ? describePortion(usual.amount, "serving", usual.servingLabel)
                : `${usual.amount} ${usual.unit}`}
            </span>{" "}
            <span className="text-xs">(from your last {usual.basedOn})</span>
          </span>
          {usingUsual ? null : (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                setUnit(usual.unit);
                if (usual.servingLabel) setServingLabel(usual.servingLabel);
                setAmount(String(usual.amount));
              }}
            >
              Use this
            </Button>
          )}
        </p>
      ) : null}
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
          onValueChange={(v) => {
            const next = v as typeof unit;
            // "100" means 100 g or 100 ml; carried over to servings it
            // means a hundred glasses. Moving between the two kinds of
            // unit resets the amount to the ordinary one for the new kind.
            if ((next === "serving") !== (unit === "serving")) {
              setAmount(next === "serving" ? "1" : "100");
            }
            setUnit(next);
          }}
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
                  {serving.label} ({formatAmount(food, serving.grams)})
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
