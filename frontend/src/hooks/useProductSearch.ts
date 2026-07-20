import { useState, useCallback } from "react";
import type { ProductListing } from "../lib/types";

export type SearchedVia = "salesforce" | null;

interface State {
  results: ProductListing[];
  loading: boolean;
  loadingLive: boolean;
  error: string | null;
  searchedVia: SearchedVia;
}

export function useProductSearch() {
  const [state, setState] = useState<State>({
    results: [],
    loading: false,
    loadingLive: false,
    error: null,
    searchedVia: null,
  });

  const setResults = useCallback((results: ProductListing[], searchedVia: SearchedVia) => {
    setState({ results, loading: false, loadingLive: false, error: null, searchedVia });
  }, []);

  /** Append live (phase-2) results to the existing table, de-duping by id. */
  const appendResults = useCallback((listings: ProductListing[]) => {
    setState((prev) => {
      const seen = new Set(prev.results.map((r) => r.id));
      const merged = [...prev.results, ...listings.filter((l) => !seen.has(l.id))];
      return { ...prev, results: merged, loadingLive: false };
    });
  }, []);

  const setLoading = useCallback((loading: boolean) => {
    setState((prev) => ({ ...prev, loading, error: null }));
  }, []);

  const setLoadingLive = useCallback((loadingLive: boolean) => {
    setState((prev) => ({ ...prev, loadingLive }));
  }, []);

  const setError = useCallback((error: string) => {
    setState((prev) => ({ ...prev, loading: false, error }));
  }, []);

  return {
    ...state,
    setResults,
    appendResults,
    setLoading,
    setLoadingLive,
    setError,
  };
}
