/**
 * The operation key a form sends with a diary write (ARCHITECTURE
 * invariant 27).
 *
 * A form makes one key when it opens and keeps it until it is answered, so
 * a double tap or a retried request carries the same key and the database
 * writes the entries once. Anything that is not a UUID is treated as no key
 * at all — never as an error the user has to understand.
 */

import { z } from "zod";

const keySchema = z.uuid();

export function operationKeyFrom(formData: FormData): string | null {
  const parsed = keySchema.safeParse(formData.get("clientToken"));
  return parsed.success ? parsed.data : null;
}
