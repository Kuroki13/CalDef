import "server-only";

/**
 * The `FoodProvider` port.
 *
 * Providers are reachable only from server code, because their keys are
 * server-only and because the browser must never talk to a third party
 * directly (ARCHITECTURE §2). The `server-only` import above enforces that
 * at build time.
 */

import type { Food, FoodSearchQuery, ProviderResult } from "@/lib/food/types";

export type FoodProvider = {
  readonly name: string;
  /** False when the provider is unconfigured, e.g. a missing API key. */
  isAvailable(): boolean;
  search(query: FoodSearchQuery): Promise<ProviderResult>;
  /** Not every provider can resolve barcodes; USDA effectively cannot. */
  lookupBarcode?(barcode: string): Promise<Food | null>;
};

/** How long we wait on a provider before treating it as unavailable. */
export const PROVIDER_TIMEOUT_MS = 6000;

/**
 * `fetch` with a timeout and a descriptive User-Agent.
 *
 * Open Food Facts asks integrators to identify themselves, and a hung
 * provider must not hold a search open indefinitely — the point of the
 * degradation rule is that the other sources still return.
 */
export async function providerFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs = PROVIDER_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent":
          "CalDef/0.1 (personal nutrition tracker; +https://github.com/Kuroki13/CalDef)",
        Accept: "application/json",
        ...init.headers,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wraps a provider call so a failure becomes a value.
 *
 * Also the single place error text is sanitised. A provider error can carry
 * the request URL, and for USDA that URL contains the API key — so the
 * message is never passed through verbatim.
 */
export async function safeProviderCall(
  source: ProviderResult["source"],
  fn: () => Promise<Food[]>,
): Promise<ProviderResult> {
  try {
    return { source, ok: true, foods: await fn() };
  } catch (error) {
    return {
      source,
      ok: false,
      foods: [],
      error: describeFailure(error),
    };
  }
}

function describeFailure(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") {
    return "The provider did not respond in time.";
  }
  if (error instanceof ProviderHttpError) {
    return `The provider returned ${error.status}.`;
  }
  // Deliberately generic: an upstream message may embed the request URL,
  // and the USDA request URL carries the API key.
  return "The provider could not be reached.";
}

export class ProviderHttpError extends Error {
  constructor(readonly status: number) {
    super(`Provider responded ${status}`);
    this.name = "ProviderHttpError";
  }
}
