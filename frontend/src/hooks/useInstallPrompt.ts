import { useCallback, useEffect, useState } from "react";

/**
 * The `beforeinstallprompt` event isn't in the standard DOM lib, so we model the
 * bits we use. Chrome/Android fire this when the app meets installability criteria.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface UseInstallPrompt {
  /** True once the browser has offered an install prompt we can replay. */
  canInstall: boolean;
  /** True if the app is already installed / running standalone. */
  installed: boolean;
  /** Show the native install dialog. Resolves to true if the user accepted. */
  promptInstall: () => Promise<boolean>;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari exposes standalone on navigator instead of matchMedia.
    (navigator as { standalone?: boolean }).standalone === true
  );
}

export function useInstallPrompt(): UseInstallPrompt {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState<boolean>(isStandalone);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      // Stop Chrome's default mini-infobar so we can trigger install from our menu.
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<boolean> => {
    if (!deferred) return false;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    // The event can only be used once; drop it regardless of outcome.
    setDeferred(null);
    if (outcome === "accepted") {
      setInstalled(true);
      return true;
    }
    return false;
  }, [deferred]);

  return { canInstall: deferred !== null, installed, promptInstall };
}
