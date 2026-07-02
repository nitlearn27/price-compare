import { useEffect, useRef } from "react";
import { ShoppingCart, X, Trash2, Check, Loader2 } from "lucide-react";
import { useCart } from "../../hooks/useCart";
import { getSourceTheme } from "../../lib/source-theme";
import { STRINGS } from "../../lib/strings";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CartDrawer({ open, onClose }: Props) {
  const { items, count, remove, checkout, submitting, error, success, resetStatus } = useCart();
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes; move focus into the panel on open. Clear transient
  // success/error status whenever the drawer is opened.
  useEffect(() => {
    if (!open) return;
    resetStatus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, resetStatus]);

  // After a successful submit the cart is already cleared; briefly show the
  // confirmation, then close the drawer so the user lands back on the results.
  useEffect(() => {
    if (!open || !success) return;
    const t = setTimeout(onClose, 2500);
    return () => clearTimeout(t);
  }, [open, success, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-30 bg-black/50 backdrop-blur-[2px] transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over panel */}
      <aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={STRINGS.cartTitle}
        className={`fixed top-0 right-0 z-40 h-full w-full sm:w-[420px] glass-strong border-l border-white/10 shadow-2xl flex flex-col outline-none transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <header className="px-5 py-4 border-b border-white/10 flex items-center gap-3 flex-shrink-0">
          <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-md shadow-blue-500/20 flex-shrink-0">
            <ShoppingCart size={16} className="text-white" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-white tracking-tight leading-none">
              {STRINGS.cartTitle}
            </h2>
            <p className="text-[11px] text-white/60 mt-1 leading-none">
              {count} {count === 1 ? "item" : "items"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={STRINGS.cartClose}
            className="ml-auto w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-auto scrollbar-thin px-5 py-4">
          {items.length === 0 ? (
            <EmptyState />
          ) : (
            <ul className="space-y-2.5 fade-up">
              {items.map((item) => {
                const theme = item.source ? getSourceTheme(item.source) : null;
                return (
                  <li
                    key={item.id}
                    className="glass-panel rounded-xl p-3 flex items-center gap-3"
                    style={theme ? { borderLeft: `3px solid ${theme.accent}` } : undefined}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-white truncate" title={item.name}>
                        {item.name}
                      </p>
                      {theme && (
                        <span
                          className="inline-block mt-1 text-[10px] font-semibold rounded-full px-2 py-0.5"
                          style={{ color: theme.accent, background: `${theme.accent}2E` }}
                        >
                          {theme.label}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(item.id)}
                      aria-label={`${STRINGS.removeFromCart}: ${item.name}`}
                      className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:text-rose-300 hover:bg-rose-500/15 transition-colors"
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-white/10 flex-shrink-0 bg-white/[0.04] space-y-2.5">
          {success && (
            <p
              role="status"
              className="flex items-center gap-1.5 text-xs font-medium text-emerald-300 bg-emerald-400/15 ring-1 ring-emerald-400/30 rounded-lg px-3 py-2"
            >
              <Check size={14} aria-hidden="true" />
              {success}
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="text-xs font-medium text-rose-300 bg-rose-500/15 ring-1 ring-rose-400/30 rounded-lg px-3 py-2"
            >
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={checkout}
            disabled={submitting || items.length === 0}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white bg-gradient-to-br from-blue-500 to-indigo-600 glow-indigo hover:from-blue-400 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {submitting ? (
              <>
                <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                {STRINGS.cartSubmitting}
              </>
            ) : (
              <>
                <ShoppingCart size={15} aria-hidden="true" />
                {STRINGS.cartSubmit}
              </>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center fade-up">
      <div className="w-16 h-16 rounded-2xl bg-white/[0.06] border border-white/10 flex items-center justify-center mb-4 shadow-sm">
        <ShoppingCart size={26} className="text-white/30" aria-hidden="true" />
      </div>
      <p className="text-white font-medium text-sm">{STRINGS.cartEmptyHeading}</p>
      <p className="text-white/60 text-xs mt-1.5">{STRINGS.cartEmptySubtext}</p>
    </div>
  );
}
