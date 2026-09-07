import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const useLinkStatus = vi.fn();
vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useLinkStatus: () => useLinkStatus(),
}));

const { LinkPending } = await import("@/components/pending-nav");

describe("LinkPending", () => {
  it("shows what it was given while the link is idle", () => {
    useLinkStatus.mockReturnValue({ pending: false });
    render(<LinkPending>Dashboard</LinkPending>);

    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(document.querySelector("svg.animate-spin")).toBeNull();
  });

  it("replaces it with motion while the route is loading", () => {
    useLinkStatus.mockReturnValue({ pending: true });
    render(<LinkPending>Dashboard</LinkPending>);

    // Replaced rather than added, so nothing on the row moves sideways when
    // the spinner appears.
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
    expect(document.querySelector("svg.animate-spin")).not.toBeNull();
  });

  it("sizes the spinner to what it stands in for", () => {
    useLinkStatus.mockReturnValue({ pending: true });
    render(<LinkPending spinnerClassName="size-5">x</LinkPending>);

    expect(document.querySelector("svg")).toHaveClass("size-5");
  });
});
