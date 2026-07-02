import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ChatWindow } from "../../src/components/chat/ChatWindow";
import type { UIMessage } from "../../src/lib/types";
import type { RecommendationsState } from "../../src/hooks/useRecommendations";

window.HTMLElement.prototype.scrollIntoView = vi.fn();

const recs = {
  data: null,
  loading: false,
  error: null,
  fetch: vi.fn(),
} as unknown as RecommendationsState;

const messages: UIMessage[] = [
  { id: "1", role: "user", content: "milk" },
  { id: "2", role: "assistant", content: "Here are your options." },
];

function renderWindow(props: Partial<Parameters<typeof ChatWindow>[0]> = {}) {
  return render(
    <ChatWindow
      messages={messages}
      inputValue=""
      onInputChange={() => {}}
      onSubmit={() => {}}
      isLoading={false}
      recommendations={recs}
      {...props}
    />,
  );
}

describe("ChatWindow view-results chip", () => {
  it("shows the chip with the result count and fires onViewResults", () => {
    const onViewResults = vi.fn();
    renderWindow({ resultCount: 6, onViewResults });

    const chip = screen.getByRole("button", { name: /view full comparison \(6\)/i });
    fireEvent.click(chip);
    expect(onViewResults).toHaveBeenCalledOnce();
  });

  it("hides the chip while loading", () => {
    renderWindow({ resultCount: 6, onViewResults: vi.fn(), isLoading: true });
    expect(screen.queryByRole("button", { name: /view full comparison/i })).toBeNull();
  });

  it("hides the chip when there are no results", () => {
    renderWindow({ resultCount: 0, onViewResults: vi.fn() });
    expect(screen.queryByRole("button", { name: /view full comparison/i })).toBeNull();
  });
});
