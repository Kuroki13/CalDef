/**
 * Who may create an account.
 *
 * This app is deployed on the open internet and is single-user by design.
 * An account is not harmless to give away: it can spend the owner's Gemini
 * quota against the owner's key, and the rate limiter is per serverless
 * instance, so it does not bound what a determined stranger can do.
 *
 * So signup is closed by default and opened by naming addresses in
 * `SIGNUP_ALLOWLIST`. **Unset means nobody**, which is the safe direction to
 * fail: a missing variable in a new environment must not quietly reopen the
 * door. Existing accounts are unaffected — this gates signup only, never
 * sign-in.
 *
 * Pure and client-safe on purpose, so it can be tested without a database
 * and without the environment. Reading the variable and enforcing the answer
 * both happen server-side; see `app/auth/actions.ts`.
 */

/**
 * Addresses are compared trimmed and lowercased, and nothing else.
 *
 * No Gmail dot-and-plus folding: treating `a.b@gmail.com` and `ab@gmail.com`
 * as the same address is a provider-specific rule that would silently widen
 * the list, and widening an allowlist by inference is the opposite of what
 * one is for. The owner writes the address they will actually type.
 */
export function normaliseAddress(value: string): string {
  return value.trim().toLowerCase();
}

/** Parses the environment variable into the set it names. */
export function parseAllowlist(raw: string | null | undefined): Set<string> {
  if (!raw) return new Set();

  return new Set(
    raw
      .split(/[,\s]+/)
      .map(normaliseAddress)
      // A stray comma or a trailing newline is not an address, and an entry
      // with no `@` cannot match one either — dropping both keeps a typo in
      // the variable from becoming a silent hole.
      .filter((entry) => entry.length > 0 && entry.includes("@")),
  );
}

/** Whether this address may create an account. */
export function isSignupAllowed(
  email: string,
  allowlist: ReadonlySet<string>,
): boolean {
  return allowlist.has(normaliseAddress(email));
}

/**
 * What the user is told when they are not on the list.
 *
 * The same sentence whichever address was typed, so the form cannot be used
 * to discover who has an account here. It states the situation plainly
 * rather than implying a fault the visitor could fix by trying again.
 */
export const SIGNUP_CLOSED_MESSAGE =
  "This is a personal app and it is not open for signup. " +
  "If you already have an account, sign in instead.";
