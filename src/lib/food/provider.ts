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

/** Statuses worth a second attempt: the server is unwell, not the request. */
export const DEFAULT_RETRY_STATUSES = [429, 500, 502, 503, 504];

export type ProviderFetchOptions = {
  timeoutMs?: number;
  /** Extra attempts after the first. Only ever used on idempotent GETs. */
  retries?: number;
  retryStatuses?: readonly number[];
};

/**
 * `fetch` with a timeout, a descriptive User-Agent, and a bounded retry.
 *
 * Open Food Facts asks integrators to identify themselves, and a hung
 * provider must not hold a search open indefinitely — the point of the
 * degradation rule is that the other sources still return.
 *
 * The retry exists because a provider that fails half its requests is not
 * the same thing as a provider that is down: giving up on the first bad
 * response would make search unusable when one more attempt would have
 * worked. It stays small and only covers idempotent reads, so a flaky
 * upstream cannot turn into a stampede.
 */
export async function providerFetch(
  url: string,
  init: RequestInit = {},
  options: ProviderFetchOptions = {},
): Promise<Response> {
  const {
    timeoutMs = PROVIDER_TIMEOUT_MS,
    retries = 0,
    retryStatuses = DEFAULT_RETRY_STATUSES,
  } = options;

  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      // Brief linear backoff. Long enough to clear a transient blip, short
      // enough that the caller's own timeout still governs.
      await delay(150 * attempt);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          "User-Agent":
            "CalDef/0.1 (personal nutrition tracker; +https://github.com/Kuroki13/CalDef)",
          Accept: "application/json",
          ...init.headers,
        },
      });

      if (response.ok || !retryStatuses.includes(response.status)) {
        return response;
      }
      lastResponse = response;
    } catch (error) {
      // A timeout or transport error on a non-final attempt is retried; on
      // the final one it propagates to safeProviderCall.
      if (attempt === retries) throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  // Every attempt returned a retryable status. Hand back the last one so the
  // caller reports the real code rather than a synthetic one.
  return lastResponse!;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
