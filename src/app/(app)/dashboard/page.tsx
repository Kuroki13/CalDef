import { ArrowRight, Plus, Scale } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import {
  CalorieBudget,
  MacroRemainder,
  ProteinFloor,
} from "@/app/(app)/dashboard/macro-budget";
import { Slab } from "@/components/page-header";
import { Sparkline } from "@/components/sparkline";
import { StartWorkoutButton } from "@/components/training/start-button";
import { Button } from "@/components/ui/button";
import { formatLongDate, todayInTimeZone } from "@/lib/dates";
import { getDiaryDay } from "@/lib/diary";
import { getActivePhase, phaseCoversDate } from "@/lib/phase";
import { getPhaseDashboard } from "@/lib/phase-dashboard";
import { getAccountSetup } from "@/lib/profile";
import { getOrCreateDailyTarget } from "@/lib/targets";
import { getTrainingToday } from "@/lib/training/today";
import { dayOf, summaryLine } from "@/lib/training/view";
import { formatMass, kgToDisplay, massUnitLabel } from "@/lib/units";
import { getWeightHistory } from "@/lib/weight";

export const metadata: Metadata = { title: "Today · CalDef" };

/**
 * The screen worth opening. It answers three questions, in this order:
 *
 *   Where am I today?        the slab: what is left, and the macros
 *   What do I do next?       one volt action — the next meal to log
 *   Is there a session?      in progress, planned today, or the last one
 *
 * It does not repeat the other screens. The diary's list of foods, the
 * weigh-in history and the phase's roadmap each live where they are worked
 * on; here they are a figure and a way in.
 */
