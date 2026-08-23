import type { Metadata } from "next";

import { stopPhase } from "@/app/(app)/phase/actions";
import { StartPhaseForm } from "@/app/(app)/phase/start-form";
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
