"use client";

/**
 * "Add food": one volt button, and the whole adding tool behind it.
 *
 * The tool — your foods, search, scan, describe a meal, quick add — is
 * large, and it used to sit open above the day's meals, so the first thing
 * on the diary was a form and the meals were a scroll away. Now the day is
 * what you see, and adding is one tap that opens the tool in place.
 *
 * It stays open while it is being used and can be closed; arriving with
 * `?add` (from Today's "Log lunch") opens it straight away.
 */

import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

export function AddFoodPanel({
  defaultOpen,
  children,
}: {
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Bring the tool to the top and put the cursor where typing starts.
    panel.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [open]);

  if (!open) {
    return (
      <Button
        type="button"
        variant="volt"
        size="lg"
        className="min-h-[4.25rem] w-full justify-between rounded-2xl px-5 text-lg"
        onClick={() => setOpen(true)}
      >
        Add food
        <Plus className="size-6" aria-hidden />
      </Button>
    );
  }

  return (
    <div ref={panel} className="scroll-mt-16 space-y-2">
      <div className="flex items-center justify-between px-1">
        <h2 className="display text-2xl">Add food</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close add food"
          onClick={() => setOpen(false)}
        >
          <X />
        </Button>
      </div>
      {children}
    </div>
  );
}
