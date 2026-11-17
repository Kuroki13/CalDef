/**
 * The credit lines the reference tables' licences require (§13J/§13K).
 *
 * Kept apart from the providers so a screen can show them without pulling
 * the tables themselves into the browser bundle.
 */

export const ATTRIBUTION = {
  ciqual:
    "Source : Anses, Table de composition nutritionnelle des aliments Ciqual 2025 (Licence Ouverte / Etalab 2.0).",
  cnf: "Contains information licensed under the Open Government Licence – Canada (Health Canada, Canadian Nutrient File 2026).",
} as const;

/**
 * Whether a food is a stored official restaurant reference (§13L), read from
 * its marker alone — so a screen can say so without loading the catalogue.
 */
export function isRestaurantDescription(description: string | null | undefined): boolean {
  return typeof description === "string" && description.startsWith("Restaurant reference |");
}

/**
 * The source link and review date a restaurant reference carries in its own
 * marker ("… | Reviewed 2026-10-08 | https://… | …"). Read from the marker,
 * so the review screen needs no catalogue in the browser.
 */
export function restaurantReferenceFromDescription(
  description: string | null | undefined,
): { url: string; reviewed: string; country: "Canada" } | null {
  if (!isRestaurantDescription(description)) return null;
  const parts = (description as string).split(" | ");
  const reviewed = parts.find((p) => p.startsWith("Reviewed "))?.slice("Reviewed ".length);
  const url = parts.find((p) => p.startsWith("https://"));
  return reviewed && url ? { url, reviewed, country: "Canada" } : null;
}
