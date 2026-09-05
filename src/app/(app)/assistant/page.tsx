import type { Metadata } from "next";
import Link from "next/link";

import { Chat, type Turn } from "@/app/(app)/assistant/chat";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { latestThread } from "@/lib/ai/conversations";
import { getAccountSetup } from "@/lib/profile";

export const metadata: Metadata = { title: "Assistant · CalDef" };

export default async function AssistantPage() {
  const { profile } = await getAccountSetup();
  // The layout guarantees setup is complete before this renders.
  if (!profile) return null;

  // The whole page is the assistant, so with it switched off there is
  // nothing to render but the way to turn it on. Every other screen works
  // exactly as before — ARCHITECTURE invariant 3.
  if (!profile.ai_enabled) {
    return (
      <div className="space-y-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">The assistant is off</CardTitle>
            <CardDescription>
              Turn it on in settings if you want it. Nothing else in CalDef
              depends on it: food search, logging, weight, targets and the cut
              phase all work without it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="secondary">
              <Link href="/settings">Open settings</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const thread = await latestThread();
  const turns: Turn[] = (thread?.messages ?? [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as Turn["role"], content: m.content }));

  return (
    <div className="space-y-6">
      <Header />
      <Card>
        <CardContent className="pt-6">
          <Chat
            initialTurns={turns}
            initialConversationId={thread?.conversation.id ?? null}
          />
        </CardContent>
      </Card>
      <p className="text-muted-foreground text-xs">
        CalDef provides estimates for personal tracking. It is not medical or
        dietary advice.
      </p>
    </div>
  );
}

function Header() {
  return (
    <header>
      <h1 className="text-2xl font-semibold tracking-tight">Assistant</h1>
      <p className="text-muted-foreground text-sm">
        Questions about nutrition, answered against your own numbers.
      </p>
    </header>
  );
}
