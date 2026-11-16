import type { Metadata } from "next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { AddFood } from "@/app/(app)/diary/add-food";
import { CopyFromYesterday } from "@/components/repeat-forms";
import { EntryRow } from "@/app/(app)/diary/entry-row";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { LinkPending } from "@/components/pending-nav";
import { Progress } from "@/components/ui/progress";
import { addDays, formatLongDate, isIsoDate, todayInTimeZone } from "@/lib/dates";
import { getDiaryDay } from "@/lib/diary";
import { getPersonalLibrary } from "@/lib/food/library";
import { estimatedShare } from "@/lib/nutrition/confidence";
import { hasGeminiKey } from "@/lib/env.server";
import { remainingAgainstTarget } from "@/lib/nutrition/totals";
import { getAccountSetup } from "@/lib/profile";
import { getOrCreateDailyTarget } from "@/lib/targets";

export const metadata: Metadata = { title: "Diary · CalDef" };

const DAY_NAV_CLASS =
  "hover:bg-muted flex min-h-10 min-w-10 items-center justify-center rounded-lg border bg-card";

function MacroStat({
  label,
  consumed,
  target,
  unit = "g",
}: {
  label: string;
  consumed: number;
  target: number;
  unit?: string;
}) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-0.5 tabular-nums">
        <span className="figure text-xl">{Math.round(consumed)}</span>
        <span className="text-muted-foreground text-sm">
          {" "}
          / {Math.round(target)} {unit}
        </span>
      </dd>
    </div>
  );
}

export default async function DiaryPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { profile } = await getAccountSetup();
  // The layout guarantees setup is complete before this renders.
  if (!profile) return null;

  const today = todayInTimeZone(profile.timezone);
  const requested = (await searchParams).date;
  const date = requested && isIsoDate(requested) ? requested : today;

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

  const remaining = target
    ? remainingAgainstTarget(day.totals.totals, target.macros)
    : null;

  const entriesByMeal = new Map(
    day.mealTypes.map((meal) => [
      meal.id,
      day.entries.filter((e) => e.meal_type_id === meal.id),
    ]),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={date === today ? "Today" : formatLongDate(date)}
        title="Diary"
        action={
          <nav aria-label="Day" className="flex items-center gap-1 text-sm">
            <Link
              href={`/diary?date=${addDays(date, -1)}`}
              className={DAY_NAV_CLASS}
              aria-label="Previous day"
            >
              <LinkPending spinnerClassName="size-5">
                <ChevronLeft className="size-5" aria-hidden />
              </LinkPending>
            </Link>
            {date !== today ? (
              <Link
                href="/diary"
                className={`${DAY_NAV_CLASS} px-3 font-semibold`}
              >
                <LinkPending>Today</LinkPending>
              </Link>
            ) : null}
            <Link
              href={`/diary?date=${addDays(date, 1)}`}
              className={DAY_NAV_CLASS}
              aria-label="Next day"
            >
              <LinkPending spinnerClassName="size-5">
                <ChevronRight className="size-5" aria-hidden />
              </LinkPending>
            </Link>
          </nav>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="figure text-3xl leading-none">
            {remaining && remaining.isOver
              ? `${Math.abs(remaining.kcal).toFixed(0)} kcal over`
              : remaining
                ? `${remaining.kcal.toFixed(0)} kcal left`
                : "No target yet"}
          </CardTitle>
          <CardDescription>
            {target ? (
              <>
                <span className="text-foreground font-medium">
                  {target.label}
                </span>
                {` · ${Math.round(day.totals.totals.kcal)} of ${target.calories} kcal`}
                {target.detail ? ` · ${target.detail.explanation}` : ""}
              </>
            ) : (
              "Add your profile and a weigh-in to get a target."
            )}
          </CardDescription>
          {uncertainShare !== null && uncertainShare > 0 ? (
            <p className="text-muted-foreground text-sm">
              About {Math.max(1, Math.round(uncertainShare * 100))}% of this
              day&rsquo;s calories are estimates.
            </p>
          ) : null}
          {target?.fellBackFromPhase ? (
            <p className="text-muted-foreground text-sm">
              Your cut phase has ended, so this is your everyday target again.
              The number changed because the phase is no longer setting it.
            </p>
          ) : null}
        </CardHeader>
        {target && remaining ? (
          <CardContent className="space-y-4">
            <Progress value={remaining.kcalProgress * 50} className="h-2.5" />
            <dl className="grid grid-cols-3 gap-4">
              <MacroStat
                label="Protein"
                consumed={day.totals.totals.protein_g}
                target={target.macros.protein_g}
              />
              <MacroStat
                label="Carbs"
                consumed={day.totals.totals.carbs_g}
                target={target.macros.carbs_g}
              />
              <MacroStat
                label="Fat"
                consumed={day.totals.totals.fat_g}
                target={target.macros.fat_g}
              />
            </dl>
          </CardContent>
        ) : null}
      </Card>

      <AddFood logDate={date} mealTypes={day.mealTypes} aiReady={aiReady}
        library={library}
      />

      {day.mealTypes.map((meal) => {
        const entries = entriesByMeal.get(meal.id) ?? [];
        const previous = previousDay.entries.filter(
          (e) => e.meal_type_id === meal.id,
        );
        const mealKcal = entries.reduce((sum, e) => sum + e.kcal, 0);

        return (
          <Card key={meal.id}>
            <CardHeader>
              <div className="flex items-baseline justify-between">
                <CardTitle className="text-base">{meal.name}</CardTitle>
                <span className="text-muted-foreground text-sm font-medium tabular-nums">
                  {Math.round(mealKcal)} kcal
                </span>
              </div>
            </CardHeader>
            <CardContent>
              {entries.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Nothing logged yet.
                </p>
              ) : (
                <ul className="divide-y">
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
              )}
              {previous.length > 0 ? (
                <div className="mt-3">
                  <CopyFromYesterday
                    entries={previous}
                    mealTypeId={meal.id}
                    mealName={meal.name}
                    logDate={date}
                  />
                </div>
              ) : null}
            </CardContent>
          </Card>
        );
      })}

      <p className="text-muted-foreground text-xs">
        CalDef provides estimates for personal tracking. It is not medical or
        dietary advice.
      </p>
    </div>
  );
}
