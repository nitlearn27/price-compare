import { useEffect, useRef, useState } from "react";
import { MoreVertical, Download, Check } from "lucide-react";
import type { UseInstallPrompt } from "../../hooks/useInstallPrompt";
import { STRINGS } from "../../lib/strings";

interface Props {
  install: UseInstallPrompt;
}

export function HeaderMenu({ install }: Props) {
  const { canInstall, installed, promptInstall } = install;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape while the menu is open.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleInstall = async () => {
    await promptInstall();
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={STRINGS.menuLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-white/10 bg-white/10 text-white/85 hover:bg-white/15 transition"
      >
        <MoreVertical size={16} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={STRINGS.menuLabel}
          className="absolute right-0 mt-2 w-64 glass-strong border border-white/10 rounded-xl shadow-2xl p-1.5 z-50 fade-up"
        >
          {installed ? (
            <div
              role="menuitem"
              aria-disabled="true"
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-emerald-300"
            >
              <Check size={15} aria-hidden="true" />
              {STRINGS.installInstalled}
            </div>
          ) : canInstall ? (
            <button
              type="button"
              role="menuitem"
              onClick={handleInstall}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-white hover:bg-white/10 transition text-left"
            >
              <Download size={15} aria-hidden="true" />
              {STRINGS.installApp}
            </button>
          ) : (
            <div className="px-3 py-2 text-xs text-white/60 leading-relaxed">
              {STRINGS.installHint}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
