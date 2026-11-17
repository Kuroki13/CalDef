"use client";

/**
 * "Find an alternative", during a session — the machine is taken.
 *
 * The list is `findAlternatives` (same muscle group, same kind of set,
 * closest movement first), with the reasons it gives. Choosing one does not
 * act at once: it says which exercise is concerned, what becomes of the sets
 * already logged, and that only this session changes — never the workout.
 *
 *   nothing logged yet   the alternative takes its place, with fresh sets
 *   some sets logged     those stay as they were, under the original; the
 *                        alternative is added after it
 */

import { ArrowRight } from "lucide-react";
import { useState } from "react";

import { PendingButton } from "@/components/pending-button";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { findAlternatives } from "@/lib/training/alternatives";
import { EQUIPMENT, EQUIPMENT_LABEL, type Equipment, type Exercise } from "@/lib/training/types";
import { cn } from "@/lib/utils";

export function AlternativesSheet({
  target,
  doneSets,
  sessionName,
  catalogue,
  pending,
  onOpenChange,
  onReplace,
  onAdd,
}: {
  /** The exercise in the session that needs replacing; null when closed. */
  target: (Exercise & { sessionExerciseId: number }) | null;
  doneSets: number;
  sessionName: string;
  catalogue: readonly Exercise[];
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onReplace: (exercise: Exercise) => void;
  onAdd: (exercise: Exercise) => void;
}) {
  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const [chosen, setChosen] = useState<Exercise | null>(null);

  const all = target ? findAlternatives(target, catalogue, { limit: 60 }) : [];
  const available = EQUIPMENT.filter((e) => all.some((a) => a.exercise.equipment === e));
  const list = all.filter((a) => !equipment || a.exercise.equipment === equipment).slice(0, 15);

  return (
    <Sheet
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) {
          setChosen(null);
          setEquipment(null);
        }
        onOpenChange(open);
      }}
    >
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[88dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] data-[side=bottom]:h-auto"
      >
        <SheetHeader className="px-0">
          <SheetTitle className="display text-2xl">
            {chosen ? "Swap for this session?" : "Find an alternative"}
          </SheetTitle>
          <SheetDescription>
            {target ? `For ${target.name}: same muscles, logged the same way, closest movement first.` : ""}
          </SheetDescription>
        </SheetHeader>

        {target && chosen ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span className="min-w-0 flex-1 truncate">{target.name}</span>
              <ArrowRight className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{chosen.name}</span>
            </div>
            <ul className="text-muted-foreground list-disc space-y-1.5 pl-5 text-sm">
              {doneSets > 0 ? (
                <>
                  <li>
                    The {doneSets} {doneSets === 1 ? "set" : "sets"} already logged stay
                    as {target.name}.
                  </li>
                  <li>{chosen.name} is added to the end of this session, with its own sets and its own history.</li>
                </>
              ) : (
                <>
                  <li>{chosen.name} takes the place of {target.name}, with fresh sets.</li>
                  <li>Its own history fills the &ldquo;Last&rdquo; line.</li>
                </>
              )}
              <li>Only this session changes. The workout &ldquo;{sessionName}&rdquo; is not edited.</li>
            </ul>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" className="flex-1" onClick={() => setChosen(null)}>
                Back
              </Button>
              <PendingButton
                type="button"
                variant="volt"
                className="flex-1 rounded-xl"
                pending={pending}
                pendingLabel="Changing…"
                onClick={() => (doneSets > 0 ? onAdd(chosen) : onReplace(chosen))}
              >
                {doneSets > 0 ? "Add it" : "Swap"}
              </PendingButton>
            </div>
          </div>
        ) : (
          <>
            {available.length > 1 ? (
              <div role="group" aria-label="Equipment" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
                {[null, ...available].map((option) => (
                  <button
                    key={option ?? "any"}
                    type="button"
                    aria-pressed={equipment === option}
                    onClick={() => setEquipment(option)}
                    className={cn(
                      "min-h-11 shrink-0 rounded-full border px-4 text-sm",
                      equipment === option ? "bg-foreground text-background border-foreground font-semibold" : "bg-card",
                    )}
                  >
                    {option ? EQUIPMENT_LABEL[option] : "Any"}
                  </button>
                ))}
              </div>
            ) : null}
            {list.length === 0 ? (
              <p className="text-muted-foreground py-6 text-sm">
                Nothing in the library matches by those rules. Use Replace to choose any exercise.
              </p>
            ) : (
              <ul className="divide-y">
                {list.map(({ exercise, reasons }) => (
                  <li key={exercise.id}>
                    <button
                      type="button"
                      onClick={() => setChosen(exercise)}
                      className="flex min-h-16 w-full items-center gap-3 py-2 text-left"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{exercise.name}</span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {EQUIPMENT_LABEL[exercise.equipment]}
                          {reasons.length ? ` · ${reasons.join(" · ")}` : ""}
                        </span>
                      </span>
                      <ArrowRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
