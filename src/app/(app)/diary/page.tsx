import type { Metadata } from "next";
import Link from "next/link";

import { AddFood } from "@/app/(app)/diary/add-food";
import { DescribeFood } from "@/app/(app)/diary/describe-food";
import { EntryRow } from "@/app/(app)/diary/entry-row";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LinkPending } from "@/components/pending-nav";
import { Progress } from "@/components/ui/progress";
import { addDays, isIsoDate, todayInTimeZone } from "@/lib/dates";
import { getDiaryDay } from "@/lib/diary";
import { hasGeminiKey } from "@/lib/env.server";
import { remainingAgainstTarget } from "@/lib/nutrition/totals";
import { getAccountSetup } from "@/lib/profile";
import { getOrCreateDailyTarget } from "@/lib/targets";

export const metadata: Metadata = { title: "Diary · CalDef" };

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
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="tabular-nums">
        <span className="text-lg font-medium">{Math.round(consumed)}</span>
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

  const [day, target] = await Promise.all([
    getDiaryDay(date),
    getOrCreateDailyTarget(date),
  ]);

  // The assistant needs both the user's switch and a configured key. Showing
  // a "Describe a meal" box that can only ever answer "not configured" is an
  // unimplemented button, which the acceptance criteria forbid — and the
  // manual search above it is the whole feature regardless.
  const aiReady = profile.ai_enabled && hasGeminiKey();

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
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Diary</h1>
          <p className="text-muted-foreground text-sm">
            {date === today ? "Today" : date}
          </p>
        </div>
        <nav className="flex items-center gap-1 text-sm">
          <Link
            href={`/diary?date=${addDays(date, -1)}`}
            className="hover:bg-accent rounded-md px-3 py-2"
            aria-label="Previous day"
          >
            <LinkPending>←</LinkPending>
          </Link>
          {date !== today ? (
            <Link href="/diary" className="hover:bg-accent rounded-md px-3 py-2">
              <LinkPending>Today</LinkPending>
            </Link>
          ) : null}
          <Link
            href={`/diary?date=${addDays(date, 1)}`}
            className="hover:bg-accent rounded-md px-3 py-2"
            aria-label="Next day"
          >
            <LinkPending>→</LinkPending>
          </Link>
        </nav>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>
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
          {target?.fellBackFromPhase ? (
            <p className="text-muted-foreground text-sm">
              Your cut phase has ended, so this is your everyday target again.
              The number changed because the phase is no longer setting it.
            </p>
          ) : null}
        </CardHeader>
        {target && remaining ? (
          <CardContent className="space-y-4">
            <Progress value={remaining.kcalProgress * 50} />
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

      <AddFood logDate={date} mealTypes={day.mealTypes} aiReady={aiReady} />

      {/*
        Rendered only when the user has the assistant on. The manual search
        above is the whole feature without it — ARCHITECTURE invariant 3 — so
        its absence removes a shortcut, never a capability.
      */}
      {aiReady ? (
        <DescribeFood logDate={date} mealTypes={day.mealTypes} />
      ) : null}

      {day.mealTypes.map((meal) => {
        const entries = entriesByMeal.get(meal.id) ?? [];
        const mealKcal = entries.reduce((sum, e) => sum + e.kcal, 0);

        return (
          <Card key={meal.id}>
            <CardHeader>
              <div className="flex items-baseline justify-between">
                <CardTitle className="text-base">{meal.name}</CardTitle>
                <span className="text-muted-foreground text-sm tabular-nums">
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
                      />
                  ))}
                </ul>
              )}
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
