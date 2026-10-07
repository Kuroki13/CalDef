"use client";

import { useActionState, useState } from "react";

import {
  deleteEntry,
  updateEntryAmount,
  type DiaryActionState,
} from "@/app/(app)/diary/actions";
import { applyCorrection, type AiLogState } from "@/app/(app)/diary/ai-actions";
import { toggleFavoriteAction } from "@/app/(app)/recipes/actions";
import { PendingButton } from "@/components/pending-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LogAgainForm } from "@/components/repeat-forms";
import type { DiaryEntry, MealType } from "@/lib/diary";
import { describePortion } from "@/lib/nutrition/units";

export function EntryRow({
  entry,
  aiEnabled,
  mealTypes = [],
  today,
}: {
  entry: DiaryEntry;
  /** The assistant's amend box is a shortcut; Edit below always works. */
  aiEnabled: boolean;
  /** For "Log again"; without them the control is not offered. */
  mealTypes?: MealType[];
  today?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [again, setAgain] = useState(false);
  const [amending, setAmending] = useState(false);
  const [state, formAction] = useActionState<DiaryActionState, FormData>(
    updateEntryAmount,
    {},
  );

  return (
    <li className="py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{entry.foodName}</p>
          <p className="text-muted-foreground truncate text-xs">
            {entry.isEstimate ? (
              // Never dressed as a portion of a food: it is not one.
              <span className="text-foreground font-medium">Your estimate</span>
            ) : (
              <>
                {entry.foodBrand ? `${entry.foodBrand} · ` : ""}
                {describePortion(entry.amount, entry.unit, entry.servingLabel)}
                {entry.unit !== "g" ? ` · ${Math.round(entry.grams)} g` : ""}
              </>
            )}
            {" · "}
            {Math.round(entry.protein_g)}P {Math.round(entry.carbs_g)}C{" "}
            {Math.round(entry.fat_g)}F
          </p>
          {state.error ? (
            <p className="text-destructive text-xs">{state.error}</p>
          ) : null}
        </div>

        {editing ? (
          <form action={formAction} className="flex items-center gap-2">
            <input type="hidden" name="entryId" value={entry.id} />
            <Input
              name="amount"
              type="number"
              inputMode="decimal"
              step="any"
              min="0.01"
              defaultValue={entry.amount}
              className="w-24"
              aria-label={`Amount for ${entry.foodName}`}
            />
            <PendingButton type="submit" size="sm" pendingLabel="Saving…">
              Save
            </PendingButton>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <div className="flex items-center gap-1">
            <span className="text-sm tabular-nums">
              {Math.round(entry.kcal)} kcal
            </span>
            {/* A recipe entry has no single food, so there is nothing to star. */}
            {entry.foodId !== null ? (
              <form action={toggleFavoriteAction}>
                <input type="hidden" name="foodId" value={entry.foodId} />
                <input
                  type="hidden"
                  name="favorite"
                  value={String(entry.isFavorite)}
                />
                <PendingButton
                  type="submit"
                  size="sm"
                  variant="ghost"
                  aria-label={
                    entry.isFavorite
                      ? `Unstar ${entry.foodName}`
                      : `Star ${entry.foodName}`
                  }
                  aria-pressed={entry.isFavorite}
                >
                  {entry.isFavorite ? "★" : "☆"}
                </PendingButton>
              </form>
            ) : null}
            {aiEnabled && entry.foodId !== null ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setAmending((open) => !open)}
                aria-label={`Amend ${entry.foodName} in words`}
                aria-expanded={amending}
              >
                Amend
              </Button>
            ) : null}
            {today && mealTypes.length > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setAgain((open) => !open)}
                aria-label={`Repeat ${entry.foodName}`}
                aria-expanded={again}
              >
                Again
              </Button>
            ) : null}
            {/* An estimate has no food to recompute a new amount from;
                remove it and add it again instead. */}
            {entry.isEstimate ? null : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setEditing(true)}
                aria-label={`Edit ${entry.foodName}`}
              >
                Edit
              </Button>
            )}
            <form action={deleteEntry}>
              <input type="hidden" name="entryId" value={entry.id} />
              <PendingButton
                type="submit"
                size="sm"
                variant="ghost"
                aria-label={`Remove ${entry.foodName}`}
              >
                Remove
              </PendingButton>
            </form>
          </div>
        )}
      </div>

      {amending ? (
        <AmendInWords entry={entry} onDone={() => setAmending(false)} />
      ) : null}
      {again && today ? (
        <div className="bg-muted/40 mt-2 rounded-md p-3">
          <LogAgainForm entry={entry} mealTypes={mealTypes} defaultDate={today} />
        </div>
      ) : null}
    </li>
  );
}

