import { ArrowRight, History } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { getAccountSetup } from "@/lib/profile";
import { listCompletedSessions } from "@/lib/training/store";
import { dayOf, summaryLine } from "@/lib/training/view";

export const metadata: Metadata = { title: "Training history · CalDef" };

const LIMIT = 200;

export default async function HistoryPage() {
  const { profile } = await getAccountSetup();
  if (!profile) return null;
  const sessions = await listCompletedSessions(LIMIT);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Training"
        title="History"
        description={
          sessions.length === 0
            ? undefined
            : `${sessions.length}${sessions.length === LIMIT ? "+" : ""} ${sessions.length === 1 ? "session" : "sessions"} completed.`
        }
      />
      {sessions.length === 0 ? (
        <EmptyState
          icon={History}
          title="Nothing logged yet"
          action={
            <Button asChild>
              <Link href="/training">Go to training</Link>
            </Button>
          }
        >
          Sessions you finish appear here, with every set you did.
        </EmptyState>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card">
          {sessions.map((session) => (
            <li key={session.id}>
              <Link
                href={`/training/history/${session.id}`}
                className="flex min-h-16 items-center justify-between gap-3 px-4 py-3"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{session.name}</span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {dayOf(session.startedAt, profile.timezone)} ·{" "}
                    {summaryLine(session, profile.unit_system)}
                  </span>
                </span>
                <ArrowRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
