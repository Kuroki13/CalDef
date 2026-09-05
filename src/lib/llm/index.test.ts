import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { trustedFoodText } from "@/lib/llm/food-text";

const hasGeminiKey = vi.fn();
const maybeSingle = vi.fn();

vi.mock("@/lib/env.server", () => ({
  GEMINI_API_KEY: null,
  USDA_API_KEY: null,
  hasGeminiKey: () => hasGeminiKey(),
  hasUsdaKey: () => false,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ maybeSingle: () => maybeSingle() }) }),
  }),
  getUserId: vi.fn(),
  requireUserId: vi.fn(),
}));

const { llmFor, llmForCurrentUser } = await import("@/lib/llm");

const text = trustedFoodText("200g chicken");

beforeEach(() => {
  vi.clearAllMocks();
  hasGeminiKey.mockReturnValue(true);
  maybeSingle.mockResolvedValue({ data: { ai_enabled: true } });
});

afterEach(() => vi.restoreAllMocks());

describe("llmFor", () => {
  it("returns Gemini when the key is present and the user has it on", () => {
    expect(llmFor(true).name).toBe("Gemini");
  });

  it("returns the disabled provider when the user switched it off", () => {
    const provider = llmFor(false);
    expect(provider.isAvailable()).toBe(false);
    expect(provider.name).toBe("AI disabled");
  });

  it("prefers the user's switch over the key being present", () => {
    hasGeminiKey.mockReturnValue(true);
    // Their choice wins: a configured key does not override "off".
    expect(llmFor(false).name).toBe("AI disabled");
  });

  it("returns the unconfigured provider when there is no key", () => {
    hasGeminiKey.mockReturnValue(false);
    expect(llmFor(true).name).toBe("AI unconfigured");
  });
});

describe("with GEMINI_API_KEY unset", () => {
  it("still answers every call, without touching the network", async () => {
    hasGeminiKey.mockReturnValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const provider = llmFor(true);
    const result = await provider.parseFoods(text);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("unconfigured");
      // The whole promise of invariant 3 in one string.
      expect(result.message).toContain("manually");
    }

    vi.unstubAllGlobals();
  });
});

describe("llmForCurrentUser", () => {
  it("reads only the flag from the profile", async () => {
    const provider = await llmForCurrentUser();
    expect(provider.name).toBe("Gemini");
  });

  it("treats a missing profile as the AI being off", async () => {
    maybeSingle.mockResolvedValue({ data: null });
    // "We do not know" is not a reason to start sending things to a model.
    expect((await llmForCurrentUser()).isAvailable()).toBe(false);
  });
});
