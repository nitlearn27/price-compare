import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useInstallPrompt } from "../../src/hooks/useInstallPrompt";

/** Build a fake beforeinstallprompt event with controllable user choice. */
function makeInstallEvent(outcome: "accepted" | "dismissed") {
  const event = new Event("beforeinstallprompt") as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
  };
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome });
  return event;
}

beforeEach(() => {
  vi.restoreAllMocks();
  // jsdom has no matchMedia by default.
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
});

describe("useInstallPrompt", () => {
  it("starts not installable and not installed", () => {
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.canInstall).toBe(false);
    expect(result.current.installed).toBe(false);
  });

  it("becomes installable when beforeinstallprompt fires", () => {
    const { result } = renderHook(() => useInstallPrompt());
    act(() => {
      window.dispatchEvent(makeInstallEvent("accepted"));
    });
    expect(result.current.canInstall).toBe(true);
  });

  it("promptInstall calls the event's prompt and marks installed on accept", async () => {
    const { result } = renderHook(() => useInstallPrompt());
    const event = makeInstallEvent("accepted");
    act(() => {
      window.dispatchEvent(event);
    });

    let accepted: boolean | undefined;
    await act(async () => {
      accepted = await result.current.promptInstall();
    });

    expect(event.prompt).toHaveBeenCalledOnce();
    expect(accepted).toBe(true);
    expect(result.current.installed).toBe(true);
    expect(result.current.canInstall).toBe(false);
  });

  it("promptInstall returns false when the user dismisses", async () => {
    const { result } = renderHook(() => useInstallPrompt());
    act(() => {
      window.dispatchEvent(makeInstallEvent("dismissed"));
    });

    let accepted: boolean | undefined;
    await act(async () => {
      accepted = await result.current.promptInstall();
    });

    expect(accepted).toBe(false);
    expect(result.current.installed).toBe(false);
  });

  it("promptInstall is a no-op when nothing is deferred", async () => {
    const { result } = renderHook(() => useInstallPrompt());
    let accepted: boolean | undefined;
    await act(async () => {
      accepted = await result.current.promptInstall();
    });
    expect(accepted).toBe(false);
  });

  it("the appinstalled event marks the app installed", () => {
    const { result } = renderHook(() => useInstallPrompt());
    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(result.current.installed).toBe(true);
  });
});
