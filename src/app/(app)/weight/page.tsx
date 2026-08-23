import type { Metadata } from "next";

import { deleteWeighIn } from "@/app/(app)/weight/actions";
import { WeighInForm } from "@/app/(app)/weight/weigh-in-form";
import { TrendChart } from "@/components/trend-chart";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { todayInTimeZone } from "@/lib/dates";
import { getExpenditure } from "@/lib/expenditure";
import { getAccountSetup } from "@/lib/profile";
import { describeEstimate } from "@/lib/tdee/adaptive";
import { formatMass, kgToDisplay, massUnitLabel } from "@/lib/units";
import { getRecentWeighIns, getWeightHistory } from "@/lib/weight";

export const metadata: Metadata = { title: "Weight · CalDef" };

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-lg font-medium tabular-nums">{value}</dd>
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

export default async function WeightPage() {
  const { profile } = await getAccountSetup();
  // The layout guarantees setup is complete before this renders.
  if (!profile) return null;

  const units = profile.unit_system;
  const today = todayInTimeZone(profile.timezone);

  const [history, recent, expenditure] = await Promise.all([
    getWeightHistory(profile.timezone),
    getRecentWeighIns(),
    getExpenditure(today),
  ]);

  const ratePerWeek = history.changeKgPerWeek;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Weight</h1>
        <p className="text-muted-foreground text-sm">
          Weigh in daily if you can. The trend matters, not any single day.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Trend</CardTitle>
          <CardDescription>
            {history.entries.length === 0
              ? "No weigh-ins recorded yet."
              : `${history.entries.length} weigh-in${history.entries.length === 1 ? "" : "s"} recorded.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat
              label="Latest reading"
              value={
                history.latestKg === null
                  ? "—"
                  : formatMass(history.latestKg, units)
              }
            />
            <Stat
              label="Trend weight"
              value={
                history.latestTrendKg === null
                  ? "—"
                  : formatMass(history.latestTrendKg, units)
              }
              hint="What decisions use"
            />
            <Stat
              label="Rate"
              value={
                ratePerWeek === null
                  ? "—"
                  : `${ratePerWeek > 0 ? "+" : ""}${kgToDisplay(ratePerWeek, units).toFixed(2)} ${massUnitLabel(units)}/wk`
              }
              hint="Last 28 days"
            />
          </dl>

          <TrendChart
            points={history.trend}
            unitLabel={massUnitLabel(units)}
            toDisplay={(kg) => kgToDisplay(kg, units)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Record a weigh-in</CardTitle>
          <CardDescription>
            Weighing at the same time of day, before eating, gives the
            cleanest signal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WeighInForm
            today={today}
            unitLabel={massUnitLabel(units)}
            defaultWeight={
              history.latestKg === null
                ? null
                : Number(kgToDisplay(history.latestKg, units).toFixed(1))
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Expenditure</CardTitle>
          <CardDescription>
            What your intake and trend suggest you actually burn.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {expenditure ? (
            <div className="space-y-3">
              <dl className="grid grid-cols-2 gap-4">
                <Stat
                  label="In use"
                  value={`${Math.round(expenditure.tdeeKcal)} kcal`}
                  hint={
                    expenditure.estimate.method === "adaptive"
                      ? `Adaptive · ${expenditure.estimate.confidence} confidence`
                      : "Starting estimate"
                  }
                />
                <Stat
                  label="Observed"
                  value={
                    expenditure.estimate.observedTdeeKcal === null
                      ? "—"
                      : `${Math.round(expenditure.estimate.observedTdeeKcal)} kcal`
                  }
                  hint="Before smoothing"
                />
              </dl>
              <p className="text-muted-foreground text-sm">
                {describeEstimate(
                  expenditure.estimate,
                  expenditure.formulaTdeeKcal,
                )}
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              Add your profile and a weigh-in to see an estimate.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nothing recorded yet.
            </p>
          ) : (
            <ul className="divide-y">
              {recent.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium tabular-nums">
                      {formatMass(entry.weight_kg, units)}
                    </p>
                    <p className="text-muted-foreground truncate text-xs">
                      {entry.entry_date}
                      {entry.note ? ` · ${entry.note}` : ""}
                    </p>
                  </div>
                  <form action={deleteWeighIn}>
                    <input type="hidden" name="entryId" value={entry.id} />
                    <Button
                      type="submit"
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove weigh-in for ${entry.entry_date}`}
                    >
                      Remove
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs">
        CalDef provides estimates for personal tracking. It is not medical or
        dietary advice.
      </p>
    </div>
  );
}
