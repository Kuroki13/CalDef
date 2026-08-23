import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PhaseChart } from "@/components/phase-chart";
import { buildPhaseSeries } from "@/lib/tdee/phase-series";
import { weightTrend } from "@/lib/tdee/trend";

const identity = (kg: number) => kg;

const series = (over: Record<string, unknown> = {}) =>
  buildPhaseSeries({
    startDate: "2026-08-23",
    durationDays: 56,
    startWeightKg: 111.8,
    recommendedKgPerWeek: 1.118,
    stretchTargetKg: 99,
    trend: weightTrend([
      { entry_date: "2026-08-23", weight_kg: 111.8 },
      { entry_date: "2026-08-25", weight_kg: 111.2 },
    ]),
    ...over,
  });

const render_ = (props: Partial<React.ComponentProps<typeof PhaseChart>> = {}) =>
  render(
    <PhaseChart
      points={series()}
      finalGoalKg={90}
      unitLabel="kg"
      toDisplay={identity}
      todayIndex={2}
      {...props}
    />,
  );

describe("PhaseChart", () => {
  it("asks for a started phase rather than drawing one point", () => {
    render_({ points: [] });
    expect(screen.getByText(/appears once the phase has started/)).toBeInTheDocument();
  });

  it("draws all four series", () => {
    const { container } = render_();
    // trend, recommended, stretch — three paths — plus weigh-in dots.
    expect(container.querySelectorAll("path")).toHaveLength(3);
    expect(container.querySelectorAll("circle").length).toBeGreaterThan(0);
  });

  it("produces no NaN coordinates", () => {
    const { container } = render_();
    for (const path of container.querySelectorAll("path")) {
      expect(path.getAttribute("d")).not.toContain("NaN");
    }
  });

  it("dashes the stretch line so it cannot be mistaken for the plan", () => {
    const { container } = render_();
    const dashed = [...container.querySelectorAll("path")].filter((p) =>
      p.getAttribute("stroke-dasharray"),
    );
    expect(dashed).toHaveLength(1);
  });

  it("draws the trend more heavily than the projections", () => {
    const { container } = render_();
    const widths = [...container.querySelectorAll("path")].map((p) =>
      Number(p.getAttribute("stroke-width")),
    );
    expect(Math.max(...widths)).toBe(2.5);
  });

  it("marks the final goal", () => {
    render_();
    expect(screen.getByText(/final goal 90.0/)).toBeInTheDocument();
  });

  it("omits the goal marker when it falls outside the drawn range", () => {
    // A goal far below the axis would otherwise be pinned to the floor and
    // read as if it were nearly reached.
    render_({ finalGoalKg: 40 });
    expect(screen.queryByText(/final goal/)).not.toBeInTheDocument();
  });

  it("breaks the trend line rather than bridging days with no data", () => {
    const { container } = render_();
    const paths = [...container.querySelectorAll("path")];
    const trend = paths[paths.length - 1];
    // Future days carry no trend, so the line must stop rather than run on.
    const moves = (trend.getAttribute("d") ?? "").match(/M /g) ?? [];
    expect(moves.length).toBeGreaterThanOrEqual(1);
  });

  it("labels the axis in the display unit", () => {
    render_({ toDisplay: (kg) => kg / 0.45359237, unitLabel: "lb" });
    expect(screen.queryByText("111.8")).not.toBeInTheDocument();
  });

  it("names the series for screen readers", () => {
    render_();
    expect(
      screen.getByRole("img", { name: /recommended trajectory/ }),
    ).toBeInTheDocument();
  });

  it("keeps a legend so the hierarchy is confirmable", () => {
    render_();
    expect(screen.getByText("Smoothed trend")).toBeInTheDocument();
    expect(
      screen.getByText(/Stretch \(never sets calories\)/),
    ).toBeInTheDocument();
  });

  it("copes with no stretch target", () => {
    const { container } = render_({
      points: series({ stretchTargetKg: null }),
    });
    const dashed = [...container.querySelectorAll("path")].filter(
      (p) => (p.getAttribute("d") ?? "").length > 0 && p.getAttribute("stroke-dasharray"),
    );
    expect(dashed).toHaveLength(0);
  });
});
