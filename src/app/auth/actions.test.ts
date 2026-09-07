import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Signup enforcement, at the only place that counts.
 *
 * The signup page hides its form when the allowlist is empty, but a page is
 * a suggestion. These check the server action itself: that a stranger is
 * refused, that the refusal happens before Supabase is reached at all, and
 * that sign-in is untouched by any of it.
 */

const signUpWithSupabase = vi.fn();
const signInWithPassword = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signUp: (...args: unknown[]) => signUpWithSupabase(...args),
      signInWithPassword: (...args: unknown[]) => signInWithPassword(...args),
      signOut: async () => ({ error: null }),
    },
  }),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ origin: "https://example.test" }),
}));

const redirect = vi.fn((): never => {
  // `redirect` throws in Next; the tests below only reach it on success.
  throw new Error("REDIRECT");
});
vi.mock("next/navigation", () => ({ redirect: () => redirect() }));

const allowlist = vi.hoisted(() => ({ value: null as string | null }));
vi.mock("@/lib/env.server", () => ({
  get SIGNUP_ALLOWLIST() {
    return allowlist.value;
  },
  GEMINI_API_KEY: null,
  USDA_API_KEY: null,
  hasGeminiKey: () => false,
  hasUsdaKey: () => false,
}));

const { signIn, signUp } = await import("@/app/auth/actions");

function credentials(email: string, password = "correct-horse") {
  const form = new FormData();
  form.set("email", email);
  form.set("password", password);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  allowlist.value = "owner@example.com";
  signUpWithSupabase.mockResolvedValue({ data: { session: null }, error: null });
});

afterEach(() => vi.restoreAllMocks());

describe("signUp — the allowlist is the gate", () => {
  it("refuses an address nobody named, without calling Supabase", async () => {
    const result = await signUp({}, credentials("stranger@example.com"));

    expect(result.error).toMatch(/not open for signup/i);
    // Reaching Supabase would spend its rate limit on a request that was
    // never going to be honoured, and would create the account if the
    // project setting ever drifted.
    expect(signUpWithSupabase).not.toHaveBeenCalled();
  });

  it("refuses everyone when the variable is unset", async () => {
    // The direction it fails in: a fresh environment is closed, not open.
    allowlist.value = null;

    const result = await signUp({}, credentials("owner@example.com"));

    expect(result.error).toMatch(/not open for signup/i);
    expect(signUpWithSupabase).not.toHaveBeenCalled();
  });

  it("admits an allowlisted address, however it was typed", async () => {
    const result = await signUp({}, credentials("  Owner@Example.COM "));

    expect(result.error).toBeUndefined();
    expect(signUpWithSupabase).toHaveBeenCalledOnce();
  });

  it("says the same thing to every refused address", async () => {
    // The form must not become a way to find out who has an account here.
    const a = await signUp({}, credentials("stranger@example.com"));
    const b = await signUp({}, credentials("someone.else@example.com"));

    expect(a.error).toBe(b.error);
  });

  it("still rejects a malformed address first, as it always did", async () => {
    const result = await signUp({}, credentials("not-an-address"));
    expect(result.error).toMatch(/valid email/i);
  });
});

describe("signIn — existing accounts keep working", () => {
  it("does not consult the allowlist", async () => {
    // The gate is on creating accounts. Someone who already has one must go
    // on signing in even if their address was never on the list — including
    // when the list is empty, which is the normal production state.
    allowlist.value = null;
    signInWithPassword.mockResolvedValue({ error: null });

    await expect(
      signIn({}, credentials("someone@example.com")),
    ).rejects.toThrow("REDIRECT");

    expect(signInWithPassword).toHaveBeenCalledOnce();
  });
});
