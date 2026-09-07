import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PendingButton } from "@/components/pending-button";

/** A server action that never settles, so the form stays submitting. */
const hangs = () => new Promise<void>(() => {});

describe("PendingButton — a form action it does not own", () => {
  it("disables itself and says it is busy while the form submits", async () => {
    render(
      <form action={hangs}>
        <PendingButton type="submit" pendingLabel="Adding…">
          Add to diary
        </PendingButton>
      </form>,
    );

    const button = screen.getByRole("button");
    expect(button).toBeEnabled();

    fireEvent.click(button);

    expect(await screen.findByText("Adding…")).toBeInTheDocument();
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("keeps its own label when there is nothing better to say", async () => {
    render(
      <form action={hangs}>
        <PendingButton type="submit">Remove</PendingButton>
      </form>,
    );

    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("button", { name: "Remove" })).toBeDisabled();
  });
});

describe("PendingButton — double submission", () => {
  it("submits once however fast the second tap lands", () => {
    // The case this exists for: a plain server-action form, which has no
    // state of its own and used to fire twice on a double tap.
    const action = vi.fn(hangs);
    render(
      <form action={action}>
        <input type="hidden" name="entryId" value="1" />
        <PendingButton type="submit">Remove</PendingButton>
      </form>,
    );

    const button = screen.getByRole("button");
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(action).toHaveBeenCalledTimes(1);
  });

  it("blocks a repeat even when nothing re-rendered to disable it", () => {
    // A button whose click starts work the button cannot see — the guard is
    // synchronous, so it does not depend on a render arriving in time.
    const onClick = vi.fn();
    render(<PendingButton onClick={onClick}>Ask</PendingButton>);

    const button = screen.getByRole("button");
    fireEvent.click(button);
    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("lets the same button be used again once the moment has passed", () => {
    vi.useFakeTimers();
    try {
      const onClick = vi.fn();
      render(<PendingButton onClick={onClick}>Search</PendingButton>);

      const button = screen.getByRole("button");
      fireEvent.click(button);
      vi.setSystemTime(Date.now() + 1000);
      fireEvent.click(button);

      expect(onClick).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("PendingButton — pending it is told about", () => {
  it("shows the busy state for work outside any form", () => {
    render(
      <PendingButton pending pendingLabel="Searching…">
        Search
      </PendingButton>,
    );

    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Searching…")).toBeInTheDocument();
  });

  it("stays disabled when the caller disabled it for its own reasons", () => {
    render(
      <PendingButton disabled>
        Add 0 items
      </PendingButton>,
    );

    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    // Disabled is not busy: nothing is happening, the button simply has
    // nothing to do yet.
    expect(button).toHaveAttribute("aria-busy", "false");
  });
});

describe("PendingButton — reduced motion", () => {
  it("stops the spin but keeps every other signal", () => {
    render(
      <PendingButton pending pendingLabel="Saving…">
        Save
      </PendingButton>,
    );

    const spinner = document.querySelector("svg");
    expect(spinner).toHaveClass("animate-spin");
    // The class that switches it off is a media variant, so the same markup
    // serves both preferences — and the label and aria-busy carry the state
    // for anyone who never sees the animation.
    expect(spinner).toHaveClass("motion-reduce:animate-none");
    expect(screen.getByText("Saving…")).toBeInTheDocument();
  });
});
