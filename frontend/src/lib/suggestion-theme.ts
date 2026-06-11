import { STRINGS } from "./strings";
import type { BuySuggestion } from "./types";

export interface SuggestionTheme {
  label: string;
  bg: string;
  fg: string;
  ring: string;
  dot: string;
}

const SUGGESTION_THEMES: Record<BuySuggestion, SuggestionTheme> = {
  frequent: {
    label: STRINGS.suggestionFrequent,
    bg: "#10B98126", // emerald-500 @ 15%
    fg: "#6EE7B7", // emerald-300
    ring: "#10B98155", // emerald-500 @ 33%
    dot: "#34D399", // emerald-400
  },
  restock: {
    label: STRINGS.suggestionRestock,
    bg: "#818CF826", // indigo-400 @ 15%
    fg: "#A5B4FC", // indigo-300
    ring: "#818CF855", // indigo-400 @ 33%
    dot: "#818CF8", // indigo-400
  },
  recent: {
    label: STRINGS.suggestionRecent,
    bg: "#FFFFFF14", // white @ 8%
    fg: "#CBD5E1", // slate-300
    ring: "#FFFFFF33", // white @ 20%
    dot: "#94A3B8", // slate-400
  },
  new: {
    label: STRINGS.suggestionNew,
    bg: "#F59E0B26", // amber-500 @ 15%
    fg: "#FCD34D", // amber-300
    ring: "#F59E0B55", // amber-500 @ 33%
    dot: "#FBBF24", // amber-400
  },
};

export function getSuggestionTheme(label: BuySuggestion): SuggestionTheme {
  return SUGGESTION_THEMES[label];
}

export const SUGGESTION_LABELS = Object.keys(
  SUGGESTION_THEMES,
) as BuySuggestion[];
