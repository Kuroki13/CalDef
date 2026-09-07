import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Vite resolves the `@/*` alias from tsconfig.json natively.
    tsconfigPaths: true,
    alias: {
      // See src/test/server-only-stub.ts for why.
      "server-only": fileURLToPath(
        new URL("./src/test/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Live provider checks make real network calls, so they are opt-in via
    // `npm run test:live`. A unit suite that fails when a third party is
    // down is a suite people learn to ignore.
    exclude: ["**/node_modules/**", "src/**/*.integration.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    // Vitest's 5s default is a budget for a test's own work, but these run
    // 50 jsdom environments across every core at once, and the slowest cases
    // reset the module registry and re-import a component graph. Measured on
    // this machine, the same file took 394ms alone and over 5s under that
    // contention — three consecutive full runs failed 2, then 4, then 0
    // tests, always on timeout and never on an assertion. A suite that fails
    // on machine load rather than on merit is one people learn to re-run
    // instead of read, so the budget is raised to cover the contention.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
