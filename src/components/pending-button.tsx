"use client";

/**
 * The one button that says it heard you.
 *
 * Every control in this app that reaches the server goes through here, so
 * that "I tapped it and nothing happened" cannot be true anywhere. On a
 * phone on mobile data a server action can take a second or more, and a
 * button that neither moves nor dims during that second reads as broken —
 * which invites the second tap that this component also has to stop.
 *
 * Two sources of pending, because there are two kinds of work:
 *
 *   - A form action. `useFormStatus` reports the enclosing form's own
 *     submission, which means a plain `<form action={serverAction}>` in a
 *     server component gets a pending state without becoming a client
 *     component or threading any state down to it.
 *   - Anything else — a `fetch`, a `useTransition`, a router navigation.
 *     The caller passes `pending` itself.
 *
 * Whichever is true, the button disables, marks itself `aria-busy`, and
 * shows motion. `pendingLabel` replaces the text where there is something
 * more useful to say than the same word again.
 */

import { LoaderCircle } from "lucide-react";
import { useRef } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * How long a second click is ignored after the first.
 *
 * `disabled` is the real guard, but it arrives with a re-render, and a
 * re-render is exactly what a phone under load defers — so the window
 * between "the tap registered" and "the button looks disabled" is widest on
 * the device where people tap twice. This closes it synchronously. It is
 * short enough that a deliberate second action never notices, and it clears
 * itself, so a submission the browser rejected before it started cannot
 * leave a button stuck.
 */
const DOUBLE_TAP_MS = 600;

/**
 * The motion.
 *
 * `motion-reduce:animate-none` stops the spin for anyone who has asked the
 * system for less movement. They are not left without feedback: the label
 * still changes, the button still dims, and `aria-busy` still says what is
 * happening — the spin was never the only signal.
 */
export function Spinner({ className }: { className?: string }) {
  return (
    <LoaderCircle
      aria-hidden
      className={cn("animate-spin motion-reduce:animate-none", className)}
    />
  );
}

type PendingButtonProps = React.ComponentProps<typeof Button> & {
  /** Pending work this button started that is not a form submission. */
  pending?: boolean;
  /** Replaces the label while busy, e.g. "Adding…". */
  pendingLabel?: string;
};

export function PendingButton({
  pending,
  pendingLabel,
  children,
  disabled,
  onClick,
  className,
  ...props
}: PendingButtonProps) {
  const status = useFormStatus();
  const busy = Boolean(pending) || status.pending;
  const lastClickAt = useRef(0);

  return (
    <Button
      {...props}
      className={cn("gap-2", className)}
      disabled={disabled || busy}
      aria-busy={busy}
      onClick={(event) => {
        const now = Date.now();
        if (busy || now - lastClickAt.current < DOUBLE_TAP_MS) {
          event.preventDefault();
          return;
        }
        lastClickAt.current = now;
        onClick?.(event);
      }}
    >
      {busy ? <Spinner /> : null}
      {busy && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
