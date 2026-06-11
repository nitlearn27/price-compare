import { ArrowUp, ArrowDown } from "lucide-react";

interface Props {
  current: number | null;
  lastPaid: number | null;
}

function formatDelta(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Trend of the current price relative to what the user last paid.
 * Current HIGHER than last paid → pricier now → red up arrow.
 * Current LOWER  than last paid → cheaper now → green down arrow.
 * Equal or missing data → neutral dash.
 */
export function PriceTrend({ current, lastPaid }: Props) {
  if (current === null || lastPaid === null || current === lastPaid) {
    return (
      <span className="text-white/25 text-xs" aria-label="No price change">
        —
      </span>
    );
  }

  const delta = formatDelta(Math.abs(Math.round(current - lastPaid)));

  if (current > lastPaid) {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-rose-400 text-xs font-medium whitespace-nowrap"
        aria-label={`Up ${delta} versus last paid`}
      >
        <ArrowUp size={13} aria-hidden="true" />
        {delta}
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-0.5 text-emerald-400 text-xs font-medium whitespace-nowrap"
      aria-label={`Down ${delta} versus last paid`}
    >
      <ArrowDown size={13} aria-hidden="true" />
      {delta}
    </span>
  );
}
