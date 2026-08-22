import type { Metadata } from "next";

import { signUp } from "@/app/auth/actions";
import { AuthFooterLink, AuthForm } from "@/components/auth/auth-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = { title: "Create account · CalDef" };

export default function SignupPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>
          You will set up your profile and goal next.
        </CardDescription>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  );
}
