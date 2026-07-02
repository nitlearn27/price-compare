import { Sparkles, RefreshCw, ExternalLink } from "lucide-react";
import type { RecommendationItem } from "../../lib/types";
import type { RecommendationsState } from "../../hooks/useRecommendations";
import { STRINGS } from "../../lib/strings";
import { getSourceTheme } from "../../lib/source-theme";
import { recommendationHint } from "../../lib/recommendation-hint";
import { AddToCartButton } from "../cart/AddToCartButton";

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

/** First-open view: the user's recommended products, each with a 1-2 word "why" hint. */
export function RecommendedPicks({ state }: { state: RecommendationsState }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-3 flex-shrink-0">
        <Sparkles size={16} className="text-amber-300" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-white tracking-tight">{STRINGS.picksHeading}</h2>
        <button
          type="button"
          onClick={() => state.fetch("", { refresh: true })}
          disabled={state.loading}
          aria-label={STRINGS.picksRefresh}
          title={STRINGS.picksRefresh}
          className="ml-auto w-7 h-7 rounded-lg flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
        >
          <RefreshCw size={14} className={state.loading ? "animate-spin" : ""} aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 min-h-0 space-y-3">
        {state.loading ? (
          Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="glass-panel rounded-2xl p-3">
              <div className="shimmer h-4 rounded w-3/4 mb-2.5" />
              <div className="shimmer h-4 rounded w-1/3" />
            </div>
          ))
        ) : state.error ? (
          <p className="text-sm text-rose-300 mt-6 text-center">{STRINGS.picksError}</p>
        ) : state.recommendations.length === 0 ? (
          <p className="text-sm text-white/50 mt-6 text-center">{STRINGS.picksEmpty}</p>
        ) : (
          state.recommendations.map((item, i) => <PickCard key={i} item={item} />)
        )}
      </div>
    </div>
  );
}

function PickCard({ item }: { item: RecommendationItem }) {
  const hint = recommendationHint(item);
  const source = inferSource(item.product_url);
  const theme = source ? getSourceTheme(source) : null;
  const showRating =
    item.rating &&
    item.rating.toLowerCase() !== STRINGS.recommendationsRatingUnavailable.toLowerCase();

  return (
    <div
      className="glass-panel rounded-2xl p-3 hover:shadow-md transition-shadow flex gap-3"
      style={theme ? { borderLeft: `3px solid ${theme.accent}` } : undefined}
    >
      {/* Product Image */}
      <div className="w-16 h-16 rounded-xl flex-shrink-0 bg-white/95 p-1 ring-1 ring-white/15 flex items-center justify-center overflow-hidden">
        {item.image_url ? (
          <img
            src={item.image_url}
            alt=""
            className="w-full h-full object-contain"
            onError={(e) => {
              const el = e.currentTarget as HTMLImageElement;
              el.style.display = "none";
              const fb = el.nextElementSibling as HTMLElement | null;
              if (fb) fb.style.display = "flex";
            }}
            aria-hidden="true"
          />
        ) : null}
        <div
          className={`${item.image_url ? "hidden" : "flex"} w-full h-full items-center justify-center text-xl`}
          style={
            theme
              ? { background: `${theme.accent}1A`, color: theme.accent }
              : { background: "rgba(255,255,255,0.06)" }
          }
        >
          📦
        </div>
      </div>

      {/* Product Details */}
      <div className="flex-1 min-w-0 flex flex-col justify-between">
        <div>
          <div className="flex items-start justify-between gap-2">
            <p
              className="font-medium text-white text-sm leading-snug line-clamp-2"
              title={item.product_name}
            >
              {item.product_name}
            </p>
            <span
              className={`flex-shrink-0 inline-flex items-center text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ring-1 ${hint.tone}`}
            >
              {hint.label}
            </span>
          </div>

          <div className="flex items-center gap-2.5 mt-1.5 flex-wrap">
            <span className="text-sm font-semibold text-white">{formatINR(item.price)}</span>
            {showRating && <span className="text-xs text-amber-400 font-medium">★ {item.rating}</span>}
            {theme && (
              <span
                className="text-[10px] font-semibold rounded-full px-2 py-0.5"
                style={{ color: theme.accent, background: `${theme.accent}2E` }}
              >
                {theme.label}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 mt-2.5">
          <AddToCartButton
            id={item.product_url ?? item.product_name}
            name={item.product_name}
            source={source}
          />
          {item.product_url && (
            <a
              href={item.product_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-sky-300 hover:text-sky-200 transition-colors"
              aria-label={`View ${item.product_name}`}
            >
              {STRINGS.viewButtonLabel}
              <ExternalLink size={11} aria-hidden="true" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
