import { Star } from "lucide-react";

interface Props {
  rating: string | null;
}

export function RatingStars({ rating }: Props) {
  if (!rating) return <span className="text-gray-400 text-xs">—</span>;

  const numeric = parseFloat(rating);
  if (isNaN(numeric)) return <span className="text-gray-500 text-xs">{rating}</span>;

  const full = Math.floor(numeric);
  const partial = numeric - full;

  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`Rating: ${rating} out of 5`}>
      {Array.from({ length: 5 }, (_, i) => {
        const filled = i < full;
        const isPartial = i === full && partial >= 0.5;
        return (
          <Star
            key={i}
            size={12}
            className={filled || isPartial ? "text-amber-400" : "text-gray-300"}
            fill={filled ? "currentColor" : isPartial ? "currentColor" : "none"}
            aria-hidden="true"
          />
        );
      })}
      <span className="ml-1 text-xs text-gray-600">{numeric.toFixed(1)}</span>
    </span>
  );
}
