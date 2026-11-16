/**
 * When is a plan fulfilled?
 *
 * A workout planned for a day is fulfilled by a session of THAT workout,
 * on that day, started after the plan was made. Each clause matters:
 *
 *   that workout   a different session the same day does not tick it off;
 *   that day       in the user's own calendar;
 *   after          planning "Push A" again for this evening, having done it
 *                  this morning, is a new intention — it must not vanish
 *                  the moment it is saved.
 *
 * Pure: the day of each session is worked out by the caller, in the user's
 * time zone.
 */

export type PlanLike = { templateId: number; date: string; createdAt: string };
export type SessionLike = { templateId: number | null; date: string; startedAt: string };

export function isFulfilled(plan: PlanLike, sessions: readonly SessionLike[]): boolean {
  return sessions.some(
    (session) =>
      session.templateId === plan.templateId &&
      session.date === plan.date &&
      session.startedAt >= plan.createdAt,
  );
}

/** The plans still to do, in the order given. */
export function openPlans<T extends PlanLike>(plans: readonly T[], sessions: readonly SessionLike[]): T[] {
  return plans.filter((plan) => !isFulfilled(plan, sessions));
}
