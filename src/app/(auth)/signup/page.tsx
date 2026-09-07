import type { Metadata } from "next";

import { signUp } from "@/app/auth/actions";
import { AuthFooterLink, AuthForm } from "@/components/auth/auth-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SIGNUP_ALLOWLIST } from "@/lib/env.server";
import { SIGNUP_CLOSED_MESSAGE, parseAllowlist } from "@/lib/signup-allowlist";

export const metadata: Metadata = { title: "Create account · CalDef" };

export default function SignupPage() {
  // Only whether the door is open, never who is on the list: rendering the
  // addresses would publish them. The form is still refused server-side for
  // anyone not named, so this is courtesy rather than enforcement — someone
  // who reaches the action another way meets the same answer.
  const open = parseAllowlist(SIGNUP_ALLOWLIST).size > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>
          {open
            ? "You will set up your profile and goal next."
            : "Signup is closed on this deployment."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {open ? (
          <AuthForm
            action={signUp}
            submitLabel="Create account"
            pendingLabel="Creating account…"
            footer={
              <>
                Already have an account?{" "}
                <AuthFooterLink href="/login">Sign in</AuthFooterLink>
              </>
            }
          />
        ) : (
          <div className="space-y-4">
            <Alert>
              <AlertDescription>{SIGNUP_CLOSED_MESSAGE}</AlertDescription>
            </Alert>
            <p className="text-muted-foreground text-center text-sm">
              <AuthFooterLink href="/login">Sign in</AuthFooterLink>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
