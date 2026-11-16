/**
 * Progress of one exercise, as inline SVG — the same dependency-free
 * approach as the weight chart.
 *
 * One dot per completed session, joined by a line. Only real sessions are
 * drawn: with fewer than two there is no line to draw, and the component
 * says so instead of inventing one.
 */

import type { ProgressPoint } from "@/lib/training/metrics";

const WIDTH = 720;
const HEIGHT = 200;
const PADDING = { top: 14, right: 14, bottom: 24, left: 46 };

export function ProgressChart({
  points,
  /** Converts a stored value (kg, s, m, reps) into what the axis shows. */
  format,
  caption,
}: {
  points: readonly ProgressPoint[];
  format: (value: number) => string;
  caption: string;
}) {
  if (points.length < 2) {
    return (
      <p className="text-muted-foreground text-sm">
        Two sessions are needed before progress can be drawn.
      </p>
    );
  }

  const values = points.map((p) => p.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const pad = Math.max((rawMax - rawMin) * 0.15, rawMax * 0.02, 0.5);
  const min = Math.max(0, rawMin - pad);
  const max = rawMax + pad;

  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const x = (i: number) => PADDING.left + (i / (points.length - 1)) * plotWidth;
  const y = (v: number) => PADDING.top + ((max - v) / (max - min)) * plotHeight;

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`)
    .join(" ");
  const day = (iso: string) => iso.slice(0, 10);

  return (
    <figure className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full min-w-[320px]"
        role="img"
        aria-label={`${caption}, ${points.length} sessions from ${day(points[0].date)} to ${day(points[points.length - 1].date)}: from ${format(points[0].value)} to ${format(points[points.length - 1].value)}`}
      >
        {[max, (max + min) / 2, min].map((value) => (
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
              {format(value)}
            </text>
          </g>
        ))}
        <path
          d={path}
          fill="none"
          className="stroke-foreground"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((p, i) => (
          <circle key={p.sessionId} cx={x(i)} cy={y(p.value)} r={4} className="fill-volt stroke-foreground" strokeWidth={2} />
        ))}
        <text x={PADDING.left} y={HEIGHT - 6} className="fill-muted-foreground text-[11px]">
          {day(points[0].date)}
        </text>
        <text
          x={WIDTH - PADDING.right}
          y={HEIGHT - 6}
          textAnchor="end"
          className="fill-muted-foreground text-[11px]"
        >
          {day(points[points.length - 1].date)}
        </text>
      </svg>
      <figcaption className="text-muted-foreground mt-2 text-xs">{caption}</figcaption>
    </figure>
  );
}
