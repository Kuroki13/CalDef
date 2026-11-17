"use client";

/** One planned workout: start it, move it to another day, or cancel it. */

import { CalendarDays, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  cancelScheduledAction,
  moveScheduledAction,
  type ActionResult,
} from "@/app/(app)/training/actions";
import { PendingButton } from "@/components/pending-button";
import { StartWorkoutButton } from "@/components/training/start-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ScheduledWorkout } from "@/lib/training/types";

export function PlanRow({
  plan,
  when,
  canStart,
}: {
  plan: ScheduledWorkout;
  /** "Today", "Tomorrow" or "Wed 18 Nov". */
  when: string;
  /** Offered for today's plan when nothing is running. */
  canStart: boolean;
}) {
  const router = useRouter();
  const [moving, setMoving] = useState(false);
  const [date, setDate] = useState(plan.date);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, work: () => Promise<ActionResult>) {
    setPending(key);
    setError(null);
    try {
      const result = await work();
      if (!result.ok) return setError(result.error);
      setMoving(false);
      router.refresh();
    } catch {
      setError("No connection. Nothing was changed.");
    } finally {
      setPending(null);
    }
  }

  return (
    <li className="py-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="eyebrow">{when}</p>
          <p className="truncate font-semibold">{plan.name}</p>
        </div>
        {canStart ? (
          <StartWorkoutButton templateId={plan.templateId} scheduleId={plan.id} className="rounded-full px-5">
            Start
          </StartWorkoutButton>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Move ${plan.name} to another day`}
          aria-expanded={moving}
          onClick={() => setMoving((value) => !value)}
        >
          <CalendarDays />
        </Button>
        <PendingButton
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Cancel ${plan.name} on ${when}`}
          pending={pending === "cancel"}
          onClick={() => void run("cancel", () => cancelScheduledAction(plan.id))}
        >
          {pending === "cancel" ? null : <X />}
        </PendingButton>
      </div>
      {moving ? (
        <div className="mt-2 flex items-center gap-2">
          <Input
            type="date"
            aria-label={`New date for ${plan.name}`}
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          <PendingButton
            type="button"
            pending={pending === "move"}
            disabled={date === "" || date === plan.date}
            onClick={() => void run("move", () => moveScheduledAction({ id: plan.id, date }))}
          >
            Move
          </PendingButton>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-destructive mt-1 text-xs">{error}</p> : null}
    </li>
  );
}
