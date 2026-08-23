"use client";

import { useActionState, useState } from "react";

import {
  recordWeighIn,
  type WeightActionState,
} from "@/app/(app)/weight/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function WeighInForm({
  today,
  unitLabel,
  defaultWeight,
}: {
  today: string;
  unitLabel: string;
  defaultWeight: number | null;
}) {
  const [state, formAction, pending] = useActionState<
    WeightActionState,
    FormData
  >(recordWeighIn, {});

  // Cleared during render rather than in an effect, so the success message
  // is not painted alongside a stale value first.
  const [handledOk, setHandledOk] = useState(false);
  if (Boolean(state.ok) !== handledOk) setHandledOk(Boolean(state.ok));

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {state.ok ? (
        <Alert>
          <AlertDescription>Weigh-in recorded.</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="weight">Weight ({unitLabel})</Label>
          <Input
            id="weight"
            name="weight"
            type="number"
            inputMode="decimal"
            step="any"
            min="1"
            required
            defaultValue={defaultWeight ?? undefined}
            placeholder={`e.g. ${unitLabel === "kg" ? "111.8" : "246.5"}`}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="entryDate">Date</Label>
          <Input
            id="entryDate"
            name="entryDate"
            type="date"
            required
            max={today}
            defaultValue={today}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="note">Note (optional)</Label>
        <Input
          id="note"
          name="note"
          maxLength={280}
          placeholder="Anything worth remembering about this reading"
        />
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Saving…" : "Record weigh-in"}
      </Button>
    </form>
  );
}
