/**
 * The projection sentence for a cut phase, in words (spec §8.6). Pure, so
 * the numbers and the grammar can be tested: weights to the tenth, and no
 * "1 weeks".
 */

/** "1 week", "3 weeks": English plurals, said once, here. */
export function plural(n: number, word: string): string {
  return `${n} ${n === 1 ? word : `${word}s`}`;
}

/**
 * The projection sentence from spec §8.6.
 *
 * States the gap between the current trajectory and the stretch target
 * factually, and never characterises the user for the difference.
 */
export function describeProjection({
  projectedEndWeightKg,
  stretchTargetKg,
  finalGoalWeightKg,
  daysToFinalGoal,
  daysRemaining,
  rate,
}: {
  projectedEndWeightKg: number | null;
  stretchTargetKg: number | null;
  finalGoalWeightKg: number | null;
  daysToFinalGoal: number | null;
  daysRemaining: number;
  rate: number | null;
}): string {
  if (projectedEndWeightKg === null || rate === null) {
    return "A few more weigh-ins are needed before this phase can be projected.";
  }

  if (rate >= 0) {
    return (
      "Your trend is flat or rising at the moment, so there is no projection " +
      "to make yet. That is common early in a phase, and often in the week " +
      "after a change in routine."
    );
  }

  const parts = [
    `At your current rate you are projected to reach approximately ` +
      `${projectedEndWeightKg.toFixed(1)} kg by the end of this phase` +
      (daysRemaining > 0 ? `, ${plural(daysRemaining, "day")} from now.` : "."),
  ];

  if (stretchTargetKg !== null && projectedEndWeightKg > stretchTargetKg) {
    parts.push(
      `${stretchTargetKg.toFixed(1)} kg would need a faster loss rate than your data ` +
        "currently supports.",
    );
  }

  if (finalGoalWeightKg !== null && daysToFinalGoal !== null) {
    parts.push(
      `At this pace ${finalGoalWeightKg.toFixed(1)} kg is ` +
        (daysToFinalGoal < 7
          ? "less than a week away."
          : `about ${plural(Math.round(daysToFinalGoal / 7), "week")} away.`),
    );
  }

  return parts.join(" ");
}

