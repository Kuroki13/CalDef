import { describe, expect, it } from "vitest";

import { phraseKey } from "@/lib/vocabulary-key";

describe("phraseKey", () => {
  it("is one key for one phrase however it is spelled or sized", () => {
    expect(phraseKey("Warak")).toBe(phraseKey("warak"));
    expect(phraseKey("waraq")).toBe(phraseKey("warak"));
    expect(phraseKey("200 g warak")).toBe(phraseKey("warak"));
    expect(phraseKey("8 pieces warak")).toBe(phraseKey("warak"));
  });

  it("keeps different phrases apart", () => {
    expect(phraseKey("my yogurt")).not.toBe(phraseKey("yogurt"));
    expect(phraseKey("the usual")).not.toBe(phraseKey("usual lunch"));
  });

  it("keeps Arabic", () => {
    expect(phraseKey("ورق")).toBe("ورق");
  });

  it("is empty for a bare amount", () => {
    expect(phraseKey("200 g")).toBe("");
  });
});
