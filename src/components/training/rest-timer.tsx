"use client";

/**
 * The rest countdown, pinned above the tab bar.
 *
 * It is drawn from an end time, not counted down, so it is still right
 * after the phone was locked. What it cannot do is ring while the app is in
 * the background — a web app is not allowed to — so it does not claim to:
 * when you come back, it shows where the rest stands, or that it is over.
 */

import { Minus, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatClock } from "@/lib/training/format";
import { remainingSeconds, type RestTimer } from "@/lib/training/timer";

/** How long "Rest over" stays on screen before the bar clears itself. */
export const REST_DONE_LINGER_MS = 6000;

export function RestTimerBar({
  timer,
  now,
  label,
  onAdjust,
  onDismiss,
}: {
  timer: RestTimer;
  now: number;
  /** The exercise the rest follows. */
  label: string | null;
  onAdjust: (deltaSeconds: number) => void;
  onDismiss: () => void;
}) {
  const remaining = remainingSeconds(timer.endsAt, now);
  const over = remaining === 0;
  const fraction = over
    ? 1
    : Math.min(1, Math.max(0, 1 - remaining / timer.totalSeconds));

  return (
    <div
      role="timer"
      aria-label="Rest timer"
      className="bg-foreground text-background fixed inset-x-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 overflow-hidden rounded-2xl shadow-lg md:inset-x-auto md:right-8 md:bottom-8 md:w-96"
    >
      <div className="flex items-center gap-2 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-background/70 truncate text-[0.6875rem] font-semibold tracking-[0.08em] uppercase">
            {over ? "Rest over" : "Rest"}
            {label ? ` · ${label}` : ""}
          </p>
          <p className="figure text-2xl leading-tight" aria-live="off">
            {over ? "Go" : formatClock(remaining)}
          </p>
        </div>
        {over ? null : (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-background hover:bg-background/15 hover:text-background"
              aria-label="15 seconds less"
              onClick={() => onAdjust(-15)}
            >
              <Minus />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-background hover:bg-background/15 hover:text-background"
              aria-label="15 seconds more"
              onClick={() => onAdjust(15)}
            >
              <Plus />
            </Button>
          </>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-background hover:bg-background/15 hover:text-background"
          aria-label={over ? "Dismiss" : "Skip rest"}
          onClick={onDismiss}
        >
          <X />
        </Button>
      </div>
      <div className="bg-background/20 h-1">
        <div
          className="bg-primary h-full transition-[width] duration-300 ease-linear motion-reduce:transition-none"
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
    </div>
  );
}