export default async function DashboardPage() {
  const { profile, goal, latestWeightKg } = await getAccountSetup();
  // The layout guarantees setup is complete before this renders.
  if (!profile || !goal || latestWeightKg === null) return null;

  const units = profile.unit_system;
  const today = todayInTimeZone(profile.timezone);

  const [target, day, weight, active, training] = await Promise.all([
    getOrCreateDailyTarget(today),
    getDiaryDay(today),
    getWeightHistory(profile.timezone),
    getActivePhase(today),
    // Training is shown next to food, never mixed into it: a session does
    // not change the calorie target, and no "calories burned" figure is
    // estimated (spec §16.7).
    getTrainingToday(today, profile.timezone),
  ]);

  const phase =
    active && phaseCoversDate(active.phase, today)
      ? await getPhaseDashboard(active, weight, today)
      : null;

  const consumed = day.totals.totals;
  const goalWeightKg = goal.final_goal_weight_kg;
  const toGoKg = goalWeightKg === null ? null : latestWeightKg - goalWeightKg;

  // The next action: the first meal of the day with nothing in it.
  const emptyMeal = day.mealTypes.find(
    (meal) => !day.entries.some((entry) => entry.meal_type_id === meal.id),
  );
  const weighedToday = weight.entries.at(-1)?.entry_date === today;

  return (
    <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-8">
      <Slab className="lg:col-span-7">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="eyebrow">
            {formatLongDate(today)}
            {profile.display_name ? ` · ${profile.display_name}` : ""}
          </h1>
        </div>
        {target ? (
          <>
            <div className="mt-4">
              <CalorieBudget
                consumed={consumed.kcal}
                target={target.macros.kcal}
                label={target.label}
              />
            </div>
            <dl className="border-slab-line mt-6 grid grid-cols-3 gap-4 border-t pt-5">
              <ProteinFloor
                consumed={consumed.protein_g}
                target={target.macros.protein_g}
              />
              <MacroRemainder
                carbs={{ consumed: consumed.carbs_g, target: target.macros.carbs_g }}
                fat={{ consumed: consumed.fat_g, target: target.macros.fat_g }}
              />
            </dl>
          </>
        ) : (
          <div className="mt-4 space-y-1">
            <p className="display text-4xl">No target yet</p>
            <p className="text-slab-muted text-sm">
              Record a weigh-in and your goal to get a daily target.
            </p>
          </div>
        )}
      </Slab>

      <div className="mt-4 space-y-3 lg:col-span-5 lg:mt-10">
        {/* The one volt action of the screen. */}
        <Link
          href={emptyMeal ? `/diary?add=${emptyMeal.id}` : "/diary?add=1"}
          className="bg-volt text-volt-foreground flex min-h-[4.5rem] items-center gap-3 rounded-2xl px-5"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-lg leading-tight font-bold">
              {emptyMeal ? `Log ${emptyMeal.name.toLowerCase()}` : "Add food"}
            </span>
            <span className="block text-sm opacity-75">
              {day.entries.length === 0
                ? "Nothing logged today yet"
                : emptyMeal
                  ? `${day.entries.length} ${day.entries.length === 1 ? "entry" : "entries"} so far today`
                  : "Every meal has something in it"}
            </span>
          </span>
          <Plus className="size-6 shrink-0" aria-hidden />
        </Link>

        {weighedToday ? null : (
          <Link
            href="/weight"
            className="bg-card flex min-h-14 items-center gap-3 rounded-2xl px-5"
          >
            <Scale className="text-muted-foreground size-5 shrink-0" aria-hidden />
            <span className="flex-1 text-sm font-semibold">Weigh in today</span>
            <ArrowRight className="text-muted-foreground size-4" aria-hidden />
          </Link>
        )}

        <section aria-labelledby="today-training" className="bg-card rounded-2xl p-5">
          <h2 id="today-training" className="eyebrow">
            {training.running
              ? "Training · in progress"
              : training.planned
                ? "Training · planned today"
                : "Training"}
          </h2>
          {training.running ? (
            // The session bar at the bottom of every screen is the way
            // back in; saying it twice here would be two buttons for one
            // thing.
            <p className="display mt-2 truncate text-3xl">{training.running.name}</p>
          ) : training.planned ? (
            <div className="mt-2 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="display truncate text-3xl">{training.planned.name}</p>
                <p className="text-muted-foreground text-sm">{training.planned.detail}</p>
              </div>
              <StartWorkoutButton
                templateId={training.planned.templateId}
                scheduleId={training.planned.id}
                className="rounded-full px-5"
              >
                Start
              </StartWorkoutButton>
            </div>
          ) : (
            <div className="mt-2 flex items-center gap-3">
              <p className="min-w-0 flex-1 text-sm">
                {training.last
                  ? "Nothing planned today."
                  : "No session logged yet."}
              </p>
              <Button asChild variant="outline" className="rounded-full px-5">
                <Link href="/training">
                  {training.last ? "Choose a workout" : "Start training"}
                </Link>
              </Button>
            </div>
          )}
          {training.last ? (
            <p className="text-muted-foreground mt-4 border-t pt-3 text-sm">
              Last · {training.last.name},{" "}
              {dayOf(training.last.startedAt, profile.timezone)} ·{" "}
              {summaryLine(training.last, units)}
            </p>
          ) : null}
        </section>

        <Link
          href="/weight"
          aria-label="Weight trend — open progress"
          className="bg-card grid grid-cols-[auto_1fr] items-center gap-5 rounded-2xl p-5"
        >
          <div>
            <p className="eyebrow">Weight trend</p>
            <p className="mt-1">
              <span className="figure text-5xl">
                {weight.latestTrendKg === null
                  ? "—"
                  : kgToDisplay(weight.latestTrendKg, units).toFixed(1)}
              </span>
              <span className="text-muted-foreground text-sm"> {massUnitLabel(units)}</span>
            </p>
            <p className="text-muted-foreground mt-1 text-sm tabular-nums">
              {weight.changeKgPerWeek === null
                ? "Rate after more weigh-ins"
                : `${weight.changeKgPerWeek > 0 ? "+" : ""}${kgToDisplay(weight.changeKgPerWeek, units).toFixed(2)} ${massUnitLabel(units)}/wk`}
              {toGoKg === null
                ? ""
                : ` · ${kgToDisplay(Math.abs(toGoKg), units).toFixed(1)} ${massUnitLabel(units)} to goal`}
            </p>
          </div>
          <Sparkline
            values={weight.trend.map((point) => point.trendKg)}
            label="Weight trend over time"
          />
        </Link>

        {/* Only while a phase is running: outside one it is noise. */}
        {phase ? (
          <Link href="/phase" className="bg-card block rounded-2xl p-5">
            <p className="eyebrow">
              Cut phase · day {phase.dayNumber} of {phase.totalDays}
            </p>
            <p className="mt-1 text-sm">{phase.projectionNote}</p>
            <p className="text-muted-foreground mt-2 text-sm tabular-nums">
              Trend{" "}
              {phase.currentTrendKg === null ? "—" : formatMass(phase.currentTrendKg, units)}
              {" · "}projected{" "}
              {phase.projectedEndWeightKg === null
                ? "—"
                : formatMass(phase.projectedEndWeightKg, units)}
            </p>
          </Link>
        ) : null}

        <p className="text-muted-foreground px-1 pt-2 text-xs">
          CalDef provides estimates for personal tracking. It is not medical or
          dietary advice.
        </p>
      </div>
    </div>
  );
}
