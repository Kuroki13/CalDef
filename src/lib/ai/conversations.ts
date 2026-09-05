import "server-only";

/**
 * Assistant threads.
 *
 * Stored so a conversation survives a page reload, and so the account owner
 * can see and delete what they have asked. Nothing here is ever sent to
 * Gemini: each question is answered on its own, with the anonymous figures
 * of the moment, and the stored history is for the user's screen only.
 *
 * That is a deliberate limitation rather than an oversight — replaying a
 * thread would mean sending back everything previously typed, which is
 * exactly the accumulation of personal detail the data-minimization rule
 * exists to prevent. A follow-up question therefore has to restate its own
 * context, and the UI says so.
 */

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

export async function messagesFor(conversationId: number): Promise<Message[]> {
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
