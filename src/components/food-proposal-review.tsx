"use client";

import { useActionState, useId, useState } from "react";
import { logParsedFoods, saveParsedFoods, type AiLogState } from "@/app/(app)/diary/ai-actions";
import { PendingButton } from "@/components/pending-button";
import type { FoodProposal } from "@/lib/ai/resolve";
import type { MealType } from "@/lib/diary";
import { restaurantReference } from "@/lib/food/restaurant-catalogue";
import { scaleNutrients } from "@/lib/nutrition/macros";
import { toGrams, type PortionUnit } from "@/lib/nutrition/units";

type Choice = { index: number; amount: string; unit: PortionUnit; included: boolean };

/** Shared by the diary and assistant: reading a sentence never writes a log. */
export function FoodProposalReview({ proposals, logDate, mealTypes, mode = "log" }: {
  proposals: FoodProposal[];
  logDate: string;
  mealTypes: MealType[];
  mode?: "log" | "save";
}) {
  const id = useId();
  const [choices, setChoices] = useState<Choice[]>(() => proposals.map((p) => ({
    index: 0, amount: String(p.intent.amount), unit: p.intent.unit, included: Boolean(p.match),
  })));
  const [date, setDate] = useState(logDate);
  const [meal, setMeal] = useState(String(mealTypes[0]?.id ?? ""));
  const [state, action, pending] = useActionState<AiLogState, FormData>(
    mode === "save" ? saveParsedFoods : logParsedFoods, {},
  );
  const locked = pending || Boolean(state.ok);
  function update(index: number, patch: Partial<Choice>) {
    setChoices((previous) => previous.map((choice, i) => i === index ? { ...choice, ...patch } : choice));
  }
  const rows = proposals.map((proposal, i) => {
    const candidates = proposal.match ? [proposal.match, ...proposal.alternatives] : [];
    const choice = choices[i];
    const food = candidates[choice.index];
    const serving = food?.servings.find((s) => s.isDefault) ?? food?.servings[0];
    let grams: number | null = null;
    try {
      if (food && Number(choice.amount) <= 100000) {
        grams = toGrams({ amount: Number(choice.amount), unit: choice.unit, serving });
      }
    } catch { /* An unknown serving needs a weight, never an invented one. */ }
    return { proposal, candidates, choice, food, serving, grams };
  });
  const selected = rows.filter((row) => row.choice.included && row.food);
  const invalid = selected.some((row) => mode === "log" && row.grams === null);
  const payload = JSON.stringify({
    logDate: date, mealTypeId: meal,
    items: selected.map((row) => ({
      food: row.food, amount: mode === "save" ? 100 : Number(row.choice.amount),
      unit: mode === "save" ? "g" : row.choice.unit,
      servingLabel: row.choice.unit === "serving" ? row.serving?.label ?? null : null,
    })),
  });
  return (
    <form action={action} className="space-y-4 rounded-lg border p-3">
      <p className="text-sm font-medium">{mode === "save" ? "Review foods to save" : "Review your meal"}</p>
      <p className="text-muted-foreground text-xs">Check the exact product and portion. Matching is a suggestion; nothing is added until you confirm.</p>
      <input type="hidden" name="payload" value={payload} />
      <fieldset disabled={locked} className="min-w-0 space-y-4">
        {rows.map((row, i) => {
          const reference = row.food ? restaurantReference(row.food) : null;
          const macros = row.food && row.grams !== null ? scaleNutrients(row.food.nutrients, row.grams) : null;
          return (
            <div key={i} className="space-y-2 border-b pb-3">
              <p className="text-muted-foreground text-xs">Understood: {row.proposal.intent.query}</p>
              {!row.food ? (
                <p className="text-sm">No matching food found. Use “Create a food” with the package or restaurant nutrition label; the assistant will not invent macros.</p>
              ) : <>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={row.choice.included} onChange={(e) => update(i, { included: e.target.checked })} />
                  Include this food
                </label>
                <select aria-label={`Food for ${row.proposal.intent.query}`} className="bg-background w-full min-w-0 rounded border p-2 text-sm" value={row.choice.index} onChange={(e) => update(i, { index: Number(e.target.value) })}>
                  {row.candidates.map((food, index) => <option key={index} value={index}>{food.brand ? `${food.brand} · ` : ""}{food.name}</option>)}
                </select>
                <p className="text-muted-foreground text-xs">
                  {reference ? <>Official restaurant reference · Canada · <a className="underline" href={reference.url} target="_blank" rel="noopener noreferrer">Nutrition source</a> · Checked {reference.reviewed}. Saved reference, not a live web search. Standard item only; check toppings and customisations.</> : row.food.source === "usda" ? "USDA FoodData Central" : row.food.source === "off" ? "Open Food Facts · community-contributed" : "Your custom food"}
                </p>
                {mode === "log" ? <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1 text-xs" htmlFor={`${id}-${i}`}>Amount
                    <input id={`${id}-${i}`} type="number" required={row.choice.included} min="0.01" max="100000" step="any" className="bg-background block w-full rounded border p-2 text-sm" value={row.choice.amount} onChange={(e) => update(i, { amount: e.target.value })} />
                  </label>
                  <label className="space-y-1 text-xs">Unit
                    <select className="bg-background block w-full rounded border p-2 text-sm" value={row.choice.unit} onChange={(e) => update(i, { unit: e.target.value as PortionUnit })}>
                      <option value="g">grams</option><option value="ml">ml (estimated 1 g/ml)</option>
                      <option value="serving">{row.serving ? `${row.serving.label} (${row.serving.grams} g)` : "serving (weight unknown)"}</option>
                    </select>
                  </label>
                </div> : null}
                {mode === "save" ? <p className="text-sm">Per 100 g: {row.food.nutrients.kcal} kcal · Protein {row.food.nutrients.protein_g} g · Carbs {row.food.nutrients.carbs_g} g · Fat {row.food.nutrients.fat_g} g</p> : macros ? <p className="text-sm">{Math.round(macros.kcal)} kcal · Protein {macros.protein_g.toFixed(1)} g · Carbs {macros.carbs_g.toFixed(1)} g · Fat {macros.fat_g.toFixed(1)} g</p> : <p className="text-sm text-destructive">Enter a valid amount. If serving weight is unknown, choose grams and enter the measured weight.</p>}
              </>}
            </div>
          );
        })}
        {mode === "log" ? <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1 text-xs">Date<input type="date" required className="bg-background block w-full rounded border p-2 text-sm" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="space-y-1 text-xs">Meal<select className="bg-background block w-full rounded border p-2 text-sm" value={meal} onChange={(e) => setMeal(e.target.value)}>{mealTypes.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        </div> : null}
        <PendingButton type="submit" pending={pending} pendingLabel="Saving…" disabled={locked || !selected.length || invalid || (mode === "log" && (!date || !meal))}>
          {mode === "save" ? `Save ${selected.length} food(s), without logging` : `Confirm: add ${selected.length} item(s) to diary`}
        </PendingButton>
      </fieldset>
      {state.error ? <p role="alert" className="text-destructive text-sm">{state.error}</p> : null}
      {state.notice ? <p role="status" className="text-sm">{state.notice}</p> : null}
    </form>
  );
}
