"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { SIGNUP_ALLOWLIST } from "@/lib/env.server";
import { safeRedirect } from "@/lib/safe-redirect";
import {
  SIGNUP_CLOSED_MESSAGE,
  isSignupAllowed,
  parseAllowlist,
} from "@/lib/signup-allowlist";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error?: string; notice?: string };

const credentials = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

function readCredentials(formData: FormData) {
  return credentials.safeParse({
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  });
}

export async function signIn(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = readCredentials(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: error.message };

  redirect(safeRedirect(String(formData.get("next") ?? "")));
}

export async function signUp(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = readCredentials(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  // Checked here, before Supabase is called at all: this is the enforcement,
  // not a hint. The signup page also says the door is shut when the list is
  // empty, but a page is only a page — the address has to be refused on the
  // server whatever the browser was persuaded to send.
  //
  // Worth knowing what this does *not* cover: the publishable key is in the
  // client bundle by design, so Supabase's own `/auth/v1/signup` endpoint is
  // reachable without going through this action. Closing that is a project
  // setting (`disable_signup`), and production has it set. See
  // IMPLEMENTATION_STATUS.md.
  if (!isSignupAllowed(parsed.data.email, parseAllowlist(SIGNUP_ALLOWLIST))) {
    return { error: SIGNUP_CLOSED_MESSAGE };
  }

  const origin = (await headers()).get("origin") ?? "";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: `${origin}/auth/confirm` },
  });
  if (error) return { error: error.message };

  // Whether a session comes back depends on the project's "Confirm email"
  // setting. Both outcomes are handled so the flow works either way.
  if (data.session) redirect("/onboarding");

  return {
    notice:
      "Check your email for a confirmation link, then sign in. " +
      "You can close this page.",
  };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
