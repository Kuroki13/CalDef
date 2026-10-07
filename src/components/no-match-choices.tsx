"use client";

/**
 * What to do when search has nothing useful.
 *
 * One question and a short list of answers, each saying in plain words what
 * it is for. This replaced a paragraph naming every option, a button, and a
 * recipe card that opened by itself — four ways forward with two of them
 * called "Describe…", which the owner rightly found hard to read.
 *
 * The assistant's two options are listed only when the assistant is on; the
 * two that need no assistant are always there.
 */

import { ChevronRight } from "lucide-react";

export type NoMatchChoice = "describe" | "draft" | "packet" | "estimate";

type Option = { choice: NoMatchChoice; title: string; hint: string };

export function noMatchOptions(aiReady: boolean): Option[] {
  const options: Option[] = [
    {
      choice: "packet",
      title: "Add it from the packet",
      hint: "Type in the nutrition label once. It's saved as your own food.",
    },
    {
      choice: "estimate",
      title: "Just the calories",
      hint: "A quick estimate, e.g. 750 kcal. Marked as an estimate.",
    },
  ];
  if (!aiReady) return options;
  return [
    {
      choice: "describe",
      title: "Describe what you ate",
      hint: "e.g. “a plate of chicken maqlouba, about 400 g”. The assistant matches it to real foods.",
    },
    {
      choice: "draft",
      title: "Build it from ingredients",
      hint: "For home cooking. The assistant suggests what goes in it; you check the amounts.",
    },
    ...options,
  ];
}

export function NoMatchChoices({
  query,
  hadResults,
  aiReady,
  onChoose,
}: {
  query: string;
  /** Results came back, just none that fit — they are still listed below. */
  hadResults: boolean;
  aiReady: boolean;
  onChoose: (choice: NoMatchChoice) => void;
}) {
  return (
    <section aria-labelledby="no-match-heading" className="space-y-2">
      <div>
        <p id="no-match-heading" className="text-sm font-medium">
          {hadResults ? "Nothing here looks like" : "No match for"} &ldquo;
          {query.trim()}&rdquo;
        </p>
        <p className="text-muted-foreground text-sm">
          How do you want to add it?
          {hadResults ? " The closest results are below." : ""}
        </p>
      </div>
      <ul className="divide-y rounded-lg border">
        {noMatchOptions(aiReady).map((option) => (
          <li key={option.choice}>
            <button
              type="button"
              onClick={() => onChoose(option.choice)}
              className="hover:bg-accent/50 flex w-full items-center gap-3 px-3 py-3 text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{option.title}</span>
                <span className="text-muted-foreground block text-xs">
                  {option.hint}
                </span>
              </span>
              <ChevronRight aria-hidden className="text-muted-foreground size-4 shrink-0" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
