"use client";

/**
 * The draft, before anything is saved.
 *
 * Follows `FoodProposalReview`: the model's reading is shown, every part of
 * it is editable, and a hidden JSON payload carries the *resolved foods* —
 * never the model's words — to the action that writes.
 *
 * What is different here is the shape of the thing being confirmed. A meal
 * is a set of diary entries; a recipe is one object with a serving count, so
 * the totals shown are the whole batch and what one portion of it costs.
 * Both figures are computed here from the matched foods' own nutrients, the
 * same way the server will recompute them from the stored rows afterwards.
 *
 * An ingredient the providers could not resolve is shown as unresolved and
 * cannot be included. It is replaced by searching for it, or dropped. There
 * is deliberately no third option: a recipe with a guessed ingredient in it
 * would produce a calorie figure with no food behind part of it.
 */

import { useActionState, useId, useState } from "react";

import {
  saveDraftedRecipe,
  type RecipeDraftState,
} from "@/app/(app)/recipes/draft-actions";
import { PendingButton } from "@/components/pending-button";
import type { FoodProposal } from "@/lib/ai/resolve";
import type { Food } from "@/lib/food/types";
import { scaleNutrients, sumMacros, multiplyMacros } from "@/lib/nutrition/macros";
import { toGrams, type PortionUnit } from "@/lib/nutrition/units";

type Row = {
  /** What the model proposed, or what the owner typed to add a row. */
  query: string;
  candidates: Food[];
  choice: number;
  amount: string;
  unit: PortionUnit;
  included: boolean;
  /** True for a row the owner added, so the UI can say where it came from. */
  added?: boolean;
};

function rowsFrom(proposals: readonly FoodProposal[]): Row[] {
  return proposals.map((proposal) => ({
    query: proposal.intent.query,
    candidates: proposal.match
      ? [proposal.match, ...proposal.alternatives]
      : [],
    choice: 0,
    amount: String(proposal.intent.amount),
    unit: proposal.intent.unit,
    // An unresolved ingredient starts excluded: including it is not
    // something the UI can offer, because there is no food to include.
    included: Boolean(proposal.match),
  }));
}

