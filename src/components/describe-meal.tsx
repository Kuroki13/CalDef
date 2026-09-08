"use client";

/**
 * "Describe a meal" — one component, everywhere it appears.
 *
 * It used to exist twice: a card on the diary with its own wording, and the
 * assistant's chat box reaching the same route by a different path and
 * presenting the result differently. Two implementations of one idea drift,
 * and they had: different labels, different empty-result wording, different
 * placement.
 *
 * It is also a **peer of search**, not a fallback. Typing "200 g chicken and
 * a cup of rice" is not what you do when search fails; it is what you do
 * when you ate several things and would rather write a sentence than run
 * four searches. Gating it behind a failed search made the faster path the
 * hidden one.
 *
 * What it never is: a write. The model reads the sentence into search
 * terms, the backend resolves them against the real providers, and
 * `FoodProposalReview` shows every match and portion for confirmation.
 * Nothing reaches the diary until that confirmation, which is the same
 * review step the assistant and the recipe draft use.
 */

import { useState } from "react";

import { FoodProposalReview } from "@/components/food-proposal-review";
import { PendingButton } from "@/components/pending-button";
import { Textarea } from "@/components/ui/textarea";
import type { FoodProposal } from "@/lib/ai/resolve";
import type { MealType } from "@/lib/diary";

export const DESCRIBE_MEAL_PLACEHOLDER =
  "e.g. 200 g chicken, a cup of rice and a tablespoon of olive oil";

type Parsed = {
  id: number;
  proposals: FoodProposal[];
  notice?: string;
  degraded?: boolean;
};

export function DescribeMeal({
  logDate,
  mealTypes,
}: {
  logDate: string;
  mealTypes: MealType[];
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Parsed | null>(null);

  async function run(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim() || pending) return;

    setPending(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/ai/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const body = await response.json();

      if (!response.ok) {
        // Covers the assistant being off, unconfigured, over quota or down.
        // Every one of them leaves search working, which the message says.
        setError(body.error ?? "The assistant could not be reached.");
        return;
      }

      setResult({
        id: Date.now(),
        proposals: body.proposals ?? [],
        notice: body.notice,
        degraded: body.degraded,
      });
    } catch {
      setError("Could not reach the assistant. Food search still works.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        Write what you ate, including any brand or restaurant. Nothing is
        logged until you check the matches and confirm.
      </p>

      <form onSubmit={run} className="space-y-2">
        <Textarea
          aria-label="Describe what you ate"
          rows={2}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={DESCRIBE_MEAL_PLACEHOLDER}
        />
        <PendingButton
          type="submit"
          variant="secondary"
          pending={pending}
          pendingLabel="Reading…"
          disabled={!text.trim()}
        >
          Read this
        </PendingButton>
      </form>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      {result?.degraded ? (
        <p className="text-muted-foreground text-sm">
          A food source did not respond; these matches may be incomplete.
        </p>
      ) : null}

      {result && result.proposals.length === 0 ? (
        <p className="text-sm">
          {result.notice ?? "No food found in that. Try naming what you ate."}
        </p>
      ) : null}

      {result?.proposals.length ? (
        <FoodProposalReview
          key={result.id}
          proposals={result.proposals}
          logDate={logDate}
          mealTypes={mealTypes}
        />
      ) : null}
    </div>
  );
}
