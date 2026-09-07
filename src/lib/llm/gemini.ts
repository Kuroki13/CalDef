import "server-only";

/**
 * Gemini — the one place this application talks to a model.
 *
 * Every request to Google leaves from `callGemini` below, and every public
 * function here takes `FoodText` or `AnonymousFigures`. That is the "single
 * server-side call site whose input type is food text" the spec asks for: to
 * send a user's name or id you would have to change a type signature, not
 * merely forget a rule.
 *
 * The model is asked for structured intent and is given a response schema
 * with no nutrition fields in it, so it has nowhere to put a calorie figure.
 * Even so the parsers below read only `query`, `amount` and `unit` — a model
 * that invents a `kcal` key has that key dropped rather than trusted.
 */

import { GEMINI_API_KEY } from "@/lib/env.server";
import type {
  AnonymousFigures,
  ChatTurn,
  CorrectionIntent,
  FoodText,
  LLMProvider,
  LLMResult,
  ParsedFoods,
} from "@/lib/llm/types";
import type { PortionUnit } from "@/lib/nutrition/units";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * The model, chosen for its free-tier allowance rather than its ability.
 *
 * Measured against this key on 2026-09-05: `gemini-3.8-flash` is capped at
 * **20 requests per day** (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`,
 * quotaValue 20), which is a handful of meals and then nothing. The lite
 * model took 16 requests in a single burst before refusing, and refused on
 * the *per-minute* quota (15/min) rather than a daily one — so its daily
 * allowance is far larger. For parsing a sentence into search terms, lite is
 * ample; the ceiling is what decides this.
 *
 * `gemini-2.5-flash` is closed to new keys and answers 404, and the
 * `-latest` aliases float and answered 503 while pinned versions were
 * healthy, so the version is pinned. `GEMINI_MODEL` overrides it without a
 * code change if the allowances move again.
 */
const MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";

const TIMEOUT_MS = 15_000;
/**
 * 429 is deliberately absent. It means the free tier's per-minute quota is
 * spent, and retrying inside a second spends more of it — the first version
 * of this file did retry, and turned one over-quota call into three. A
 * transient 5xx is a different thing and is worth another attempt.
 */
const RETRY_STATUSES = [500, 502, 503, 504];

const UNITS: PortionUnit[] = ["g", "ml", "serving"];

/** Shared by both structured calls: units are a closed set our code owns. */
const UNIT_SCHEMA = { type: "STRING", enum: UNITS } as const;

const FOODS_SCHEMA = {
  type: "OBJECT",
  properties: {
    foods: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          query: { type: "STRING" },
          amount: { type: "NUMBER" },
          unit: UNIT_SCHEMA,
        },
        required: ["query", "amount", "unit"],
      },
    },
  },
  required: ["foods"],
} as const;

const CORRECTION_SCHEMA = {
  type: "OBJECT",
  properties: {
    kind: { type: "STRING", enum: ["amount", "remove", "unclear"] },
    amount: { type: "NUMBER" },
    unit: UNIT_SCHEMA,
  },
  required: ["kind"],
} as const;

const PARSE_INSTRUCTION = `You convert a description of food into search terms and portions.

Return one entry per distinct food. For each: a short search term
suitable for a food database, the amount as a number, and the unit.
Preserve named restaurants, brands, exact menu names and customisations.
For example "Harvey's big angus burger" stays "Harvey's Big Angus Burger";
never turn it into a generic beef burger. Do not add sides or drinks unless
the user explicitly names them. A combo with unspecified contents needs
clarification, not invented components.

Units are only "g", "ml" or "serving". Convert household measures to grams or
millilitres where the conversion is standard (1 tablespoon of oil is 15 ml, a
teaspoon is 5 ml). When no amount is stated, use "serving" with amount 1.

Do not return calories, protein, carbohydrate, fat, or any other nutrition
value. You are not being asked what the food contains — only what it is and
how much of it there was. Nutrition is computed from a database afterwards.

If the text describes no food at all, return an empty list.`;

const CORRECTION_INSTRUCTION = `The user is amending a food entry they already logged.

Decide what they want:
- "amount": they restated how much it was. Give the new amount and unit.
- "remove": they are saying they did not eat it.
- "unclear": anything else, including a change you cannot express as an
  amount or a removal.

Prefer "unclear" over a guess. A wrong amount silently rewrites their diary,
which is worse than asking them to edit it by hand.

Do not return calories or any nutrition value.`;

const ANSWER_INSTRUCTION = `You answer questions about nutrition and body composition for someone
tracking their intake.

You may be given a few of their current figures. Use them if they help.
They are anonymous numbers — you do not know who this person is, and you must
not ask for or speculate about their identity.

Be concise and practical. Give estimates as estimates. You are not a doctor
or a dietitian: say so if asked for medical advice, and never present a
figure as a diagnosis.

If you state a calorie or macro figure for a specific food, say plainly that
it is a rough guide and that logging the food gives the real number from the
food database.

You may be shown a few earlier turns of this conversation. Use them only to
understand what the last question refers to — "and how much protein was that?"
means the food in the previous turn. Answer the last question, not the earlier
ones.`;

export const geminiProvider: LLMProvider = {
  name: "Gemini",

  isAvailable: () => GEMINI_API_KEY !== null,

  async parseFoods(text: FoodText): Promise<LLMResult<ParsedFoods>> {
    const raw = await callGemini(PARSE_INSTRUCTION, text, FOODS_SCHEMA);
    if (!raw.ok) return raw;

    const parsed = readJson(raw.value);
    if (!parsed) return unusable();

    const list = Array.isArray((parsed as { foods?: unknown }).foods)
      ? ((parsed as { foods: unknown[] }).foods ?? [])
      : null;
    if (!list) return unusable();

    // Only these three fields are read. Anything else the model returned —
    // a calorie count above all — has nowhere to go and is discarded here.
    const foods = list.slice(0, 8).flatMap((item) => {
      const intent = readIntent(item);
      return intent ? [intent] : [];
    });

    return { ok: true, value: { foods } };
  },

  async parseCorrection(
    text: FoodText,
    entry: { description: FoodText; amount: number; unit: PortionUnit },
  ): Promise<LLMResult<CorrectionIntent>> {
    // The entry reaches the model as a sentence about food, never as a row.
    const prompt =
      `Logged entry: ${entry.description}, ${entry.amount} ${entry.unit}.\n` +
      `The user says: ${text}`;

    const raw = await callGemini(
      CORRECTION_INSTRUCTION,
      prompt as FoodText,
      CORRECTION_SCHEMA,
    );
    if (!raw.ok) return raw;

    const parsed = readJson(raw.value) as {
      kind?: unknown;
      amount?: unknown;
      unit?: unknown;
    } | null;
    if (!parsed) return unusable();

    if (parsed.kind === "remove") return { ok: true, value: { kind: "remove" } };

    if (parsed.kind === "amount") {
      const amount = readAmount(parsed.amount);
      const unit = readUnit(parsed.unit);
      // An "amount" correction that carries no usable amount is not a
      // correction. Falling through to `unclear` leaves the entry alone.
      if (amount !== null && unit !== null) {
        return { ok: true, value: { kind: "amount", amount, unit } };
      }
    }

    return { ok: true, value: { kind: "unclear" } };
  },

  async answer(
    question: FoodText,
    figures: AnonymousFigures,
    history: readonly ChatTurn[] = [],
  ): Promise<LLMResult<string>> {
    const prompt = [
      describeFigures(figures),
      describeHistory(history),
      `Question: ${question}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const raw = await callGemini(ANSWER_INSTRUCTION, prompt as FoodText, null);
    if (!raw.ok) return raw;

    const text = raw.value.trim();
    if (text.length === 0) return unusable();

    return { ok: true, value: text };
  },
};

