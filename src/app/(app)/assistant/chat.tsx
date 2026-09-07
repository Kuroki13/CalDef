"use client";

/**
 * The assistant thread.
 *
 * A follow-up works: the last few turns of the thread go back with the
 * question, so "and how much protein was that?" has a referent. What goes is
 * food text only — every stored message is re-checked on its way out and
 * dropped if it no longer passes the gate — and the note under the box says
 * exactly that, because the boundary is the sort of thing a user is entitled
 * to know the shape of.
 */

import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { PendingButton } from "@/components/pending-button";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { FoodProposalReview } from "@/components/food-proposal-review";
import { CustomFoodForm } from "@/components/custom-food-form";
import type { FoodProposal } from "@/lib/ai/resolve";
import type { AssistantMode } from "@/lib/ai/message-intent";
import type { MealType } from "@/lib/diary";

export type Turn = { role: "user" | "assistant"; content: string };

export function Chat({
  initialTurns,
  initialConversationId,
  logDate,
  mealTypes,
}: {
  initialTurns: Turn[];
  initialConversationId: number | null;
  logDate: string;
  mealTypes: MealType[];
}) {
  const [turns, setTurns] = useState<Turn[]>(initialTurns);
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<AssistantMode>("auto");
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState<{ id: number; mode: "log" | "save"; proposals: FoodProposal[]; degraded: boolean } | null>(null);

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (text.length === 0 || pending) return;

    setPending(true);
    setError(null);
    setDraft(null);
    setShowCreate(false);
    // Shown immediately: the question is the user's own words and does not
    // depend on the answer arriving.
    setTurns((prev) => [...prev, { role: "user", content: text }]);
    setQuestion("");

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message: text, mode }),
      });
      const body = await response.json();

      if (!response.ok) {
        setError(body.error ?? "The assistant could not be reached.");
        return;
      }

      setTurns((prev) => [...prev, { role: "assistant", content: body.answer }]);
      if (body.conversationId) setConversationId(body.conversationId);
      if (body.kind === "create") setShowCreate(true);
      if (body.kind === "log" || body.kind === "save") {
        setDraft({ id: Date.now(), mode: body.kind, proposals: body.proposals ?? [], degraded: Boolean(body.degraded) });
      }
    } catch {
      setError("Could not reach the assistant.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      {turns.length > 0 ? (
        <ul className="space-y-3">
          {turns.map((turn, index) => (
            <li
              key={index}
              className={
                turn.role === "user"
                  ? "bg-muted ml-auto max-w-[85%] rounded-lg px-3 py-2 text-sm"
                  : "bg-card max-w-[85%] rounded-lg border px-3 py-2 text-sm whitespace-pre-wrap"
              }
            >
              {turn.content}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">
          Ask about your targets, describe what you ate, or save a food for later.
        </p>
      )}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {draft?.degraded ? <p className="text-muted-foreground text-sm">A food source did not respond. Check the matches carefully.</p> : null}
      {draft?.proposals.length ? <FoodProposalReview key={draft.id} proposals={draft.proposals} logDate={logDate} mealTypes={mealTypes} mode={draft.mode} /> : null}
      {showCreate ? <div className="space-y-3 rounded-lg border p-3">
        <h2 className="font-medium">Create a food</h2>
        <p className="text-muted-foreground text-sm">Copy the nutrition label. This saves to your food library; it does not add a meal to your diary.</p>
        <CustomFoodForm onCancel={() => setShowCreate(false)} />
      </div> : null}

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">Message action
          <select aria-label="Message action" className="bg-background ml-2 rounded border p-2" value={mode} onChange={(e) => setMode(e.target.value as AssistantMode)}>
            <option value="auto">Automatic</option><option value="question">Ask a question</option><option value="log">Log a meal</option><option value="save">Save a food</option>
          </select>
        </label>
        <Button type="button" variant="secondary" onClick={() => setShowCreate((value) => !value)}>Create a food</Button>
      </div>
      <form onSubmit={ask} className="space-y-2">
        <Textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={2}
          placeholder="I ate a Harvey’s Big Angus burger"
          aria-label="Ask the assistant"
        />
        <PendingButton
          type="submit"
          pending={pending}
          pendingLabel="Thinking…"
          disabled={question.trim().length === 0}
        >
          Send
        </PendingButton>
      </form>

      <p className="text-muted-foreground text-xs">
        Food proposals stay in this session until you confirm them. Saved foods and confirmed meals remain in your account. Restaurant references show their source and review date; general live web search is not enabled.
      </p>
      <p className="text-muted-foreground text-xs">
        The last few turns of this thread go back with your question, so a
        follow-up can say &ldquo;and how much protein was that?&rdquo;. Only
        the food text goes: anything that looks like an address, a link or an
        identifier is dropped rather than sent. Your targets and today&rsquo;s
        totals go as plain numbers; your name, email and weight history do
        not.
      </p>
    </div>
  );
}
