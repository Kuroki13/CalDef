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
      <SlabBar
        value={pct(consumed, target)}
        tone="volt"
        className="mt-5 h-2"
        label="Calories eaten against the target"
      />
      <p className="text-slab-muted mt-2 flex justify-between text-xs tabular-nums">
        <span>{Math.round(consumed)} / {Math.round(target)} kcal</span>
        <span>{Math.round(pct(consumed, target))}%</span>
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