/**
 * "Actually that was 250g."
 *
 * Shows what the assistant read and what it would do, and applies nothing
 * until the user says so. An unclear reading offers no button at all — the
 * Edit control beside it is the answer in that case, and pretending to
 * understand would be worse than admitting the sentence was ambiguous.
 */
function AmendInWords({
  entry,
  onDone,
}: {
  entry: DiaryEntry;
  onDone: () => void;
}) {
  const [text, setText] = useState("");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<{
    intent:
      | { kind: "amount"; amount: number; unit: "g" | "ml" | "serving" }
      | { kind: "remove" }
      | { kind: "unclear" };
    preview?: { grams: number; kcal: number } | null;
  } | null>(null);

  const [state, formAction] = useActionState<AiLogState, FormData>(
    applyCorrection,
    {},
  );

  const [handledOk, setHandledOk] = useState(false);
  if (Boolean(state.ok) !== handledOk) {
    setHandledOk(Boolean(state.ok));
    if (state.ok) onDone();
  }

  async function read(event: React.FormEvent) {
    event.preventDefault();
    if (text.trim().length === 0) return;

    setReading(true);
    setError(null);
    setProposal(null);
    try {
      const response = await fetch("/api/ai/correct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId: entry.id, text }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "The assistant could not be reached.");
        return;
      }
      setProposal(body);
    } catch {
      setError("Could not reach the assistant.");
    } finally {
      setReading(false);
    }
  }

  return (
    <div className="bg-muted/40 mt-2 space-y-2 rounded-md p-3">
      <form onSubmit={read} className="flex items-center gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="actually that was 250g"
          aria-label={`Describe the change to ${entry.foodName}`}
        />
        <PendingButton
          type="submit"
          size="sm"
          variant="secondary"
          pending={reading}
          pendingLabel="Reading…"
          disabled={text.trim().length === 0}
        >
          Read
        </PendingButton>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Close
        </Button>
      </form>

      {error ? <p className="text-destructive text-xs">{error}</p> : null}
      {state.error ? (
        <p className="text-destructive text-xs">{state.error}</p>
      ) : null}

      {proposal?.intent.kind === "amount" ? (
        <form action={formAction} className="flex items-center gap-2">
          <input type="hidden" name="entryId" value={entry.id} />
          <input type="hidden" name="amount" value={proposal.intent.amount} />
          <input type="hidden" name="unit" value={proposal.intent.unit} />
          <p className="text-xs">
            Change to {proposal.intent.amount} {proposal.intent.unit}
            {proposal.preview
              ? ` — ${Math.round(proposal.preview.kcal)} kcal instead of ${Math.round(entry.kcal)}`
              : ""}
            .
          </p>
          <PendingButton type="submit" size="sm" pendingLabel="Applying…">
            Apply
          </PendingButton>
        </form>
      ) : null}

      {proposal?.intent.kind === "remove" ? (
        <form action={deleteEntry} className="flex items-center gap-2">
          <input type="hidden" name="entryId" value={entry.id} />
          <p className="text-xs">Remove this entry?</p>
          <PendingButton type="submit" size="sm" variant="destructive">
            Remove
          </PendingButton>
        </form>
      ) : null}

      {proposal?.intent.kind === "unclear" ? (
        <p className="text-muted-foreground text-xs">
          That could not be read as a change to the amount. Use Edit to set it
          by hand.
        </p>
      ) : null}
    </div>
  );
}
