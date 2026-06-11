import { ExternalLink } from "lucide-react";
import type { ProductListing } from "../../lib/types";
import { getSourceTheme } from "../../lib/source-theme";
import { STRINGS } from "../../lib/strings";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { SourceBadge } from "./SourceBadge";
import { RatingStars } from "./RatingStars";
import { PriceTrend } from "./PriceTrend";
import { SuggestionBadge } from "./SuggestionBadge";
import { AddToCartButton } from "../cart/AddToCartButton";

interface Props {
  results: ProductListing[];
  loading: boolean;
  error: string | null;
}

const COLUMN_COUNT = 11;

function formatINR(amount: number | null): string {
  if (amount === null) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

function groupBySource(listings: ProductListing[]): Map<string, ProductListing[]> {
  const map = new Map<string, ProductListing[]>();
  for (const item of listings) {
    const existing = map.get(item.source) ?? [];
    existing.push(item);
    map.set(item.source, existing);
  }
  return map;
}

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: COLUMN_COUNT }, (_, i) => (
        <td key={i} className="px-4 py-2.5">
          <div className="shimmer h-4 rounded w-full" />
        </td>
      ))}
    </tr>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.07] backdrop-blur-sm p-3.5">
      <div className="flex gap-3">
        <div className="shimmer w-12 h-12 rounded-lg flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="shimmer h-4 rounded w-3/4" />
          <div className="shimmer h-3 rounded w-1/3" />
        </div>
      </div>
      <div className="shimmer h-5 rounded w-1/4 mt-3" />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center fade-up">
      <div className="w-20 h-20 rounded-3xl bg-white/[0.06] border border-white/10 flex items-center justify-center mb-4 shadow-sm">
        <span className="text-4xl" role="img" aria-label="search">🔍</span>
      </div>
      <p className="text-white font-medium text-base">{STRINGS.tableEmptyHeading}</p>
      <p className="text-white/60 text-sm mt-1.5">{STRINGS.tableEmptySubtext}</p>
    </div>
  );
}

function ErrorState({ detail }: { detail: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center fade-up">
      <div className="w-20 h-20 rounded-3xl bg-rose-500/15 border border-rose-400/20 flex items-center justify-center mb-4 shadow-sm">
        <span className="text-4xl" role="img" aria-label="error">⚠️</span>
      </div>
      <p className="text-rose-300 font-medium text-base">{STRINGS.tableErrorHeading}</p>
      <p className="text-white/60 text-sm mt-1.5">{detail}</p>
    </div>
  );
}

