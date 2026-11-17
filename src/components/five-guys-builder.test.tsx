import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const action = vi.fn();
vi.mock("@/app/(app)/diary/restaurant-actions", () => ({
  logRestaurantPartsAction: (prev: unknown, form: FormData) => action(prev, form),
}));

const { FiveGuysBuilder, wantsFiveGuysBuilder } = await import("@/components/five-guys-builder");

const meals = [{ id: 3, slug: "dinner", name: "Dinner", sort_order: 3 }];

beforeEach(() => {
  vi.clearAllMocks();
  action.mockResolvedValue({ ok: true, notice: "Logged 3 parts from Five Guys." });
});

describe("FiveGuysBuilder (§13M)", () => {
  it("opens for a Five Guys burger, not for anything else", () => {
    expect(wantsFiveGuysBuilder("five guys cheeseburger")).toBe(true);
    expect(wantsFiveGuysBuilder("5 guys bacon burger")).toBe(true);
    expect(wantsFiveGuysBuilder("five guys fries")).toBe(false);
    expect(wantsFiveGuysBuilder("cheeseburger")).toBe(false);
  });

  it("assumes no patty count, totals the published parts, and sends slugs and counts only", async () => {
    const { container } = render(<FiveGuysBuilder logDate="2026-10-08" mealTypes={meals} />);
    const total = () => container.querySelector('[aria-live="polite"]')?.textContent ?? "";
    expect(total()).toMatch(/^0 kcal/);
    expect(screen.getByRole("button", { name: "Log 0 parts" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "One more Bun" }));
    fireEvent.click(screen.getByRole("button", { name: "One more Hamburger patty" }));
    fireEvent.click(screen.getByRole("button", { name: "One more Hamburger patty" }));
    fireEvent.click(screen.getByRole("button", { name: "One more Cheese (1 slice)" }));

    // 240 + 2 × 302 + 70, all from Five Guys' sheet.
    expect(total()).toMatch(/^914 kcal/);
    fireEvent.click(screen.getByRole("button", { name: "Log 3 parts" }));

    await waitFor(() => expect(action).toHaveBeenCalledOnce(), { timeout: 5000 });
    const form: FormData = action.mock.calls[0][1];
    expect(form.get("part:bun")).toBe("1");
    expect(form.get("part:patty")).toBe("2");
    expect(form.get("part:cheese")).toBe("1");
    expect([...form.keys()].some((k) => /kcal|protein/.test(k))).toBe(false);
    await screen.findByText(/Logged 3 parts/, {}, { timeout: 5000 });
  });
});
