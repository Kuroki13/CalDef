"use client";

/**
 * "Find an alternative" on an exercise's page.
 *
 * The rule is stated on screen, because a suggestion nobody can check is
 * not worth much: same muscle, same kind of set, your equipment — then the
 * closest movement first. Nothing is swapped for you; each result is a
 * link to an exercise with its own history.
 */

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { findAlternatives } from "@/lib/training/alternatives";
import {
  EQUIPMENT,
  EQUIPMENT_LABEL,
  MUSCLE_LABEL,
  type Equipment,
  type Exercise,
} from "@/lib/training/types";
import { cn } from "@/lib/utils";

export function Alternatives({
  exercise,
  all,
}: {
  exercise: Exercise;
  all: Exercise[];
}) {
  const [equipment, setEquipment] = useState<Equipment | null>(null);

  // Only equipment that has at least one candidate is offered as a filter.
  const available = useMemo(() => {
    const present = new Set(
      findAlternatives(exercise, all, { limit: 1000 }).map((a) => a.exercise.equipment),
    );
    return EQUIPMENT.filter((item) => present.has(item));
  }, [exercise, all]);

  const results = useMemo(
    () => findAlternatives(exercise, all, { equipment, limit: 8 }),
    [exercise, all, equipment],
  );

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        Exercises that target {MUSCLE_LABEL[exercise.muscleGroup].toLowerCase()} and
        are logged the same way, closest movement first. Choose what you have:
      </p>
      <div role="group" aria-label="Equipment available" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        {[null, ...available].map((item) => {
          const active = equipment === item;
          return (
            <button
              key={item ?? "any"}
              type="button"
              aria-pressed={active}
              onClick={() => setEquipment(item)}
              className={cn(
                "min-h-10 shrink-0 rounded-full border px-4 text-sm font-medium",
                active ? "border-foreground bg-foreground text-background" : "bg-card",
              )}
            >
              {item ? EQUIPMENT_LABEL[item] : "Any"}
            </button>
          );
        })}
      </div>
      {results.length === 0 ? (
        <p className="text-muted-foreground rounded-2xl border border-dashed px-4 py-6 text-sm">
          Nothing in the library matches that. You can create your own exercise
          from the library.
        </p>
      ) : (
        <ul className="bg-card divide-y rounded-2xl px-4">
          {results.map(({ exercise: option, reasons }) => (
            <li key={option.id}>
              <Link href={`/training/exercises/${option.id}`} className="flex min-h-16 items-center gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{option.name}</span>
                  <span className="text-muted-foreground block truncate text-sm">
                    {EQUIPMENT_LABEL[option.equipment]}
                    {reasons.filter((r) => r !== "Different equipment").length > 0
                      ? ` · ${reasons.filter((r) => r !== "Different equipment")[0]}`
                      : ""}
                  </span>
                </span>
                <ArrowRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
