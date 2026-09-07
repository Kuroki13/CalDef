import { redirect } from "next/navigation";

import { AppSidebar, AppTabBar } from "@/components/app-nav";
import { ensureAccountExists } from "@/lib/account-status";
import { getAccountSetup } from "@/lib/profile";
import { getUserId } from "@/lib/supabase/server";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The proxy already redirected signed-out visitors, but authorization is
  // re-verified here: proxy is an optimistic check, not the boundary.
  const userId = await getUserId();
  if (!userId) redirect("/login");

  const setup = await getAccountSetup();
  // A verified token with no profile behind it is a deleted account, not an
  // unfinished one. Checked before the onboarding redirect, or someone whose
  // account is gone would be sent to go and finish setting it up.
  ensureAccountExists({ userId, profile: setup.profile });
  if (!setup.isComplete) redirect("/onboarding");

  return (
    <div className="flex min-h-dvh">
      <AppSidebar />
      <main className="flex-1 pb-20 md:pb-0">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8 md:py-10">
          {children}
        </div>
      </main>
      <AppTabBar />
    </div>
  );
}
