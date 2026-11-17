"use client";

import { ChevronDown, MessageCircle, Pencil, Repeat, Star, Trash2 } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";

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
import { ConfidenceBadge } from "@/components/confidence-badge";
import { LogAgainForm } from "@/components/repeat-forms";
import type { DiaryEntry, MealType } from "@/lib/diary";
import { portionText } from "@/lib/nutrition/units";

export function EntryRow({
  entry,
  aiEnabled,
  mealTypes = [],
  today,
  isNew = false,
}: {
  entry: DiaryEntry;
  /** The assistant's amend box is a shortcut; Edit below always works. */
  aiEnabled: boolean;
  /** For "Log again"; without them the control is not offered. */
  mealTypes?: MealType[];
  today?: string;
  /** Just added: marked, and brought into view, so it is seen where it went. */
  isNew?: boolean;
}) {
  const row = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!isNew) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.current?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }, [isNew]);

  const [editing, setEditing] = useState(false);
  const [again, setAgain] = useState(false);
  const [amending, setAmending] = useState(false);
  const [state, formAction] = useActionState<DiaryActionState, FormData>(
    updateEntryAmount,
    {},
  );

  // A saved amount closes its editor. Tracked during render, not in an
  // effect, so the form is never painted once more with the new value.
  // Compared by identity: every submission returns a new state object, so
  // the second successful save closes the editor as the first did.
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state.ok) setEditing(false);
  }

  const [open, setOpen] = useState(false);
  const uncertain = entry.confidence === "estimated" || entry.confidence === "rough";
  const actionClass = "min-h-10 rounded-full px-3.5";

  return (
    <li ref={row} className="-mx-4 px-4 py-1" data-new={isNew || undefined}>
      {/*
        One line to read, one tap to act. The row is the food, its portion
        and its calories; everything that can be done to it opens beneath,
        so a meal of five foods is five lines and not twenty-five buttons.
      */}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={`Actions for ${entry.foodName}`}
        className="flex min-h-14 w-full items-center gap-3 py-2 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.9375rem] font-medium">
            {entry.foodName}
          </span>
          <span className="text-muted-foreground block truncate text-xs">
            {entry.isEstimate ? (
              // Never dressed as a portion of a food: it is not one.
              <span className="text-foreground font-medium">Your estimate</span>
            ) : (
              <>
                {entry.foodBrand ? `${entry.foodBrand} · ` : ""}
                {portionText(entry.amount, entry.unit, entry.grams, entry.servingLabel)}
              </>
            )}
            {" · "}
            {Math.round(entry.protein_g)}P {Math.round(entry.carbs_g)}C{" "}
            {Math.round(entry.fat_g)}F
          </span>
        </span>
        {/* Shown in the row only when the figure is uncertain; a reliable
            one says so once the row is opened, where there is room. */}
        {uncertain ? <ConfidenceBadge level={entry.confidence} /> : null}
        <span className="shrink-0 text-right whitespace-nowrap">
          <span className="figure text-2xl">{Math.round(entry.kcal)}</span>
          <span className="text-muted-foreground font-sans text-xs"> kcal</span>
        </span>
        <ChevronDown
          aria-hidden
          className={`text-muted-foreground size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {state.error ? (
        <p className="text-destructive pb-2 text-xs">{state.error}</p>
      ) : null}

      {open ? (
        <div className="space-y-2.5 pb-3">
          {/* What was estimated in this entry, from its own data — the
              "why" behind the badge, where a finger can find it. */}
          <p className="text-muted-foreground flex items-start gap-2 text-xs">
            <ConfidenceBadge level={entry.confidence} />
            <span className="pt-0.5">
              {entry.estimationNote ?? "How far this figure can be trusted."}
            </span>
          </p>
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
                className="w-28"
                aria-label={`Amount for ${entry.foodName}`}
              />
              <span className="text-muted-foreground text-sm">{entry.unit}</span>
              <PendingButton type="submit" pendingLabel="Saving…" className="ml-auto">
                Save
              </PendingButton>
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {/* An estimate has no food to recompute a new amount from;
                  remove it and add it again instead. */}
              {entry.isEstimate ? null : (
                <Button
                  type="button"
                  variant="secondary"
                  className={actionClass}
                  onClick={() => setEditing(true)}
                  aria-label={`Edit ${entry.foodName}`}
                >
                  <Pencil aria-hidden /> Amount
                </Button>
              )}
              {today && mealTypes.length > 0 ? (
                <Button
                  type="button"
                  variant="secondary"
                  className={actionClass}
                  onClick={() => setAgain((value) => !value)}
                  aria-label={`Repeat ${entry.foodName}`}
                  aria-expanded={again}
                >
                  <Repeat aria-hidden /> Again
                </Button>
              ) : null}
              {aiEnabled && entry.foodId !== null ? (
                <Button
                  type="button"
                  variant="secondary"
                  className={actionClass}
                  onClick={() => setAmending((value) => !value)}
                  aria-label={`Amend ${entry.foodName} in words`}
                  aria-expanded={amending}
                >
                  <MessageCircle aria-hidden /> In words
                </Button>
              ) : null}
              {/* A recipe entry has no single food, so there is nothing to star. */}
              {entry.foodId !== null ? (
                <form action={toggleFavoriteAction}>
                  <input type="hidden" name="foodId" value={entry.foodId} />
                  <input type="hidden" name="favorite" value={String(entry.isFavorite)} />
                  <PendingButton
                    type="submit"
                    variant="secondary"
                    className={actionClass}
                    aria-label={
                      entry.isFavorite ? `Unstar ${entry.foodName}` : `Star ${entry.foodName}`
                    }
                    aria-pressed={entry.isFavorite}
                  >
                    <Star aria-hidden className={entry.isFavorite ? "fill-current" : ""} />
                    {entry.isFavorite ? "Starred" : "Star"}
                  </PendingButton>
                </form>
              ) : null}
              <form action={deleteEntry} className="ml-auto">
                <input type="hidden" name="entryId" value={entry.id} />
                <PendingButton
                  type="submit"
                  variant="ghost"
                  className={`${actionClass} text-destructive`}
                  aria-label={`Remove ${entry.foodName}`}
                >
                  <Trash2 aria-hidden /> Remove
                </PendingButton>
              </form>
            </div>
          )}
        </div>
      ) : null}

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
