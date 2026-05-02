import { useState, useCallback } from "react";
import type { ProductListing, ProductQuery } from "../lib/types";
import { api } from "../lib/api";

interface State {
  results: ProductListing[];
  loading: boolean;
  error: string | null;
}

export function useProductSearch() {
  const [state, setState] = useState<State>({
    results: [],
    loading: false,
    error: null,
  });

  const search = useCallback(async (query: ProductQuery) => {
    setState({ results: [], loading: true, error: null });
    try {
      const data = await api.searchProducts(query);
      setState({ results: data.results, loading: false, error: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to fetch products.";
      setState({ results: [], loading: false, error: msg });
    }
  }, []);

  return { ...state, search };
}
