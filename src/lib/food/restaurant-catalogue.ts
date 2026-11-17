import data from "@/lib/food/data/restaurants.json";
import { fold } from "@/lib/food/text-match";
import type { Food } from "@/lib/food/types";

/**
 * Official restaurant nutrition, reviewed and stored (spec §13L/§13M).
 *
 * Never an LLM estimate and never a live web search: every item comes from
 * the chain's own published data, recorded with its source and review date.
 *
 * - Harvey's: reviewed by hand from harveys.ca, 2026-09-06 (below).
 * - Subway, A&W, Five Guys: built by `scripts/build-restaurants.mjs` from the
 *   official sources in scripts/restaurant-sources/ — see
 *   docs/IMPLEMENTATION_STATUS.md for how each was obtained and verified.
 *
 * Figures are per published serving with its published weight, converted to
 * per 100 g by arithmetic. An item is offered only when the query names the
 * chain and every other word matches it, so an unsupported variant ("combo",
 * "extra cheese") is not quietly resolved to the plain item.
 */

type Item = {
  slug: string;
  name: string;
  fr?: string | null;
  serving: string;
  grams: number;
  /** kcal, protein, carbs, fat, fibre, sugar, sat fat, sodium — per serving. */
  n: (number | null)[];
};

type Chain = {
  id: string;
  name: string;
  aliases: string[];
  source_url: string;
  document_label: string;
  reviewed: string;
  note: string;
  items: Item[];
};

// ---- Harvey's, reviewed by hand. Identities and the description string are
// unchanged from the original catalogue: foods users already saved from it
// are recognised by exactly these.
const HARVEYS_SOURCE = "https://www.harveys.ca/en/nutrition.html";
const HARVEYS_REVIEWED = "2026-09-06";
const HARVEYS_DESCRIPTION = `Restaurant reference | Canada | Reviewed ${HARVEYS_REVIEWED} | ${HARVEYS_SOURCE} | Standard item only; check toppings and customisations.`;

const HARVEYS: Chain = {
  id: "harveys",
  name: "Harvey's",
  aliases: ["harveys", "harvey s", "harvey"],
  source_url: HARVEYS_SOURCE,
  document_label: "harveys.ca nutrition",
  reviewed: HARVEYS_REVIEWED,
  note: "Standard item only; check toppings and customisations.",
  items: [
    { slug: "big-harv-angus", name: "Big Harv (Angus)", serving: "1 burger (281 g)", grams: 281, n: [750, 36, 39, 50, 2, 5, 16, 1620] },
    { slug: "angus-burger", name: "Angus Burger", serving: "1 burger (157 g)", grams: 157, n: [410, 18, 32, 23, 1, 3, 6, 700] },
    { slug: "angus-cheese", name: "Angus Burger with Cheese", serving: "1 burger (174 g)", grams: 174, n: [470, 21, 34, 27, 1, 4, 8, 990] },
    { slug: "angus-cheese-bacon", name: "Angus Burger with Cheese and Bacon", serving: "1 burger (187 g)", grams: 187, n: [520, 25, 35, 31, 1, 4, 10, 1170] },
  ],
};

const CHAINS: Chain[] = [HARVEYS, ...(data.chains as Chain[])];

function description(chain: Chain): string {
  if (chain.id === "harveys") return HARVEYS_DESCRIPTION;
  return `Restaurant reference | ${chain.name} | Canada | ${chain.document_label} | Reviewed ${chain.reviewed} | ${chain.source_url} | ${chain.note}`;
}

const BY_DESCRIPTION = new Map(CHAINS.map((chain) => [description(chain), chain]));

