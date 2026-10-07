"use client";

/**
 * "Describe this dish" — the way in for a meal no database knows.
 *
 * Offered where the need actually appears: a search for "chicken maqlouba"
 * comes back with nothing useful, and the alternatives until now were to
 * type out a dozen ingredients by hand or to give up and guess. This asks
 * the assistant what goes into the dish, resolves each ingredient against
 * the real providers, and hands the result to a review.
 *
 * With the AI unavailable this component is not rendered at all and the
 * caller shows the manual path instead — but the route refuses just as
 * clearly if it is reached another way, and that refusal is displayed here
 * with the same fallback wording.
 */

import { useState } from "react";

import { PendingButton } from "@/components/pending-button";
import { RecipeDraftReview } from "@/components/recipe-draft-review";
import { Button } from "@/components/ui/button";
import type { FoodProposal } from "@/lib/ai/resolve";

type Draft = {
  dish: string;
  proposals: FoodProposal[];
  degraded: boolean;
};

export function DescribeDish({
  initialDish = "",
  startOpen = false,
  onCancel,
}: {
  initialDish?: string;
  /** Opened by a deliberate choice, so skip the button that opens it. */
  startOpen?: boolean;
  /** Where Cancel goes when someone else opened this. */
  onCancel?: () => void;
}) {
  const [open, setOpen] = useState(startOpen);
  const [dish, setDish] = useState(initialDish);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  async function requestDraft() {
    const name = dish.trim();
    if (name.length < 2) return;

    setDrafting(true);
    setError(null);
    setDraft(null);
    try {
      const response = await fetch("/api/ai/recipe-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dish: name }),
      });
      const body = await response.json();

      if (!response.ok) {
        // Covers the assistant being off, unconfigured, over quota, or
        // simply not knowing the dish. Every one of them leaves building
        // the recipe by hand available, which is what the message says.
        setError(body.error ?? "The assistant could not be reached.");
        return;
      }

      setDraft({
        dish: body.dish ?? name,
        proposals: body.proposals ?? [],
        degraded: Boolean(body.degraded),
      });
    } catch {
      setError("The assistant could not be reached.");
    } finally {
      setDrafting(false);
    }
  }

  if (draft) {
    return (
      <RecipeDraftReview
        dish={draft.dish}
        proposals={draft.proposals}
        degraded={draft.degraded}
        onDismiss={() => {
          setDraft(null);
          if (onCancel) onCancel();
          else setOpen(false);
        }}
      />
    );
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
      >
        Describe this dish
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-sm font-medium">Build it from ingredients</p>
      <p className="text-muted-foreground text-xs">
        The assistant suggests the ingredients and amounts. You check each
        one, and the calories come from those real foods.
      </p>

      <div className="flex gap-2">
        <input
          className="bg-background w-full min-w-0 rounded border p-2 text-sm"
          placeholder="e.g. chicken maqlouba"
          aria-label="Dish name"
          maxLength={200}
          value={dish}
          onChange={(event) => setDish(event.target.value)}
        />
        <PendingButton
          type="button"
          pending={drafting}
          pendingLabel="Thinking…"
          disabled={dish.trim().length < 2}
          onClick={() => void requestDraft()}
        >
          Draft it
        </PendingButton>
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        className="text-muted-foreground text-xs underline"
        onClick={() => (onCancel ? onCancel() : setOpen(false))}
      >
        Cancel
      </button>
    </div>
  );
}
