"use client";

/**
 * What the search understood (spec §13A–§13E).
 *
 * "Maqluba · مقلوبة — layered rice with meat or chicken…", so the user can
 * see that "ma2loubeh" was read as the dish they meant. When the dish has
 * variants that change its nutrition and the query did not say which, it
 * asks that one question — chicken or meat — as buttons, never as a form,
 * and never about anything else (§13E: ask only what materially changes
 * the result).
 *
 * The line carries no nutrition: recognising a dish is not knowing what is
 * in this one.
 */

import { Button } from "@/components/ui/button";
import type { RecognisedDish } from "@/lib/food/types";

export function RecognisedDishNote({
  dish,
  onChooseVariant,
}: {
  dish: RecognisedDish;
  /** Searches again with the chosen variant's phrase. */
  onChooseVariant: (searchAs: string) => void;
}) {
  return (
    <div className="bg-muted/40 space-y-2 rounded-lg px-3 py-2">
      <p className="text-sm">
        <span className="font-medium">{dish.name}</span>{" "}
        <span lang="ar" dir="rtl" className="text-muted-foreground">
          {dish.arabic}
        </span>
        {dish.variant ? (
          <span className="text-muted-foreground"> · {dish.variant.label}</span>
        ) : null}
      </p>
      <p className="text-muted-foreground text-xs">{dish.about}</p>
      {dish.variantOpen ? (
        <div className="space-y-1">
          <p className="text-sm">Which kind?</p>
          <div className="flex flex-wrap gap-1" role="group" aria-label={`Which kind of ${dish.name}`}>
            {dish.variants.map((variant) => (
              <Button
                key={variant.id}
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => onChooseVariant(variant.searchAs)}
              >
                {variant.label}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
