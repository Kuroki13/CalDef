/**
 * When is a plan fulfilled?
 *
 * Since migration 20261118000003 a session started from a plan carries that
 * plan's id (`workout_sessions.schedule_id`). That link is the answer, and
 * the only one for new sessions: two workouts with the same name planned the
 * same day, or a free session called the same thing, cannot be confused.
 *
 * Sessions recorded before the link existed have none. For them the old rule
 * still applies — a session of THAT workout, on that day, started after the
 * plan was made — and the result says the match is `inferred`, so it stays
 * identifiable rather than passing for a recorded fact. A session that links
 * to some plan never stands in for another one by inference.
 *
 * Pure: the day of each session is worked out by the caller, in the user's
 * time zone.
 */

export type PlanLike = { id: number; templateId: number; date: string; createdAt: string };
export type SessionLike = {
  templateId: number | null;
  date: string;
  startedAt: string;
  /** The plan this session carried out; null for free or older sessions. */
  scheduleId?: number | null;
};

export type Fulfilment = "linked" | "inferred" | null;

export function fulfilment(plan: PlanLike, sessions: readonly SessionLike[]): Fulfilment {
  if (sessions.some((session) => session.scheduleId === plan.id)) return "linked";
  const inferred = sessions.some(
    (session) =>
      (session.scheduleId ?? null) === null &&
      session.templateId === plan.templateId &&
      session.date === plan.date &&
      session.startedAt >= plan.createdAt,
  );
  return inferred ? "inferred" : null;
}

export function isFulfilled(plan: PlanLike, sessions: readonly SessionLike[]): boolean {
  return fulfilment(plan, sessions) !== null;
}

/** The plans still to do, in the order given. */
export function openPlans<T extends PlanLike>(plans: readonly T[], sessions: readonly SessionLike[]): T[] {
  return plans.filter((plan) => !isFulfilled(plan, sessions));
}
