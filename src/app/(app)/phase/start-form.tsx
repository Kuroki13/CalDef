"use client";

import { useActionState } from "react";

import { startPhase, type PhaseActionState } from "@/app/(app)/phase/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function StartPhaseForm({
  unitLabel,
  suggestedStretch,
}: {
  unitLabel: string;
  suggestedStretch: number | null;
}) {
  const [state, formAction, pending] = useActionState<
    PhaseActionState,
    FormData
  >(startPhase, {});

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="stretchTarget">
          Stretch target ({unitLabel}, optional)
        </Label>
        <Input
          id="stretchTarget"
          name="stretchTarget"
          type="number"
          inputMode="decimal"
          step="any"
          min="1"
          defaultValue={suggestedStretch ?? undefined}
        />
        <p className="text-muted-foreground text-xs">
          What you would love to hit. It is drawn on the chart as a separate
          line and never used to set your calories — the plan works to a rate
          your data supports.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="durationDays">Length (days)</Label>
        <Input
          id="durationDays"
          name="durationDays"
          type="number"
          min="7"
          max="365"
          defaultValue={56}
        />
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Starting…" : "Start the phase"}
      </Button>
    </form>
  );
}