/**
 * Renders the earlier turns of this thread.
 *
 * Every line is `FoodText` — the caller cannot construct a `ChatTurn` any
 * other way — so this function has no filtering to do and deliberately does
 * none. Adding a "just in case" strip here would put the boundary in two
 * places and make it easy to believe the wrong one.
 *
 * Labelled rather than role-tagged in the model's own format: this is
 * context for a single question, not a chat session being resumed, and the
 * instruction below tells the model to answer the last line.
 */
function describeHistory(history: readonly ChatTurn[]): string {
  if (history.length === 0) return "";

  const lines = history.map((turn) =>
    `${turn.role === "user" ? "They asked" : "You answered"}: ${turn.text}`,
  );

  return `Earlier in this conversation:\n${lines.join("\n")}`;
}

/**
 * Renders the anonymous figures as a few lines of numbers.
 *
 * Built from a fixed list rather than by iterating the object, so a field
 * added to `AnonymousFigures` later cannot start being sent without someone
 * writing its label here — and a field that is not a number has no label to
 * be given.
 */
function describeFigures(figures: AnonymousFigures): string {
  const lines = [
    label("Calorie target", figures.targetCalories, "kcal"),
    label("Protein target", figures.targetProteinG, "g"),
    label("Eaten so far today", figures.caloriesToday, "kcal"),
    label("Protein so far today", figures.proteinTodayG, "g"),
    label("Estimated expenditure", figures.estimatedExpenditureKcal, "kcal"),
    label("Current trend weight", figures.trendWeightKg, "kg"),
    label("Weekly weight change", figures.weeklyChangeKg, "kg"),
  ].filter((line): line is string => line !== null);

  return lines.length === 0 ? "" : `Their current figures:\n${lines.join("\n")}`;
}

