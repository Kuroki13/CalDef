"use client";

/**
 * "I ate 200g chicken, 150g rice and a tablespoon of olive oil".
 *
 * The assistant proposes; the user confirms. Every proposal is shown with
 * the food it matched, the portion, and the calories — all of which came
 * from the food database, not from the model. A misreading is therefore
 * visible before anything is written, which is the reason this step exists
 * rather than logging straight from the sentence.
 *
 * This component never sees an API key. It calls our own route, which is
 * where Gemini is reached.
 */

import { useActionState, useState } from "react";

import {
  logParsedFoods,
  type AiLogState,
} from "@/app/(app)/diary/ai-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { PendingButton } from "@/components/pending-button";
import {
  Card,
  CardContent,
  CardDescription,
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
import { Textarea } from "@/components/ui/textarea";
import type { Food } from "@/lib/food/types";
import type { MealType } from "@/lib/diary";

type Proposal = {
  intent: { query: string; amount: number; unit: "g" | "ml" | "serving" };
  match: Food | null;
  alternatives: Food[];
  grams: number | null;
  macros: { kcal: number } | null;
};

/** One row's editable state: which candidate, and how much. */
type Choice = { foodIndex: number; amount: number };

type ParseState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; proposals: Proposal[]; degraded: boolean; notice?: string };

