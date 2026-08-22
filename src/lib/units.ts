/**
 * Body-measurement unit conversion.
 *
 * Everything is stored in kilograms and centimetres. `unit_system` is a
 * display preference only — conversion happens at the edges, so no
 * calculation anywhere else has to know which system the user picked.
 *
 * (Portion units — g / ml / serving — are a separate concern and live in
 * `src/lib/nutrition/units.ts`.)
 */

export const KG_PER_LB = 0.45359237;
export const CM_PER_INCH = 2.54;

export type UnitSystem = "metric" | "imperial";

export const lbToKg = (lb: number): number => lb * KG_PER_LB;
export const kgToLb = (kg: number): number => kg / KG_PER_LB;
export const inchToCm = (inch: number): number => inch * CM_PER_INCH;
export const cmToInch = (cm: number): number => cm / CM_PER_INCH;

/** Interprets a mass the user typed, in their chosen system, as kilograms. */
export function massToKg(value: number, system: UnitSystem): number {
  return system === "imperial" ? lbToKg(value) : value;
}

/** Interprets a length the user typed, in their chosen system, as centimetres. */
export function lengthToCm(value: number, system: UnitSystem): number {
  return system === "imperial" ? inchToCm(value) : value;
}

/** Renders a stored kilogram value in the user's chosen system. */
export function kgToDisplay(kg: number, system: UnitSystem): number {
  return system === "imperial" ? kgToLb(kg) : kg;
}

/** Renders a stored centimetre value in the user's chosen system. */
export function cmToDisplay(cm: number, system: UnitSystem): number {
  return system === "imperial" ? cmToInch(cm) : cm;
}

export const massUnitLabel = (system: UnitSystem) =>
  system === "imperial" ? "lb" : "kg";

export const lengthUnitLabel = (system: UnitSystem) =>
  system === "imperial" ? "in" : "cm";

/** Rounds for display without pretending to more precision than we have. */
export function formatMass(kg: number, system: UnitSystem): string {
  return `${kgToDisplay(kg, system).toFixed(1)} ${massUnitLabel(system)}`;
}
