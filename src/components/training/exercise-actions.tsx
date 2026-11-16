"use client";

/**
 * What can be done with an exercise from its own page: add it to the
 * session in progress, or to one of the workouts.
 */

import { Check, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  addSessionExercisesAction,
  appendTemplateExerciseAction,
  type ActionResult,
} from "@/app/(app)/training/actions";
import { PendingButton } from "@/components/pending-button";

export function ExerciseActions({
  exerciseId,
  activeSession,
  templates,
}: {
  exerciseId: number;
  activeSession: { id: number; name: string } | null;
  templates: { id: number; name: string }[];
}) {
  const router = useRouter();
  const [templateId, setTemplateId] = useState(String(templates[0]?.id ?? ""));
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(key: string, done: string, work: () => Promise<ActionResult>) {
    setPending(key);
    setMessage(null);
    try {
      const result = await work();
      setMessage(result.ok ? { ok: true, text: done } : { ok: false, text: result.error });
      if (result.ok) router.refresh();
    } catch {
      setMessage({ ok: false, text: "No connection. Nothing was added." });
    } finally {
      setPending(null);
    }
  }

  if (!activeSession && templates.length === 0) return null;

  return (
    <div className="space-y-3">
      {activeSession ? (
        <PendingButton
          type="button"
          variant="volt"
          size="lg"
          className="w-full rounded-2xl"
          pending={pending === "session"}
          pendingLabel="Adding…"
          onClick={() =>
            void run("session", `Added to ${activeSession.name}.`, () =>
              addSessionExercisesAction({ sessionId: activeSession.id, exerciseIds: [exerciseId] }),
            )
          }
        >
          <Plus aria-hidden /> Add to “{activeSession.name}”
        </PendingButton>
      ) : null}

      {templates.length > 0 ? (
        <div className="flex items-center gap-2">
          <label htmlFor="add-to-workout" className="sr-only">Workout to add this exercise to</label>
          <select
            id="add-to-workout"
            className="border-input bg-card h-12 min-w-0 flex-1 rounded-2xl border px-3 text-base"
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value)}
          >
            {templates.map((template) => (
              <option key={template.id} value={template.id}>{template.name}</option>
            ))}
          </select>
          <PendingButton
            type="button"
            variant={activeSession ? "outline" : "default"}
            size="lg"
            className="rounded-2xl"
            pending={pending === "template"}
            pendingLabel="Adding…"
            onClick={() =>
              void run(
                "template",
                `Added to ${templates.find((t) => String(t.id) === templateId)?.name ?? "the workout"}.`,
                () => appendTemplateExerciseAction({ templateId: Number(templateId), exerciseId }),
              )
            }
          >
            <Plus aria-hidden /> Add to workout
          </PendingButton>
        </div>
      ) : null}

      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={`flex items-center gap-1.5 text-sm ${message.ok ? "" : "text-destructive"}`}
        >
          {message.ok ? <Check className="text-success size-4" aria-hidden /> : null}
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