function asFood(chain: Chain, item: Item): Food {
  const per100 = (value: number | null) =>
    value === null ? null : Math.round((value * 10000) / item.grams) / 100;
  const [kcal, protein, carbs, fat, fiber, sugar, satFat, sodium] = item.n;
  return {
    source: "custom",
    sourceId: `restaurant:${chain.id}:${item.slug}`,
    name: item.name,
    brand: chain.name,
    description: description(chain),
    barcode: null,
    isVerified: false,
    nutrients: {
      kcal: per100(kcal) as number,
      protein_g: per100(protein) as number,
      carbs_g: per100(carbs) as number,
      fat_g: per100(fat) as number,
      fiber_g: per100(fiber),
      sugar_g: per100(sugar),
      sat_fat_g: per100(satFat),
      sodium_mg: per100(sodium),
    },
    servings: [{ label: item.serving, grams: item.grams, isDefault: true }],
    dataUpdatedAt: null, // A review date is not the publisher's revision date.
  };
}

export function restaurantById(id: string): Food | null {
  const match = /^restaurant:([^:]+):(.+)$/.exec(id);
  if (!match) return null;
  const chain = CHAINS.find((c) => c.id === match[1]);
  const item = chain?.items.find((i) => i.slug === match[2]);
  return chain && item ? asFood(chain, item) : null;
}

export function isRestaurantReference(food: Pick<Food, "description">): boolean {
  return food.description != null && BY_DESCRIPTION.has(food.description);
}

export function restaurantReference(food: Pick<Food, "description">) {
  const chain = food.description != null ? BY_DESCRIPTION.get(food.description) : undefined;
  return chain ? { url: chain.source_url, reviewed: chain.reviewed, country: "Canada" } : null;
}

/** Words that say nothing about which item: they never have to match. */
const FILLER = new Set([
  "with", "and", "a", "an", "the", "de", "du", "le", "la", "les", "au", "avec", "et",
  "canada", "from", "at", "chez", "s", "burger", "burgers",
  // Subway: the menu lists the 6" serving; a footlong is two of them.
  "inch", "in", "6", "footlong", "foot", "long",
]);

const tokens = (text: string) => fold(text.replace(/\./g, "")).split(" ").filter(Boolean);

/** The chain a query names, and the words left once its name is removed. */
function chainIn(text: string): { chain: Chain; rest: string[] } | null {
  const words = tokens(text.replace(/[’']/g, " "));
  for (const chain of CHAINS) {
    for (const alias of chain.aliases) {
      const a = tokens(alias);
      for (let i = 0; i + a.length <= words.length; i++) {
        if (a.every((w, j) => words[i + j] === w)) {
          return { chain, rest: [...words.slice(0, i), ...words.slice(i + a.length)] };
        }
      }
    }
  }
  return null;
}

/** At most this many items for one query: a list to choose from, not a menu. */
const MAX_HITS = 8;

export function searchRestaurantCatalogue(text: string): Food[] {
  const found = chainIn(text);
  if (!found) return [];
  const terms = found.rest.filter((w) => !FILLER.has(w));
  if (terms.length === 0) return [];

  const needle = terms.join(" ");
  return found.chain.items
    .map((item) => {
      const haystack = tokens(`${item.name} ${item.fr ?? ""}`).join(" ");
      if (!terms.every((t) => haystack.includes(t))) return null;
      const name = tokens(item.name).join(" ");
      // The whole phrase intact beats scattered words; then the shorter name,
      // so "Angus Burger" comes before "Angus Burger with Cheese".
      const score = (name.includes(needle) ? 2 : 0) + (name.startsWith(terms[0]) ? 1 : 0);
      return { item, score, length: item.name.length };
    })
    .filter((hit): hit is { item: Item; score: number; length: number } => hit !== null)
    .sort((a, b) => b.score - a.score || a.length - b.length)
    .slice(0, MAX_HITS)
    .map((hit) => asFood(found.chain, hit.item));
}

/** The chains the catalogue holds, for showing where the data came from. */
export function restaurantSources() {
  return CHAINS.map((c) => ({
    name: c.name,
    url: c.source_url,
    label: c.document_label,
    reviewed: c.reviewed,
    items: c.items.length,
  }));
}
