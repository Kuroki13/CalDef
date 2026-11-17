"use client";

import { Scale } from "lucide-react";
import { useActionState, useState } from "react";
import { toast } from "sonner";

import {
  recordWeighIn,
  type WeightActionState,
} from "@/app/(app)/weight/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PendingButton } from "@/components/pending-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatLongDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * "Record a weigh-in": one button, and a short form behind it — the weight
 * (with the keyboard for decimals, comma or point), the day, an optional
 * note. The page shows the chart; the form is only there when wanted.
 */
export function WeighInButton({
  today,
  unitLabel,
  defaultWeight,
  recordedToday,
  className,
}: {
  today: string;
  unitLabel: string;
  defaultWeight: number | null;
  /** Today already has a reading: the button says so. */
  recordedToday: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(0);
  return (
    <>
      <Button
        type="button"
        variant="volt"
        size="lg"
        className={cn("rounded-full px-5", className)}
        onClick={() => {
          setN((v) => v + 1);
          setOpen(true);
        }}
      >
        <Scale aria-hidden /> {recordedToday ? "Correct today\u2019s weigh-in" : "Record a weigh-in"}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="mx-auto w-full max-w-md rounded-t-3xl px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] data-[side=bottom]:h-auto"
        >
          <SheetHeader className="px-0">
            <SheetTitle className="display text-3xl">Weigh-in</SheetTitle>
            <SheetDescription>
              Same time of day, before eating, gives the cleanest signal.
            </SheetDescription>
          </SheetHeader>
          <WeighInForm
            key={n}
            today={today}
            unitLabel={unitLabel}
            defaultWeight={defaultWeight}
            onSaved={(date) => {
              setOpen(false);
              toast.success(`Weigh-in saved for ${formatLongDate(date)}`);
            }}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}

export function WeighInForm({
  today,
  unitLabel,
  defaultWeight,
  onSaved,
}: {
  today: string;
  unitLabel: string;
  defaultWeight: number | null;
  onSaved?: (date: string) => void;
}) {
  const [date, setDate] = useState(today);
  const [state, formAction] = useActionState<WeightActionState, FormData>(
    recordWeighIn,
    {},
  );

  // Cleared during render rather than in an effect, so the success message
  // is not painted alongside a stale value first.
  const [handledOk, setHandledOk] = useState(false);
  if (Boolean(state.ok) !== handledOk) {
    setHandledOk(Boolean(state.ok));
    if (state.ok) onSaved?.(date);
  }

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
            type="text"
            inputMode="decimal"
            // A comma is a decimal point here, as on a French keyboard.
            pattern="[0-9]+([.,][0-9]+)?"
            autoComplete="off"
            required
            autoFocus
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
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
      </div>
      <p className="text-muted-foreground -mt-1 text-xs">
        One reading per day: saving a day that already has one replaces it.
      </p>

      <div className="space-y-2">
        <Label htmlFor="note">Note (optional)</Label>
        <Input
          id="note"
          name="note"
          maxLength={280}
          placeholder="Anything worth remembering about this reading"
        />
      </div>

      <PendingButton type="submit" variant="volt" size="lg" className="w-full rounded-2xl" pendingLabel="Saving…">
        Save weigh-in
      </PendingButton>
    </form>
  );
}
