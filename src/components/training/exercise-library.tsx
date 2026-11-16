"use client";

/**
 * Browsing the library: the same search and filters as the picker, but a
 * tap opens the exercise instead of ticking it.
 */

import { ArrowRight, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { CreateExerciseForm } from "@/components/training/exercise-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchExercises } from "@/lib/training/search";
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
  "border-input bg-card h-10 w-full min-w-0 rounded-lg border px-3 text-base md:text-sm";

export function ExerciseLibrary({ exercises }: { exercises: Exercise[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [muscle, setMuscle] = useState<MuscleGroup | "">("");
  const [equipment, setEquipment] = useState<Equipment | "">("");
  const [creating, setCreating] = useState(false);

  const results = useMemo(
    () =>
      searchExercises(exercises, {
        query,
        muscleGroup: muscle || null,
        equipment: equipment || null,
      }),
    [exercises, query, muscle, equipment],
  );

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name"
          aria-label="Search exercises"
          className="pl-9"
          autoComplete="off"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <select
          aria-label="Muscle group"
          className={SELECT_CLASS}
          value={muscle}
          onChange={(event) => setMuscle(event.target.value as MuscleGroup | "")}
        >
          <option value="">All muscles</option>
          {MUSCLE_GROUPS.map((group) => (
            <option key={group} value={group}>{MUSCLE_LABEL[group]}</option>
          ))}
        </select>
        <select
          aria-label="Equipment"
          className={SELECT_CLASS}
          value={equipment}
          onChange={(event) => setEquipment(event.target.value as Equipment | "")}
        >
          <option value="">All equipment</option>
          {EQUIPMENT.map((item) => (
            <option key={item} value={item}>{EQUIPMENT_LABEL[item]}</option>
          ))}
        </select>
      </div>

      <p className="text-muted-foreground text-xs" aria-live="polite">
        {results.length} of {exercises.length} exercises
      </p>

      {results.length === 0 ? (
        <p className="text-muted-foreground rounded-2xl border border-dashed px-4 py-8 text-center text-sm">
          Nothing matches. If the exercise is missing, create it below.
        </p>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card">
          {results.map((exercise) => (
            <li key={exercise.id}>
              <Link
                href={`/training/exercises/${exercise.id}`}
                className="flex min-h-14 items-center gap-3 px-4 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{exercise.name}</span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {MUSCLE_LABEL[exercise.muscleGroup]} · {EQUIPMENT_LABEL[exercise.equipment]}
                    {exercise.custom ? " · Yours" : ""}
                  </span>
                </span>
                <ArrowRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <CreateExerciseForm
          initialName={query}
          initialMuscle={muscle || null}
          initialEquipment={equipment || null}
          onCancel={() => setCreating(false)}
          onCreated={(exercise) => {
            setCreating(false);
            router.push(`/training/exercises/${exercise.id}`);
            router.refresh();
          }}
        />
      ) : (
        <Button type="button" variant="outline" size="lg" className="w-full" onClick={() => setCreating(true)}>
          <Plus aria-hidden /> Create an exercise
        </Button>
      )}
    </div>
  );
}
