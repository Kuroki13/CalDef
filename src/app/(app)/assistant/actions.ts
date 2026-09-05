"use server";

import { revalidatePath } from "next/cache";

import { deleteConversation, latestThread } from "@/lib/ai/conversations";

/**
 * Deletes the current thread.
 *
 * `conversations.ts` says the thread is stored "so the account owner can see
 * and delete what they have asked" — which was only half true until this
 * existed. For an app whose whole AI story is about sending as little as
 * possible, being unable to delete what you typed is the wrong gap to leave.
 *
 * Takes no id: it deletes the thread the page is showing, so a forged id has
 * nothing to aim at. The cascade removes its messages.
 */
export async function clearThread(): Promise<void> {
  const thread = await latestThread();
  if (!thread) return;

  await deleteConversation(thread.conversation.id);
  revalidatePath("/assistant");
}
