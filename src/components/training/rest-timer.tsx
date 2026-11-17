"use client";

/**
 * The rest countdown, pinned above the tab bar.
 *
 * It is drawn from an end time, not counted down, so it is still right
 * after the phone was locked. What it cannot do is ring while the app is in
 * the background — a web app is not allowed to — so it does not claim to:
 * when you come back, it shows where the rest stands, or that it is over.
 */

import { Minus, Pause, Play, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatClock } from "@/lib/training/format";
import { isPaused, restRemaining, type RestTimer } from "@/lib/training/timer";

/** How long "Rest over" stays on screen before the bar clears itself. */
export const REST_DONE_LINGER_MS = 6000;

export function RestTimerBar({
  timer,
  now,
  label,
  next = null,
  onAdjust,
  onPauseToggle,
  onDismiss,
}: {
  timer: RestTimer;
  now: number;
  /** The exercise the rest follows. */
  label: string | null;
  /** The set that follows, so resting never hides what comes next. */
  next?: string | null;
  onAdjust: (deltaSeconds: number) => void;
  onPauseToggle: () => void;
  onDismiss: () => void;
}) {
  const remaining = restRemaining(timer, now);
  const paused = isPaused(timer);
  const over = remaining === 0 && !paused;
  const fraction = over
    ? 1
    : Math.min(1, Math.max(0, 1 - remaining / timer.totalSeconds));

  return (
    <div
      role="timer"
      aria-label="Rest timer"
      className="bg-foreground text-background bottom-above-tabs fixed inset-x-3 z-20 overflow-hidden rounded-2xl shadow-lg lg:inset-x-auto lg:right-8 lg:bottom-8 lg:w-96"
    >
      <div className="flex items-center gap-2 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-background/70 truncate text-[0.6875rem] font-semibold tracking-[0.08em] uppercase">
            {over ? "Rest over" : paused ? "Rest · paused" : "Rest"}
            {label ? ` · ${label}` : ""}
          </p>
          <p className="figure mt-0.5 text-3xl" aria-live="off">
            {over ? "Go" : formatClock(remaining)}
          </p>
          {next ? (
            <p className="text-background/70 truncate text-xs">Next · {next}</p>
          ) : null}
        </div>
        {over ? null : (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-background hover:bg-background/15 hover:text-background"
              aria-label={paused ? "Resume rest" : "Pause rest"}
              onClick={onPauseToggle}
            >
              {paused ? <Play /> : <Pause />}
            </Button>
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
          className="bg-volt h-full transition-[width] duration-300 ease-linear motion-reduce:transition-none"
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
    </div>
  );
}
