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
