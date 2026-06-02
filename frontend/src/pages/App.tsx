import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useChat } from "../hooks/useChat";
import { useRecommendations } from "../hooks/useRecommendations";
import { ChatWindow } from "../components/chat/ChatWindow";
import { ComparisonTable } from "../components/results/ComparisonTable";
import { RecommendationsDrawer } from "../components/recommendations/RecommendationsDrawer";
import { STRINGS } from "../lib/strings";

export default function App() {
  const { messages, input, setInput, isLoading, sendMessage, submitExample, productSearch } =
    useChat();
  const recommendations = useRecommendations();
  const [recsOpen, setRecsOpen] = useState(false);

  const resultCount = productSearch.results.length;
  const storeCount = new Set(productSearch.results.map((r) => r.source)).size;

  return (
    <div className="flex flex-col h-screen overflow-hidden app-bg">
      {/* Top bar */}
      <header className="glass-strong border-b border-slate-200 px-6 py-3.5 flex items-center gap-3 flex-shrink-0 relative z-20">
        <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-md shadow-indigo-500/20 flex-shrink-0">
          <span className="text-white text-xs font-bold tracking-tight">PC</span>
        </div>
        <div>
          <h1 className="text-[15px] font-semibold text-slate-900 tracking-tight leading-none">
            {STRINGS.appTitle}
          </h1>
          <p className="text-[11px] text-slate-500 mt-1 leading-none">
            Smart price comparison · powered by AI
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setRecsOpen(true)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-white px-3.5 py-1.5 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 glow-indigo hover:from-indigo-600 hover:to-violet-700 transition"
          >
            <Sparkles size={14} aria-hidden="true" />
            {STRINGS.recommendationsButton}
          </button>
          <span className="hidden sm:inline-flex items-center gap-1.5 text-[10px] text-slate-600 tracking-widest uppercase font-semibold px-3 py-1.5 rounded-full border border-slate-200 bg-white">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/40 animate-pulse" />
            Live
          </span>
        </div>
      </header>

      {/* Main two-pane layout */}
      <main className="flex flex-1 overflow-hidden relative z-10">
        {/* Left pane — chat (38%) */}
        <section
          className="w-full lg:w-[38%] flex-shrink-0 border-r border-slate-200 flex flex-col overflow-hidden bg-white/60"
          aria-label="Chat panel"
        >
          <ChatWindow
            messages={messages}
            inputValue={input}
            onInputChange={setInput}
            onSubmit={() => sendMessage(input)}
            isLoading={isLoading}
            onExampleClick={submitExample}
          />
        </section>

        {/* Right pane — comparison table (62%) */}
        <section
          className="hidden lg:flex flex-1 flex-col overflow-hidden"
          aria-label="Product comparison panel"
        >
          {/* Pane header */}
          <div className="px-6 py-4 border-b border-slate-200 glass flex items-center justify-between flex-shrink-0">
            <div>
              <h2 className="text-[15px] font-semibold text-slate-900 tracking-tight">
                Product Comparison
              </h2>
              {resultCount > 0 ? (
                <p className="text-xs text-slate-500 mt-1">
                  <span className="text-slate-800 font-medium">{resultCount}</span> result
                  {resultCount !== 1 ? "s" : ""} across{" "}
                  <span className="text-slate-800 font-medium">{storeCount}</span> store
                  {storeCount !== 1 ? "s" : ""}
                </p>
              ) : (
                <p className="text-xs text-slate-400 mt-1">
                  Ask the assistant about a product to see comparisons here
                </p>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-hidden">
            <ComparisonTable
              results={productSearch.results}
              loading={productSearch.loading}
              error={productSearch.error}
            />
          </div>
        </section>

        {/* Mobile: table below chat */}
        <section
          className="lg:hidden w-full border-t border-slate-200"
          aria-label="Product comparison (mobile)"
        >
          <ComparisonTable
            results={productSearch.results}
            loading={productSearch.loading}
            error={productSearch.error}
          />
        </section>
      </main>

      <RecommendationsDrawer
        open={recsOpen}
        onClose={() => setRecsOpen(false)}
        state={recommendations}
      />
    </div>
  );
}
