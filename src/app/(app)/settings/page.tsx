import type { Metadata } from "next";

import { signOut } from "@/app/auth/actions";
import { AiToggle, SettingsForm } from "@/app/(app)/settings/settings-form";
import { PendingButton } from "@/components/pending-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getAccountSetup } from "@/lib/profile";

export const metadata: Metadata = { title: "Settings · CalDef" };

export default async function SettingsPage() {
  const { profile, goal } = await getAccountSetup();
  // The layout guarantees setup is complete before this renders.
  if (!profile || !goal || profile.height_cm === null || !profile.birth_date) {
    return null;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Profile and goal</CardTitle>
          <CardDescription>
            Changing these re-seeds the expenditure estimate. Your logged
            history is not affected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsForm
            displayName={profile.display_name ?? ""}
            sex={profile.sex}
            birthDate={profile.birth_date}
            unitSystem={profile.unit_system}
            heightCm={profile.height_cm}
            goalType={goal.goal_type}
            goalWeightKg={goal.final_goal_weight_kg}
            activityLevel={goal.activity_level}
            proteinPerKg={goal.protein_g_per_kg}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Privacy</CardTitle>
        </CardHeader>
        <CardContent>
          <AiToggle enabled={profile.ai_enabled} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={signOut}>
            <PendingButton
              type="submit"
              variant="outline"
              pendingLabel="Signing out…"
            >
              Sign out
            </PendingButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
