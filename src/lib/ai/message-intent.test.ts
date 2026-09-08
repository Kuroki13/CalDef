import { describe, expect, it } from "vitest";

import { assistantIntent } from "@/lib/ai/message-intent";

/**
 * Realistic inputs, in the shapes people actually type them.
 *
 * The classifier this replaced scored 18 of these 27: every food-with-an-
 * amount fell through to "question", because it only recognised a first
 * person past-tense verb. "chicken maqlouba 200g" — a portion typed the way
 * anyone types one — was answered with an essay.
 */
const CASES: { text: string; want: string; note: string }[] = [
  // A quantity is what a log has and a question does not.
  { text: "chicken maqlouba 200g", want: "log", note: "food + amount" },
  { text: "200g chicken and a cup of rice", want: "log", note: "two amounts" },
  { text: "2 slices of toast with butter", want: "log", note: "count + food" },
  { text: "3 eggs", want: "log", note: "bare leading count" },
  { text: "1 cup oats", want: "log", note: "household measure" },
  { text: "grilled salmon 150 g", want: "log", note: "amount after the food" },

  // Statements, with and without the pronoun people drop.
  { text: "I ate a Harvey's Big Angus burger", want: "log", note: "straight apostrophe" },
  { text: "I ate a Harvey’s Big Angus burger", want: "log", note: "curly apostrophe" },
  { text: "had two eggs for breakfast", want: "log", note: "no leading pronoun" },
  { text: "just finished a protein shake", want: "log", note: "colloquial" },
  { text: "log a banana", want: "log", note: "told to log it" },

  // French, including the apostrophe that arrives curly from an iPhone.
  { text: "j'ai mangé 200g de poulet", want: "log", note: "French statement" },
  { text: "j’ai mangé une pomme", want: "log", note: "French curly apostrophe" },
  { text: "200 g de riz basmati", want: "log", note: "French food + amount" },
  { text: "combien de calories dans une banane ?", want: "question", note: "French question" },
  { text: "est-ce que j'ai assez de protéines", want: "question", note: "French, no ?" },

  // Questions, with and without the mark.
  { text: "how much protein is in chicken?", want: "question", note: "explicit ?" },
  { text: "am I on track today", want: "question", note: "no ?" },
  { text: "what should I eat tonight", want: "question", note: "leading interrogative" },
  { text: "is 150 g of lentils a good protein source", want: "question", note: "amount inside a question" },
  { text: "why is my weight up", want: "question", note: "leading why" },

  // Follow-ups, which the thread now carries context for.
  { text: "and how much protein was that?", want: "question", note: "follow-up" },
  { text: "what about carbs", want: "question", note: "elliptical follow-up" },

  // Explicit destinations.
  { text: "save this to my foods", want: "save", note: "save" },
  { text: "add the protein bar to my library", want: "save", note: "save, not log" },
  { text: "create a new food", want: "create", note: "create" },
  { text: "créer un aliment", want: "create", note: "French create" },

  // Mixed: it asks something, so it is a question.
  { text: "I ate 900 kcal already, should I skip dinner?", want: "question", note: "log + question" },
];

describe("assistantIntent — realistic messages", () => {
  it.each(CASES)("$note: $text", ({ text, want }) => {
    expect(assistantIntent(text)).toBe(want);
  });
});

describe("assistantIntent — what wins over what", () => {
  it("treats anything that asks as a question, whatever else it holds", () => {
    // The ordering that matters: a quantity does not make a question into
    // a meal.
    expect(assistantIntent("is 200 g of rice too much")).toBe("question");
    expect(assistantIntent("should I have 2 eggs")).toBe("question");
    expect(assistantIntent("how many calories in 100 g of oats?")).toBe(
      "question",
    );
  });

  it("keeps saving distinct from logging when both words appear", () => {
    expect(assistantIntent("add the protein bar to my library")).toBe("save");
    expect(assistantIntent("add 2 eggs to my diary")).toBe("log");
  });

  it("does not read a bare number as a portion", () => {
    // "how much is 200" is not a meal, and neither is a stray figure.
    expect(assistantIntent("200")).toBe("question");
  });

  it("leaves an unclassifiable message as a question", () => {
    // A bare food name is far more likely to be "tell me about chicken"
    // than a meal with no portion, and the wrong guess costs one tap.
    expect(assistantIntent("chicken")).toBe("question");
    expect(assistantIntent("")).toBe("question");
    expect(assistantIntent("   ")).toBe("question");
  });
});

describe("assistantIntent — the invariant", () => {
  it("never returns anything but the four destinations", () => {
    // Routing is a choice of screen. None of these writes: `log` and `save`
    // both end at a confirmation showing real matched foods, and the
    // database is only touched when the user confirms there.
    const destinations = new Set(["question", "log", "save", "create"]);

    for (const { text } of CASES) {
      expect(destinations.has(assistantIntent(text))).toBe(true);
    }
  });

  it("hands the decision to the user whenever they have made one", () => {
    // The visible mode selector always wins — the classifier is a default,
    // not a decision taken away from them.
    expect(assistantIntent("how much protein is in chicken?", "log")).toBe("log");
    expect(assistantIntent("chicken maqlouba 200g", "question")).toBe("question");
    expect(assistantIntent("anything at all", "save")).toBe("save");
    expect(assistantIntent("anything at all", "create")).toBe("create");
  });
});
