import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * Unmount between tests.
 *
 * Testing Library registers this itself only when Vitest runs with
 * `globals: true`, which this project does not — so without it every
 * `render` in a file stacks into the same document. A query then matches an
 * element left behind by an earlier test, which produces both false passes
 * and false failures. Caught by a chart test finding an axis label that
 * belonged to the previous case.
 */
afterEach(cleanup);
