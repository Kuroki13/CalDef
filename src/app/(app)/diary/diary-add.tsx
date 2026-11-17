"use client";

/**
 * Adding food from the diary, in a sheet over the day.
 *
 * Every meal has its own "+", which opens the adding tool on that meal and
 * on the day being viewed; the general "Add food" opens it on the meal the
 * hour suggests. Either way the meal and the day are shown at the top of the
 * tool and can be changed before saving.
 *
 * After saving, the sheet closes onto the diary of the day the entry went
 * to, the new row is marked and brought into view, and a confirmation names
 * the meal and the day, with "Add another" to carry on in the same place.
 */

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useContext, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { AddFood, type SavedEntry } from "@/app/(app)/diary/add-food";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatLongDate } from "@/lib/dates";
import type { MealType } from "@/lib/diary";
import type { PersonalLibrary } from "@/lib/food/library-types";
import { mealForHour } from "@/lib/meal-suggestion";
import { cn } from "@/lib/utils";

type Opener = (mealId?: number) => void;
const AddContext = createContext<Opener>(() => {});

const subscribe = () => () => {};

export function DiaryAdd({
  date,
  today,
  meals,
  aiReady,
  library,
  openOnArrival,
  children,
}: {
  date: string;
  today: string;
  meals: MealType[];
  aiReady: boolean;
  library: PersonalLibrary;
  /** From Today's "Add food" (`?add`): a meal id, or "" for "you choose". */
  openOnArrival: string | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const suggested = () =>
    date === today ? mealForHour(meals, new Date().getHours())?.id : meals[0]?.id;

  const arrivalMeal = meals.find((meal) => String(meal.id) === openOnArrival)?.id;
  const [state, setState] = useState<{ open: boolean; mealId: number | undefined; n: number }>({
    open: openOnArrival !== null,
    mealId: arrivalMeal,
    n: 0,
  });

  const open: Opener = (mealId) =>
    setState((current) => ({ open: true, mealId: mealId ?? suggested(), n: current.n + 1 }));

  function saved(entry: SavedEntry) {
    const meal = meals.find((m) => m.id === entry.mealTypeId);
    setState((current) => ({ ...current, open: false }));
    toast.success(`Added to ${meal?.name ?? "your diary"} · ${formatLongDate(entry.logDate)}`, {
      action: { label: "Add another", onClick: () => open(entry.mealTypeId) },
    });
    // The diary of the day it went to, with the new row marked.
    router.replace(`/diary?date=${entry.logDate}&saved=${entry.entryId}`, { scroll: false });
  }

  // On arrival from Today with no meal named, the hour decides — which only
  // the browser knows, so it is settled once the page is in the browser.
  const mealId = state.mealId ?? (hydrated ? suggested() : undefined);

  return (
    <AddContext.Provider value={open}>
      {children}
      <Sheet open={state.open} onOpenChange={(value) => setState((c) => ({ ...c, open: value }))}>
        <SheetContent
          side="bottom"
          className="mx-auto max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl px-4 pt-2 pb-[calc(1.5rem+env(safe-area-inset-bottom))] data-[side=bottom]:h-auto"
        >
          <div aria-hidden className="bg-border mx-auto mt-1 h-1 w-10 rounded-full" />
          <SheetHeader className="px-0 pb-0">
            <SheetTitle className="display text-3xl">Add food</SheetTitle>
            <SheetDescription className="sr-only">
              Choose a food, its amount, the meal and the day, then add it.
            </SheetDescription>
          </SheetHeader>
          {state.open && mealId !== undefined ? (
            <AddFood
              key={state.n}
              logDate={date}
              today={today}
              mealTypes={meals}
              initialMealTypeId={mealId}
              aiReady={aiReady}
              library={library}
              onSaved={saved}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </AddContext.Provider>
  );
}

/** The "+" on a meal: opens the tool on that meal and the day on screen. */
export function AddToMeal({ mealId, mealName }: { mealId: number; mealName: string }) {
  const open = useContext(AddContext);
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="bg-card size-11 shrink-0 rounded-full"
      aria-label={`Add food to ${mealName}`}
      onClick={() => open(mealId)}
    >
      <Plus className="size-5" aria-hidden />
    </Button>
  );
}

/** The general "Add food": the meal the hour suggests, changeable at once. */
export function AddFoodButton({ className }: { className?: string }) {
  const open = useContext(AddContext);
  return (
    <Button
      type="button"
      variant="volt"
      size="lg"
      className={cn("rounded-full px-5", className)}
      onClick={() => open()}
    >
      <Plus aria-hidden /> Add food
    </Button>
  );
}
