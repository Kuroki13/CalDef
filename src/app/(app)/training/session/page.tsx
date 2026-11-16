import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ActiveSession } from "@/components/training/active-session";
import { getAccountSetup } from "@/lib/profile";
import {
  getActiveSession,
  getPreviousPerformance,
  listExercises,
} from "@/lib/training/store";

export const metadata: Metadata = { title: "Session · CalDef" };

/**
 * The session in progress. There is at most one, so the address needs no
 * id — and reopening the app on this page is how a session is resumed.
 */
export default async function SessionPage({
  searchParams,
}: {
  searchParams: Promise<{ resumed?: string }>;
}) {
  const { profile } = await getAccountSetup();
  if (!profile) return null;

  const session = await getActiveSession();
  if (!session) redirect("/training");

  const [previous, exercises] = await Promise.all([
    getPreviousPerformance(
      session.exercises.map((exercise) => exercise.exerciseId),
      session.id,
    ),
    listExercises(),
  ]);

  return (
    <ActiveSession
      // A different session is a different screen: no state carries over.
      key={session.id}
      session={session}
      previous={previous}
      exercises={exercises}
      units={profile.unit_system}
      resumed={(await searchParams).resumed === "1"}
    />
  );
}
