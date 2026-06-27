import { useState, useCallback } from "react";
import type { RecommendationItem } from "../lib/types";
import { api } from "../lib/api";
import { STRINGS } from "../lib/strings";

interface State {
  insight: string | null;
  recommendations: RecommendationItem[];
  loading: boolean;
  error: string | null;
}

export function useRecommendations() {
  const [state, setState] = useState<State>({
    insight: null,
    recommendations: [],
    loading: false,
    error: null,
  });

  const fetch = useCallback(async (userInput: string, opts?: { refresh?: boolean }) => {
    const trimmed = userInput.trim() || STRINGS.recommendationsDefaultInput;
    setState({ insight: null, recommendations: [], loading: true, error: null });
    try {
      const data = await api.getRecommendations({
        user_input: trimmed,
        refresh: opts?.refresh,
      });
      setState({
        insight: data.insight_message,
        recommendations: data.recommendations,
        loading: false,
        error: null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to fetch recommendations.";
      setState({ insight: null, recommendations: [], loading: false, error: msg });
    }
  }, []);

  return { ...state, fetch };
}

export type RecommendationsState = ReturnType<typeof useRecommendations>;
