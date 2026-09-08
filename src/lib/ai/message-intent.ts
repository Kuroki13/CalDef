/**
 * What the assistant should *do* with a message.
 *
 * Routing only, never authorisation to write. Every destination proposes:
 * `log` and `save` end at a confirmation step showing real matched foods and
 * their real macros, and nothing reaches the database until the user
 * confirms. So the cost of routing wrongly is a wasted screen and a tap on
 * the visible mode selector — never a wrong diary entry.
 *
 * ## Why this is not a model call
 *
 * A model would classify better. It would also spend a request to decide how
 * to spend a request, and the free tier this app is pinned to is measured in
 * tens per day — the assistant would answer half as many questions in
 * exchange for routing them more accurately. It would add a round trip
 * before every message on a phone. And when the model is over quota or
 * unreachable — which is an ordinary state here, not an outage — routing
 * would fall back to these rules anyway, so they have to be good regardless.
 * Making them good removes the reason to call the model at all.
 *
 * The contract is a pure function of the text, so a model-based classifier
 * can be dropped in behind it later without anything else moving.
 *
 * ## The order matters
 *
 * A question wins over a quantity. "Is 150 g of lentils a good protein
 * source" names an amount and is not a log; "I ate 900 kcal, should I skip
 * dinner?" is asking something. Anything that asks is a question, whatever
 * else it contains.
 */

export type AssistantMode = "auto" | "question" | "log" | "save" | "create";
export type AssistantIntent = Exclude<AssistantMode, "auto">;

/** Diacritics folded and curly apostrophes straightened, once, up front. */
function normalise(text: string): string {
  return text
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[’‘`]/g, "'");
}

const CREATE = /\b(create|new|custom)\b.*\bfood\b|\bcreer\b.*\baliment\b|\bnouvel? aliment\b/;

const SAVE = /\b(save|add)\b.*\b(library|database|db|my foods|mes aliments)\b|\benregistrer\b.*\baliment\b/;

/**
 * Anything that asks.
 *
 * A question mark settles it. Otherwise the giveaway is an interrogative or
 * a modal at the *start*, where English and French both put them — "should
 * I", "combien de", "est-ce que". Mid-sentence they are unreliable: "I had
 * what was left of the rice" opens with a pronoun and is a statement.
 */
const QUESTION_LEAD =
  /^(what|how|why|when|where|which|who|should|shall|can|could|would|will|is|are|was|were|do|does|did|am|have|has|any|combien|comment|pourquoi|quand|quel|quelle|quels|quelles|est-ce|qu'est-ce|puis-je|dois-je)\b/;

/** Asked anywhere in the sentence, not only at its start. */
const QUESTION_ANYWHERE =
  /\b(should i|can i|could i|would it|do i need|est-ce que|dois-je|puis-je|is it (?:ok|okay|fine|better)|what about|how about|et pour)\b/;

/**
 * Said in the past tense about food, which is the clearest log signal there
 * is. Deliberately tolerant of a missing pronoun, because people drop it:
 * "had two eggs" is how anyone actually types it.
 */
const EATING_VERB =
  /\b(?:i|we)\s+(?:just\s+|already\s+)?(?:ate|had|drank|eaten|finished)\b|^(?:just\s+)?(?:ate|had|drank|finished|eating|logged)\b|\bj'ai\s+(?:mange|bu|pris)\b|\bje\s+viens\s+de\s+manger\b/;

/**
 * Told to log it, which needs no inference at all.
 *
 * Checked after `SAVE`, so "add the bar to my library" is still a save
 * rather than a log that happens to start with "add".
 */
const EXPLICIT_LOG = /^(?:log|record|track|note)\b|^add\b.*\b(?:diary|journal)\b/;

/**
 * An amount, which is what "chicken maqlouba 200g" has and a question does
 * not.
 *
 * Three shapes, because all three are how portions get typed: a number with
 * a unit ("200g", "1 cup", "2 tbsp"), a leading count before a word ("3
 * eggs"), and a written-out count ("two eggs"). A number on its own is not
 * enough — "how much is 200" is a question.
 */
const UNITS =
  "g|gs|gram|grams|gramme|grammes|kg|mg|ml|cl|l|litre|litres|oz|lb|cup|cups|tasse|slice|slices|tranche|tranches|tbsp|tsp|tablespoon|teaspoon|cuillere|piece|pieces|portion|portions|serving|servings|scoop|scoops|handful|bowl|plate|can|cans|bottle";

const WORD_COUNTS =
  "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a couple of|half a|deux|trois|quatre|cinq|six|sept|huit|neuf|dix";

const QUANTITY = new RegExp(
  [
    // 200g · 200 g · 1 cup · 2 tbsp
    `\\b\\d+(?:[.,]\\d+)?\\s*(?:${UNITS})\\b`,
    // 3 eggs · 2 slices of toast — a count leading a word.
    `^\\d+(?:[.,]\\d+)?\\s+\\p{L}`,
    // two eggs · deux pommes
    `\\b(?:${WORD_COUNTS})\\s+\\p{L}`,
  ].join("|"),
  "u",
);

/**
 * Routes a message.
 *
 * `mode` is the user's explicit choice from the visible selector and always
 * wins — the classifier is a default, not a decision taken away from them.
 */
export function assistantIntent(
  text: string,
  mode: AssistantMode = "auto",
): AssistantIntent {
  if (mode !== "auto") return mode;

  const value = normalise(text);
  if (value.length === 0) return "question";

  // Explicit instructions first: "create a new food" is neither a question
  // nor a meal, however it is phrased.
  if (CREATE.test(value)) return "create";
  if (SAVE.test(value)) return "save";

  // Anything that asks is a question, whatever else it holds.
  if (
    value.includes("?") ||
    QUESTION_LEAD.test(value) ||
    QUESTION_ANYWHERE.test(value)
  ) {
    return "question";
  }

  // Then: did they say they ate something, or name an amount of it?
  if (
    EXPLICIT_LOG.test(value) ||
    EATING_VERB.test(value) ||
    QUANTITY.test(value)
  ) {
    return "log";
  }

  // Everything else stays a question. A bare "chicken" is far more likely
  // to be "tell me about chicken" than a meal with no portion, and the
  // wrong guess here costs a tap on the mode selector.
  return "question";
}
