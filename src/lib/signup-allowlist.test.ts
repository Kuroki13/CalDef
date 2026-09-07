import { describe, expect, it } from "vitest";

import {
  isSignupAllowed,
  normaliseAddress,
  parseAllowlist,
} from "@/lib/signup-allowlist";

describe("parseAllowlist", () => {
  it("reads a comma-separated list", () => {
    const list = parseAllowlist("one@example.com,two@example.com");
    expect(list.size).toBe(2);
    expect(list.has("one@example.com")).toBe(true);
  });

  it("tolerates the whitespace a copied-in variable carries", () => {
    const list = parseAllowlist(" one@example.com ,\n two@example.com \n");
    expect([...list]).toEqual(["one@example.com", "two@example.com"]);
  });

  it("lowercases, because an address is not case-sensitive in practice", () => {
    expect(parseAllowlist("Owner@Example.COM").has("owner@example.com")).toBe(
      true,
    );
  });

  it("drops entries that cannot be an address", () => {
    // A trailing comma or a stray word must not become an allowlist entry
    // that some future input accidentally matches.
    const list = parseAllowlist("one@example.com,,true,");
    expect([...list]).toEqual(["one@example.com"]);
  });

  it("treats unset and empty as nobody, not as everybody", () => {
    // The direction this fails in is the whole point.
    for (const raw of [null, undefined, "", "   ", ",,,"]) {
      expect(parseAllowlist(raw).size).toBe(0);
    }
  });
});

describe("isSignupAllowed", () => {
  const list = parseAllowlist("owner@example.com");

  it("admits an address on the list", () => {
    expect(isSignupAllowed("owner@example.com", list)).toBe(true);
  });

  it("admits it however it was typed", () => {
    expect(isSignupAllowed("  Owner@Example.com  ", list)).toBe(true);
  });

  it("refuses anything else", () => {
    expect(isSignupAllowed("stranger@example.com", list)).toBe(false);
    expect(isSignupAllowed("owner@example.com.evil.test", list)).toBe(false);
    // Not a substring match: an allowlist that matched by prefix would admit
    // an address the owner never named.
    expect(isSignupAllowed("owner@example.co", list)).toBe(false);
  });

  it("refuses everyone when the list is empty", () => {
    const closed = parseAllowlist(null);
    expect(isSignupAllowed("owner@example.com", closed)).toBe(false);
  });

  it("does not fold Gmail aliases, which would widen the list by inference", () => {
    const gmail = parseAllowlist("owner@gmail.com");
    expect(isSignupAllowed("own.er@gmail.com", gmail)).toBe(false);
    expect(isSignupAllowed("owner+cal@gmail.com", gmail)).toBe(false);
  });
});

describe("normaliseAddress", () => {
  it("is what both sides of the comparison go through", () => {
    expect(normaliseAddress("  A@B.COM ")).toBe("a@b.com");
  });
});
