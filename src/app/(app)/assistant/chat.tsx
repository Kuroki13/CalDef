"use client";

/**
 * The assistant thread.
 *
 * Each question is answered on its own: the stored history is on screen for
 * the user, not sent back to the model. The note under the box says so,
 * because a chat window that silently forgets would otherwise look broken
 * rather than deliberate.
 */

import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { PendingButton } from "@/components/pending-button";
import { Textarea } from "@/components/ui/textarea";

export type Turn = { role: "user" | "assistant"; content: string };

export function Chat({
  initialTurns,
  initialConversationId,
}: {
  initialTurns: Turn[];
  initialConversationId: number | null;
}) {
  const [turns, setTurns] = useState<Turn[]>(initialTurns);
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (text.length === 0) return;

    setPending(true);
    setError(null);
    // Shown immediately: the question is the user's own words and does not
    // depend on the answer arriving.
    setTurns((prev) => [...prev, { role: "user", content: text }]);
    setQuestion("");

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message: text }),
      });
      const body = await response.json();

      if (!response.ok) {
        setError(body.error ?? "The assistant could not be reached.");
        return;
      }

      setTurns((prev) => [...prev, { role: "assistant", content: body.answer }]);
      if (body.conversationId) setConversationId(body.conversationId);
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
          Ask about your targets, your macros, or what to eat next.
        </p>
      )}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <form onSubmit={ask} className="space-y-2">
        <Textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={2}
          placeholder="Am I on track for protein today?"
          aria-label="Ask the assistant"
        />
        <PendingButton
          type="submit"
          pending={pending}
          pendingLabel="Thinking…"
          disabled={question.trim().length === 0}
        >
          Ask
        </PendingButton>
      </form>

      <p className="text-muted-foreground text-xs">
        Each question is answered on its own — earlier messages are kept for
        you to read, not sent back to the assistant, so a follow-up needs to
        restate what it is about. Your targets and today&rsquo;s totals go with
        the question as plain numbers; your name, email and weight history do
        not.
      </p>
    </div>
  );
}