function label(name: string, value: number | undefined, unit: string): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return `- ${name}: ${Math.round(value * 10) / 10} ${unit}`;
}

/**
 * The single request to Google.
 *
 * `text` is `FoodText`, so nothing unchecked reaches this function, and the
 * body is assembled here rather than by callers — there is no parameter
 * through which extra context could be smuggled in.
 */
async function callGemini(
  instruction: string,
  text: FoodText,
  schema: object | null,
): Promise<LLMResult<string>> {
  if (GEMINI_API_KEY === null) {
    return {
      ok: false,
      reason: "unconfigured",
      message: "The assistant is not configured.",
    };
  }

  const body = {
    systemInstruction: { parts: [{ text: instruction }] },
    contents: [{ role: "user", parts: [{ text }] }],
    generationConfig: {
      temperature: 0,
      ...(schema
        ? { responseMimeType: "application/json", responseSchema: schema }
        : {}),
    },
  };

  let lastStatus = 0;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await delay(300 * attempt);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(
        // The key is a query parameter because that is the auth this API
        // takes. It must never appear in an error message; see below.
        `${ENDPOINT}/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        lastStatus = response.status;
        if (RETRY_STATUSES.includes(response.status)) continue;
        return httpFailure(response.status);
      }

      const payload = (await response.json()) as GeminiResponse;
      const answer = readText(payload);
      if (answer === null) return unusable();

      return { ok: true, value: answer };
    } catch {
      // Deliberately not surfaced: a fetch error message can embed the
      // request URL, and the request URL carries the API key.
      lastStatus = 0;
    } finally {
      clearTimeout(timer);
    }
  }

  return lastStatus === 0
    ? {
        ok: false,
        reason: "unavailable",
        message: "The assistant did not respond.",
      }
    : httpFailure(lastStatus);
}

function httpFailure(status: number): LLMResult<never> {
  if (status === 429) {
    return {
      ok: false,
      reason: "rate-limited",
      message:
        "The assistant has used its free allowance for the moment. Try again in a minute.",
    };
  }

  return {
    ok: false,
    reason: "unavailable",
    // The status only. An upstream error body can quote the request.
    message: `The assistant returned ${status}.`,
  };
}

function unusable(): LLMResult<never> {
  return {
    ok: false,
    reason: "unusable",
    message: "The assistant's answer could not be read.",
  };
}

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
  }>;
};

/**
 * Joins the answer parts of the first candidate.
 *
 * Thinking models return their reasoning as parts flagged `thought`. Those
 * are not the answer and would corrupt a JSON parse, so they are skipped.
 */
function readText(payload: GeminiResponse): string | null {
  const parts = payload.candidates?.[0]?.content?.parts;
  if (!parts) return null;

  const text = parts
    .filter((part) => part.thought !== true && typeof part.text === "string")
    .map((part) => part.text)
    .join("");

  return text.length > 0 ? text : null;
}

function readJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function readIntent(item: unknown): ParsedFoods["foods"][number] | null {
  if (typeof item !== "object" || item === null) return null;
  const row = item as { query?: unknown; amount?: unknown; unit?: unknown };

  const query = typeof row.query === "string" ? row.query.trim() : "";
  const amount = readAmount(row.amount);
  const unit = readUnit(row.unit);

  if (query.length === 0 || amount === null || unit === null) return null;
  return { query: query.slice(0, 200), amount, unit };
}

/** Rejects zero, negatives and absurd values rather than clamping them. */
function readAmount(value: unknown): number | null {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000) return null;
  return amount;
}

function readUnit(value: unknown): PortionUnit | null {
  return UNITS.includes(value as PortionUnit) ? (value as PortionUnit) : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
