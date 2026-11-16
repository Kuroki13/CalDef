import type { Metadata } from "next";

import { deleteWeighIn } from "@/app/(app)/weight/actions";
import { WeighInForm } from "@/app/(app)/weight/weigh-in-form";
import { SectionTitle, Slab, Stat } from "@/components/page-header";
import { FrequencyBars } from "@/components/training/frequency-bars";
import { TrendChart } from "@/components/trend-chart";
import { PendingButton } from "@/components/pending-button";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { addDays, formatLongDate, startOfIsoWeek, todayInTimeZone } from "@/lib/dates";
import { weeklyFrequency } from "@/lib/training/calendar";
import { listCompletedSessions, listSessionStarts } from "@/lib/training/store";
import { getExpenditure } from "@/lib/expenditure";
import { getAccountSetup } from "@/lib/profile";
import { describeEstimate } from "@/lib/tdee/adaptive";
import { formatMass, kgToDisplay, massUnitLabel } from "@/lib/units";
import { getRecentWeighIns, getWeightHistory } from "@/lib/weight";

export const metadata: Metadata = { title: "Progress · CalDef" };

const WEEKS = 8;

/**
 * Where it is all going: the weight trend, and how often you train.
 *
 * The two are shown together and kept apart. The weight trend drives the
 * calorie target; training does not, and no figure here pretends
 * otherwise (spec §16.7). Progress on a lift lives on that exercise's own
 * page, because a kilogram on the bench and a kilogram on a curl are not
 * the same kilogram.
 */
