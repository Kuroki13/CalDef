import type { Metadata } from "next";
import { ChefHat, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { AddFood } from "@/app/(app)/diary/add-food";
import { CopyFromYesterday } from "@/components/repeat-forms";
import { EntryRow } from "@/app/(app)/diary/entry-row";
import { AddFoodPanel } from "@/app/(app)/diary/add-food-panel";
import {
  CalorieBudget,
  MacroRemainder,
  ProteinFloor,
} from "@/app/(app)/dashboard/macro-budget";
import { Slab } from "@/components/page-header";
import { LinkPending } from "@/components/pending-nav";
import { addDays, formatLongDate, isIsoDate, todayInTimeZone } from "@/lib/dates";
import { getDiaryDay } from "@/lib/diary";
import { getPersonalLibrary } from "@/lib/food/library";
import { estimatedShare } from "@/lib/nutrition/confidence";
import { hasGeminiKey } from "@/lib/env.server";
import { getAccountSetup } from "@/lib/profile";
import { getOrCreateDailyTarget } from "@/lib/targets";

export const metadata: Metadata = { title: "Nutrition · CalDef" };

const DAY_NAV_CLASS =
  "flex size-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20";

export default async function DiaryPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; add?: string }>;
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

  // Every adding form starts on the first meal it is given. So the meal
  // that was asked for — "Log dinner" on Today sends `?add=<its id>` — or
  // otherwise the first meal of the day with nothing in it, is handed over
  // first. Nothing is logged to breakfast by default at eight in the
  // evening.
  const askedMeal = day.mealTypes.find((meal) => String(meal.id) === query.add);
  const nextMeal =
    askedMeal ??
    day.mealTypes.find((meal) => !day.entries.some((e) => e.meal_type_id === meal.id));
  const mealsForAdding = nextMeal
    ? [nextMeal, ...day.mealTypes.filter((meal) => meal.id !== nextMeal.id)]
    : day.mealTypes;

  const entriesByMeal = new Map(
    day.mealTypes.map((meal) => [
      meal.id,
      day.entries.filter((e) => e.meal_type_id === meal.id),
    ]),
  );

  return (
    <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-8">
      <div className="lg:sticky lg:top-0 lg:col-span-5">
        <Slab>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="display text-3xl">Nutrition</h1>
              <p className="eyebrow mt-1">
                {date === today ? `Today · ${formatLongDate(date)}` : formatLongDate(date)}
              </p>
            </div>
            <nav aria-label="Day" className="flex items-center gap-1.5">
              {date !== today ? (
                <Link
                  href="/diary"
                  className="flex h-10 items-center rounded-full bg-white/10 px-3.5 text-sm font-semibold hover:bg-white/20"
                >
                  <LinkPending>Today</LinkPending>
                </Link>
              ) : null}
              <Link
                href={`/diary?date=${addDays(date, -1)}`}
                className={DAY_NAV_CLASS}
                aria-label="Previous day"
              >
                <LinkPending spinnerClassName="size-5">
                  <ChevronLeft className="size-5" aria-hidden />
                </LinkPending>
              </Link>
              {date < today ? (
                <Link
                  href={`/diary?date=${addDays(date, 1)}`}
                  className={DAY_NAV_CLASS}
                  aria-label="Next day"
                >
                  <LinkPending spinnerClassName="size-5">
                    <ChevronRight className="size-5" aria-hidden />
                  </LinkPending>
                </Link>
              ) : (
                // Today is the last day there is: shown, so the two arrows
                // do not jump, and plainly not a control.
                <span
                  aria-hidden
                  className="flex size-10 items-center justify-center rounded-full opacity-30"
                >
                  <ChevronRight className="size-5" />
                </span>
              )}
            </nav>
          </div>

          {target ? (
            <>
              <div className="mt-5">
                <CalorieBudget
                  consumed={consumed.kcal}
                  target={target.macros.kcal}
                  label={target.label}
                  day={date === today ? "today" : "that day"}
                  compact
                />
              </div>
              <dl className="border-slab-line mt-6 grid grid-cols-3 gap-4 border-t pt-5">
                <ProteinFloor consumed={consumed.protein_g} target={target.macros.protein_g} />
                <MacroRemainder
                  carbs={{ consumed: consumed.carbs_g, target: target.macros.carbs_g }}
                  fat={{ consumed: consumed.fat_g, target: target.macros.fat_g }}
                />
              </dl>
              <div className="text-slab-muted mt-4 space-y-1 text-xs">
                {target.detail ? <p>{target.detail.explanation}</p> : null}
                {uncertainShare !== null && uncertainShare > 0 ? (
                  <p>
                    About {Math.max(1, Math.round(uncertainShare * 100))}% of this
                    day&rsquo;s calories are estimates.
                  </p>
                ) : null}
                {target.fellBackFromPhase ? (
                  <p>
                    Your cut phase has ended, so this is your everyday target
                    again. The number changed because the phase is no longer
                    setting it.
                  </p>
                ) : null}
              </div>
            </>
          ) : (
            <div className="mt-5 space-y-1">
              <p className="display text-3xl">No target yet</p>
              <p className="text-slab-muted text-sm">
                Add your profile and a weigh-in to get a target.
              </p>
            </div>
          )}
        </Slab>
      </div>

      <div className="mt-4 space-y-6 lg:col-span-7 lg:mt-10">
        <AddFoodPanel defaultOpen={query.add !== undefined}>
          <AddFood
            logDate={date}
            mealTypes={mealsForAdding}
            aiReady={aiReady}
            library={library}
          />
        </AddFoodPanel>

        {day.mealTypes.map((meal) => {
          const entries = entriesByMeal.get(meal.id) ?? [];
          const previous = previousDay.entries.filter(
            (e) => e.meal_type_id === meal.id,
          );
          const mealKcal = entries.reduce((sum, e) => sum + e.kcal, 0);

          return (
            <section key={meal.id} aria-labelledby={`meal-${meal.id}`}>
              <div className="flex items-baseline justify-between gap-3 px-1">
                <h2 id={`meal-${meal.id}`} className="display text-2xl">
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
              </div>
              {entries.length > 0 ? (
                <ul className="bg-card mt-2 divide-y rounded-2xl px-4">
                  {entries.map((entry) => (
                    <EntryRow
                      key={entry.id}
                      entry={entry}
                      aiEnabled={aiReady}
                      mealTypes={day.mealTypes}
                      today={today}
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
          CalDef provides estimates for personal tracking. It is not medical or
          dietary advice.
        </p>
      </div>
    </div>
  );
}
