"use client";

/**
 * "Start" — once, however many times it is tapped.
 *
 * The token is made when the button mounts and sent with every attempt, so
 * a double tap or a retry after a dropped response reaches the same session
 * (`start_workout`). If another session was already running, that one is
 * opened and the session screen says so.
 */

import { Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { startWorkoutAction } from "@/app/(app)/training/actions";
import { PendingButton } from "@/components/pending-button";
import type { Button } from "@/components/ui/button";

export function StartWorkoutButton({
  templateId = null,
  fromSessionId = null,
  sessionName = null,
  scheduleId = null,
  children,
  ...button
}: {
  templateId?: number | null;
  fromSessionId?: number | null;
  /** For an empty session. */
  sessionName?: string | null;
  /** The planned occurrence this start carries out. */
  scheduleId?: number | null;
  children: React.ReactNode;
} & Omit<React.ComponentProps<typeof Button>, "onClick" | "type">) {
  const router = useRouter();
  const [token] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setPending(true);
    setError(null);
    try {
      const result = await startWorkoutAction({ token, templateId, fromSessionId, name: sessionName, scheduleId });
      if (!result.ok) {
        setError(result.error);
        setPending(false);
        return;
      }
      // Stays pending through the navigation, so it cannot be tapped again.
      router.push(result.resumed ? "/training/session?resumed=1" : "/training/session");
    } catch {
      setError("No connection. The session was not started.");
      setPending(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-stretch gap-1">
      <PendingButton
        type="button"
        pending={pending}
        pendingLabel="Starting…"
        onClick={() => void start()}
        {...button}
      >
        <Play aria-hidden />
        {children}
      </PendingButton>
      {error ? (
        <span role="alert" className="text-destructive text-xs">{error}</span>
      ) : null}
    </span>
  );
}
