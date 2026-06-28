import { useState, useCallback } from "react";
import type { ProductListing, ProductQuery } from "../lib/types";
import { api } from "../lib/api";

export type SearchedVia = "salesforce" | "flipkart" | null;

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

  /** Search the internal catalog. Returns the number of results found, or -1 on
   *  error, so the caller falls back to Flipkart only on a clean zero-result run. */
  const search = useCallback(async (query: ProductQuery): Promise<number> => {
    setState({ results: [], loading: true, loadingLive: false, error: null, searchedVia: null });
    try {
      const data = await api.searchProducts(query);
      setState({
        results: data.results,
        loading: false,
        loadingLive: false,
        error: null,
        searchedVia: "salesforce",
      });
      return data.results.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to fetch products.";
      setState({ results: [], loading: false, loadingLive: false, error: msg, searchedVia: null });
      return -1;
    }
  }, []);

  /** Live Flipkart fallback — used when the catalog search returned nothing. */
  const searchFlipkart = useCallback(async (query: ProductQuery): Promise<number> => {
    setState({ results: [], loading: true, loadingLive: false, error: null, searchedVia: "flipkart" });
    try {
      const data = await api.searchProductsFlipkart(query);
      setState({
        results: data.results,
        loading: false,
        loadingLive: false,
        error: null,
        searchedVia: "flipkart",
      });
      return data.results.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to fetch products.";
      setState({
        results: [],
        loading: false,
        loadingLive: false,
        error: msg,
        searchedVia: "flipkart",
      });
      return 0;
    }
  }, []);

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
    search,
    searchFlipkart,
    setResults,
    appendResults,
    setLoading,
    setLoadingLive,
    setError,
  };
}
