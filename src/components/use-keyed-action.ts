"use client";

/**
 * A form action that writes to the diary at most once (ARCHITECTURE
 * invariant 27).
 *
 * The form holds one operation key while it is open and sends it as
 * `clientToken`. The server writes the operation's entries under that key,
 * so a double tap, or the same request sent again, is answered with what
 * the first one wrote.
 *
 * The key is renewed only after the server has answered — success or a
 * refusal, both of which mean the operation is settled. It is kept when the
 * request could not be completed: the request may have arrived and the
 * reply been lost, so the retry must carry the same key to be recognised.
 * In that case the form stays as it was (no error screen) and says so.
 */

import { useActionState, useState } from "react";

export const CONNECTION_LOST =
  "No connection — this may not have been added. Try again when you are back online: it will not be added twice.";

export function useKeyedAction<S extends { error?: string }>(
  action: (previous: S, form: FormData) => Promise<S>,
  initial: S,
): [state: S, formAction: (form: FormData) => void, pending: boolean, operationKey: string] {
  const [operationKey, setOperationKey] = useState(() => crypto.randomUUID());
  const run = (previous: S, form: FormData): Promise<S> =>
    action(previous, form).then(
      (answer) => {
        setOperationKey(crypto.randomUUID());
        return answer;
      },
      // Unanswered: keep the key, keep the form.
      () => ({ ...previous, error: CONNECTION_LOST }),
    );
  const [state, formAction, pending] = useActionState(
    run as (previous: Awaited<S>, form: FormData) => Promise<S>,
    initial as Awaited<S>,
  );
  return [state as S, formAction, pending, operationKey];
}
