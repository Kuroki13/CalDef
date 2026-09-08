import type { Metadata } from "next";
import Link from "next/link";

import {
  CalorieBudget,
  MacroRemainder,
  ProteinFloor,
} from "@/app/(app)/dashboard/macro-budget";
import { TrendChart } from "@/components/trend-chart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { todayInTimeZone } from "@/lib/dates";
import { getDiaryDay } from "@/lib/diary";
import { describePortion } from "@/lib/nutrition/units";
import { getActivePhase, phaseCoversDate } from "@/lib/phase";
import { getPhaseDashboard } from "@/lib/phase-dashboard";
import { getAccountSetup } from "@/lib/profile";
import { getOrCreateDailyTarget } from "@/lib/targets";
import { formatMass, kgToDisplay, massUnitLabel } from "@/lib/units";
import { getWeightHistory } from "@/lib/weight";

export const metadata: Metadata = { title: "Dashboard · CalDef" };

/**
 * The screen worth opening.
 *
 * It used to lead with the weigh-in and the profile figures — true, static,
 * and not what anyone opens an app to find out. The question at eleven in
 * the morning is "what is left of today", so that is what is at the top,
 * and everything else is ordered by how often it changes the next decision:
 * what has been eaten, where the weight is going, and — when one is running
 * — where the phase stands.
 *
 * Height, age and activity have gone. They are settings, they change twice
 * a year, and they were taking the third of the screen a phone shows first.
 * Settings still holds them.
 */
export default async function DashboardPage() {
  const { profile, goal, latestWeightKg } = await getAccountSetup();
  // The layout guarantees setup is complete before this renders.
  if (!profile || !goal || latestWeightKg === null) return null;

  const units = profile.unit_system;
  const today = todayInTimeZone(profile.timezone);

  const [target, day, weight, active] = await Promise.all([
    getOrCreateDailyTarget(today),
    getDiaryDay(today),
    getWeightHistory(profile.timezone),
    getActivePhase(today),
  ]);

  // The phase panel needs the weight history the card below already loaded,
  // so it is built after the fan-out rather than inside it.
  const phase =
    active && phaseCoversDate(active.phase, today)
      ? await getPhaseDashboard(active, weight, today)
      : null;

  const consumed = day.totals.totals;
  const goalWeightKg = goal.final_goal_weight_kg;
  const toGoKg = goalWeightKg === null ? null : latestWeightKg - goalWeightKg;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {profile.display_name ? `Hi, ${profile.display_name}` : "Today"}
        </h1>
        <p className="text-muted-foreground text-sm">{today}</p>
      </header>

      {/*
        The lead. Which régime is governing is named here exactly as the
        diary names it — "2-Month Cut target" or "Daily target" — so the
        number is never ambiguous about where it came from.
      */}
      <Card>
        <CardHeader>
          <CardTitle>{target ? target.label : "No target yet"}</CardTitle>
          <CardDescription>
            {target
              ? "What is left of today."
              : "Record a weigh-in and your goal to get a target."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {target ? (
            <>
              <CalorieBudget
                consumed={consumed.kcal}
                target={target.macros.kcal}
                label={`${target.label} · ${Math.round(target.macros.kcal)} kcal`}
              />
              <ProteinFloor
                consumed={consumed.protein_g}
                target={target.macros.protein_g}
              />
              <MacroRemainder
                carbs={{
                  consumed: consumed.carbs_g,
                  target: target.macros.carbs_g,
                }}
                fat={{ consumed: consumed.fat_g, target: target.macros.fat_g }}
              />
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Today&rsquo;s food</CardTitle>
          <CardDescription>
            {day.entries.length === 0
              ? "Nothing logged yet."
              : `${day.entries.length} ${day.entries.length === 1 ? "entry" : "entries"} · ${Math.round(consumed.kcal)} kcal`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {day.entries.length > 0 ? (
            <ul className="divide-y">
              {day.entries.slice(0, 6).map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-baseline justify-between gap-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">{entry.foodName}</p>
                    <p className="text-muted-foreground truncate text-xs">
                      {describePortion(
                        entry.amount,
                        entry.unit,
                        entry.servingLabel,
                      )}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm tabular-nums">
                    {Math.round(entry.kcal)} kcal
                  </p>
                </li>
              ))}
            </ul>
          ) : null}

          <Link
            href="/diary"
            className="text-sm font-medium underline underline-offset-4"
          >
            {day.entries.length > 6
              ? `Open the diary — ${day.entries.length - 6} more`
              : "Open the diary"}
          </Link>
        </CardContent>
      </Card>

      {/* Only while a phase is running: outside one it is noise. */}
      {phase ? (
        <Card>
          <CardHeader>
            <CardTitle>
              Day {phase.dayNumber} of {phase.totalDays}
            </CardTitle>
            <CardDescription>{phase.projectionNote}</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Stat
                label="Trend now"
                value={
                  phase.currentTrendKg === null
                    ? "—"
                    : formatMass(phase.currentTrendKg, units)
                }
              />
              <Stat
                label="Projected"
                value={
                  phase.projectedEndWeightKg === null
                    ? "—"
                    : formatMass(phase.projectedEndWeightKg, units)
                }
              />
              <Stat
                label="Recommended"
                value={
                  phase.recommendedLowKg === null ||
                  phase.recommendedHighKg === null
                    ? "—"
                    : `${kgToDisplay(phase.recommendedLowKg, units).toFixed(1)}–${kgToDisplay(
                        phase.recommendedHighKg,
                        units,
                      ).toFixed(1)} ${massUnitLabel(units)}`
                }
              />
            </dl>
            <p className="mt-3">
              <Link
                href="/phase"
                className="text-sm font-medium underline underline-offset-4"
              >
                Open the phase
              </Link>
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Weight</CardTitle>
          <CardDescription>
            {weight.latestKg === null
              ? "No weigh-in recorded yet."
              : `${formatMass(weight.latestKg, units)} latest · trend ${
                  weight.latestTrendKg === null
                    ? "—"
                    : formatMass(weight.latestTrendKg, units)
                }`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <TrendChart
            points={weight.trend}
            unitLabel={massUnitLabel(units)}
            toDisplay={(kg) => kgToDisplay(kg, units)}
            height={140}
          />
          <dl className="grid grid-cols-3 gap-4">
            <Stat label="Current" value={formatMass(latestWeightKg, units)} />
            <Stat
              label="Final goal"
              value={
                goalWeightKg === null ? "Not set" : formatMass(goalWeightKg, units)
              }
            />
            <Stat
              label="To go"
              value={
                toGoKg === null
                  ? "—"
                  : `${kgToDisplay(Math.abs(toGoKg), units).toFixed(1)} ${massUnitLabel(units)}`
              }
            />
          </dl>
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs">
        CalDef provides estimates for personal tracking. It is not medical or
        dietary advice.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-lg font-medium tabular-nums">{value}</dd>
    </div>
  );
}
