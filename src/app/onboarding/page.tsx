import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { OnboardingForm } from "@/app/onboarding/onboarding-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getAccountSetup } from "@/lib/profile";
import { getUserId } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Set up · CalDef" };

export default async function OnboardingPage() {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  const setup = await getAccountSetup();
  if (setup.isComplete) redirect("/dashboard");

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Set up CalDef</CardTitle>
          <CardDescription>
            These figures seed the expenditure model. It corrects itself from
            your real intake and weight trend afterwards, so approximate
            answers are fine.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OnboardingForm />
        </CardContent>
      </Card>

      <p className="text-muted-foreground mt-6 text-center text-xs">
        CalDef provides estimates for personal tracking. It is not medical or
        dietary advice.
      </p>
    </div>
  );
}
