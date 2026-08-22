import type { Metadata } from "next";

import { signIn } from "@/app/auth/actions";
import { AuthFooterLink, AuthForm } from "@/components/auth/auth-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = { title: "Sign in · CalDef" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Welcome back.</CardDescription>
      </CardHeader>
      <CardContent>
        <AuthForm
          action={signIn}
          submitLabel="Sign in"
          pendingLabel="Signing in…"
          next={next}
          initialError={error}
          footer={
            <>
              No account yet?{" "}
              <AuthFooterLink href="/signup">Create one</AuthFooterLink>
            </>
          }
        />
      </CardContent>
    </Card>
  );
}
