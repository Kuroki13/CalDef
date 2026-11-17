/**
 * What is left of today — the figures the slab carries.
 *
 * Calories and protein are not the same kind of number and are deliberately
 * not worded as though they were. On a cut, calories are a **ceiling** you
 * stay under — "left" is headroom, and running out is the normal end of a
 * good day. Protein is a **floor** you have to reach — what remains is a
 * shortfall, and ending the day with some remaining is the failure. So
 * calories count down ("left"), protein counts up ("to go", then "Target
 * met"), and protein alone gets the volt bar: it is the one macro a day on
 * a cut is judged by.
 *
 * Going over is stated, not shouted. A day at 2 300 against 2 200 is a fact
 * about a day, not an emergency, and colouring it like an error trains
 * someone to stop reading the screen.
 *
 * These are written to sit on the slab (`Slab` in page-header.tsx): light
 * text on ink.
 */

import { SlabBar } from "@/components/page-header";

export type MacroFigures = {
  consumed: number;
  target: number;
};

/**
 * Three states, not two. A full bar means both "reached" and "over", so the
 * words carry the difference — and on the slab an over-target bar turns to
 * the warning colour with a notch where the target was, so the two never
 * look alike even at a glance. Within 2% either way counts as reached: the
 * last mouthful is not news.
 */
export type BudgetState = "under" | "reached" | "over";

export function budgetState(consumed: number, target: number): BudgetState {
  if (target <= 0) return "under";
  const ratio = consumed / target;
  if (ratio > 1.02) return "over";
  if (ratio >= 0.98) return "reached";
  return "under";
}

/** The kcal bar, which says "over" by colour and by shape. */
function CalorieBar({ consumed, target, className }: MacroFigures & { className?: string }) {
  const state = budgetState(consumed, target);
  if (state !== "over") {
    return (
      <SlabBar
        value={pct(consumed, target)}
        tone="volt"
        className={className}
        label={state === "reached" ? "Calories: target reached" : "Calories eaten against the target"}
      />
    );
  }
  // Over: the bar is scaled to what was eaten, the target is a notch in it,
  // and the part past the notch is the warning colour.
  const at = (target / consumed) * 100;
  return (
    <div
      role="img"
      aria-label={`Calories: ${Math.round(consumed - target)} kcal over the target`}
      className={`bg-slab-line relative overflow-hidden rounded-full ${className ?? ""}`}
    >
      <div className="bg-volt absolute inset-y-0 left-0" style={{ width: `${at}%` }} />
      <div className="bg-warning absolute inset-y-0 right-0" style={{ left: `${at}%` }} />
      <div className="bg-slab absolute inset-y-0 w-0.5" style={{ left: `${at}%` }} />
    </div>
  );
}

function pct(consumed: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(Math.max((consumed / target) * 100, 0), 100);
}

/**
 * The headline: one number, as large as the screen allows, and the words
 * that say what it is.
 */
export function CalorieBudget({
  consumed,
  target,
  label,
  compact = false,
  day = "today",
}: MacroFigures & {
  label: string;
  /** Which day the figure is about; the diary shows other days too. */
  day?: "today" | "that day";
  /** A smaller figure, where the screen has a list to get to. */
  compact?: boolean;
}) {
  const left = Math.round(target - consumed);
  const state = budgetState(consumed, target);
  const over = left < 0;

  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className="mt-3 flex items-end gap-3">
        <span
          className={
            compact
              ? "figure text-7xl leading-[0.8]"
              : "figure text-[6.75rem] leading-[0.8] lg:text-[9rem]"
          }
        >
          {Math.abs(left)}
        </span>
        <span className="text-slab-muted pb-1 text-sm leading-tight">
          {over ? "kcal over" : "kcal left"}
          <br />
          {day}
        </span>
      </p>
      <CalorieBar consumed={consumed} target={target} className="mt-5 h-2" />
      <p className="text-slab-muted mt-2 flex justify-between text-xs tabular-nums">
        <span>{Math.round(consumed)} / {Math.round(target)} kcal</span>
        <span className={state === "under" ? "" : "text-slab-foreground font-semibold"}>
          {state === "over"
            ? `Over target by ${Math.abs(left)} kcal`
            : state === "reached"
              ? "Target reached"
              : `${Math.round(pct(consumed, target))}%`}
        </span>
      </p>
    </div>
  );
}

