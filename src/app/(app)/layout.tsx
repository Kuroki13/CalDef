import { redirect } from "next/navigation";

import { AppSidebar, AppTabBar } from "@/components/app-nav";
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