export function DescribeFood({
  logDate,
  mealTypes,
}: {
  logDate: string;
  mealTypes: MealType[];
}) {
  const [text, setText] = useState("");
  const [parse, setParse] = useState<ParseState>({ status: "idle" });
  const [choices, setChoices] = useState<Choice[]>([]);
  const [mealTypeId, setMealTypeId] = useState(String(mealTypes[0]?.id ?? ""));

  const [state, formAction] = useActionState<AiLogState, FormData>(
    logParsedFoods,
    {},
  );

  // Clearing after a successful log returns the box to empty, ready for the
  // next meal. Adjusted during render for the same reason as in `AddFood`.
  const [handledOk, setHandledOk] = useState(false);
  if (Boolean(state.ok) !== handledOk) {
    setHandledOk(Boolean(state.ok));
    if (state.ok) {
      setText("");
      setParse({ status: "idle" });
      setChoices([]);
    }
  }

  async function run(event: React.FormEvent) {
    event.preventDefault();
    if (text.trim().length === 0) return;

    setParse({ status: "loading" });
    try {
      const response = await fetch("/api/ai/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const body = await response.json();

      if (!response.ok) {
        // Covers the AI being off, unconfigured, over quota or down. Every
        // one of them leaves the search box above working, which is what the
        // message says.
        setParse({
          status: "error",
          message: body.error ?? "The assistant could not be reached.",
        });
        return;
      }

      const proposals: Proposal[] = body.proposals ?? [];
      setParse({
        status: "done",
        proposals,
        degraded: Boolean(body.degraded),
        notice: body.notice,
      });
      setChoices(
        proposals.map((p) => ({ foodIndex: 0, amount: p.intent.amount })),
      );
    } catch {
      setParse({
        status: "error",
        message: "Could not reach the assistant.",
      });
    }
  }

  const proposals = parse.status === "done" ? parse.proposals : [];

  const rows = proposals.map((proposal, index) => {
    const candidates = proposal.match
      ? [proposal.match, ...proposal.alternatives]
      : [];
    const choice = choices[index] ?? { foodIndex: 0, amount: proposal.intent.amount };
    return { proposal, candidates, choice, food: candidates[choice.foodIndex] };
  });

  const loggable = rows.filter((row) => row.food);

  const payload = JSON.stringify({
    logDate,
    mealTypeId,
    items: loggable.map((row) => ({
      food: row.food,
      amount: row.choice.amount,
      unit: row.proposal.intent.unit,
      servingLabel:
        row.proposal.intent.unit === "serving"
          ? (row.food!.servings.find((s) => s.isDefault)?.label ??
            row.food!.servings[0]?.label ??
            null)
          : null,
    })),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Describe a meal</CardTitle>
        <CardDescription>
          Write what you ate. Nothing is logged until you confirm, and the
          calories come from the food database — not from the assistant.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={run} className="space-y-2">
          <Label htmlFor="describe" className="sr-only">
            Describe what you ate
          </Label>
          <Textarea
            id="describe"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            placeholder="200g chicken breast, 150g rice and a tablespoon of olive oil"
          />
          <PendingButton
            type="submit"
            variant="secondary"
            pending={parse.status === "loading"}
            pendingLabel="Reading…"
            disabled={text.trim().length === 0}
          >
            Read this
          </PendingButton>
        </form>

        {parse.status === "error" ? (
          <Alert variant="destructive">
            <AlertDescription>{parse.message}</AlertDescription>
          </Alert>
        ) : null}

        {parse.status === "done" && parse.degraded ? (
          <Alert>
            <AlertDescription>
              A food source did not respond, so these matches may be
              incomplete.
            </AlertDescription>
          </Alert>
        ) : null}

        {parse.status === "done" && proposals.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {parse.notice ?? "No food found in that."}
          </p>
        ) : null}

        {state.error ? (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}

        {state.notice ? (
          <Alert>
            <AlertDescription>{state.notice}</AlertDescription>
          </Alert>
        ) : null}

        {rows.length > 0 ? (
          <form action={formAction} className="space-y-4">
            <input type="hidden" name="payload" value={payload} />

            <ul className="divide-y">
              {rows.map((row, index) => (
                <li key={index} className="space-y-2 py-3">
                  <p className="text-muted-foreground text-xs">
                    Heard: &ldquo;{row.proposal.intent.query}&rdquo;,{" "}
                    {row.proposal.intent.amount} {row.proposal.intent.unit}
                  </p>

                  {row.candidates.length === 0 ? (
                    <p className="text-sm">
                      No match found. Add this one from the search box above.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Select
                          value={String(row.choice.foodIndex)}
                          onValueChange={(v) =>
                            setChoices((prev) =>
                              prev.map((c, i) =>
                                i === index ? { ...c, foodIndex: Number(v) } : c,
                              ),
                            )
                          }
                        >
                          <SelectTrigger
                            aria-label={`Food for ${row.proposal.intent.query}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {row.candidates.map((food, i) => (
                              <SelectItem key={i} value={String(i)}>
                                {food.name}
                                {food.brand ? ` · ${food.brand}` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Badge variant="outline">
                          {row.food?.source === "usda" ? "USDA" : "Community"}
                        </Badge>
                      </div>

                      <div className="flex items-end gap-2">
                        <div className="w-24 space-y-1">
                          <Label
                            htmlFor={`amount-${index}`}
                            className="text-xs"
                          >
                            {row.proposal.intent.unit}
                          </Label>
                          <Input
                            id={`amount-${index}`}
                            type="number"
                            step="any"
                            min="0.01"
                            value={row.choice.amount}
                            onChange={(e) =>
                              setChoices((prev) =>
                                prev.map((c, i) =>
                                  i === index
                                    ? { ...c, amount: Number(e.target.value) }
                                    : c,
                                ),
                              )
                            }
                          />
                        </div>
                        <p className="text-muted-foreground pb-2 text-xs">
                          {row.food
                            ? `${Math.round((row.food.nutrients.kcal * estimateGrams(row)) / 100)} kcal`
                            : ""}
                        </p>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>

            <div className="space-y-2">
              <Label htmlFor="ai-meal">Meal</Label>
              <Select value={mealTypeId} onValueChange={setMealTypeId}>
                <SelectTrigger id="ai-meal">
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

            <PendingButton
              type="submit"
              className="w-full"
              pendingLabel="Adding…"
              disabled={loggable.length === 0}
            >
              {`Add ${loggable.length} item${loggable.length === 1 ? "" : "s"} to diary`}
            </PendingButton>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * The gram weight for the preview figure only.
 *
 * The number written to the diary is computed server-side from the stored
 * nutrient row; this is the same arithmetic run early so the user can see
 * what they are about to confirm.
 */
function estimateGrams(row: {
  proposal: Proposal;
  choice: Choice;
  food?: Food;
}): number {
  const { unit } = row.proposal.intent;
  if (unit === "serving") {
    const serving =
      row.food?.servings.find((s) => s.isDefault) ?? row.food?.servings[0];
    return serving ? serving.grams * row.choice.amount : 0;
  }
  return row.choice.amount;
}
