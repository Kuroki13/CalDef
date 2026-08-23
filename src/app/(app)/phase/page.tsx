import type { Metadata } from "next";

import { stopPhase } from "@/app/(app)/phase/actions";
import { StartPhaseForm } from "@/app/(app)/phase/start-form";
import { PhaseChart } from "@/components/phase-chart";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { todayInTimeZone } from "@/lib/dates";
import { getActivePhase } from "@/lib/phase";
import { getPhaseDashboard } from "@/lib/phase-dashboard";
import { getAccountSetup } from "@/lib/profile";
import { buildPhaseSeries, dayIndexFor } from "@/lib/tdee/phase-series";
import { formatMass, kgToDisplay, massUnitLabel } from "@/lib/units";
import { getWeightHistory } from "@/lib/weight";

export const metadata: Metadata = { title: "Phase · CalDef" };

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-lg font-medium tabular-nums">{value}</dd>
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

export default async function PhasePage() {
  const { profile, goal } = await getAccountSetup();
  // The layout guarantees setup is complete before this renders.
  if (!profile || !goal) return null;

  const units = profile.unit_system;
  const unitLabel = massUnitLabel(units);
  const today = todayInTimeZone(profile.timezone);

  const [active, history] = await Promise.all([
    getActivePhase(today),
    getWeightHistory(profile.timezone),
  ]);

  if (!active) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">2-Month Cut</h1>
          <p className="text-muted-foreground text-sm">
            A bounded eight-week phase with its own target, adjusted weekly
            from what you actually eat and weigh.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Start a phase</CardTitle>
            <CardDescription>
              While a phase runs it sets your calorie target. Your everyday
              target takes over again when it ends.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StartPhaseForm
              unitLabel={unitLabel}
              suggestedStretch={
                goal.final_goal_weight_kg === null
                  ? null
                  : Number(
                      kgToDisplay(
                        Number(goal.final_goal_weight_kg),
                        units,
                      ).toFixed(1),
                    )
              }
            />
          </CardContent>
        </Card>

        <p className="text-muted-foreground text-xs">
          CalDef provides estimates for personal tracking. It is not medical or
          dietary advice.
        </p>
      </div>
    );
  }

  const dash = await getPhaseDashboard(active, history, today);
  const showMass = (kg: number | null) =>
    kg === null ? "—" : formatMass(kg, units);

  // The rate the roadmap was drawn at. Derived from the stored milestones so
  // the graph and the table cannot disagree about the trajectory.
  const recommendedKgPerWeek =
    active.milestones.length >= 2
      ? active.milestones[0].recommendedWeightKg -
        active.milestones[1].recommendedWeightKg
      : 0;

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {active.phase.name}
          </h1>
          <p className="text-muted-foreground text-sm">
            Day {dash.dayNumber} of {dash.totalDays} ·{" "}
            {dash.daysRemaining} days left
          </p>
        </div>
        <form action={stopPhase}>
          <Button type="submit" variant="outline" size="sm">
            {active.hasElapsed ? "Finish phase" : "End early"}
          </Button>
        </form>
      </header>

      {active.hasElapsed ? (
        <PhaseNotice>
          This phase has run its full {dash.totalDays} days. Finish it to go
          back to your everyday target, or start a new phase.
        </PhaseNotice>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Progress</CardTitle>
          <CardDescription>
            {Math.round(dash.fractionComplete * 100)}% complete
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Progress value={dash.fractionComplete * 100} />
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Started at" value={showMass(dash.startWeightKg)} />
            <Stat
              label="Trend now"
              value={showMass(dash.currentTrendKg)}
              hint="What decisions use"
            />
            <Stat
              label="Lost so far"
              value={
                dash.lostKg === null
                  ? "—"
                  : `${kgToDisplay(dash.lostKg, units).toFixed(1)} ${unitLabel}`
              }
            />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Where this is heading</CardTitle>
          <CardDescription>
            The recommended range is what a sustainable rate produces. The
            stretch target is aspirational and never sets your calories.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat
              label="Recommended"
              value={
                dash.recommendedLowKg === null || dash.recommendedHighKg === null
                  ? "—"
                  : `${kgToDisplay(dash.recommendedLowKg, units).toFixed(1)}–${kgToDisplay(dash.recommendedHighKg, units).toFixed(1)} ${unitLabel}`
              }
            />
            <Stat label="Projected" value={showMass(dash.projectedEndWeightKg)} />
            <Stat label="Stretch" value={showMass(dash.stretchTargetKg)} />
            <Stat label="Final goal" value={showMass(dash.finalGoalWeightKg)} />
          </dl>
          <p className="text-muted-foreground text-sm">{dash.projectionNote}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Progress graph</CardTitle>
          <CardDescription>
            Day 1 to day {dash.totalDays}. The bold line is the smoothed
            trend, which is what every decision uses.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PhaseChart
            points={buildPhaseSeries({
              startDate: active.phase.start_date,
              durationDays: active.phase.duration_days,
              startWeightKg: Number(active.phase.start_weight_kg),
              recommendedKgPerWeek: recommendedKgPerWeek,
              stretchTargetKg: dash.stretchTargetKg,
              trend: history.trend,
            })}
            finalGoalKg={dash.finalGoalWeightKg}
            unitLabel={unitLabel}
            toDisplay={(kg) => kgToDisplay(kg, units)}
            todayIndex={dayIndexFor(
              active.phase.start_date,
              active.phase.duration_days,
              today,
            )}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Weekly milestones</CardTitle>
          <CardDescription>
            Estimates, not obligations. They are recomputed from your real
            trend rather than being a fixed ladder.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-left">
                  <th className="py-2 pr-4 font-normal">Week</th>
                  <th className="py-2 pr-4 font-normal">Date</th>
                  <th className="py-2 pr-4 font-normal">Recommended</th>
                  <th className="py-2 pr-4 font-normal">Stretch</th>
                  <th className="py-2 font-normal">Actual trend</th>
                </tr>
              </thead>
              <tbody>
                {active.milestones.map((m) => (
                  <tr
                    key={m.weekNumber}
                    className={
                      m.date <= today ? "border-t" : "text-muted-foreground border-t"
                    }
                  >
                    <td className="py-2 pr-4 tabular-nums">{m.weekNumber}</td>
                    <td className="py-2 pr-4 tabular-nums">{m.date}</td>
                    <td className="py-2 pr-4 tabular-nums">
                      {showMass(m.recommendedWeightKg)}
                    </td>
                    <td className="py-2 pr-4 tabular-nums">
                      {showMass(m.stretchWeightKg)}
                    </td>
                    <td className="py-2 tabular-nums">
                      {m.actualTrendWeightKg === null
                        ? m.date <= today
                          ? "—"
                          : ""
                        : showMass(m.actualTrendWeightKg)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How the phase is going</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat
              label="Average intake"
              value={`${Math.round(dash.meanIntakeKcal)} kcal`}
            />
            <Stat
              label="Average protein"
              value={`${Math.round(dash.meanProteinG)} g`}
            />
            <Stat
              label="Days logged"
              value={`${dash.loggedDays} of ${dash.dayNumber}`}
              hint={`${dash.adherencePct}% adherence`}
            />
            <Stat
              label="Weekly change"
              value={
                dash.trendKgPerWeek === null
                  ? "—"
                  : `${dash.trendKgPerWeek > 0 ? "+" : ""}${kgToDisplay(dash.trendKgPerWeek, units).toFixed(2)} ${unitLabel}`
              }
            />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{dash.report.headline}</CardTitle>
          <CardDescription>
            Checkpoints at days{" "}
            {dash.checkpoints.map((c) => c.day).join(", ")}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ol className="flex flex-wrap gap-2 text-xs">
            {dash.checkpoints.map((c) => (
              <li
                key={c.day}
                className={
                  c.reached
                    ? "bg-accent text-accent-foreground rounded-md px-2 py-1"
                    : "text-muted-foreground rounded-md border px-2 py-1"
                }
              >
                Day {c.day}
                {c.kind === "halfway" ? " · halfway" : ""}
                {c.kind === "final" ? " · final" : ""}
              </li>
            ))}
          </ol>

          <div className="space-y-2 text-sm">
            {dash.report.body.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>

          {dash.report.percentBodyweightLost !== null &&
          dash.report.kind === "final" ? (
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Stat
                label="Bodyweight lost"
                value={`${dash.report.percentBodyweightLost}%`}
              />
              <Stat
                label="Average weekly"
                value={
                  dash.report.averageWeeklyLossKg === null
                    ? "—"
                    : `${Math.abs(kgToDisplay(dash.report.averageWeeklyLossKg, units)).toFixed(2)} ${unitLabel}`
                }
              />
              <Stat
                label="Best logging run"
                value={`${dash.bestStreakDays} days`}
              />
            </dl>
          ) : null}
        </CardContent>
      </Card>

      {dash.phaseTwo ? (
        <Card>
          <CardHeader>
            <CardTitle>What comes next</CardTitle>
            <CardDescription>
              A proposal, not a commitment. Nothing starts until you start it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">{dash.phaseTwo.explanation}</p>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Stat
                label="Suggested length"
                value={`${dash.phaseTwo.durationDays} days`}
              />
              <Stat
                label="Would reach"
                value={showMass(dash.phaseTwo.projectedEndWeightKg)}
              />
              <Stat
                label="Long-term goal"
                value={showMass(dash.phaseTwo.finalGoalWeightKg)}
              />
            </dl>
            <p className="text-muted-foreground text-xs">
              Finish this phase first — the next one is planned from where this
              one actually ended, not from where it was projected to.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <p className="text-muted-foreground text-xs">
        CalDef provides estimates for personal tracking. It is not medical or
        dietary advice.
      </p>
    </div>
  );
}

function PhaseNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted rounded-md px-4 py-3 text-sm">{children}</div>
  );
}
