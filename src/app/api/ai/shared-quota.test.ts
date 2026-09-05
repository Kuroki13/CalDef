import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { __resetRateLimits } from "@/lib/rate-limit";

/**
 * The AI routes share one upstream budget.
 *
 * Each route holds its own 10/min bucket, so no single screen can starve the
 * others. On its own that is not enough: three routes at 10/min is 30
 * requests a minute against a model whose free tier allows 15, and our
 * limiter would have reported everything fine while Gemini refused. This
 * file is the test that the shared bucket closes that gap — it can only be
 * written across routes, which is why it does not live in any one of them.
 */

const getUserId = vi.fn();
const parseFoods = vi.fn();
const answer = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getUserId: () => getUserId(),
  requireUserId: () => getUserId(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/llm", () => ({
  llmForCurrentUser: async () => ({
    name: "stub",
    isAvailable: () => true,
    parseFoods: (...a: unknown[]) => parseFoods(...a),
    parseCorrection: vi.fn(),
    answer: (...a: unknown[]) => answer(...a),
  }),
}));

vi.mock("@/lib/ai/resolve", () => ({
  resolveIntents: async () => ({ proposals: [], degraded: false }),
}));

vi.mock("@/lib/ai/figures", () => ({ currentFigures: async () => ({}) }));

vi.mock("@/lib/ai/conversations", () => ({
  openThread: async () => ({ id: 1 }),
  appendMessage: async () => undefined,
}));

const { POST: parse } = await import("@/app/api/ai/parse/route");
const { POST: chat } = await import("@/app/api/ai/chat/route");

const callParse = () =>
  parse(
    new NextRequest("http://localhost/api/ai/parse", {
      method: "POST",
      body: JSON.stringify({ text: "200g rice" }),
    }),
  );

const callChat = () =>
  chat(
    new NextRequest("http://localhost/api/ai/chat", {
      method: "POST",
      body: JSON.stringify({ message: "how much protein?" }),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimits();
  getUserId.mockResolvedValue("user-1");
  parseFoods.mockResolvedValue({ ok: true, value: { foods: [] } });
  answer.mockResolvedValue({ ok: true, value: "180 g." });
});

describe("the AI routes share one Gemini budget", () => {
  it("refuses a route that is under its own limit once the shared one is spent", async () => {
    // Six each: neither route is near its own 10/min ceiling.
    for (let i = 0; i < 6; i++) expect((await callParse()).status).toBe(200);
    for (let i = 0; i < 6; i++) expect((await callChat()).status).toBe(200);

    // Twelve Gemini calls have now been made, which is the shared ceiling.
    const response = await callParse();

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeTruthy();
  });

  it("stops the provider being called once refused", async () => {
    for (let i = 0; i < 6; i++) await callParse();
    for (let i = 0; i < 6; i++) await callChat();

    const before = parseFoods.mock.calls.length;
    await callParse();

    // The point of the limiter is the request that does not happen.
    expect(parseFoods.mock.calls.length).toBe(before);
  });

  it("names our own limiter, so it is not read as the provider's", async () => {
    for (let i = 0; i < 12; i++) await callParse();

    const body = await (await callParse()).json();

    // Both answer 429. `too-many-requests` is ours and clears in a minute;
    // `rate-limited` is Gemini's own quota, which is a different problem
    // with a different remedy.
    expect(body.reason).toBe("too-many-requests");
  });

  it("keeps each user's budget separate", async () => {
    for (let i = 0; i < 12; i++) await callParse();
    expect((await callParse()).status).toBe(429);

    getUserId.mockResolvedValue("user-2");
    expect((await callParse()).status).toBe(200);
  });
});
