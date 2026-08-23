/**
 * Weight trend chart, as inline SVG.
 *
 * No charting library: a dependency-free server-rendered SVG keeps the
 * bundle small and works without JavaScript, and the shape here — two
 * series over a date axis — does not need a chart engine.
 *
 * The raw scale readings are drawn faintly and the smoothed trend boldly,
 * because the trend is what every decision in the app is based on and the
 * chart should make that hierarchy obvious (ARCHITECTURE §6).
 */

import type { TrendPoint } from "@/lib/tdee/trend";

type Props = {
  points: readonly TrendPoint[];
  unitLabel: string;
  /** Converts a stored kilogram value into the user's display unit. */
  toDisplay: (kg: number) => number;
  height?: number;
};

const WIDTH = 720;
const PADDING = { top: 12, right: 12, bottom: 22, left: 40 };

export function TrendChart({
  points,
  unitLabel,
  toDisplay,
  height = 220,
}: Props) {
  if (points.length < 2) {
    return (
      <p className="text-muted-foreground text-sm">
        Two weigh-ins are needed before a trend can be drawn.
      </p>
    );
  }

  const values = points.flatMap((p) =>
    p.actualKg === null ? [p.trendKg] : [p.trendKg, p.actualKg],
  );
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  // A flat series would give a zero-height range and divide by zero.
  const pad = Math.max((rawMax - rawMin) * 0.1, 0.5);
  const min = rawMin - pad;
  const max = rawMax + pad;

  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = height - PADDING.top - PADDING.bottom;

  const x = (i: number) =>
    PADDING.left + (i / (points.length - 1)) * plotWidth;
  const y = (kg: number) =>
    PADDING.top + ((max - kg) / (max - min)) * plotHeight;

  const trendPath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.trendKg).toFixed(1)}`)
    .join(" ");

  const ticks = [max, (max + min) / 2, min];

  return (
    <figure className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="h-auto w-full min-w-[320px]"
        role="img"
        aria-label={`Weight trend from ${points[0].date} to ${points[points.length - 1].date}`}
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

        {/* Raw readings, deliberately secondary to the trend line. */}
        {points.map((p, i) =>
          p.actualKg === null ? null : (
            <circle
              key={p.date}
              cx={x(i)}
              cy={y(p.actualKg)}
              r={2.5}
              className="fill-muted-foreground/40"
            />
          ),
        )}

        <path
          d={trendPath}
          fill="none"
          className="stroke-foreground"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        <text
          x={PADDING.left}
          y={height - 6}
          className="fill-muted-foreground text-[11px]"
        >
          {points[0].date}
        </text>
        <text
          x={WIDTH - PADDING.right}
          y={height - 6}
          textAnchor="end"
          className="fill-muted-foreground text-[11px]"
        >
          {points[points.length - 1].date}
        </text>
      </svg>
      <figcaption className="text-muted-foreground mt-2 text-xs">
        Solid line is the smoothed trend in {unitLabel}; dots are individual
        weigh-ins. Decisions use the trend, never a single reading.
      </figcaption>
    </figure>
  );
}