export function RecipeDraftReview({
  dish,
  proposals,
  degraded,
  onDismiss,
}: {
  dish: string;
  proposals: FoodProposal[];
  degraded: boolean;
  onDismiss?: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(dish);
  const [servings, setServings] = useState("4");
  const [rows, setRows] = useState<Row[]>(() => rowsFrom(proposals));
  const [state, action, pending] = useActionState<RecipeDraftState, FormData>(
    saveDraftedRecipe,
    {},
  );
  const locked = pending || Boolean(state.ok);

  function update(index: number, patch: Partial<Row>) {
    setRows((previous) =>
      previous.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  const weighed = rows.map((row) => {
    const food = row.candidates[row.choice] ?? null;
    const serving =
      food?.servings.find((s) => s.isDefault) ?? food?.servings[0] ?? null;

    let grams: number | null = null;
    try {
      if (food && Number(row.amount) > 0 && Number(row.amount) <= 100000) {
        grams = toGrams({
          amount: Number(row.amount),
          unit: row.unit,
          serving: serving ?? undefined,
        });
      }
    } catch {
      // A serving with no weight behind it needs a real one, never an
      // invented one — the same refusal `toGrams` makes everywhere.
    }

    return {
      row,
      food,
      serving,
      grams,
      macros: food && grams !== null ? scaleNutrients(food.nutrients, grams) : null,
    };
  });

  const included = weighed.filter((w) => w.row.included && w.food);
  const unresolved = weighed.filter((w) => !w.food);
  const invalid = included.some((w) => w.grams === null);

  const totals = sumMacros(
    included.flatMap((w) => (w.macros ? [w.macros] : [])),
  );
  const perServing = multiplyMacros(totals, 1 / (Number(servings) || 1));

  const payload = JSON.stringify({
    name,
    servings: Number(servings),
    aiDrafted: true,
    ingredients: included.map((w) => ({
      food: w.food,
      amount: Number(w.row.amount),
      unit: w.row.unit,
      servingLabel: w.row.unit === "serving" ? (w.serving?.label ?? null) : null,
    })),
  });

  return (
    <form action={action} className="space-y-4 rounded-lg border p-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">Review this recipe</p>
        <p className="text-muted-foreground text-xs">
          The ingredient list below was <strong>estimated by the assistant</strong>{" "}
          and is a starting point, not a measurement — check every amount
          against what you actually cooked. The nutrition beside each one is
          computed from the matched food&rsquo;s real data, never from the
          assistant. Nothing is saved until you confirm.
        </p>
        {degraded ? (
          <p className="text-muted-foreground text-xs">
            A food source did not respond, so some ingredients may have
            matched worse than usual.
          </p>
        ) : null}
      </div>

      <input type="hidden" name="payload" value={payload} />

      <fieldset disabled={locked} className="min-w-0 space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1 text-xs" htmlFor={`${id}-name`}>
            Recipe name
            <input
              id={`${id}-name`}
              className="bg-background block w-full rounded border p-2 text-sm"
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs" htmlFor={`${id}-servings`}>
            Servings it makes
            <input
              id={`${id}-servings`}
              type="number"
              min="0.1"
              max="1000"
              step="any"
              className="bg-background block w-full rounded border p-2 text-sm"
              value={servings}
              onChange={(event) => setServings(event.target.value)}
            />
          </label>
        </div>

        {weighed.map((entry, index) => (
          <div key={index} className="space-y-2 border-b pb-3">
            <p className="text-muted-foreground text-xs">
              {entry.row.added ? "You added" : "Suggested"}: {entry.row.query}
            </p>

            {!entry.food ? (
              <div className="space-y-2">
                <p className="text-destructive text-sm" role="status">
                  No food matched “{entry.row.query}”. Search for it and pick
                  the right one, or remove it — it will not be included as a
                  guess.
                </p>
                <ReplaceIngredient
                  label={entry.row.query}
                  onResolved={(food) =>
                    update(index, {
                      candidates: [food],
                      choice: 0,
                      included: true,
                    })
                  }
                />
                <button
                  type="button"
                  className="text-muted-foreground text-xs underline"
                  onClick={() =>
                    setRows((previous) => previous.filter((_, i) => i !== index))
                  }
                >
                  Remove this ingredient
                </button>
              </div>
            ) : (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={entry.row.included}
                    onChange={(event) =>
                      update(index, { included: event.target.checked })
                    }
                  />
                  Include this ingredient
                </label>

                <select
                  aria-label={`Food for ${entry.row.query}`}
                  className="bg-background w-full min-w-0 rounded border p-2 text-sm"
                  value={entry.row.choice}
                  onChange={(event) =>
                    update(index, { choice: Number(event.target.value) })
                  }
                >
                  {entry.row.candidates.map((food, candidate) => (
                    <option key={candidate} value={candidate}>
                      {food.brand ? `${food.brand} · ` : ""}
                      {food.name}
                    </option>
                  ))}
                </select>

                <div className="grid grid-cols-2 gap-2">
                  <label
                    className="space-y-1 text-xs"
                    htmlFor={`${id}-amount-${index}`}
                  >
                    Amount
                    <input
                      id={`${id}-amount-${index}`}
                      type="number"
                      min="0.01"
                      max="100000"
                      step="any"
                      className="bg-background block w-full rounded border p-2 text-sm"
                      value={entry.row.amount}
                      onChange={(event) =>
                        update(index, { amount: event.target.value })
                      }
                    />
                  </label>
                  <label className="space-y-1 text-xs">
                    Unit
                    <select
                      className="bg-background block w-full rounded border p-2 text-sm"
                      value={entry.row.unit}
                      onChange={(event) =>
                        update(index, { unit: event.target.value as PortionUnit })
                      }
                    >
                      <option value="g">grams</option>
                      <option value="ml">ml (estimated 1 g/ml)</option>
                      <option value="serving">
                        {entry.serving
                          ? `${entry.serving.label} (${entry.serving.grams} g)`
                          : "serving (weight unknown)"}
                      </option>
                    </select>
                  </label>
                </div>

                {entry.macros ? (
                  <p className="text-sm">
                    {Math.round(entry.macros.kcal)} kcal · Protein{" "}
                    {entry.macros.protein_g.toFixed(1)} g · Carbs{" "}
                    {entry.macros.carbs_g.toFixed(1)} g · Fat{" "}
                    {entry.macros.fat_g.toFixed(1)} g
                  </p>
                ) : (
                  <p className="text-destructive text-sm">
                    Enter a valid amount. If the serving weight is unknown,
                    choose grams.
                  </p>
                )}

                <button
                  type="button"
                  className="text-muted-foreground text-xs underline"
                  onClick={() =>
                    setRows((previous) => previous.filter((_, i) => i !== index))
                  }
                >
                  Remove this ingredient
                </button>
              </>
            )}
          </div>
        ))}

        <AddIngredient
          onResolved={(food, query) =>
            setRows((previous) => [
              ...previous,
              {
                query,
                candidates: [food],
                choice: 0,
                amount: "100",
                unit: "g",
                included: true,
                added: true,
              },
            ])
          }
        />

        <div className="space-y-1 rounded-md border p-3">
          <p className="text-sm font-medium">
            Whole recipe: {Math.round(totals.kcal)} kcal · Protein{" "}
            {totals.protein_g.toFixed(1)} g · Carbs {totals.carbs_g.toFixed(1)}{" "}
            g · Fat {totals.fat_g.toFixed(1)} g
          </p>
          <p className="text-sm">
            Per serving: {Math.round(perServing.kcal)} kcal · Protein{" "}
            {perServing.protein_g.toFixed(1)} g · Carbs{" "}
            {perServing.carbs_g.toFixed(1)} g · Fat{" "}
            {perServing.fat_g.toFixed(1)} g
          </p>
          <p className="text-muted-foreground text-xs">
            Summed from the {included.length} ingredient
            {included.length === 1 ? "" : "s"} above and divided by the serving
            count. Saved as a private recipe of yours, and recorded as
            AI-drafted so you can tell later where the list came from.
          </p>
        </div>

        {unresolved.length > 0 ? (
          <p className="text-destructive text-sm" role="alert">
            {unresolved.length} ingredient{unresolved.length === 1 ? "" : "s"}{" "}
            could not be matched. Replace or remove{" "}
            {unresolved.length === 1 ? "it" : "them"} before saving.
          </p>
        ) : null}

        <div className="flex gap-2">
          <PendingButton
            type="submit"
            pending={pending}
            pendingLabel="Saving…"
            disabled={
              locked ||
              included.length === 0 ||
              invalid ||
              unresolved.length > 0 ||
              name.trim().length === 0 ||
              !(Number(servings) > 0)
            }
          >
            Save recipe
          </PendingButton>
          {onDismiss ? (
            <button
              type="button"
              className="text-muted-foreground text-sm underline"
              onClick={onDismiss}
            >
              Discard draft
            </button>
          ) : null}
        </div>
      </fieldset>

      {state.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p role="status" className="text-sm">
          {state.notice}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Finds a real food to stand in for an ingredient.
 *
 * Uses the ordinary search route, so an ingredient added or replaced by hand
 * is resolved exactly the way one the model proposed was — there is one way
 * a food gets into this recipe, and it goes through the providers.
 */
function IngredientSearch({
  placeholder,
  action,
  onResolved,
}: {
  placeholder: string;
  action: string;
  onResolved: (food: Food, query: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Food[] | null>(null);
  const [searching, setSearching] = useState(false);

  async function search() {
    const text = query.trim();
    if (text.length < 2) return;

    setSearching(true);
    try {
      const response = await fetch(
        `/api/foods/search?q=${encodeURIComponent(text)}`,
      );
      const body = await response.json();
      setResults(response.ok ? (body.foods ?? []) : []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          className="bg-background w-full min-w-0 rounded border p-2 text-sm"
          placeholder={placeholder}
          value={query}
          aria-label={action}
          onChange={(event) => setQuery(event.target.value)}
        />
        <PendingButton
          type="button"
          variant="secondary"
          size="sm"
          pending={searching}
          pendingLabel="Searching…"
          onClick={() => void search()}
        >
          Search
        </PendingButton>
      </div>

      {results !== null && results.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          Nothing found. Try a plainer name, or add the food from its packet
          first.
        </p>
      ) : null}

      {results?.length ? (
        <ul className="divide-y rounded border">
          {results.slice(0, 6).map((food, index) => (
            <li key={index}>
              <button
                type="button"
                className="hover:bg-accent/50 w-full px-2 py-2 text-left text-sm"
                onClick={() => {
                  onResolved(food, query.trim());
                  setQuery("");
                  setResults(null);
                }}
              >
                {food.brand ? `${food.brand} · ` : ""}
                {food.name}
                <span className="text-muted-foreground">
                  {" "}
                  · {Math.round(food.nutrients.kcal)} kcal / 100 g
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ReplaceIngredient({
  label,
  onResolved,
}: {
  label: string;
  onResolved: (food: Food) => void;
}) {
  return (
    <IngredientSearch
      placeholder={label}
      action={`Search for a food to replace ${label}`}
      onResolved={(food) => onResolved(food)}
    />
  );
}

function AddIngredient({
  onResolved,
}: {
  onResolved: (food: Food, query: string) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium">Add an ingredient</p>
      <IngredientSearch
        placeholder="e.g. pine nuts"
        action="Search for an ingredient to add"
        onResolved={onResolved}
      />
    </div>
  );
}
