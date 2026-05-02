import { ExternalLink } from "lucide-react";
import type { ProductListing } from "../../lib/types";
import { getSourceTheme } from "../../lib/source-theme";
import { STRINGS } from "../../lib/strings";
import { SourceBadge } from "./SourceBadge";
import { RatingStars } from "./RatingStars";

interface Props {
  results: ProductListing[];
  loading: boolean;
  error: string | null;
}

function formatINR(amount: number | null): string {
  if (amount === null) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatReviews(count: number | null): string {
  if (count === null) return "—";
  if (count >= 100_000) return `${(count / 100_000).toFixed(1)}L`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
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
      {Array.from({ length: 9 }, (_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="shimmer h-4 rounded w-full" />
        </td>
      ))}
    </tr>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
        <span className="text-3xl" role="img" aria-label="search">🔍</span>
      </div>
      <p className="text-gray-700 font-medium">{STRINGS.tableEmptyHeading}</p>
      <p className="text-gray-400 text-sm mt-1">{STRINGS.tableEmptySubtext}</p>
    </div>
  );
}

export function ComparisonTable({ results, loading, error }: Props) {
  const groups = groupBySource(results);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-auto scrollbar-thin">
        {loading ? (
          <table className="w-full border-collapse text-sm" aria-label="Loading product results">
            <TableHeader />
            <tbody>
              {Array.from({ length: 5 }, (_, i) => <SkeletonRow key={i} />)}
            </tbody>
          </table>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-red-600 font-medium">{STRINGS.tableErrorHeading}</p>
            <p className="text-gray-400 text-sm mt-1">{error}</p>
          </div>
        ) : results.length === 0 ? (
          <EmptyState />
        ) : (
          <table className="w-full border-collapse text-sm" aria-label="Product comparison results">
            <TableHeader />
            <tbody>
              {Array.from(groups.entries()).map(([source, items]) => (
                <SourceGroup key={source} source={source} items={items} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function TableHeader() {
  return (
    <thead className="sticky top-0 bg-white border-b border-gray-200 z-10">
      <tr>
        {[
          STRINGS.columnName,
          STRINGS.columnSource,
          STRINGS.columnCurrentPrice,
          STRINGS.columnOriginalPrice,
          STRINGS.columnDiscount,
          STRINGS.columnRating,
          STRINGS.columnReviews,
          STRINGS.columnRank,
          STRINGS.columnLink,
        ].map((col, i) => (
          <th
            key={i}
            className={`px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap ${
              i >= 2 && i <= 7 ? "text-right" : ""
            }`}
          >
            {col}
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
          colSpan={9}
          className="px-4 py-2 bg-gray-50 border-y border-gray-100"
        >
          <div className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: theme.accent }}
              aria-hidden="true"
            />
            <span className="text-xs font-semibold text-gray-600">
              {source} — {items.length} {items.length === 1 ? "result" : "results"}
            </span>
          </div>
        </td>
      </tr>
      {items.map((item, idx) => (
        <ProductRow key={item.id} item={item} isTopMatch={idx === 0} source={source} accent={theme.accent} />
      ))}
    </>
  );
}

interface ProductRowProps {
  item: ProductListing;
  isTopMatch: boolean;
  source: string;
  accent: string;
}

function ProductRow({ item, isTopMatch, accent }: ProductRowProps) {
  return (
    <tr
      className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
      style={{ borderLeft: `4px solid ${accent}` }}
    >
      {/* Product name */}
      <td className="px-4 py-3 max-w-[200px]">
        <div className="flex items-start gap-2">
          <div>
            <p
              className="font-medium text-gray-900 line-clamp-2"
              title={item.title}
            >
              {item.title}
            </p>
            {isTopMatch && (
              <span className="inline-block mt-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
                {STRINGS.topMatchBadge}
              </span>
            )}
          </div>
        </div>
      </td>

      {/* Source */}
      <td className="px-4 py-3 whitespace-nowrap">
        <SourceBadge source={item.source} />
      </td>

      {/* Current price */}
      <td className="px-4 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
        {formatINR(item.current_price)}
      </td>

      {/* Original price */}
      <td className="px-4 py-3 text-right whitespace-nowrap">
        {item.original_price && item.current_price && item.original_price > item.current_price ? (
          <span className="text-gray-400 line-through text-xs">
            {formatINR(item.original_price)}
          </span>
        ) : (
          <span className="text-gray-400 text-xs">{formatINR(item.original_price)}</span>
        )}
      </td>

      {/* Discount */}
      <td className="px-4 py-3 text-right">
        {item.discount !== null && item.discount > 0 ? (
          <span className="inline-block bg-green-100 text-green-700 text-xs font-semibold px-2 py-0.5 rounded-full">
            -{item.discount}%
          </span>
        ) : (
          <span className="text-gray-400 text-xs">—</span>
        )}
      </td>

      {/* Rating */}
      <td className="px-4 py-3 text-right">
        <div className="flex justify-end">
          <RatingStars rating={item.rating} />
        </div>
      </td>

      {/* Reviews */}
      <td className="px-4 py-3 text-right text-xs text-gray-600 whitespace-nowrap">
        {formatReviews(item.review_count)}
      </td>

      {/* Rank */}
      <td className="px-4 py-3 text-right text-xs text-gray-600">
        {item.rank !== null ? `#${item.rank}` : STRINGS.noRankLabel}
      </td>

      {/* View link */}
      <td className="px-4 py-3">
        {item.product_url ? (
          <a
            href={item.product_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 whitespace-nowrap"
            aria-label={`View ${item.title} on ${item.source}`}
          >
            {STRINGS.viewButtonLabel}
            <ExternalLink size={12} aria-hidden="true" />
          </a>
        ) : (
          <span className="text-gray-300 text-xs">—</span>
        )}
      </td>
    </tr>
  );
}
