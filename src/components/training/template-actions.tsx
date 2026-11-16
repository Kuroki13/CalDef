"use client";

import { Copy, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  deleteTemplateAction,
  duplicateTemplateAction,
} from "@/app/(app)/training/actions";
import { PendingButton } from "@/components/pending-button";
import { ConfirmAction } from "@/components/training/confirm-action";
import { Button } from "@/components/ui/button";

/** Edit, duplicate, delete — the three things done to a template. */
export function TemplateActions({ id, name }: { id: number; name: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function duplicate() {
    setPending(true);
    setError(null);
    try {
      const result = await duplicateTemplateAction(id);
      if (!result.ok) setError(result.error);
      else router.refresh();
    } catch {
      setError("No connection. Nothing was copied.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button asChild variant="ghost">
        <Link href={`/training/templates/${id}`}>
          <Pencil aria-hidden /> Edit
        </Link>
      </Button>
      <PendingButton
        type="button"
        variant="ghost"
        pending={pending}
        pendingLabel="Copying…"
        onClick={() => void duplicate()}
      >
        <Copy aria-hidden /> Duplicate
      </PendingButton>
      <ConfirmAction
        trigger={
          <Button type="button" variant="ghost" className="text-destructive">
            <Trash2 aria-hidden /> Delete
          </Button>
        }
        title={`Delete “${name}”?`}
        description="The workout is removed from your list. Sessions you already did with it stay in your history, unchanged."
        confirmLabel="Delete"
        action={() => deleteTemplateAction(id)}
      />
      {error ? <p role="alert" className="text-destructive w-full text-xs">{error}</p> : null}
    </div>
  );
}
