"use client";

import { useState } from "react";
import { FoodProposalReview } from "@/components/food-proposal-review";
import { PendingButton } from "@/components/pending-button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { FoodProposal } from "@/lib/ai/resolve";
import type { MealType } from "@/lib/diary";

export function DescribeFood({ logDate, mealTypes }: { logDate: string; mealTypes: MealType[] }) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ id: number; proposals: FoodProposal[]; notice?: string; degraded?: boolean } | null>(null);
  async function run(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim() || pending) return;
    setPending(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/ai/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      const body = await response.json();
      if (!response.ok) { setError(body.error ?? "The assistant could not be reached."); return; }
      setResult({ id: Date.now(), proposals: body.proposals ?? [], notice: body.notice, degraded: body.degraded });
    } catch { setError("Could not reach the assistant. Food search still works."); }
    finally { setPending(false); }
  }
  return <Card>
    <CardHeader><CardTitle className="text-base">Describe a meal</CardTitle><CardDescription>Write what you ate, including the brand or restaurant. Review the match and macros before confirming.</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      <form onSubmit={run} className="space-y-2">
        <Textarea aria-label="Describe what you ate" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="I ate a Harvey’s Big Angus burger" />
        <PendingButton type="submit" variant="secondary" pending={pending} pendingLabel="Reading…" disabled={!text.trim()}>Read this</PendingButton>
      </form>
      {error ? <p role="alert" className="text-destructive text-sm">{error}</p> : null}
      {result?.degraded ? <p className="text-muted-foreground text-sm">A food source did not respond; these matches may be incomplete.</p> : null}
      {result && !result.proposals.length ? <p className="text-sm">{result.notice ?? "No food found in that."}</p> : null}
      {result?.proposals.length ? <FoodProposalReview key={result.id} proposals={result.proposals} logDate={logDate} mealTypes={mealTypes} /> : null}
    </CardContent>
  </Card>;
}
