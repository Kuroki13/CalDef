import type { Metadata } from "next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { todayInTimeZone } from "@/lib/dates";
import { getAccountSetup } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { formatMass, kgToDisplay, massUnitLabel } from "@/lib/units";

export const metadata: Metadata = { title: "Dashboard · CalDef" };

const ACTIVITY_LABELS: Record<string, string> = {
  sedentary: "Sedentary",
  light: "Lightly active",
  moderate: "Moderately active",
  very: "Very active",
  extra: "Extremely active",
};

function ageFrom(birthDate: string, today: string): number {
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-lg font-medium tabular-nums">{value}</dd>
    </div>
  );
}

export default async function DashboardPage() {
  const { profile, goal, latestWeightKg } = await getAccountSetup();
  // The layout guarantees setup is complete before this renders.
  if (!profile || !goal || latestWeightKg === null) return null;

  const units = profile.unit_system;
  const today = todayInTimeZone(profile.timezone);

  const supabase = await createClient();
  const { data: latestEntry } = await supabase
    .from("weight_entries")
    .select("entry_date, weight_kg")
    .order("entry_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const goalWeightKg = goal.final_goal_weight_kg;
  const toGoKg = goalWeightKg === null ? null : latestWeightKg - goalWeightKg;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {profile.display_name ? `Hi, ${profile.display_name}` : "Dashboard"}
        </h1>
        <p className="text-muted-foreground text-sm">{today}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Where you are</CardTitle>
          <CardDescription>
            {latestEntry
              ? `Last weigh-in ${latestEntry.entry_date}.`
              : "No weigh-in recorded yet."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Current" value={formatMass(latestWeightKg, units)} />
            <Stat
              label="Final goal"
              value={
                goalWeightKg === null
                  ? "Not set"
                  : formatMass(goalWeightKg, units)
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

      <Card>
        <CardHeader>
          <CardTitle>Your details</CardTitle>
          <CardDescription>
            These seed the expenditure estimate. Change them in Settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat
              label="Height"
              value={
                profile.height_cm === null
                  ? "—"
                  : units === "imperial"
                    ? `${(profile.height_cm / 2.54).toFixed(1)} in`
                    : `${profile.height_cm} cm`
              }
            />
            <Stat
              label="Age"
              value={
                profile.birth_date === null
                  ? "—"
                  : `${ageFrom(profile.birth_date, today)}`
              }
            />
            <Stat
              label="Activity"
              value={ACTIVITY_LABELS[goal.activity_level] ?? goal.activity_level}
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
