import type { Food } from "@/lib/food/types";

/** Reviewed public nutrition, not an LLM estimate or a live web-search result.
 * Source: https://www.harveys.ca/en/nutrition.html (Canada), 2026-09-06.
 * Values below are per published menu serving; arithmetic converts to 100 g.
 * Adding another restaurant requires a reviewed source with a serving weight.
 */
const SOURCE = "https://www.harveys.ca/en/nutrition.html";
const REVIEWED = "2026-09-06";
const DESCRIPTION = `Restaurant reference | Canada | Reviewed ${REVIEWED} | ${SOURCE} | Standard item only; check toppings and customisations.`;

type PublishedItem = {
  slug: string; name: string; grams: number;
  kcal: number; protein: number; carbs: number; fat: number;
  fiber: number; sugar: number; saturatedFat: number; sodium: number;
};

const ITEMS: PublishedItem[] = [
  { slug: "big-harv-angus", name: "Big Harv (Angus)", grams: 281,
    kcal: 750, protein: 36, carbs: 39, fat: 50, fiber: 2, sugar: 5, saturatedFat: 16, sodium: 1620 },
  { slug: "angus-burger", name: "Angus Burger", grams: 157,
    kcal: 410, protein: 18, carbs: 32, fat: 23, fiber: 1, sugar: 3, saturatedFat: 6, sodium: 700 },
  { slug: "angus-cheese", name: "Angus Burger with Cheese", grams: 174,
    kcal: 470, protein: 21, carbs: 34, fat: 27, fiber: 1, sugar: 4, saturatedFat: 8, sodium: 990 },
  { slug: "angus-cheese-bacon", name: "Angus Burger with Cheese and Bacon", grams: 187,
    kcal: 520, protein: 25, carbs: 35, fat: 31, fiber: 1, sugar: 4, saturatedFat: 10, sodium: 1170 },
];

function asFood(item: PublishedItem): Food {
  const per100 = (value: number) => Math.round(value * 10000 / item.grams) / 100;
  return {
    source: "custom", sourceId: `restaurant:harveys:${item.slug}`,
    name: item.name, brand: "Harvey's", description: DESCRIPTION,
    barcode: null, isVerified: false,
    nutrients: {
      kcal: per100(item.kcal), protein_g: per100(item.protein),
      carbs_g: per100(item.carbs), fat_g: per100(item.fat),
      fiber_g: per100(item.fiber), sugar_g: per100(item.sugar),
      sat_fat_g: per100(item.saturatedFat), sodium_mg: per100(item.sodium),
    },
    servings: [{ label: `1 burger (${item.grams} g)`, grams: item.grams, isDefault: true }],
    dataUpdatedAt: null, // Review date is not the publisher's revision date.
  };
}

export function restaurantById(id: string): Food | null {
  const item = ITEMS.find((item) => `restaurant:harveys:${item.slug}` === id);
  return item ? asFood(item) : null;
}

export function isRestaurantReference(food: Pick<Food, "description">): boolean {
  return food.description === DESCRIPTION;
}

export function restaurantReference(food: Pick<Food, "description">) {
  return isRestaurantReference(food) ? { url: SOURCE, reviewed: REVIEWED, country: "Canada" } : null;
}

export function searchRestaurantCatalogue(text: string): Food[] {
  const folded = text.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9 ]/g, " ");
  if (!/\bharveys?\b/.test(folded)) return [];
  const terms = folded.replace(/\bharveys?\b/g, "").split(/\s+/)
    .filter((word) => word && !["burger", "burgers", "with", "and", "a", "an", "the", "canada"].includes(word));
  // Unknown customisations and different menu items must not resolve to a
  // plain burger. Only reviewed variants are candidates.
  return ITEMS.filter((item) => {
    const name = item.name.toLowerCase();
    return terms.every((term) => name.includes(term));
  }).sort((a, b) => {
    if (terms.includes("big") || terms.includes("harv")) return 0;
    return a.name.length - b.name.length;
  }).map(asFood);
}