export default async function WeightPage() {
  const { profile, goal } = await getAccountSetup();
  // The layout guarantees setup is complete before this renders.
  if (!profile) return null;

  const units = profile.unit_system;
  const today = todayInTimeZone(profile.timezone);
  const windowStart = addDays(startOfIsoWeek(today), -7 * (WEEKS - 1));

  const [history, recent, expenditure, starts, sessions] = await Promise.all([
    getWeightHistory(profile.timezone),
    getRecentWeighIns(),
    getExpenditure(today),
    listSessionStarts(new Date(Date.parse(`${windowStart}T00:00:00Z`) - 86_400_000).toISOString()),
    listCompletedSessions(20),
  ]);

  const ratePerWeek = history.changeKgPerWeek;
  const goalKg = goal?.final_goal_weight_kg ?? null;
  const toGoKg = goalKg === null || history.latestKg === null ? null : history.latestKg - goalKg;
  const frequency = weeklyFrequency(
    starts.map((s) => todayInTimeZone(profile.timezone, new Date(s.startedAt))),
    today,
    WEEKS,
  );

  // The exercises trained most in the last sessions — the ones whose
  // progress is worth a tap.
  const counts = new Map<number, { name: string; n: number }>();
  for (const session of sessions) {
    for (const exercise of session.exercises) {
      const entry = counts.get(exercise.exerciseId) ?? { name: exercise.name, n: 0 };
      entry.n += 1;
      counts.set(exercise.exerciseId, entry);
    }
  }
  const lifts = [...counts.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 6);

  return (
    <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-8">
      <div className="lg:col-span-5">
        <Slab>
          <h1 className="display text-3xl">Progress</h1>
          <p className="eyebrow mt-5">Weight trend</p>
          <p className="mt-3 flex items-end gap-3">
            <span className="figure text-[6.75rem] leading-[0.8]">
              {history.latestTrendKg === null
                ? "—"
                : kgToDisplay(history.latestTrendKg, units).toFixed(1)}
            </span>
            <span className="text-slab-muted pb-1 text-sm leading-tight">
              {massUnitLabel(units)}
              <br />
              smoothed
            </span>
          </p>
          <dl className="border-slab-line mt-6 grid grid-cols-3 gap-4 border-t pt-5">
            <Stat
              label="Rate"
              value={
                ratePerWeek === null
                  ? "—"
                  : `${ratePerWeek > 0 ? "+" : ""}${kgToDisplay(ratePerWeek, units).toFixed(2)}`
              }
              unit={ratePerWeek === null ? undefined : `${massUnitLabel(units)}/wk`}
              hint="Last 28 days"
            />
            <Stat
              label="Latest"
              value={history.latestKg === null ? "—" : kgToDisplay(history.latestKg, units).toFixed(1)}
              unit={history.latestKg === null ? undefined : massUnitLabel(units)}
              hint="One reading"
            />
            <Stat
              label="To goal"
              value={toGoKg === null ? "—" : kgToDisplay(Math.abs(toGoKg), units).toFixed(1)}
              unit={toGoKg === null ? undefined : massUnitLabel(units)}
              hint={goalKg === null ? "No goal set" : `Goal ${formatMass(goalKg, units)}`}
            />
          </dl>
        </Slab>

        <section aria-labelledby="weigh-in-heading" className="bg-card mt-4 rounded-2xl p-5">
          <h2 id="weigh-in-heading" className="display text-2xl">Weigh in</h2>
          <p className="text-muted-foreground mt-1 mb-4 text-sm">
            Same time of day, before eating, gives the cleanest signal.
          </p>
          <WeighInForm
            today={today}
            unitLabel={massUnitLabel(units)}
            defaultWeight={
              history.latestKg === null
                ? null
                : Number(kgToDisplay(history.latestKg, units).toFixed(1))
            }
          />
        </section>
      </div>

      <div className="mt-6 space-y-7 lg:col-span-7 lg:mt-10">
        <section aria-labelledby="trend-heading">
          <SectionTitle id="trend-heading">Weight</SectionTitle>
          <div className="bg-card mt-2 rounded-2xl p-5">
            <TrendChart
              points={history.trend}
              unitLabel={massUnitLabel(units)}
              toDisplay={(kg) => kgToDisplay(kg, units)}
            />
            <details className="mt-3 border-t pt-3">
              <summary className="flex min-h-10 cursor-pointer items-center text-sm font-semibold">
                {history.entries.length} weigh-in{history.entries.length === 1 ? "" : "s"} — show and edit
              </summary>
              {recent.length === 0 ? (
                <p className="text-muted-foreground text-sm">Nothing recorded yet.</p>
              ) : (
                <ul className="divide-y">
                  {recent.map((entry) => (
                    <li key={entry.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="font-semibold tabular-nums">{formatMass(entry.weight_kg, units)}</p>
                        <p className="text-muted-foreground truncate text-xs">
                          {formatLongDate(entry.entry_date)}
                          {entry.note ? ` · ${entry.note}` : ""}
                        </p>
                      </div>
                      <form action={deleteWeighIn}>
                        <input type="hidden" name="entryId" value={entry.id} />
                        <PendingButton
                          type="submit"
                          variant="ghost"
                          className="text-destructive"
                          aria-label={`Remove weigh-in for ${entry.entry_date}`}
                        >
                          Remove
                        </PendingButton>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          </div>
        </section>

        <section aria-labelledby="training-heading">
          <SectionTitle
            id="training-heading"
            action={
              <Link href="/training/history" className="flex min-h-10 items-center gap-1 text-sm font-semibold">
                Calendar <ArrowRight className="size-4" aria-hidden />
              </Link>
            }
          >
            Training
          </SectionTitle>
          <div className="bg-card mt-2 rounded-2xl p-5">
            <p className="eyebrow mb-3">Sessions per week · last {WEEKS} weeks</p>
            <FrequencyBars weeks={frequency} />
          </div>
          {lifts.length > 0 ? (
            <>
              <p className="eyebrow px-1 pt-4 pb-2">Progress by exercise</p>
              <ul className="bg-card divide-y rounded-2xl px-4">
                {lifts.map(([exerciseId, { name, n }]) => (
                  <li key={exerciseId}>
                    <Link href={`/training/exercises/${exerciseId}`} className="flex min-h-14 items-center gap-3 py-2">
                      <span className="min-w-0 flex-1 truncate font-semibold">{name}</span>
                      <span className="text-muted-foreground text-sm tabular-nums">
                        {n} {n === 1 ? "session" : "sessions"}
                      </span>
                      <ArrowRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-muted-foreground px-1 pt-3 text-sm">
              Each exercise shows its own progress once you have logged it.
            </p>
          )}
        </section>

        <section aria-labelledby="expenditure-heading">
          <SectionTitle id="expenditure-heading">Expenditure</SectionTitle>
          <div className="bg-card mt-2 rounded-2xl p-5">
            {expenditure ? (
              <div className="space-y-4">
                <dl className="grid grid-cols-2 gap-4">
                  <Stat
                    label="In use"
                    value={Math.round(expenditure.tdeeKcal)}
                    unit="kcal"
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
                        : Math.round(expenditure.estimate.observedTdeeKcal)
                    }
                    unit={expenditure.estimate.observedTdeeKcal === null ? undefined : "kcal"}
                    hint="Before smoothing"
                  />
                </dl>
                <p className="text-muted-foreground text-sm">
                  {describeEstimate(expenditure.estimate, expenditure.formulaTdeeKcal)}
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                Add your profile and a weigh-in to see an estimate.
              </p>
            )}
          </div>
        </section>

        <Link href="/phase" className="bg-card flex min-h-14 items-center gap-3 rounded-2xl px-5">
          <span className="flex-1 text-sm font-semibold">2-Month Cut phase</span>
          <ArrowRight className="text-muted-foreground size-4" aria-hidden />
        </Link>

        <p className="text-muted-foreground px-1 text-xs">
          CalDef provides estimates for personal tracking. It is not medical or
          dietary advice.
        </p>
      </div>
    </div>
  );
}
