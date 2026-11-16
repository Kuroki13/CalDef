"use client";

/**
 * Editing or removing one of the user's own exercises.
 *
 * What a set records is not editable: sessions already logged depend on
 * it. An exercise that history or a workout points at is retired rather
 * than deleted, and the outcome is said in those words.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  removeExerciseAction,
  updateExerciseAction,
} from "@/app/(app)/training/actions";
import { PendingButton } from "@/components/pending-button";
import { ConfirmAction } from "@/components/training/confirm-action";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  EQUIPMENT,
  EQUIPMENT_LABEL,
  MUSCLE_GROUPS,
  MUSCLE_LABEL,
  type Equipment,
  type Exercise,
  type MuscleGroup,
} from "@/lib/training/types";

const SELECT_CLASS =
  "border-input bg-card h-10 w-full rounded-lg border px-3 text-base md:text-sm";

export function EditExercise({ exercise }: { exercise: Exercise }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(exercise.name);
  const [muscleGroup, setMuscleGroup] = useState<MuscleGroup>(exercise.muscleGroup);
  const [equipment, setEquipment] = useState<Equipment>(exercise.equipment);
  const [instructions, setInstructions] = useState(exercise.instructions ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setPending(true);
    setError(null);
    try {
      const result = await updateExerciseAction(exercise.id, {
        name, muscleGroup, equipment, instructions,
      });
      if (!result.ok) return setError(result.error);
      setOpen(false);
      router.refresh();
    } catch {
      setError("No connection. Nothing was saved.");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          Edit
        </Button>
        <ConfirmAction
          trigger={
            <Button type="button" variant="ghost" className="text-destructive">
              Remove
            </Button>
          }
          title={`Remove “${exercise.name}”?`}
          description="If you have logged sets with it, or a workout uses it, it is retired instead: hidden from the list, with its history kept."
          confirmLabel="Remove"
          action={() => removeExerciseAction(exercise.id)}
          redirectTo="/training/exercises"
        />
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border bg-card p-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="edit-exercise-name">Name</Label>
        <Input id="edit-exercise-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="edit-exercise-muscle">Muscle group</Label>
          <select id="edit-exercise-muscle" className={SELECT_CLASS} value={muscleGroup} onChange={(e) => setMuscleGroup(e.target.value as MuscleGroup)}>
            {MUSCLE_GROUPS.map((group) => (
              <option key={group} value={group}>{MUSCLE_LABEL[group]}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-exercise-equipment">Equipment</Label>
          <select id="edit-exercise-equipment" className={SELECT_CLASS} value={equipment} onChange={(e) => setEquipment(e.target.value as Equipment)}>
            {EQUIPMENT.map((item) => (
              <option key={item} value={item}>{EQUIPMENT_LABEL[item]}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="edit-exercise-cue">Notes</Label>
        <Input id="edit-exercise-cue" value={instructions} maxLength={1000} onChange={(e) => setInstructions(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="flex-1" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <PendingButton type="button" className="flex-1" pending={pending} pendingLabel="Saving…" disabled={name.trim().length === 0} onClick={() => void save()}>
          Save
        </PendingButton>
      </div>
    </div>
  );
}
