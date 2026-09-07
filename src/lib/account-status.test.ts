import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.fn((to: string): never => {
  throw new Error(`REDIRECT ${to}`);
});
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));

const { SESSION_ENDED_PATH, accountIsDeleted, ensureAccountExists } =
  await import("@/lib/account-status");

/** Only the fields the rule reads; the rest of a profile is irrelevant. */
const profile = { id: "user-1" } as unknown as Parameters<
  typeof accountIsDeleted
>[0]["profile"];

beforeEach(() => vi.clearAllMocks());

describe("accountIsDeleted", () => {
  it("is true for a signed-in request with no profile behind it", () => {
    // The case: the token verifies, because it is signed and unexpired, but
    // the account it names has been deleted and took its profile with it.
    expect(accountIsDeleted({ userId: "user-1", profile: null })).toBe(true);
  });

  it("is false for a live account", () => {
    expect(accountIsDeleted({ userId: "user-1", profile })).toBe(false);
  });

  it("is false when nobody is signed in", () => {
    // A signed-out request has no account to be missing. Treating it as
    // deleted would send every visitor through a sign-out.
    expect(accountIsDeleted({ userId: null, profile: null })).toBe(false);
  });
});

describe("ensureAccountExists", () => {
  it("sends a dead session to the route handler that can clear its cookies", () => {
    expect(() =>
      ensureAccountExists({ userId: "user-1", profile: null }),
    ).toThrow(/REDIRECT/);

    // Not to /login directly: a server component cannot write cookies, so
    // redirecting straight there would leave the browser holding the same
    // dead token and presenting it on every request until it expired.
    expect(redirect).toHaveBeenCalledWith(SESSION_ENDED_PATH);
  });

  it("does nothing at all to a live session", () => {
    expect(() =>
      ensureAccountExists({ userId: "user-1", profile }),
    ).not.toThrow();

    expect(redirect).not.toHaveBeenCalled();
  });

  it("leaves a signed-out request to the caller's own redirect", () => {
    expect(() =>
      ensureAccountExists({ userId: null, profile: null }),
    ).not.toThrow();

    expect(redirect).not.toHaveBeenCalled();
  });
});
