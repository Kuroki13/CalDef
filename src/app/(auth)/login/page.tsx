import type { Metadata } from "next";

import { signIn } from "@/app/auth/actions";
import { AuthFooterLink, AuthForm } from "@/components/auth/auth-form";
import { SIGNUP_ALLOWLIST } from "@/lib/env.server";
import { parseAllowlist } from "@/lib/signup-allowlist";

export const metadata: Metadata = { title: "Sign in · CalDef" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  // Signup is closed unless an address is named (ARCHITECTURE invariant
  // 13). A link to a form that can only refuse is not offered. There is no
  // password recovery in the app yet, so no link to one is shown either.
  const signupOpen = parseAllowlist(SIGNUP_ALLOWLIST).size > 0;

  return (
    <section aria-labelledby="sign-in">
      <h2 id="sign-in" className="display mb-4 text-3xl">Sign in</h2>
        <AuthForm
          action={signIn}
          submitLabel="Sign in"
          pendingLabel="Signing in…"
          next={next}
          initialError={error}
          footer={
            signupOpen ? (
              <>
                No account yet?{" "}
                <AuthFooterLink href="/signup">Create one</AuthFooterLink>
              </>
            ) : (
              "A personal app: accounts are by invitation."
            )
          }
        />
    </section>
  );
}
