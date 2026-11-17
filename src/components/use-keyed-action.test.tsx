import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CONNECTION_LOST, useKeyedAction } from "@/components/use-keyed-action";

type State = { error?: string; ok?: boolean };

function Form({ action }: { action: (previous: State, form: FormData) => Promise<State> }) {
  const [state, formAction, , key] = useKeyedAction<State>(action, {});
  return (
    <form action={formAction}>
      <input type="hidden" name="clientToken" value={key} data-testid="key" />
      <p>{state.error ?? (state.ok ? "done" : "")}</p>
      <button type="submit">Add</button>
    </form>
  );
}

const keyNow = () => (screen.getByTestId("key") as HTMLInputElement).value;

describe("useKeyedAction — one key per open form, kept until answered", () => {
  it("sends the same key again after a dropped connection, and keeps the form", async () => {
    const sent: string[] = [];
    const action = vi
      .fn()
      .mockImplementationOnce(async (_p: State, form: FormData) => {
        sent.push(String(form.get("clientToken")));
        throw new TypeError("Failed to fetch");
      })
      .mockImplementationOnce(async (_p: State, form: FormData) => {
        sent.push(String(form.get("clientToken")));
        return { ok: true };
      });
    render(<Form action={action} />);
    const first = keyNow();

    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByText(CONNECTION_LOST)).toBeInTheDocument();
    expect(keyNow()).toBe(first);

    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByText("done")).toBeInTheDocument();
    expect(sent).toEqual([first, first]);
  });

  it("renews the key once the server has answered, so the next entry is a new one", async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    render(<Form action={action} />);
    const first = keyNow();
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(keyNow()).not.toBe(first));
    expect(keyNow()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("renews the key after a refusal too, because nothing was written", async () => {
    const action = vi.fn().mockResolvedValue({ error: "Choose a meal." });
    render(<Form action={action} />);
    const first = keyNow();
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByText("Choose a meal.")).toBeInTheDocument();
    expect(keyNow()).not.toBe(first);
  });
});
