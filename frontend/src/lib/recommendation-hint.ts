import type { RecommendationItem } from "./types";

/** A short, punchy "why are we showing this" label (1–2 words) for a pick. */
export interface RecHint {
  label: string;
  /** Tailwind text/bg/ring classes for the chip. */
  tone: string;
}

// Order matters: first matching rule wins.
const RULES: { test: RegExp; label: string; tone: string }[] = [
  {
    test: /\b(run|running|low|out|empty|due|restock|reorder|refill|finish)/,
    label: "Running low",
    tone: "text-rose-300 bg-rose-400/15 ring-rose-400/30",
  },
  {
    test: /\b(often|frequent|regular|usual|repeat|always|staple|daily)/,
    label: "Your usual",
    tone: "text-sky-300 bg-sky-400/15 ring-sky-400/30",
  },
  {
    test: /\b(deal|discount|drop|save|saving|offer|sale|cheap|lower|low price)/,
    label: "Price drop",
    tone: "text-emerald-300 bg-emerald-400/15 ring-emerald-400/30",
  },
  {
    test: /\b(trend|popular|best.?sell|top|loved|highly rated)/,
    label: "Popular",
    tone: "text-violet-300 bg-violet-400/15 ring-violet-400/30",
  },
  {
    test: /\b(new|launch|just in)/,
    label: "New",
    tone: "text-amber-300 bg-amber-400/15 ring-amber-400/30",
  },
  {
    test: /\b(season|festive|monsoon|summer|winter)/,
    label: "Seasonal",
    tone: "text-amber-300 bg-amber-400/15 ring-amber-400/30",
  },
];

const DEFAULT_TONE = "text-white/70 bg-white/10 ring-white/15";

/** Derive a 1–2 word hint from the engine's reasoning/highlights. */
export function recommendationHint(item: RecommendationItem): RecHint {
  const haystack = [item.reasoning ?? "", ...(item.highlights ?? [])]
    .join(" ")
    .toLowerCase();

  for (const rule of RULES) {
    if (rule.test.test(haystack)) {
      return { label: rule.label, tone: rule.tone };
    }
  }

  // Fall back to the first short highlight, else a friendly default.
  const shortHighlight = (item.highlights ?? []).find(
    (h) => h.trim().split(/\s+/).length <= 2,
  );
  return { label: shortHighlight?.trim() || "For you", tone: DEFAULT_TONE };
}
