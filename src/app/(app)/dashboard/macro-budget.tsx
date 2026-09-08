/**
 * What is left of today, which is the question the dashboard exists to
 * answer.
 *
 * Calories and protein are not the same kind of number and are deliberately
 * not shown as though they were. On a cut, calories are a **ceiling** you
 * stay under — "left" is headroom, and running out is the normal end of a
 * good day. Protein is a **floor** you have to reach — "left" is a
 * shortfall, and ending the day with some remaining is the failure.
 * Rendering both as identical progress bars invites reading a protein
 * shortfall as spare room.
 *
 * So protein leads, is stated as a target to reach rather than a budget to
 * spend, and says plainly when it has been met. Carbs and fat sit under
 * them as the supporting figures they are: worth seeing, rarely the
 * decision.
 *
 * Going over is stated, not shouted. A day at 2 300 against 2 200 is a fact
 * about a day, not an emergency, and colouring it like an error trains
 * someone to stop reading the screen.
 */

import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export type MacroFigures = {
  consumed: number;
  target: number;
};

function pct(consumed: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(Math.max((consumed / target) * 100, 0), 100);
}

/**
 * The headline: calories as a budget, with what is left of it.
 */
export function CalorieBudget({
  consumed,
  target,
  label,
}: MacroFigures & { label: string }) {
  const left = Math.round(target - consumed);
  const over = left < 0;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-3xl font-semibold tabular-nums">
          {over ? `${Math.abs(left)} over` : `${left} left`}
        </p>
        <p className="text-muted-foreground text-sm tabular-nums">
          {Math.round(consumed)} / {Math.round(target)} kcal
        </p>
      </div>
      <Progress value={pct(consumed, target)} />
      <p className="text-muted-foreground text-xs">{label}</p>
    </div>
  );
}

/**
 * Protein, as a floor rather than a ceiling.
 *
 * Given its own row above the other macros and its own sentence, because it
 * is the one number on a cut that a day can be judged by and the one most
 * easily missed by twenty grams without noticing.
 */
export function ProteinFloor({ consumed, target }: MacroFigures) {
  const short = Math.round(target - consumed);
  const met = short <= 0;

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium">Protein</p>
        <p className="text-muted-foreground text-sm tabular-nums">
          {Math.round(consumed)} / {Math.round(target)} g
        </p>
      </div>
      <Progress value={pct(consumed, target)} />
      <p
        className={cn(
          "text-sm",
          // Met is worth saying warmly; short is worth saying plainly.
          // Neither is worth an alarm.
          met ? "text-foreground font-medium" : "text-muted-foreground",
        )}
      >
        {met
          ? `Target met${short < 0 ? ` — ${Math.abs(short)} g over` : ""}.`
          : `${short} g to go.`}
      </p>
    </div>
  );
}

/** Carbs and fat: present, secondary, and never alarming. */
export function MacroRemainder({
  carbs,
  fat,
}: {
  carbs: MacroFigures;
  fat: MacroFigures;
}) {
  return (
    <dl className="grid grid-cols-2 gap-3">
      {[
        { name: "Carbs", figures: carbs },
        { name: "Fat", figures: fat },
      ].map(({ name, figures }) => {
        const left = Math.round(figures.target - figures.consumed);
        return (
          <div key={name} className="space-y-1 rounded-lg border p-3">
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-muted-foreground text-xs">{name}</dt>
              <dd className="text-xs tabular-nums">
                {Math.round(figures.consumed)} / {Math.round(figures.target)} g
              </dd>
            </div>
            <Progress value={pct(figures.consumed, figures.target)} />
            <p className="text-muted-foreground text-xs tabular-nums">
              {left < 0 ? `${Math.abs(left)} g over` : `${left} g left`}
            </p>
          </div>
        );
      })}
    </dl>
  );
}
