import { useEffect, useRef, useState } from "react";
import { Sparkles, X, ExternalLink, Send } from "lucide-react";
import type { RecommendationItem } from "../../lib/types";
import type { RecommendationsState } from "../../hooks/useRecommendations";
import { getSourceTheme, SUPPORTED_SOURCES } from "../../lib/source-theme";
import { STRINGS } from "../../lib/strings";

interface Props {
  open: boolean;
  onClose: () => void;
  state: RecommendationsState;
}

function formatINR(amount: number | null): string {
  if (amount === null) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Infer a store from the product URL host so cards can show a source chip. */
function inferSource(url: string | null): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("amazon")) return "Amazon";
    if (host.includes("flipkart")) return "Flipkart";
    if (host.includes("croma")) return "Croma";
    if (host.includes("reliancedigital")) return "Reliance Digital";
    return null;
  } catch {
    return null;
  }
}

export function RecommendationsDrawer({ open, onClose, state }: Props) {
  const [input, setInput] = useState("");
  const hasFetched = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Auto-fetch with the default input the first time the drawer is opened.
  useEffect(() => {
    if (open && !hasFetched.current) {
      hasFetched.current = true;
      state.fetch("");
    }
  }, [open, state]);

  // Escape closes; move focus into the panel on open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const submit = () => {
    if (state.loading) return;
    state.fetch(input);
  };

  const pickSource = (source: string) => {
    setInput(`give recommendations from only ${source}`);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-30 bg-slate-900/30 backdrop-blur-[2px] transition-opacity duration-300 ${
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
        aria-label={STRINGS.recommendationsTitle}
        className={`fixed top-0 right-0 z-40 h-full w-full sm:w-[420px] glass-strong border-l border-slate-200 shadow-2xl flex flex-col outline-none transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <header className="px-5 py-4 border-b border-slate-200 flex items-center gap-3 flex-shrink-0">
          <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-md shadow-indigo-500/20 flex-shrink-0">
            <Sparkles size={16} className="text-white" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-slate-900 tracking-tight leading-none">
              {STRINGS.recommendationsTitle}
            </h2>
            <p className="text-[11px] text-slate-500 mt-1 leading-none">
              {STRINGS.recommendationsSubtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={STRINGS.recommendationsClose}
            className="ml-auto w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors flex-shrink-0"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        {/* Preference controls */}
        <div className="px-5 py-4 border-b border-slate-200 flex-shrink-0 bg-white/50">
          <label
            htmlFor="rec-pref"
            className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2"
          >
            {STRINGS.recommendationsInputLabel}
          </label>
          <div className="flex gap-2">
            <input
              id="rec-pref"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder={STRINGS.recommendationsInputPlaceholder}
              className="flex-1 min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition"
            />
            <button
              type="button"
              onClick={submit}
              disabled={state.loading}
              aria-label={STRINGS.recommendationsSubmit}
              className="flex-shrink-0 inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium text-white bg-gradient-to-br from-indigo-500 to-violet-600 glow-indigo hover:from-indigo-600 hover:to-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              <Send size={14} aria-hidden="true" />
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {SUPPORTED_SOURCES.map((source) => {
              const theme = getSourceTheme(source);
              return (
                <button
                  key={source}
                  type="button"
                  onClick={() => pickSource(source)}
                  className="text-[11px] font-medium rounded-full px-2.5 py-1 border transition hover:shadow-sm"
                  style={{
                    color: theme.accent,
                    borderColor: `${theme.accent}40`,
                    background: `${theme.accent}0F`,
                  }}
                >
                  {theme.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto scrollbar-thin px-5 py-4">
          {state.loading ? (
            <LoadingState />
          ) : state.error ? (
            <ErrorState detail={state.error} />
          ) : state.recommendations.length === 0 && !state.insight ? (
            <EmptyState />
          ) : (
            <div className="space-y-4 fade-up">
              {state.insight && <InsightBanner message={state.insight} />}
              {state.recommendations.map((item, i) => (
                <RecommendationCard key={i} item={item} />
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function InsightBanner({ message }: { message: string }) {
  return (
    <div className="relative rounded-2xl p-4 bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-100">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Sparkles size={13} className="text-indigo-500" aria-hidden="true" />
        <span className="text-[10px] font-semibold text-indigo-600 uppercase tracking-wider">
          {STRINGS.recommendationsInsightLabel}
        </span>
      </div>
      <p className="text-sm text-slate-700 leading-relaxed">{message}</p>
    </div>
  );
}

function RecommendationCard({ item }: { item: RecommendationItem }) {
  const source = inferSource(item.product_url);
  const theme = source ? getSourceTheme(source) : null;
  const showRating =
    item.rating && item.rating.toLowerCase() !== STRINGS.recommendationsRatingUnavailable.toLowerCase();

  return (
    <div
      className="glass-panel rounded-2xl p-4 hover:shadow-md transition-shadow"
      style={theme ? { borderLeft: `3px solid ${theme.accent}` } : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <p
          className="font-medium text-slate-900 text-sm leading-snug line-clamp-2"
          title={item.product_name}
        >
          {item.product_name}
        </p>
        {theme && (
          <span
            className="flex-shrink-0 text-[10px] font-semibold rounded-full px-2 py-0.5"
            style={{ color: theme.accent, background: `${theme.accent}14` }}
          >
            {theme.label}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 mt-2">
        <span className="text-base font-semibold text-slate-900">{formatINR(item.price)}</span>
        {showRating && (
          <span className="text-xs text-amber-600 font-medium">★ {item.rating}</span>
        )}
      </div>

      {item.reasoning && (
        <p className="text-xs text-slate-500 leading-relaxed mt-2">{item.reasoning}</p>
      )}

      {item.product_url && (
        <a
          href={item.product_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 mt-3 transition-colors"
          aria-label={`View ${item.product_name}`}
        >
          {STRINGS.viewButtonLabel}
          <ExternalLink size={11} aria-hidden="true" />
        </a>
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4" aria-label={STRINGS.recommendationsLoading} role="status">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="glass-panel rounded-2xl p-4">
          <div className="shimmer h-4 rounded w-3/4 mb-3" />
          <div className="shimmer h-4 rounded w-1/4 mb-3" />
          <div className="shimmer h-3 rounded w-full mb-1.5" />
          <div className="shimmer h-3 rounded w-5/6" />
        </div>
      ))}
    </div>
  );
}

function ErrorState({ detail }: { detail: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center fade-up">
      <div className="w-16 h-16 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center mb-4 shadow-sm">
        <span className="text-3xl" role="img" aria-label="error">
          ⚠️
        </span>
      </div>
      <p className="text-red-700 font-medium text-sm">{STRINGS.recommendationsErrorHeading}</p>
      <p className="text-slate-500 text-xs mt-1.5">{detail}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center fade-up">
      <div className="w-16 h-16 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center mb-4 shadow-sm">
        <Sparkles size={26} className="text-slate-300" aria-hidden="true" />
      </div>
      <p className="text-slate-800 font-medium text-sm">{STRINGS.recommendationsEmptyHeading}</p>
      <p className="text-slate-500 text-xs mt-1.5">{STRINGS.recommendationsEmptySubtext}</p>
    </div>
  );
}
