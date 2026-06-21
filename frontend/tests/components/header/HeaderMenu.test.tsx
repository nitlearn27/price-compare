import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { HeaderMenu } from "../../../src/components/header/HeaderMenu";
import type { UseInstallPrompt } from "../../../src/hooks/useInstallPrompt";

function makeInstall(overrides: Partial<UseInstallPrompt> = {}): UseInstallPrompt {
  return {
    canInstall: false,
    installed: false,
    promptInstall: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

describe("HeaderMenu", () => {
  it("renders a closed kebab trigger", () => {
    render(<HeaderMenu install={makeInstall()} />);
    const trigger = screen.getByRole("button", { name: /more options/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens the menu on click", () => {
    render(<HeaderMenu install={makeInstall({ canInstall: true })} />);
    fireEvent.click(screen.getByRole("button", { name: /more options/i }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("shows the Install item and calls promptInstall when installable", async () => {
    const promptInstall = vi.fn().mockResolvedValue(true);
    render(<HeaderMenu install={makeInstall({ canInstall: true, promptInstall })} />);

    fireEvent.click(screen.getByRole("button", { name: /more options/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /install app/i }));

    expect(promptInstall).toHaveBeenCalledOnce();
    // Menu closes after triggering install.
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("shows the installed state when already installed", () => {
    render(<HeaderMenu install={makeInstall({ installed: true })} />);
    fireEvent.click(screen.getByRole("button", { name: /more options/i }));
    expect(screen.getByText(/app installed/i)).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /install app/i })).not.toBeInTheDocument();
  });

  it("shows a hint when install is not available", () => {
    render(<HeaderMenu install={makeInstall()} />);
    fireEvent.click(screen.getByRole("button", { name: /more options/i }));
    expect(screen.getByText(/add to home screen/i)).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    render(<HeaderMenu install={makeInstall({ canInstall: true })} />);
    fireEvent.click(screen.getByRole("button", { name: /more options/i }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
