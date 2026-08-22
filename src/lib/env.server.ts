import "server-only";

/**
 * Server-only environment. The `server-only` import above makes the build
 * fail if a client component ever pulls this in, which is the point: these
 * values must never reach the browser bundle.
 *
 * Both are optional at load time. A missing key disables its feature rather
 * than crashing the app — the food providers degrade and the AI layer falls
 * back to its unavailable implementation. See ARCHITECTURE.md invariant 3.
 */

export const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim() || null;
export const USDA_API_KEY = process.env.USDA_API_KEY?.trim() || null;

export const hasGeminiKey = () => GEMINI_API_KEY !== null;
export const hasUsdaKey = () => USDA_API_KEY !== null;
