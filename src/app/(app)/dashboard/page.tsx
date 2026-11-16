import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

import {
  CalorieBudget,
  MacroRemainder,
  ProteinFloor,
} from "@/app/(app)/dashboard/macro-budget";
import { PageHeader, Stat } from "@/components/page-header";
import { TrendChart } from "@/components/trend-chart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatLongDate, todayInTimeZone } from "@/lib/dates";
import { getDiaryDay } from "@/lib/diary";
import { describePortion } from "@/lib/nutrition/units";
import { getActivePhase, phaseCoversDate } from "@/lib/phase";
import { getPhaseDashboard } from "@/lib/phase-dashboard";
import { getAccountSetup } from "@/lib/profile";
import { getOrCreateDailyTarget } from "@/lib/targets";
import {
  getActiveSessionSummary,
  listCompletedSessions,
} from "@/lib/training/store";
import { dayOf, summaryLine } from "@/lib/training/view";
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

  const [target, day, weight, active, runningSession, lastSessions] =
    await Promise.all([
      getOrCreateDailyTarget(today),
      getDiaryDay(today),
      getWeightHistory(profile.timezone),
      getActivePhase(today),
      // Training is shown next to food, never mixed into it: a session does
      // not change the calorie target, and no "calories burned" figure is
      // estimated (spec §16.7).
      getActiveSessionSummary(),
      listCompletedSessions(1),
    ]);
  const lastSession = lastSessions[0] ?? null;

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
      <PageHeader
        eyebrow={formatLongDate(today)}
        title={profile.display_name ? `Hi, ${profile.display_name}` : "Today"}
      />

      {/*
        The lead. Which régime is governing is named here exactly as the
        diary names it — "2-Month Cut target" or "Daily target" — so the
        number is never ambiguous about where it came from.
      */}
      <Card>
        {target ? null : (
          <CardHeader>
            <CardTitle>No target yet</CardTitle>
            <CardDescription>
              Record a weigh-in and your goal to get a target.
            </CardDescription>
          </CardHeader>
        )}
        <CardContent className="space-y-5">
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
                  className="flex items-baseline justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{entry.foodName}</p>
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

          <Link href="/diary" className={LINK_CLASS}>
            {day.entries.length > 6
              ? `Open the diary — ${day.entries.length - 6} more`
              : day.entries.length === 0
                ? "Log your first food"
                : "Open the diary"}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Training</CardTitle>
          <CardDescription>
            {runningSession
              ? `${runningSession.name} is in progress.`
              : lastSession
                ? `Last: ${lastSession.name} · ${dayOf(lastSession.startedAt, profile.timezone)}`
                : "No session logged yet."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {!runningSession && lastSession ? (
            <p className="text-muted-foreground text-sm">
              {summaryLine(lastSession, units)}
            </p>
          ) : null}
          <Link
            href={runningSession ? "/training/session" : "/training"}
            className={LINK_CLASS}
          >
            {runningSession
              ? "Resume session"
              : lastSession
                ? "Open training"
                : "Start training"}
            <ArrowRight className="size-4" aria-hidden />
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
              <Link href="/phase" className={LINK_CLASS}>
                Open the phase
                <ArrowRight className="size-4" aria-hidden />
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

/** A text link that is still a comfortable thing to tap. */
const LINK_CLASS =
  "text-primary -mx-1 inline-flex min-h-10 items-center gap-1 rounded-md px-1 text-sm font-semibold";
