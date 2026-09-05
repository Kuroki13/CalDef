import { describe, expect, it } from "vitest";

import { DEFAULT_REDIRECT, safeRedirect } from "@/lib/safe-redirect";

describe("safeRedirect", () => {
  it("keeps an in-app path", () => {
    expect(safeRedirect("/diary")).toBe("/diary");
    expect(safeRedirect("/diary?date=2026-01-01")).toBe("/diary?date=2026-01-01");
    expect(safeRedirect("/phase")).toBe("/phase");
  });

  it("refuses anything that could leave the app", () => {
    for (const hostile of [
      "https://evil.example",
      "//evil.example",
      // The one the usual startsWith pair misses: browsers normalise the
      // backslash in the authority position and navigate off-site.
      "/\\evil.example",
      "/\\/evil.example",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "\t//evil.example",
    ]) {
      expect(safeRedirect(hostile), hostile).toBe(DEFAULT_REDIRECT);
    }
  });

  it("falls back for empty, missing or malformed values", () => {
    expect(safeRedirect("")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect(null)).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect(undefined)).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect("diary")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect("/path with space")).toBe(DEFAULT_REDIRECT);
  });
});
