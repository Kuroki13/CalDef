import { describe, expect, it } from "vitest";
import { assistantIntent } from "./message-intent";

describe("assistant action intent", () => {
  it.each(["yeah I ate a harvey's big angus burger", "I just had two eggs", "log a banana", "j'ai mangé du riz"])("offers a meal draft: %s", (text) => expect(assistantIntent(text)).toBe("log"));
  it.each(["If I ate a burger would I hit my target?", "I didn't eat a burger", "Should I eat a burger?", "how much protein today?", "I had a burger, is that okay?"])("keeps questions and negation out of logging: %s", (text) => expect(assistantIntent(text)).toBe("question"));
  it("separates saving, creating and an explicit action", () => {
    expect(assistantIntent("save this burger to my library")).toBe("save");
    expect(assistantIntent("create a new food")).toBe("create");
    expect(assistantIntent("a burger", "log")).toBe("log");
  });
});
