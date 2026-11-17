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

import { formatLongDate } from "@/lib/dates";
import type { TrendPoint } from "@/lib/tdee/trend";

type Props = {
  points: readonly TrendPoint[];
  unitLabel: string;
  /** Converts a stored kilogram value into the user's display unit. */
  toDisplay: (kg: number) => number;
  height?: number;
};

// Drawn at about phone width, so its labels stay readable when scaled to a
// 360 px screen (they were 5 px at 720).
const WIDTH = 400;
const PADDING = { top: 10, right: 8, bottom: 22, left: 34 };

export function TrendChart({
  points,
  unitLabel,
  toDisplay,
  height = 190,
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
    <figure className="w-full">
      {/* The legend says how to tell a reading from the trend: by shape,
          not only by shade. */}
      <div className="text-muted-foreground mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" aria-hidden>
        <span className="flex items-center gap-1.5">
          <span className="bg-foreground h-[3px] w-5 rounded-full" />
          Trend (smoothed)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="bg-muted-foreground/60 size-2 rounded-full" />
          Weigh-ins
        </span>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Weight from ${formatLongDate(points[0].date)} to ${formatLongDate(points[points.length - 1].date)}: smoothed trend ${toDisplay(points[0].trendKg).toFixed(1)} to ${toDisplay(points[points.length - 1].trendKg).toFixed(1)} ${unitLabel}, with ${points.filter((p) => p.actualKg !== null).length} weigh-ins`}
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
              r={2.6}
              className="fill-muted-foreground/45"
            />
          ),
        )}

        <path
          d={trendPath}
          fill="none"
          className="stroke-foreground"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        <text
          x={PADDING.left}
          y={height - 6}
          className="fill-muted-foreground text-[11px]"
        >
          {formatLongDate(points[0].date)}
        </text>
        <text
          x={WIDTH - PADDING.right}
          y={height - 6}
          textAnchor="end"
          className="fill-muted-foreground text-[11px]"
        >
          {formatLongDate(points[points.length - 1].date)}
        </text>
      </svg>
      <figcaption className="text-muted-foreground mt-2 text-xs">
        In {unitLabel}. Targets follow the trend, never a single reading.
      </figcaption>
    </figure>
  );
}
