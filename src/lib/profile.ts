import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";

export type Profile = Tables<"profiles">;
export type Goal = Tables<"goals">;

export type AccountSetup = {
  profile: Profile | null;
  goal: Goal | null;
  latestWeightKg: number | null;
  /** True once there is enough on record to compute anything meaningful. */
  isComplete: boolean;
};

/**
 * Everything the shell needs to decide whether to route to onboarding.
 *
 * Setup is complete when we hold the inputs the expenditure model needs:
 * body metrics, an active goal, and at least one weigh-in to anchor the
 * trend.
 */
export async function getAccountSetup(): Promise<AccountSetup> {
  const supabase = await createClient();

  const [profileResult, goalResult, weightResult] = await Promise.all([
    supabase.from("profiles").select("*").maybeSingle(),
    supabase.from("goals").select("*").eq("is_active", true).maybeSingle(),
    supabase
      .from("weight_entries")
      .select("weight_kg")
      .order("entry_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const profile = profileResult.data ?? null;
  const goal = goalResult.data ?? null;
  const latestWeightKg = weightResult.data?.weight_kg ?? null;

  const isComplete =
    profile !== null &&
    profile.height_cm !== null &&
    profile.birth_date !== null &&
    goal !== null &&
    latestWeightKg !== null;

  return { profile, goal, latestWeightKg, isComplete };
}
