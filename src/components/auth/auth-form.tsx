"use client";

import Link from "next/link";
import { useActionState } from "react";

import type { AuthState } from "@/app/auth/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PendingButton } from "@/components/pending-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  action: (prev: AuthState, formData: FormData) => Promise<AuthState>;
  submitLabel: string;
  pendingLabel: string;
  next?: string;
  initialError?: string;
  footer: React.ReactNode;
};

export function AuthForm({
  action,
  submitLabel,
  pendingLabel,
  next,
  initialError,
  footer,
}: Props) {
  const [state, formAction] = useActionState<AuthState, FormData>(action, {
    error: initialError,
  });

  return (
    <form action={formAction} className="space-y-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      {state.notice ? (
        <Alert>
          <AlertDescription>{state.notice}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          placeholder="At least 8 characters"
        />
      </div>

      <PendingButton type="submit" className="w-full" pendingLabel={pendingLabel}>
        {submitLabel}
      </PendingButton>

      <p className="text-muted-foreground text-center text-sm">{footer}</p>
    </form>
  );
}

export function AuthFooterLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className="text-foreground font-medium underline">
      {children}
    </Link>
  );
}
