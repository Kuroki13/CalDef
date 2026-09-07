import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What may leave a stored thread.
 *
 * `recentTurns` is the only way a previous message reaches the model, so it
 * is where the data-minimization rule is kept once conversations have
 * memory. Everything it returns is `FoodText`, which is produced only by
 * `toFoodText` and only for text that passed its checks.
 */

const rows = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: async () => rows(),
      };
      return chain;
    },
  }),
  requireUserId: async () => "user-1",
}));

const { HISTORY_TURNS, recentTurns } = await import("@/lib/ai/conversations");

const message = (role: string, content: string) => ({ role, content });

beforeEach(() => vi.clearAllMocks());

describe("recentTurns", () => {
  it("returns the tail oldest first, which is the order a reference reads in", async () => {
    // The query asks for the newest rows; a transcript has to run forwards.
    rows.mockResolvedValue({
      data: [
        message("assistant", "About 31 g of protein per 100 g."),
        message("user", "and how much protein was that?"),
        message("assistant", "Chicken breast is about 165 kcal per 100 g."),
        message("user", "how many calories in chicken breast?"),
      ],
      error: null,
    });

    const turns = await recentTurns(7);

    expect(turns.map((t) => t.text)).toEqual([
      "how many calories in chicken breast?",
      "Chicken breast is about 165 kcal per 100 g.",
      "and how much protein was that?",
      "About 31 g of protein per 100 g.",
    ]);
    expect(turns[0].role).toBe("user");
  });

  it("drops a stored message that no longer passes the gate", async () => {
    // The question was refused at the time, but a message can also be stored
    // and later fail a gate that has since been tightened. Either way it does
    // not leave: dropped whole, not trimmed, so the model is never handed a
    // sentence with a hole where an address used to be.
    rows.mockResolvedValue({
      data: [
        message("user", "email me at someone@example.com about the rice"),
        message("user", "how many calories in rice?"),
      ],
      error: null,
    });

    const turns = await recentTurns(7);

    expect(turns).toHaveLength(1);
    expect(turns[0].text).toBe("how many calories in rice?");
  });

  it("drops a message carrying something that looks like an identifier", async () => {
    rows.mockResolvedValue({
      data: [
        message("user", "chicken for 123e4567-e89b-12d3-a456-426614174000"),
        message("assistant", "Chicken breast is about 165 kcal per 100 g."),
      ],
      error: null,
    });

    const turns = await recentTurns(7);

    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe("assistant");
  });

  it("keeps system messages out of a replayed transcript", async () => {
    rows.mockResolvedValue({
      data: [message("system", "internal note"), message("user", "rice?")],
      error: null,
    });

    const turns = await recentTurns(7);

    expect(turns.map((t) => t.role)).toEqual(["user"]);
  });

  it("carries a few turns, not a conversation's whole history", async () => {
    // A long thread must not accumulate into a dossier, or into a prompt
    // that costs more of a free quota than the question is worth.
    expect(HISTORY_TURNS).toBeLessThanOrEqual(8);
  });

  it("answers with nothing when the thread cannot be read", async () => {
    // A failure to load context is not a reason to fail the question: the
    // answer is simply the one a first question would have got.
    rows.mockResolvedValue({ data: null, error: { message: "boom" } });

    expect(await recentTurns(7)).toEqual([]);
  });
});
