import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const proposals = vi.fn();
vi.mock("@/components/food-proposal-review", () => ({
  FoodProposalReview: (props: { proposals: unknown[] }) => {
    proposals(props.proposals);
    return <div data-testid="review">review</div>;
  },
}));

const { DescribeMeal } = await import("@/components/describe-meal");

const mealTypes = [{ id: 1, slug: "lunch", name: "Lunch", sort_order: 1 }] as never;

function respondWith(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function describeMeal() {
  return render(<DescribeMeal logDate="2026-09-07" mealTypes={mealTypes} />);
}

async function submit(text: string) {
  fireEvent.change(screen.getByLabelText(/describe what you ate/i), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: /read this/i }));
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("DescribeMeal", () => {
  it("reads a sentence into proposals and reviews them before any write", async () => {
    const fetchMock = respondWith({
      proposals: [{ intent: { query: "chicken", amount: 200, unit: "g" } }],
    });

    describeMeal();
    await submit("200 g chicken");

    await waitFor(() => expect(screen.getByTestId("review")).toBeInTheDocument());

    // The route reads; it does not write. The review is what writes, and
    // only after the user confirms.
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ai/parse",
      expect.objectContaining({ method: "POST" }),
    );
    expect(proposals).toHaveBeenCalledWith([
      { intent: { query: "chicken", amount: 200, unit: "g" } },
    ]);
  });

  it("does nothing on an empty sentence", async () => {
    const fetchMock = respondWith({ proposals: [] });
    describeMeal();

    fireEvent.click(screen.getByRole("button", { name: /read this/i }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the assistant's own message when it refuses", async () => {
    // A spent quota, an unset key or an outage all arrive here. Each names
    // what still works; this must show that rather than a generic line.
    respondWith(
      {
        error:
          "The assistant has used its free allowance for today. It comes back tomorrow.",
        reason: "rate-limited",
      },
      false,
      429,
    );

    describeMeal();
    await submit("200 g chicken");

    expect(await screen.findByRole("alert")).toHaveTextContent(/tomorrow/);
    expect(screen.queryByTestId("review")).not.toBeInTheDocument();
  });

  it("says so when the sentence held no food", async () => {
    respondWith({ proposals: [] });

    describeMeal();
    await submit("hello");

    expect(await screen.findByText(/no food found/i)).toBeInTheDocument();
  });

  it("notes a degraded search rather than presenting it as complete", async () => {
    respondWith({
      proposals: [{ intent: { query: "chicken", amount: 200, unit: "g" } }],
      degraded: true,
    });

    describeMeal();
    await submit("200 g chicken");

    expect(
      await screen.findByText(/did not respond/i),
    ).toBeInTheDocument();
  });
});
