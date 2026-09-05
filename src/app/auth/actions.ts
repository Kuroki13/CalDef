"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { safeRedirect } from "@/lib/safe-redirect";
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
