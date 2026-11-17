"use client";

/**
 * Build a Five Guys order from its official parts (spec §13M).
 *
 * Five Guys publishes nutrition for components — bun, patty, cheese slice,
 * bacon, each topping, fries by size — not for assembled burgers, and its
 * menu does not state how many patties or slices each burger has. So the
 * user says what was in theirs, and every part is logged as its own entry
 * with the published figures: exact throughout, never an official base
 * plus a guessed addition.
 *
 * The total shown here is a preview from the same published figures; the
 * server logs each part through the normal path and computes it again.
 */

import { useState } from "react";

import { useKeyedAction } from "@/components/use-keyed-action";
import {
  logRestaurantPartsAction,
  type PartsState,
} from "@/app/(app)/diary/restaurant-actions";
import { PendingButton } from "@/components/pending-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MealType } from "@/lib/diary";
import parts from "@/lib/food/data/fiveguys-parts.json";

type Part = (typeof parts)[number];

const GROUPS: { title: string; match: (slug: string) => boolean }[] = [
  { title: "Burger or dog", match: (s) => ["bun", "patty", "cheese", "bacon", "hot-dog"].includes(s) },
  { title: "Fries", match: (s) => s.startsWith("fries-") || s.startsWith("cajun-") },
  {
    title: "Toppings and sauces",
    match: (s) =>
      ["lettuce", "tomatoes", "pickles", "onions", "mushrooms", "green-peppers", "jalapenos", "relish", "ketchup", "mustard", "mayonnaise", "bbq-sauce", "hp-sauce", "hot-sauce", "malt-vinegar"].includes(s),
  },
  { title: "Poutine, shakes and more", match: () => true },
];

function grouped(): { title: string; items: Part[] }[] {
  const used = new Set<string>();
  return GROUPS.map((group) => {
    const items = parts.filter((p) => !used.has(p.slug) && group.match(p.slug));
    items.forEach((p) => used.add(p.slug));
    return { title: group.title, items };
  }).filter((g) => g.items.length > 0);
}

export function FiveGuysBuilder({
  logDate,
  mealTypes,
}: {
  logDate: string;
  mealTypes: MealType[];
}) {
  const [round, setRound] = useState(0);
  return <Inner key={round} logDate={logDate} mealTypes={mealTypes} onAgain={() => setRound((r) => r + 1)} />;
}

function Inner({
  logDate,
  mealTypes,
  onAgain,
}: {
  logDate: string;
  mealTypes: MealType[];
  onAgain: () => void;
}) {
  const [state, formAction, , operationKey] = useKeyedAction<PartsState>(logRestaurantPartsAction, {});
  const [counts, setCounts] = useState<Record<string, number>>({});

  const chosen = parts.filter((p) => (counts[p.slug] ?? 0) > 0);
  const total = chosen.reduce(
    (sum, p) => {
      const n = counts[p.slug];
      return {
        kcal: sum.kcal + p.kcal * n,
        protein: sum.protein + p.protein_g * n,
        carbs: sum.carbs + p.carbs_g * n,
        fat: sum.fat + p.fat_g * n,
      };
    },
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );

  const step = (slug: string, delta: number) =>
    setCounts((c) => ({ ...c, [slug]: Math.max(0, Math.min(10, (c[slug] ?? 0) + delta)) }));

  if (state.ok) {
    return (
      <div className="space-y-2">
        <Alert>
          <AlertDescription>{state.notice}</AlertDescription>
        </Alert>
        <Button type="button" size="sm" variant="ghost" onClick={onAgain}>
          Build another
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-3 rounded-lg border p-3">
      <input type="hidden" name="clientToken" value={operationKey} />
      <div>
        <p className="text-sm font-medium">Build your Five Guys order</p>
        <p className="text-muted-foreground text-xs">
          Five Guys publishes its parts, not whole burgers, and doesn&rsquo;t say
          how many patties or slices each burger has. Pick what was in yours —
          each part is logged with Five Guys&rsquo; own figures.
        </p>
      </div>
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <input type="hidden" name="chain" value="fiveguys" />
      <input type="hidden" name="logDate" value={logDate} />
      {chosen.map((p) => (
        <input key={p.slug} type="hidden" name={`part:${p.slug}`} value={counts[p.slug]} />
      ))}

      {grouped().map((group) => (
        <fieldset key={group.title} className="space-y-1">
          <legend className="text-muted-foreground text-xs font-medium">{group.title}</legend>
          <ul className="divide-y">
            {group.items.map((p) => {
              const n = counts[p.slug] ?? 0;
              return (
                <li key={p.slug} className="flex items-center justify-between gap-2 py-1">
                  <span className="min-w-0 text-sm">
                    <span className="block truncate">{p.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {p.grams} g · {p.kcal} kcal
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`One less ${p.name}`}
                      disabled={n === 0}
                      onClick={() => step(p.slug, -1)}
                    >
                      −
                    </Button>
                    <span className="w-5 text-center text-sm tabular-nums" aria-label={`${p.name}: ${n}`}>
                      {n}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`One more ${p.name}`}
                      onClick={() => step(p.slug, 1)}
                    >
                      +
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}

      <p className="text-sm tabular-nums" aria-live="polite">
        <span className="font-medium">{Math.round(total.kcal)} kcal</span>
        <span className="text-muted-foreground">
          {" "}
          · Protein {Math.round(total.protein)} g · Carbs {Math.round(total.carbs)} g · Fat{" "}
          {Math.round(total.fat)} g
        </span>
      </p>

      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label htmlFor="fiveguys-meal" className="text-xs">
            Meal
          </Label>
          <Select name="mealTypeId" defaultValue={String(mealTypes[0]?.id ?? "")}>
            <SelectTrigger id="fiveguys-meal">
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
        <PendingButton type="submit" pendingLabel="Logging…" disabled={chosen.length === 0}>
          Log {chosen.length} part{chosen.length === 1 ? "" : "s"}
        </PendingButton>
      </div>
    </form>
  );
}

/** Whether a search is about a Five Guys burger, dog or order. */
export function wantsFiveGuysBuilder(text: string): boolean {
  const t = text.toLowerCase();
  return /\b(five|5) ?guys\b/.test(t) && /burger|hamburger|cheeseburger|dog|order|meal|sandwich/.test(t);
}
