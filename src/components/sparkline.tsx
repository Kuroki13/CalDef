/**
 * A trend with no axes: the shape of a series, where the figure next to it
 * already gives the value. Drawn only from real points — with fewer than
 * two there is no line, and nothing is drawn in its place.
 */
export function Sparkline({
  values,
  label,
  height = 52,
  className,
}: {
  values: readonly number[];
  label: string;
  height?: number;
  className?: string;
}) {
  if (values.length < 2) return <span aria-hidden />;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const y = (v: number) => 4 + (1 - (v - min) / span) * (height - 8);
  const d = values
    .map((v, i) => `${i === 0 ? "M" : "L"}${((i / (values.length - 1)) * 100).toFixed(2)} ${y(v).toFixed(1)}`)
    .join(" ");

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      className={className}
      style={{ width: "100%", height }}
    >
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
