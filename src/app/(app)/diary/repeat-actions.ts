"use server";

/**
 * Logging an entry again, or copying a meal from yesterday (spec §12E).
 *
 * The form says which entries and how much; `repeatEntries` decides the
 * figures, through the same paths a fresh log takes.
 */

import { revalidatePath } from "next/cache";

import { operationKeyFrom } from "@/lib/operation-key";
import { repeatEntries } from "@/lib/repeat";
import { parseRepeatForm } from "@/lib/repeat-input";

export type RepeatState = { error?: string; ok?: boolean; notice?: string };

export async function repeatEntriesAction(
  _prev: RepeatState,
  formData: FormData,
): Promise<RepeatState> {
  const parsed = parseRepeatForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  const outcome = await repeatEntries({ ...parsed, operationKey: operationKeyFrom(formData) });
  if ("error" in outcome) return { error: outcome.error };

  revalidatePath("/diary");
  revalidatePath("/dashboard");

  const added = `Added ${outcome.logged} item${outcome.logged === 1 ? "" : "s"}.`;
  if (outcome.failed.length === 0) return { ok: true, notice: added };

  // All or nothing: one entry that cannot be logged holds the others back,
  // so the meal is never half in the diary. Say which, so it can be untick-
  // ed or fixed, and the rest sent again safely.
  const missing = outcome.failed.map((f) => `${f.name} (${f.reason})`).join("; ");
  return { error: `Nothing was added: ${missing}.` };
}
