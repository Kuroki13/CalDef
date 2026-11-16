"use client";

/**
 * The sets of one exercise in a FINISHED session, each correctable.
 *
 * A typo noticed afterwards is fixed here: the figures change, the moment
 * the set was done does not, and the session stays finished
 * (`correctSetAction`). Half a set cannot be saved.
 */

import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { correctSetAction } from "@/app/(app)/training/actions";
import { PendingButton } from "@/components/pending-button";
import { fromDraft, toDraft, type SetDraft } from "@/components/training/set-draft";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { describeSet, distanceUnit, weightUnit } from "@/lib/training/format";
import type { Measure, WorkoutSet } from "@/lib/training/types";
import type { UnitSystem } from "@/lib/units";

export function CompletedSets({
  exerciseName,
  measure,
  sets,
  units,
}: {
  exerciseName: string;
  measure: Measure;
  sets: WorkoutSet[];
  units: UnitSystem;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<SetDraft | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fields: { field: "weight" | "reps" | "duration" | "distance"; label: string; mode: "decimal" | "numeric" | "text" }[] =
    measure === "weight_reps"
      ? [{ field: "weight", label: weightUnit(units), mode: "decimal" }, { field: "reps", label: "reps", mode: "numeric" }]
      : measure === "reps"
        ? [{ field: "reps", label: "reps", mode: "numeric" }]
        : measure === "duration"
          ? [{ field: "duration", label: "time", mode: "text" }]
          : [{ field: "distance", label: distanceUnit(units), mode: "decimal" }, { field: "duration", label: "time", mode: "text" }];

  async function save() {
    if (!editing) return;
    const values = fromDraft(editing, measure, units);
    if (!values) return setError("Check the figures.");
    setPending(true);
    setError(null);
    try {
      const result = await correctSetAction({ setId: editing.id, ...values });
      if (!result.ok) return setError(result.error);
      setEditing(null);
      router.refresh();
    } catch {
      setError("No connection. Nothing was changed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <ol className="mt-2 divide-y">
      {sets.map((set, index) => (
        <li key={set.id} className="py-1.5">
          {editing?.id === set.id ? (
            <div className="space-y-2 py-1">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-6 text-sm tabular-nums">{index + 1}</span>
                {fields.map(({ field, label, mode }) => (
                  <label key={field} className="flex min-w-0 flex-1 items-center gap-1.5">
                    <Input
                      aria-label={`${exerciseName} set ${index + 1} ${label}`}
                      inputMode={mode}
                      value={editing[field]}
                      onChange={(event) => setEditing({ ...editing, [field]: event.target.value })}
                      className="figure h-11 text-center text-xl md:text-xl"
                    />
                    <span className="text-muted-foreground text-xs">{label}</span>
                  </label>
                ))}
              </div>
              {error ? <p role="alert" className="text-destructive text-xs">{error}</p> : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => { setEditing(null); setError(null); }}>
                  Cancel
                </Button>
                <PendingButton type="button" pending={pending} pendingLabel="Saving…" onClick={() => void save()}>
                  Save correction
                </PendingButton>
              </div>
            </div>
          ) : (
            <div className="flex min-h-10 items-center gap-3">
              <span className="text-muted-foreground w-6 text-sm tabular-nums">{index + 1}</span>
              <span className="figure flex-1 text-xl">{describeSet(measure, set, units)}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Correct ${exerciseName} set ${index + 1}`}
                onClick={() => { setError(null); setEditing(toDraft(set, units)); }}
              >
                <Pencil />
              </Button>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