function MacroCell({
  name,
  figures,
  tone,
  status,
}: {
  name: string;
  figures: MacroFigures;
  tone: "volt" | "plain";
  status: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{name}</dt>
      <dd>
        <p className="mt-1 whitespace-nowrap">
          <span className="figure text-3xl">{Math.round(figures.consumed)}</span>
          <span className="text-slab-muted text-xs"> / {Math.round(figures.target)} g</span>
        </p>
        <SlabBar
          value={pct(figures.consumed, figures.target)}
          tone={tone}
          className="mt-2 h-1"
          label={`${name} eaten against the target`}
        />
        <p className="text-slab-muted mt-1.5 text-xs tabular-nums">{status}</p>
      </dd>
    </div>
  );
}

/**
 * Protein, as a floor rather than a ceiling: counted up, and said plainly
 * when it has been reached.
 */
export function ProteinFloor({ consumed, target }: MacroFigures) {
  const short = Math.round(target - consumed);
  const met = short <= 0;

  return (
    <MacroCell
      name="Protein"
      figures={{ consumed, target }}
      tone="volt"
      status={
        met
          ? `Target met${short < 0 ? ` — ${Math.abs(short)} g over` : ""}.`
          : `${short} g to go.`
      }
    />
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
    <>
      {[
        { name: "Carbs", figures: carbs },
        { name: "Fat", figures: fat },
      ].map(({ name, figures }) => {
        const left = Math.round(figures.target - figures.consumed);
        return (
          <MacroCell
            key={name}
            name={name}
            figures={figures}
            tone="plain"
            status={left < 0 ? `${Math.abs(left)} g over` : `${left} g left`}
          />
        );
      })}
    </>
  );
}

/**
 * The diary's version: one band of figures, so the meals come next. What
 * the day's calories are against the target, the three macros, and how much
 * of it is estimated — the questions a diary answers, in two lines.
 */
export function CompactBudget({
  consumed,
  target,
  label,
  macros,
  estimatedPct,
}: MacroFigures & {
  label: string;
  macros: { protein: MacroFigures; carbs: MacroFigures; fat: MacroFigures };
  /** Share of the day's calories that are estimates, 0–100; null when none. */
  estimatedPct: number | null;
}) {
  const left = Math.round(target - consumed);
  const state = budgetState(consumed, target);
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <p className="flex items-baseline gap-2">
          <span className="figure text-5xl">{Math.abs(left)}</span>
          <span className="text-slab-muted text-sm">
            {state === "over" ? "kcal over" : state === "reached" ? "kcal left · target reached" : "kcal left"}
          </span>
        </p>
        <p className="text-slab-muted pb-1 text-right text-xs leading-tight tabular-nums">
          <span className="text-slab-foreground font-semibold">{Math.round(consumed)}</span> /{" "}
          {Math.round(target)} kcal
          <br />
          {label}
        </p>
      </div>
      <CalorieBar consumed={consumed} target={target} className="mt-3 h-2" />
      <dl className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs tabular-nums">
        {(
          [
            ["Protein", macros.protein, "P"],
            ["Carbs", macros.carbs, "C"],
            ["Fat", macros.fat, "F"],
          ] as const
        ).map(([name, figures]) => (
          <div key={name} className="flex items-baseline gap-1">
            <dt className="text-slab-muted">{name}</dt>
            <dd>
              <span className="figure text-lg">{Math.round(figures.consumed)}</span>
              <span className="text-slab-muted">/{Math.round(figures.target)} g</span>
            </dd>
          </div>
        ))}
        {estimatedPct !== null ? (
          <div className="text-slab-muted ml-auto">
            <dt className="sr-only">Estimated</dt>
            <dd>{estimatedPct}% estimated</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
