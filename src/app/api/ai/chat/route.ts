import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { appendMessage, openThread, recentTurns } from "@/lib/ai/conversations";
import { currentFigures } from "@/lib/ai/figures";
import { assistantIntent } from "@/lib/ai/message-intent";
import { resolveIntents } from "@/lib/ai/resolve";
import { toFoodText } from "@/lib/llm/food-text";
import { llmForCurrentUser } from "@/lib/llm";
import { RATE_LIMITS, rateLimitAll, rateLimitHeaders } from "@/lib/rate-limit";
import { getUserId } from "@/lib/supabase/server";

/**
 * The nutrition assistant.
 *
 * Two things leave this machine: the question, after `toFoodText` has
 * refused anything that looks like an identifier, and `currentFigures()` —
 * a handful of numbers with no name attached. The thread is stored for the
 * user's screen and is never replayed to the model, so a long conversation
 * does not become an accumulating dossier.
 */

const bodySchema = z.object({
  conversationId: z.coerce.number().int().positive().nullable().optional(),
  message: z.string().max(2000),
  mode: z.enum(["auto", "question", "log", "save", "create"]).default("auto"),
});

export async function POST(request: NextRequest) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Two buckets: this route's own, and the one every Gemini call shares.
  // Without the second, three routes at 10/min each could make 30 requests a
  // minute against a model whose free tier allows 15.
  const limit = rateLimitAll([
    { key: `ai-chat:${userId}`, options: RATE_LIMITS.ai },
    { key: `gemini:${userId}`, options: RATE_LIMITS.gemini },
  ]);
  const headers = rateLimitHeaders(limit.result, limit.limit);
  if (!limit.allowed) {
    // `reason` distinguishes our own limiter from the provider's, which also
    // answers 429 — see the note on `rate-limited` in lib/llm/types.ts.
    return NextResponse.json(
      {
        error: "Too many questions at once. Try again shortly.",
        reason: "too-many-requests",
      },
      { status: 429, headers },
    );
  }

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { error: "Ask a question." },
      { status: 400, headers },
    );
  }

  const question = toFoodText(body.data.message);
  if (!question.ok) {
    return NextResponse.json(
      { error: question.message, reason: question.reason },
      { status: 400, headers },
    );
  }

  const llm = await llmForCurrentUser();

  // Checked before the thread is written, so a switched-off assistant does
  // not leave a question sitting in the database with no answer beside it.
  if (!llm.isAvailable()) {
    const refused = await llm.answer(question.value, {});
    return NextResponse.json(
      {
        error: refused.ok ? "The assistant is unavailable." : refused.message,
        reason: refused.ok ? "unavailable" : refused.reason,
      },
      { status: 503, headers },
    );
  }

  const intent = assistantIntent(question.value, body.data.mode);
  if (intent === "create") {
    return NextResponse.json({ kind: "create", answer: "Enter the values from the food label below. Saving creates one of your own foods; it does not log a meal." }, { headers });
  }
  if (intent === "log" || intent === "save") {
    const parsed = await llm.parseFoods(question.value);
    if (!parsed.ok) return NextResponse.json(
      { error: parsed.message, reason: parsed.reason },
      { status: parsed.reason === "rate-limited" ? 429 : 503, headers },
    );
    const resolved = await resolveIntents(parsed.value.foods.slice(0, 8));
    const answer = resolved.proposals.length
      ? intent === "save" ? "Review these foods, then save them to your library. Nothing has been logged." : "Review the food, portion, date and meal below. Nothing has been logged yet."
      : "I could not identify a food. Try a name and portion, or choose Create a food to enter its label.";
    return NextResponse.json({ kind: intent, answer, ...resolved, stored: false }, { headers });
  }

  // A follow-up needs to know what it is following. Only the tail of this
  // thread, and only the part of it that still passes the food-text gate —
  // see `recentTurns`.
  const history = body.data.conversationId
    ? await recentTurns(body.data.conversationId)
    : [];

  const answer = await llm.answer(
    question.value,
    await currentFigures(),
    history,
  );
  if (!answer.ok) {
    return NextResponse.json(
      { error: answer.message, reason: answer.reason },
      { status: answer.reason === "rate-limited" ? 429 : 503, headers },
    );
  }

  const thread = await openThread(
    body.data.conversationId ?? null,
    question.value,
  );
  if ("error" in thread) {
    // The answer exists; only storing it failed. Returning it unstored beats
    // discarding a reply the user is waiting for.
    return NextResponse.json(
      { answer: answer.value, conversationId: null, stored: false },
      { headers },
    );
  }

  await appendMessage(thread.id, "user", question.value);
  await appendMessage(thread.id, "assistant", answer.value);

  return NextResponse.json(
    { answer: answer.value, conversationId: thread.id, stored: true },
    { headers },
  );
}
