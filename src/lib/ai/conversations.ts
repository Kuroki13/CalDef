import "server-only";

/**
 * Assistant threads.
 *
 * Stored so a conversation survives a page reload, so the account owner can
 * see and delete what they have asked, and — through `recentTurns` — so a
 * follow-up like "and how much protein was that?" has something to refer to.
 *
 * Carrying a thread forward is exactly where the data-minimization rule
 * could quietly be lost, so the way out is narrow. `recentTurns` re-checks
 * every stored message with `toFoodText` and drops the ones that no longer
 * pass, which means what crosses the boundary is `FoodText` and nothing
 * else — the same branded type every other call site takes. A message the
 * gate refuses is not trimmed or masked; it simply does not go, and the
 * conversation carries on without it.
 */

import { toFoodText } from "@/lib/llm/food-text";
import type { ChatTurn } from "@/lib/llm/types";
import { createClient, requireUserId } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";

export type Conversation = Tables<"ai_conversations">;
export type Message = Tables<"ai_messages">;

export type Thread = {
  conversation: Conversation;
  messages: Message[];
};

/** The most recent thread, or null when there has never been one. */
export async function latestThread(): Promise<Thread | null> {
  const supabase = await createClient();

  const { data: conversation, error } = await supabase
    .from("ai_conversations")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!conversation) return null;

  return { conversation, messages: await messagesFor(conversation.id) };
}

async function messagesFor(conversationId: number): Promise<Message[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("ai_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error(error.message);

  return data ?? [];
}

/**
 * How many turns of context a follow-up gets.
 *
 * Six messages is roughly three exchanges: enough for "and how much protein
 * was that?" to find its referent, short enough that a long conversation
 * does not accumulate into a dossier or a prompt that costs more of a free
 * quota than the question is worth.
 */
export const HISTORY_TURNS = 6;

/**
 * The tail of a thread, as food text.
 *
 * Ordered oldest to newest, because that is the order a reader — human or
 * model — needs to follow a reference backwards. Anything the gate refuses
 * is dropped silently: it was already stored and already shown on the
 * user's own screen, and this is only about what may leave.
 */
export async function recentTurns(
  conversationId: number,
  limit: number = HISTORY_TURNS,
): Promise<ChatTurn[]> {
  const supabase = await createClient();

  // RLS scopes this to the owner's own thread; the filter is what makes the
  // query mean "this conversation" rather than "any of mine".
  const { data, error } = await supabase
    .from("ai_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) return [];

  return (data ?? [])
    .reverse()
    .flatMap((message): ChatTurn[] => {
      // A system message is instruction, not conversation, and has no place
      // in a transcript being replayed to the model.
      if (message.role !== "user" && message.role !== "assistant") return [];

      const text = toFoodText(message.content);
      if (!text.ok) return [];

      return [{ role: message.role, text: text.value }];
    });
}

/**
 * Finds the thread to append to, creating one on the first question.
 *
 * The title is the opening question, trimmed — it is the user's own words on
 * the user's own screen, and it never leaves the database.
 */
export async function openThread(
  conversationId: number | null,
  firstQuestion: string,
): Promise<{ id: number } | { error: string }> {
  const userId = await requireUserId();
  const supabase = await createClient();

  if (conversationId !== null) {
    // RLS scopes this, so a guessed id finds nothing and falls through to a
    // new thread rather than writing into someone else's.
    const { data } = await supabase
      .from("ai_conversations")
      .select("id")
      .eq("id", conversationId)
      .maybeSingle();
    if (data) return { id: data.id };
  }

  const { data, error } = await supabase
    .from("ai_conversations")
    .insert({ user_id: userId, title: firstQuestion.slice(0, 80) })
    .select("id")
    .single();
  if (error) return { error: error.message };

  return { id: data.id };
}

export async function appendMessage(
  conversationId: number,
  role: "user" | "assistant",
  content: string,
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("ai_messages")
    .insert({ conversation_id: conversationId, role, content });
  if (error) throw new Error(error.message);

  // Moves the thread to the top of the list, which is what "latest" means.
  await supabase
    .from("ai_conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);
}

export async function deleteConversation(id: number): Promise<void> {
  await requireUserId();
  const supabase = await createClient();
  await supabase.from("ai_conversations").delete().eq("id", id);
}
