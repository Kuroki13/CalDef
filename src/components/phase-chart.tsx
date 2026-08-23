/**
 * The phase progress graph (spec §8.7).
 *
 * Four lines over day 1 → 56, plus a marker at the final goal. Inline SVG,
 * no charting dependency, server-rendered.
 *
 * The visual hierarchy carries the meaning. The trend is the boldest line
 * because it is what every decision uses; the recommended trajectory is
 * solid but lighter; the stretch line is dashed, because it is a goalpost
 * and never a prescription; the raw readings are faint dots. A reader should
 * be able to tell which line the app acts on without a legend — the legend
 * is there to confirm, not to decode.
 */

import type { PhaseSeriesPoint } from "@/lib/tdee/phase-series";
import { seriesBounds } from "@/lib/tdee/phase-series";

type Props = {
  points: readonly PhaseSeriesPoint[];
  finalGoalKg: number | null;
  unitLabel: string;
  toDisplay: (kg: number) => number;
  /** Day index of today, for the "you are here" rule. */
  todayIndex: number;
  height?: number;
};

const WIDTH = 760;
const PADDING = { top: 14, right: 14, bottom: 28, left: 44 };

export function PhaseChart({
  points,
  finalGoalKg,
  unitLabel,
  toDisplay,
  todayIndex,
  height = 260,
}: Props) {
  if (points.length < 2) {
    return (
      <p className="text-muted-foreground text-sm">
        The graph appears once the phase has started.
      </p>
    );
  }

  // The goal marker stretches the axis to fit, which is right for a goal
  // near the phase and wrong for one far below it: a 40 kg marker under a
  // 110 kg phase would squash eight weeks of real movement into a sliver
  // and draw the goal as though it were nearly in reach. It is included
  // only while it stays within one full range of the data, and otherwise
  // left off the chart entirely — the dashboard still states it as a figure.
  const dataBounds = seriesBounds(points);
  const dataRange = dataBounds.max - dataBounds.min;
  const showGoal =
    finalGoalKg !== null &&
    finalGoalKg >= dataBounds.min - dataRange &&
    finalGoalKg <= dataBounds.max + dataRange;

  const { min, max } = showGoal
    ? seriesBounds(points, [finalGoalKg])
    : dataBounds;

  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = height - PADDING.top - PADDING.bottom;

  const x = (i: number) => PADDING.left + (i / (points.length - 1)) * plotWidth;
  const y = (kg: number) =>
    PADDING.top + ((max - kg) / (max - min)) * plotHeight;

  const line = (pick: (p: PhaseSeriesPoint) => number | null) => {
    const segments: string[] = [];
    let drawing = false;
    points.forEach((p, i) => {
      const value = pick(p);
      if (value === null) {
        drawing = false;
        return;
      }
      segments.push(
        `${drawing ? "L" : "M"} ${x(i).toFixed(1)} ${y(value).toFixed(1)}`,
      );
      drawing = true;
    });
    return segments.join(" ");
  };

  const ticks = [max, (max + min) / 2, min];

  return (
    <figure className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="h-auto w-full min-w-[340px]"
        role="img"
        aria-label={`Phase progress in ${unitLabel} from day 1 to day ${points.length - 1}, showing actual weight, smoothed trend, the recommended trajectory and the stretch trajectory`}
      >
        {ticks.map((value) => (
          <g key={value}>
            <line
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={y(value)}
              y2={y(value)}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={PADDING.left - 6}
              y={y(value) + 4}
              textAnchor="end"
              className="fill-muted-foreground text-[11px]"
            >
              {toDisplay(value).toFixed(1)}
            </text>
          </g>
        ))}

        {showGoal && finalGoalKg !== null ? (
          <g>
            <line
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={y(finalGoalKg)}
              y2={y(finalGoalKg)}
              className="stroke-foreground/40"
              strokeWidth={1}
              strokeDasharray="2 4"
            />
            <text
              x={WIDTH - PADDING.right}
              y={y(finalGoalKg) - 5}
              textAnchor="end"
              className="fill-muted-foreground text-[10px]"
            >
              final goal {toDisplay(finalGoalKg).toFixed(1)}
            </text>
          </g>
        ) : null}

        {/* Today, so the drawn past and the projected future are separable. */}
        {todayIndex > 0 && todayIndex < points.length - 1 ? (
          <line
            x1={x(todayIndex)}
            x2={x(todayIndex)}
            y1={PADDING.top}
            y2={height - PADDING.bottom}
            className="stroke-border"
            strokeWidth={1}
          />
        ) : null}

        {/* Stretch: dashed, because it is aspirational and sets nothing. */}
        <path
          d={line((p) => p.stretchKg)}
          fill="none"
          className="stroke-muted-foreground"
          strokeWidth={1.5}
          strokeDasharray="5 4"
        />

        {/* Recommended: what the plan actually works to. */}
        <path
          d={line((p) => p.recommendedKg)}
          fill="none"
          className="stroke-muted-foreground"
          strokeWidth={1.5}
        />

        {points.map((p, i) =>
          p.actualKg === null ? null : (
            <circle
              key={p.date}
              cx={x(i)}
              cy={y(p.actualKg)}
              r={2}
              className="fill-muted-foreground/40"
            />
          ),
        )}

        {/* Trend: boldest, because it is what every decision reads. */}
        <path
          d={line((p) => p.trendKg)}
          fill="none"
          className="stroke-foreground"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        <text
          x={PADDING.left}
          y={height - 8}
          className="fill-muted-foreground text-[11px]"
        >
          day 1
        </text>
        <text
          x={WIDTH - PADDING.right}
          y={height - 8}
          textAnchor="end"
          className="fill-muted-foreground text-[11px]"
        >
          day {points.length - 1}
        </text>
      </svg>

      <figcaption className="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <Key className="bg-foreground h-[3px] w-4 rounded-full">
          Smoothed trend
        </Key>
        <Key className="bg-muted-foreground h-[2px] w-4">Recommended</Key>
        <Key className="bg-muted-foreground h-[2px] w-4 opacity-60">
          Stretch (never sets calories)
        </Key>
        <Key className="bg-muted-foreground/40 size-1.5 rounded-full">
          Weigh-ins
        </Key>
      </figcaption>
    </figure>
  );
}

function Key({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={className} />
      {children}
    </span>
  );
}
