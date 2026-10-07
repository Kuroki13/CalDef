/**
 * Your usual amount of a food (spec §12D).
 *
 * Learned from the user's own diary: 178, 192, 185, 181 g of chicken is
 * "about 185 g". It is only ever offered — the portion field shows it beside
 * the amount and applies it on a tap. It never fills the amount in by
 * itself, because a number that changes without being asked is a number the
 * user stops checking.
 *
 * Pure, so the rule is testable without a database.
 */

import type { PortionUnit } from "@/lib/nutrition/units";

export type PortionLog = {
  amount: number;
  unit: PortionUnit;
  /** Required to mean anything when `unit` is `serving`. */
  servingLabel: string | null;
};

export type UsualPortion = {
  amount: number;
  unit: PortionUnit;
  servingLabel: string | null;
  /** How many entries it was learned from. */
  basedOn: number;
};

/** Only the latest few: habits change, and last spring's portion is not this one. */
export const USUAL_WINDOW = 10;

/** Fewer than this is an anecdote, not a habit. */
export const USUAL_MIN_LOGS = 3;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * "About" means rounded to what a person would weigh or pour: to 5 above
 * 50 g or ml, to 1 below; servings to the half.
 */
export function roundUsual(amount: number, unit: PortionUnit): number {
  if (unit === "serving") return Math.max(0.5, Math.round(amount * 2) / 2);
  if (amount >= 50) return Math.round(amount / 5) * 5;
  return Math.max(1, Math.round(amount));
}

/**
 * The usual portion, from logs newest first — or null when there is no
 * habit to speak of.
 *
 * Amounts are compared only within one unit and one serving: "1 pot" and
 * "160 g" may be the same yogurt, but averaging a count with a weight is
 * nonsense. The unit used most in the window wins; a tie goes to the one
 * used most recently.
 */
export function typicalPortion(logsNewestFirst: readonly PortionLog[]): UsualPortion | null {
  const window = logsNewestFirst
    .slice(0, USUAL_WINDOW)
    .filter((log) => Number.isFinite(log.amount) && log.amount > 0);

  const groups = new Map<string, { first: number; logs: PortionLog[] }>();
  window.forEach((log, index) => {
    const key = log.unit === "serving" ? `serving:${log.servingLabel ?? ""}` : log.unit;
    const group = groups.get(key) ?? { first: index, logs: [] };
    group.logs.push(log);
    groups.set(key, group);
  });

  const best = [...groups.values()].sort(
    (a, b) => b.logs.length - a.logs.length || a.first - b.first,
  )[0];
  if (!best || best.logs.length < USUAL_MIN_LOGS) return null;

  const sample = best.logs[0];
  if (sample.unit === "serving" && !sample.servingLabel) return null;

  return {
    amount: roundUsual(median(best.logs.map((log) => log.amount)), sample.unit),
    unit: sample.unit,
    servingLabel: sample.unit === "serving" ? sample.servingLabel : null,
    basedOn: best.logs.length,
  };
}
