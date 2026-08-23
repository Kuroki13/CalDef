import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Config for the live provider checks (`npm run test:live`).
 *
 * Standalone rather than merged from `vitest.config.mts`: `mergeConfig`
 * concatenates arrays, so the base config's exclusion of these very files
 * would survive the merge and the suite would silently run nothing.
 *
 * These hit real third-party APIs, so they are slow and can fail for reasons
 * that have nothing to do with this codebase.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
    alias: {
      "server-only": fileURLToPath(
        new URL("./src/test/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.integration.test.ts"],
    exclude: ["**/node_modules/**"],
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 30_000,
    env: loadEnvLocal(),
  },
});

/** Minimal `.env.local` reader — enough for KEY=value lines. */
function loadEnvLocal(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const text = readFileSync(
      new URL("./.env.local", import.meta.url),
      "utf8",
    );
    for (const line of text.split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // An absent .env.local just means the live run reports the provider as
    // unconfigured, which is itself a legitimate result.
  }
  return env;
}
