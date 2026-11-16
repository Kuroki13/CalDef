import { redirect } from "next/navigation";

import {
  AppSidebar,
  AppTabBar,
  AppTopBar,
  SessionBar,
} from "@/components/app-nav";
import { ensureAccountExists } from "@/lib/account-status";
import { getAccountSetup } from "@/lib/profile";
import { getUserId } from "@/lib/supabase/server";
import { getActiveSessionSummary } from "@/lib/training/store";

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

  // Shown on every screen while a session runs. A failure to read it must
  // not take the whole app down with it: no bar is the safe fallback.
  const session = await getActiveSessionSummary().catch(() => null);

  return (
    <div className="flex min-h-dvh">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopBar />
        <main
          className={
            // Room for the tab bar, and for the session bar above it when
            // there is one, so neither ever covers the last row.
            session
              ? "flex-1 pb-[calc(9rem+env(safe-area-inset-bottom))] lg:pb-28"
              : "flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-10"
          }
        >
          <div className="mx-auto w-full max-w-xl px-4 lg:max-w-5xl lg:px-10">
            {children}
          </div>
        </main>
      </div>
      <SessionBar session={session} />
      <AppTabBar />
    </div>
  );
}
