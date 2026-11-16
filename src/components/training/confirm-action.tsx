"use client";

/**
 * A destructive action behind one confirmation, with the outcome reported.
 * Used for deleting a template, a logged session or a custom exercise.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

import { PendingButton } from "@/components/pending-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function ConfirmAction({
  trigger,
  title,
  description,
  confirmLabel,
  action,
  redirectTo,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  /** A bound server action. */
  action: () => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Where to go afterwards; stays and refreshes when omitted. */
  redirectTo?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    } catch {
      setError("No connection. Nothing was changed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-destructive text-sm">{error}</p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <PendingButton
            type="button"
            variant="destructive"
            pending={pending}
            onClick={() => void confirm()}
          >
            {confirmLabel}
          </PendingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
