"use server";

/**
 * Logging an entry again, or copying a meal from yesterday (spec §12E).
 *
 * The form says which entries and how much; `repeatEntries` decides the
 * figures, through the same paths a fresh log takes.
 */

import { revalidatePath } from "next/cache";

import { repeatEntries } from "@/lib/repeat";
import { parseRepeatForm } from "@/lib/repeat-input";

export type RepeatState = { error?: string; ok?: boolean; notice?: string };

export async function repeatEntriesAction(
  _prev: RepeatState,
  formData: FormData,
): Promise<RepeatState> {
  const parsed = parseRepeatForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  const outcome = await repeatEntries(parsed);
  if ("error" in outcome) return { error: outcome.error };

  revalidatePath("/diary");
  revalidatePath("/dashboard");

  const added = `Added ${outcome.logged} item${outcome.logged === 1 ? "" : "s"}.`;
  if (outcome.failed.length === 0) return { ok: true, notice: added };

  // Some went in and some did not. Say exactly which, so the user retries
  // only those — re-sending the whole meal would log the rest twice.
  const missing = outcome.failed.map((f) => `${f.name} (${f.reason})`).join("; ");
  return outcome.logged > 0
    ? { ok: true, notice: `${added} Not added: ${missing}.` }
    : { error: `Nothing was added: ${missing}.` };
}
