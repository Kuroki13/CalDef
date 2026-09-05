/**
 * Constraining a redirect target to this application.
 *
 * The proxy puts the path a signed-out visitor asked for into `?next=`, the
 * login form posts it back, and the sign-in action redirects to it. That is a
 * value an attacker can choose, so it decides where someone lands
 * immediately after typing their password — the worst possible moment to be
 * sent to a convincing copy of this app.
 *
 * Pure and exported so it can be tested; the server action that uses it
 * cannot export a helper of its own.
 */

/**
 * The whole value must look like an in-app path.
 *
 * The familiar pair — starts with `/`, does not start with `//` — is not
 * enough. Browsers normalise a backslash to a forward slash in the authority
 * position, so `/\evil.example` passes both tests and then navigates
 * off-site. Matching a path shape closes that and the rest of its family,
 * rather than blacklisting one character at a time.
 */
const IN_APP_PATH = /^\/(?![/\\])[\w\-./?=&%~+]*$/;

export const DEFAULT_REDIRECT = "/dashboard";

export function safeRedirect(raw: string | null | undefined): string {
  const next = String(raw ?? "").trim();
  return IN_APP_PATH.test(next) ? next : DEFAULT_REDIRECT;
}
