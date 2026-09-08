import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  CalorieBudget,
  MacroRemainder,
  ProteinFloor,
} from "@/app/(app)/dashboard/macro-budget";

describe("CalorieBudget — a ceiling, counted down", () => {
  it("leads with what is left", () => {
    render(
      <CalorieBudget consumed={1200} target={2000} label="Daily target" />,
    );

    expect(screen.getByText("800 left")).toBeInTheDocument();
    expect(screen.getByText(/1200 \/ 2000 kcal/)).toBeInTheDocument();
  });

  it("says how far over, plainly, when the budget is spent", () => {
    // A day at 2300 against 2200 is a fact about a day. Stating it is the
    // job; alarming about it teaches someone to stop reading the screen.
    render(
      <CalorieBudget consumed={2300} target={2200} label="Daily target" />,
    );

    expect(screen.getByText("100 over")).toBeInTheDocument();
  });

  it("names which régime set the number", () => {
    // The diary and the dashboard have to agree about this, or the figure
    // is ambiguous about where it came from.
    render(
      <CalorieBudget
        consumed={0}
        target={2000}
        label="2-Month Cut target · 2000 kcal"
      />,
    );

    expect(screen.getByText(/2-Month Cut target/)).toBeInTheDocument();
  });
});

describe("ProteinFloor — a floor, counted up", () => {
  it("says how much is still to eat, not how much is spare", () => {
    // The distinction the whole component exists for: 60 g of protein
    // remaining is a shortfall, where 60 kcal remaining is headroom.
    render(<ProteinFloor consumed={120} target={180} />);

    expect(screen.getByText("60 g to go.")).toBeInTheDocument();
    expect(screen.queryByText(/left/)).not.toBeInTheDocument();
  });

  it("says so when the target is met", () => {
    render(<ProteinFloor consumed={180} target={180} />);
    expect(screen.getByText("Target met.")).toBeInTheDocument();
  });

  it("treats going over as met, with the excess as an aside", () => {
    render(<ProteinFloor consumed={200} target={180} />);
    expect(screen.getByText(/Target met — 20 g over\./)).toBeInTheDocument();
  });
});

describe("MacroRemainder — the supporting figures", () => {
  it("shows carbs and fat with what is left of each", () => {
    render(
      <MacroRemainder
        carbs={{ consumed: 100, target: 180 }}
        fat={{ consumed: 40, target: 60 }}
      />,
    );

    expect(screen.getByText("80 g left")).toBeInTheDocument();
    expect(screen.getByText("20 g left")).toBeInTheDocument();
  });

  it("states an overshoot without dressing it as an error", () => {
    render(
      <MacroRemainder
        carbs={{ consumed: 200, target: 180 }}
        fat={{ consumed: 40, target: 60 }}
      />,
    );

    const over = screen.getByText("20 g over");
    expect(over).toBeInTheDocument();
    expect(over.className).not.toMatch(/destructive/);
  });
});
