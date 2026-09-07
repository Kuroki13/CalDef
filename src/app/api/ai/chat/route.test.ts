import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { __resetRateLimits } from "@/lib/rate-limit";

const getUserId = vi.fn();
const answer = vi.fn();
const parseFoods = vi.fn();
const resolveIntents = vi.fn();
const isAvailable = vi.fn();
const currentFigures = vi.fn();
const openThread = vi.fn();
const appendMessage = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getUserId: () => getUserId(),
  requireUserId: () => getUserId(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/llm", () => ({
  llmForCurrentUser: async () => ({
    name: "stub",
    isAvailable: () => isAvailable(),
    parseFoods: (...a: unknown[]) => parseFoods(...a),
    parseCorrection: vi.fn(),
    answer: (...a: unknown[]) => answer(...a),
  }),
}));

vi.mock("@/lib/ai/resolve", () => ({ resolveIntents: (...a: unknown[]) => resolveIntents(...a) }));

vi.mock("@/lib/ai/figures", () => ({
  currentFigures: () => currentFigures(),
}));

vi.mock("@/lib/ai/conversations", () => ({
  openThread: (...a: unknown[]) => openThread(...a),
  appendMessage: (...a: unknown[]) => appendMessage(...a),
}));

const { POST } = await import("@/app/api/ai/chat/route");

const call = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/ai/chat", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimits();
  getUserId.mockResolvedValue("user-1");
  isAvailable.mockReturnValue(true);
  answer.mockResolvedValue({ ok: true, value: "Aim for 180 g of protein." });
  currentFigures.mockResolvedValue({
    targetCalories: 2250,
    targetProteinG: 180,
  });
  openThread.mockResolvedValue({ id: 5 });
  parseFoods.mockResolvedValue({ ok: true, value: { foods: [{ query: "Harvey's Big Angus Burger", amount: 1, unit: "serving" }] } });
  resolveIntents.mockResolvedValue({ proposals: [{ intent: { query: "Harvey's Big Angus Burger", amount: 1, unit: "serving" }, match: null, alternatives: [], grams: null, macros: null }], degraded: false });
});

describe("POST /api/ai/chat", () => {
  it("turns an eaten meal into reviewable proposals without figures or database writes", async () => {
    const response = await call({ message: "yeah I ate a harvey's big angus burger" });
    const body = await response.json();
    expect(body.kind).toBe("log");
    expect(body.proposals).toHaveLength(1);
    expect(body.answer).toContain("Nothing has been logged");
    expect(parseFoods).toHaveBeenCalledOnce();
    expect(resolveIntents).toHaveBeenCalledOnce();
    expect(answer).not.toHaveBeenCalled();
    expect(currentFigures).not.toHaveBeenCalled();
    expect(openThread).not.toHaveBeenCalled();
    expect(appendMessage).not.toHaveBeenCalled();
  });
  it("supports saving a named food separately from logging", async () => {
    const body = await (await call({ message: "Harvey's Angus Burger", mode: "save" })).json();
    expect(body.kind).toBe("save");
    expect(body.answer).toContain("Nothing has been logged");
    expect(openThread).not.toHaveBeenCalled();
  });
  it("offers a label form for a new custom food, with no model call", async () => {
    const body = await (await call({ message: "create a new food" })).json();
    expect(body.kind).toBe("create");
    expect(parseFoods).not.toHaveBeenCalled();
    expect(answer).not.toHaveBeenCalled();
  });
  it("honours question mode even if the sentence mentions eating", async () => {
    await call({ message: "I ate a burger", mode: "question" });
    expect(answer).toHaveBeenCalledOnce();
    expect(parseFoods).not.toHaveBeenCalled();
  });
  it("does not resolve foods when Gemini is over quota", async () => {
    parseFoods.mockResolvedValue({ ok: false, reason: "rate-limited", message: "Free quota reached." });
    const response = await call({ message: "I ate a burger" });
    expect(response.status).toBe(429);
    expect(resolveIntents).not.toHaveBeenCalled();
  });
  it("refuses an unauthenticated caller", async () => {
    getUserId.mockResolvedValue(null);
    const response = await call({ message: "hi" });

    expect(response.status).toBe(401);
    expect(answer).not.toHaveBeenCalled();
  });

  it("answers and stores both turns", async () => {
    const json = await (
      await call({ message: "Am I on track for protein?" })
    ).json();

    expect(json.answer).toContain("180 g");
    expect(json.conversationId).toBe(5);
    expect(json.stored).toBe(true);
    expect(appendMessage).toHaveBeenNthCalledWith(
      1,
      5,
      "user",
      "Am I on track for protein?",
    );
    expect(appendMessage).toHaveBeenNthCalledWith(
      2,
      5,
      "assistant",
      "Aim for 180 g of protein.",
    );
  });

  it("sends the question and the anonymous figures, and nothing else", async () => {
    await call({ message: "what should I eat?" });

    expect(answer).toHaveBeenCalledTimes(1);
    expect(answer).toHaveBeenCalledWith("what should I eat?", {
      targetCalories: 2250,
      targetProteinG: 180,
    });
  });

  it("does not replay the stored thread to the model", async () => {
    await call({ conversationId: 5, message: "and after that?" });

    // Only the new question. Replaying a thread would send back everything
    // previously typed, which is what the minimization rule prevents.
    const [sent] = answer.mock.calls[0];
    expect(sent).toBe("and after that?");
    expect(answer.mock.calls[0]).toHaveLength(2);
  });

  it("refuses a question carrying an identifier before the model", async () => {
    const response = await call({
      message: "my email is me@example.com, what should I eat?",
    });

    expect(response.status).toBe(400);
    expect((await response.json()).reason).toBe("email");
    expect(answer).not.toHaveBeenCalled();
  });

  it("stores nothing when the assistant is off", async () => {
    isAvailable.mockReturnValue(false);
    answer.mockResolvedValue({
      ok: false,
      reason: "disabled",
      message: "The assistant is off. Search for the food and log it manually.",
    });

    const response = await call({ message: "hi" });

    expect(response.status).toBe(503);
    // A question with no answer beside it in the database would be a puzzle
    // for whoever reads the thread later.
    expect(openThread).not.toHaveBeenCalled();
    expect(appendMessage).not.toHaveBeenCalled();
  });

  it("does not send figures when the assistant is off", async () => {
    isAvailable.mockReturnValue(false);
    answer.mockResolvedValue({
      ok: false,
      reason: "unconfigured",
      message: "not configured",
    });

    await call({ message: "hi" });

    expect(currentFigures).not.toHaveBeenCalled();
  });

  it("returns the answer even when the thread could not be stored", async () => {
    openThread.mockResolvedValue({ error: "insert failed" });

    const json = await (await call({ message: "hi" })).json();

    // Discarding a reply the user is waiting for, because a row failed to
    // write, would be the worse trade.
    expect(json.answer).toContain("180 g");
    expect(json.stored).toBe(false);
    expect(appendMessage).not.toHaveBeenCalled();
  });

  it("answers 429 when the free quota is spent", async () => {
    answer.mockResolvedValue({
      ok: false,
      reason: "rate-limited",
      message: "over quota",
    });

    const response = await call({ message: "hi" });
    expect(response.status).toBe(429);
    expect(appendMessage).not.toHaveBeenCalled();
  });

  it("rate limits repeated questions", async () => {
    for (let i = 0; i < 10; i++) await call({ message: "hi" });
    const response = await call({ message: "hi" });
    expect(response.status).toBe(429);
  });
});