export function ComparisonTable({ results, loading, error }: Props) {
  const isMobile = useMediaQuery("(max-width: 767px)");
  const groups = groupBySource(results);

  let body: React.ReactNode;
  if (loading) {
    body = isMobile ? (
      <div className="p-3 space-y-3" aria-label="Loading product results" role="status">
        {Array.from({ length: 4 }, (_, i) => <SkeletonCard key={i} />)}
      </div>
    ) : (
      <table className="w-full border-collapse text-sm" aria-label="Loading product results">
        <TableHeader />
        <tbody>{Array.from({ length: 5 }, (_, i) => <SkeletonRow key={i} />)}</tbody>
      </table>
    );
  } else if (error) {
    body = <ErrorState detail={error} />;
  } else if (results.length === 0) {
    body = <EmptyState />;
  } else if (isMobile) {
    body = (
      <div className="p-3 space-y-5">
        {Array.from(groups.entries()).map(([source, items]) => (
          <MobileSourceGroup key={source} source={source} items={items} />
        ))}
      </div>
    );
  } else {
    body = (
      <table className="w-full border-collapse text-sm" aria-label="Product comparison results">
        <TableHeader />
        <tbody>
          {Array.from(groups.entries()).map(([source, items]) => (
            <SourceGroup key={source} source={source} items={items} />
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-transparent">
      <div className="flex-1 overflow-auto scrollbar-thin">{body}</div>
    </div>
  );
}

function TableHeader() {
  const columns: { label: string; align: "left" | "right" | "center" }[] = [
    { label: STRINGS.columnName, align: "left" },
    { label: STRINGS.columnSource, align: "left" },
    { label: STRINGS.columnCurrentPrice, align: "right" },
    { label: STRINGS.columnLastPaid, align: "right" },
    { label: STRINGS.columnTrend, align: "right" },
    { label: STRINGS.columnRating, align: "right" },
    { label: STRINGS.columnAvailability, align: "left" },
    { label: STRINGS.columnLastOrdered, align: "left" },
    { label: STRINGS.columnSuggestion, align: "center" },
    { label: STRINGS.columnLink, align: "left" },
    { label: STRINGS.cartButton, align: "left" },
  ];
  return (
    <thead
      className="sticky top-0 z-10"
      style={{
        background: "rgba(10, 24, 70, 0.90)",
        backdropFilter: "blur(12px) saturate(120%)",
        WebkitBackdropFilter: "blur(12px) saturate(120%)",
      }}
    >
      <tr className="border-b border-white/10">
        {columns.map(({ label, align }, i) => (
          <th
            key={i}
            className={`px-4 py-3 text-[10px] font-semibold text-white/50 uppercase tracking-wider whitespace-nowrap text-${align}`}
          >
            {label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

interface SourceGroupProps {
  source: string;
  items: ProductListing[];
}

function SourceGroup({ source, items }: SourceGroupProps) {
  const theme = getSourceTheme(source);
  return (
    <>
      <tr>
        <td
          colSpan={COLUMN_COUNT}
          className="px-4 py-2 border-y border-white/10"
          style={{ background: `${theme.accent}26` }}
        >
          <div className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: theme.accent, boxShadow: `0 0 6px ${theme.accent}55` }}
              aria-hidden="true"
            />
            <span className="text-xs font-semibold" style={{ color: theme.accent }}>
              {theme.label}
            </span>
            <span className="text-xs text-white/60">
              — {items.length} {items.length === 1 ? "result" : "results"}
            </span>
          </div>
        </td>
      </tr>
      {items.map((item, idx) => (
        <ProductRow key={item.id} item={item} isTopMatch={idx === 0} accent={theme.accent} />
      ))}
    </>
  );
}

interface ProductRowProps {
  item: ProductListing;
  isTopMatch: boolean;
  accent: string;
}

function ProductRow({ item, isTopMatch, accent }: ProductRowProps) {
  return (
    <tr
      className="group border-b border-white/[0.08] hover:bg-white/5 transition-colors duration-150"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      {/* Product name + image */}
      <td className="px-4 py-2.5 max-w-[240px]">
        <div className="flex items-start gap-3">
          <ProductImage url={item.image_url} accent={accent} />
          <div className="min-w-0">
            <p
              className="font-medium text-white line-clamp-2 text-xs leading-snug"
              title={item.title}
            >
              {item.title}
            </p>
            {isTopMatch && (
              <span className="inline-flex items-center mt-1 text-[10px] font-medium uppercase tracking-wide text-emerald-300 bg-emerald-400/15 ring-1 ring-emerald-400/30 rounded-full px-2 py-0.5">
                {STRINGS.topMatchBadge}
              </span>
            )}
          </div>
        </div>
      </td>

      {/* Source */}
      <td className="px-4 py-2.5 whitespace-nowrap">
        <SourceBadge source={item.source} />
      </td>

      {/* Current price */}
      <td className="px-4 py-2.5 text-right font-semibold text-white whitespace-nowrap text-xs">
        {formatINR(item.current_price)}
      </td>

      {/* Last purchased price */}
      <td className="px-4 py-2.5 text-right text-white/70 whitespace-nowrap text-xs">
        {formatINR(item.last_purchased_price)}
      </td>

      {/* Price trend vs last paid */}
      <td className="px-4 py-2.5 text-right">
        <div className="flex justify-end">
          <PriceTrend current={item.current_price} lastPaid={item.last_purchased_price} />
        </div>
      </td>

      {/* Rating */}
      <td className="px-4 py-2.5 text-right">
        <div className="flex justify-end">
          <RatingStars rating={item.rating} />
        </div>
      </td>

      {/* Availability */}
      <td className="px-4 py-2.5 text-xs whitespace-nowrap">
        {item.availability ? (
          <span className="text-white/80">{item.availability}</span>
        ) : (
          <span className="text-white/25">—</span>
        )}
      </td>

      {/* Last ordered date */}
      <td className="px-4 py-2.5 text-xs text-white/70 whitespace-nowrap">
        {formatDate(item.last_ordered_date)}
      </td>

      {/* Buy? suggestion */}
      <td className="px-4 py-2.5 text-center whitespace-nowrap">
        {item.buy_suggestion ? (
          <SuggestionBadge label={item.buy_suggestion} reason={item.suggestion_reason} />
        ) : (
          <span className="text-white/25 text-xs">—</span>
        )}
      </td>

      {/* View link */}
      <td className="px-4 py-2.5">
        {item.product_url ? (
          <a
            href={item.product_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-sky-300 hover:text-sky-200 whitespace-nowrap transition-colors"
            aria-label={`View ${item.title} on ${item.source}`}
          >
            {STRINGS.viewButtonLabel}
            <ExternalLink size={11} aria-hidden="true" />
          </a>
        ) : (
          <span className="text-white/25 text-xs">—</span>
        )}
      </td>

      {/* Add to cart */}
      <td className="px-4 py-2.5 whitespace-nowrap">
        <AddToCartButton name={item.title} source={item.source} />
      </td>
    </tr>
  );
}

/* ── Mobile card layout (rendered below the `md` breakpoint) ─────────────── */

function MobileSourceGroup({ source, items }: SourceGroupProps) {
  const theme = getSourceTheme(source);
  return (
    <section>
      <div className="flex items-center gap-2 px-1 mb-2">
        <span
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: theme.accent, boxShadow: `0 0 6px ${theme.accent}55` }}
          aria-hidden="true"
        />
        <span className="text-xs font-semibold" style={{ color: theme.accent }}>
          {theme.label}
        </span>
        <span className="text-xs text-white/60">
          — {items.length} {items.length === 1 ? "result" : "results"}
        </span>
      </div>
      <div className="space-y-3">
        {items.map((item, idx) => (
          <MobileCard key={item.id} item={item} isTopMatch={idx === 0} accent={theme.accent} />
        ))}
      </div>
    </section>
  );
}

function MobileCard({ item, isTopMatch, accent }: ProductRowProps) {
  return (
    <article
      className="rounded-3xl border border-white/10 bg-white/[0.07] backdrop-blur-sm p-3.5 shadow-sm"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      {/* Header: image + title + source */}
      <div className="flex gap-3">
        <ProductImage url={item.image_url} accent={accent} />
        <div className="min-w-0 flex-1">
          <p
            className="font-medium text-white text-sm leading-snug line-clamp-2"
            title={item.title}
          >
            {item.title}
          </p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <SourceBadge source={item.source} />
            {isTopMatch && (
              <span className="inline-flex items-center text-[10px] font-medium uppercase tracking-wide text-emerald-300 bg-emerald-400/15 ring-1 ring-emerald-400/30 rounded-full px-2 py-0.5">
                {STRINGS.topMatchBadge}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Price + rating + View */}
      <div className="flex items-end justify-between gap-3 mt-3">
        <div className="min-w-0">
          <div className="text-lg font-bold text-white leading-none">
            {formatINR(item.current_price)}
          </div>
          {item.last_purchased_price !== null && (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-white/60 whitespace-nowrap">
                {STRINGS.columnLastPaid}: {formatINR(item.last_purchased_price)}
              </span>
              <PriceTrend current={item.current_price} lastPaid={item.last_purchased_price} />
            </div>
          )}
          <div className="mt-1.5">
            <RatingStars rating={item.rating} />
          </div>
        </div>
        <div className="flex-shrink-0 flex items-center gap-2">
          <AddToCartButton name={item.title} source={item.source} size="md" />
          {item.product_url && (
            <a
              href={item.product_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-sky-300 hover:text-sky-200 rounded-lg border border-sky-400/30 bg-sky-400/15 px-3 py-1.5 transition-colors"
              aria-label={`View ${item.title} on ${item.source}`}
            >
              {STRINGS.viewButtonLabel}
              <ExternalLink size={12} aria-hidden="true" />
            </a>
          )}
        </div>
      </div>

      {/* Meta: availability · last ordered · buy suggestion */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 mt-3 pt-3 border-t border-white/[0.08]">
        <Meta label={STRINGS.columnAvailability} value={item.availability ?? "—"} />
        <Meta label={STRINGS.columnLastOrdered} value={formatDate(item.last_ordered_date)} />
        {item.buy_suggestion && (
          <div className="col-span-2 flex items-center gap-2">
            <span className="text-[10px] font-semibold text-white/40 uppercase tracking-wider">
              {STRINGS.columnSuggestion}
            </span>
            <SuggestionBadge label={item.buy_suggestion} reason={item.suggestion_reason} />
          </div>
        )}
      </div>
    </article>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold text-white/40 uppercase tracking-wider">
        {label}
      </div>
      <div className="text-xs text-white/80 truncate" title={value}>
        {value}
      </div>
    </div>
  );
}

interface ProductImageProps {
  url: string | null;
  accent: string;
}

function ProductImage({ url, accent }: ProductImageProps) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className="w-10 h-10 rounded-lg object-contain flex-shrink-0 bg-white/95 p-0.5 ring-1 ring-white/15 group-hover:ring-white/25 transition"
        onError={(e) => {
          const el = e.currentTarget as HTMLImageElement;
          el.style.display = "none";
          const fallback = el.nextElementSibling as HTMLElement | null;
          if (fallback) fallback.style.display = "flex";
        }}
        aria-hidden="true"
      />
    );
  }
  return (
    <div
      className="w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center"
      style={{
        background: `${accent}26`,
        boxShadow: `inset 0 0 0 1px ${accent}55`,
      }}
      aria-hidden="true"
    >
      <span className="text-base">📦</span>
    </div>
  );
}
