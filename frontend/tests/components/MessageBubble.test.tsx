import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { MessageBubble, TypingIndicator } from "../../src/components/chat/MessageBubble";
import type { UIMessage } from "../../src/lib/types";

function msg(role: UIMessage["role"], content: string): UIMessage {
  return { id: "1", role, content };
}

describe("MessageBubble", () => {
  it("renders user message content", () => {
    render(<MessageBubble message={msg("user", "Hello there")} />);
    expect(screen.getByText("Hello there")).toBeInTheDocument();
  });

  it("renders assistant message content", () => {
    render(<MessageBubble message={msg("assistant", "Hi! How can I help?")} />);
    expect(screen.getByText("Hi! How can I help?")).toBeInTheDocument();
  });

  it("user message has correct aria-label", () => {
    render(<MessageBubble message={msg("user", "test")} />);
    expect(screen.getByLabelText(/your message/i)).toBeInTheDocument();
  });

  it("assistant message has correct aria-label", () => {
    render(<MessageBubble message={msg("assistant", "test")} />);
    expect(screen.getByLabelText(/pricebot message/i)).toBeInTheDocument();
  });

  it("renders assistant markdown tables as real tables (GFM)", () => {
    const table = "| Product | Price |\n|---|---|\n| Milk | ₹24 |";
    render(<MessageBubble message={msg("assistant", table)} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Product" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "₹24" })).toBeInTheDocument();
  });
});

describe("TypingIndicator", () => {
  it("renders with accessible role=status", () => {
    render(<TypingIndicator />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders three dot elements", () => {
    const { container } = render(<TypingIndicator />);
    const dots = container.querySelectorAll(".typing-dot");
    expect(dots.length).toBe(3);
  });
});
