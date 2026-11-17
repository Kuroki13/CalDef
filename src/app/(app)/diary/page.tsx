import type { Metadata } from "next";
import { ChefHat, ChevronRight } from "lucide-react";
import Link from "next/link";

import { CopyFromYesterday } from "@/components/repeat-forms";
import { EntryRow } from "@/app/(app)/diary/entry-row";
import { AddFoodButton, AddToMeal, DiaryAdd } from "@/app/(app)/diary/diary-add";
import { BackToToday, DayNav } from "@/app/(app)/diary/day-nav";
import { CompactBudget } from "@/app/(app)/dashboard/macro-budget";
import { Slab } from "@/components/page-header";
import { addDays, isIsoDate, todayInTimeZone } from "@/lib/dates";
import { getDiaryDay } from "@/lib/diary";
import { getPersonalLibrary } from "@/lib/food/library";
import { estimatedShare } from "@/lib/nutrition/confidence";
import { hasGeminiKey } from "@/lib/env.server";
import { getAccountSetup } from "@/lib/profile";
import { getOrCreateDailyTarget } from "@/lib/targets";

export const metadata: Metadata = { title: "Nutrition · CalDef" };

/**
 * The diary: a day's meals, and adding to them.
 *
 * Composition ("Ledger", chosen against a tiles layout on 2026-11-17): one
 * band of figures — the day, what is left, the macros — and then the meals,
 * which are the page. Each meal carries its own "+", which opens the adding
 * tool on that meal and that day; the meal and the day stay visible and
 * changeable until the entry is saved, and the new row is marked where it
 * landed.
 */
export default async function DiaryPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; add?: string; saved?: string }>;
}) {
  const { profile } = await getAccountSetup();
  // The layout guarantees setup is complete before this renders.
  if (!profile) return null;

  const today = todayInTimeZone(profile.timezone);
  const query = await searchParams;
  const requested = query.date;
  // A day that has not happened cannot be logged: a food dated tomorrow
  // would count towards an intake the expenditure model then reads as
  // real. A future date in the address is read as today.
  const date =
    requested && isIsoDate(requested) && requested <= today ? requested : today;

  const [day, previousDay, target, library] = await Promise.all([
    getDiaryDay(date),
    // For "Copy from yesterday": the day before the one being viewed.
    getDiaryDay(addDays(date, -1)),
    getOrCreateDailyTarget(date),
    getPersonalLibrary(),
  ]);

  // The assistant needs both the user's switch and a configured key. Showing
  // a "Describe a meal" box that can only ever answer "not configured" is an
  // unimplemented button, which the acceptance criteria forbid — and the
  // manual search above it is the whole feature regardless.
  const aiReady = profile.ai_enabled && hasGeminiKey();

  // §11.3: say how much of the day is estimated rather than letting a
  // rough figure pass for a weighed one.
  const uncertainShare = estimatedShare(day.entries);

  const consumed = day.totals.totals;

  const entriesByMeal = new Map(
    day.mealTypes.map((meal) => [
      meal.id,
      day.entries.filter((e) => e.meal_type_id === meal.id),
    ]),
  );

  const savedId = Number(query.saved);
  const estimatedPct =
    uncertainShare !== null && uncertainShare > 0
      ? Math.max(1, Math.round(uncertainShare * 100))
      : null;

  return (
    <DiaryAdd
      // A different day is a different context: whatever was open closes.
      key={date}
      date={date}
      today={today}
      meals={day.mealTypes}
      aiReady={aiReady}
      library={library}
      openOnArrival={query.add ?? null}
    >
    <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-8">
      <div className="lg:sticky lg:top-0 lg:col-span-5">
        <Slab size="strip">
          <h1 className="sr-only">Nutrition</h1>
          <DayNav date={date} today={today} />
          {target ? (
            <div className="mt-3">
              <CompactBudget
                consumed={consumed.kcal}
                target={target.macros.kcal}
                label={target.label}
                macros={{
                  protein: { consumed: consumed.protein_g, target: target.macros.protein_g },
                  carbs: { consumed: consumed.carbs_g, target: target.macros.carbs_g },
                  fat: { consumed: consumed.fat_g, target: target.macros.fat_g },
                }}
                estimatedPct={estimatedPct}
              />
              {target.fellBackFromPhase ? (
                <p className="text-slab-muted mt-3 text-xs">
                  Your cut phase has ended, so this is your everyday target
                  again. The number changed because the phase is no longer
                  setting it.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="mt-3 space-y-1">
              <p className="display text-3xl">No target yet</p>
              <p className="text-slab-muted text-sm">
                Add your profile and a weigh-in to get a target.
              </p>
            </div>
          )}
          <div className="mt-4 flex items-center gap-2">
            <AddFoodButton className="flex-1 sm:flex-none" />
            {date !== today ? <BackToToday /> : null}
          </div>
        </Slab>
        {target?.detail ? (
          <p className="text-muted-foreground mt-3 hidden px-1 text-xs lg:block">
            {target.detail.explanation}
          </p>
        ) : null}
      </div>

      <div className="mt-5 space-y-6 lg:col-span-7 lg:mt-10">
        {day.mealTypes.map((meal) => {
          const entries = entriesByMeal.get(meal.id) ?? [];
          const previous = previousDay.entries.filter(
            (e) => e.meal_type_id === meal.id,
          );
          const mealKcal = entries.reduce((sum, e) => sum + e.kcal, 0);

          return (
            <section key={meal.id} id={`meal-${meal.id}`} aria-labelledby={`meal-${meal.id}-title`} className="scroll-mt-20">
              <div className="flex items-center gap-3 pl-1">
                <h2 id={`meal-${meal.id}-title`} className="display flex-1 text-2xl">
                  {meal.name}
                </h2>
                <p className="text-muted-foreground text-sm tabular-nums">
                  {entries.length === 0 ? (
                    "Nothing yet"
                  ) : (
                    <>
                      <span className="text-foreground font-semibold">
                        {Math.round(mealKcal)}
                      </span>{" "}
                      kcal
                    </>
                  )}
                </p>
                <AddToMeal mealId={meal.id} mealName={meal.name} />
              </div>
              {entries.length > 0 ? (
                <ul className="bg-card mt-2 divide-y overflow-hidden rounded-2xl px-4">
                  {entries.map((entry) => (
                    <EntryRow
                      key={entry.id}
                      entry={entry}
                      aiEnabled={aiReady}
                      mealTypes={day.mealTypes}
                      today={today}
                      isNew={entry.id === savedId}
                    />
                  ))}
                </ul>
              ) : null}
              {previous.length > 0 ? (
                <div className="mt-2 px-1">
                  <CopyFromYesterday
                    entries={previous}
                    mealTypeId={meal.id}
                    mealName={meal.name}
                    logDate={date}
                  />
                </div>
              ) : null}
            </section>
          );
        })}

        <Link
          href="/recipes"
          className="bg-card flex min-h-14 items-center gap-3 rounded-2xl px-5"
        >
          <ChefHat className="text-muted-foreground size-5" aria-hidden />
          <span className="flex-1 text-sm font-semibold">
            Recipes, saved meals and your foods
          </span>
          <ChevronRight className="text-muted-foreground size-4" aria-hidden />
        </Link>

        <p className="text-muted-foreground px-1 text-xs">
          {target?.detail ? <span className="lg:hidden">{target.detail.explanation} </span> : null}
          CalDef provides estimates for personal tracking. It is not medical or
          dietary advice.
        </p>
      </div>
    </div>
    </DiaryAdd>
  );
}
