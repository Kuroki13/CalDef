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
  },
});
