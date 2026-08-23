import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TrendChart } from "@/components/trend-chart";
import type { TrendPoint } from "@/lib/tdee/trend";

const point = (
  date: string,
  trendKg: number,
  actualKg: number | null = trendKg,
): TrendPoint => ({ date, trendKg, actualKg });

const identity = (kg: number) => kg;

describe("TrendChart", () => {
  it("asks for more data rather than drawing a single point", () => {
    render(
      <TrendChart
        points={[point("2026-08-01", 111.8)]}
        unitLabel="kg"
        toDisplay={identity}
      />,
    );
    expect(screen.getByText(/Two weigh-ins are needed/)).toBeInTheDocument();
  });

  it("renders nothing but the prompt for an empty series", () => {
    render(<TrendChart points={[]} unitLabel="kg" toDisplay={identity} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("draws a trend path once there are two points", () => {
    const { container } = render(
      <TrendChart
        points={[point("2026-08-01", 111.8), point("2026-08-02", 111.6)]}
        unitLabel="kg"
        toDisplay={identity}
      />,
    );
    const path = container.querySelector("path");
    expect(path?.getAttribute("d")).toMatch(/^M [\d.]+ [\d.]+ L/);
  });

  it("survives a completely flat series without dividing by zero", () => {
    // A flat range would make (max - min) zero and every coordinate NaN.
    const { container } = render(
      <TrendChart
        points={[point("2026-08-01", 100), point("2026-08-02", 100)]}
        unitLabel="kg"
        toDisplay={identity}
      />,
    );
    const d = container.querySelector("path")?.getAttribute("d") ?? "";
    expect(d).not.toContain("NaN");
  });

  it("plots a dot only for days that carry a reading", () => {
    const { container } = render(
      <TrendChart
        points={[
          point("2026-08-01", 111.8),
          point("2026-08-02", 111.8, null),
          point("2026-08-03", 111.5),
        ]}
        unitLabel="kg"
        toDisplay={identity}
      />,
    );
    expect(container.querySelectorAll("circle")).toHaveLength(2);
  });

  it("labels the axis in the user's display unit", () => {
    render(
      <TrendChart
        points={[point("2026-08-01", 100), point("2026-08-02", 99)]}
        unitLabel="lb"
        toDisplay={(kg) => kg / 0.45359237}
      />,
    );
    // 100 kg is ~220.5 lb, so no kilogram figure should appear on the axis.
    expect(screen.queryByText("100.0")).not.toBeInTheDocument();
    expect(screen.getByText(/lb/)).toBeInTheDocument();
  });

  it("names the date range for screen readers", () => {
    render(
      <TrendChart
        points={[point("2026-08-01", 111.8), point("2026-08-28", 109.2)]}
        unitLabel="kg"
        toDisplay={identity}
      />,
    );
    expect(
      screen.getByRole("img", { name: /2026-08-01 to 2026-08-28/ }),
    ).toBeInTheDocument();
  });
});
