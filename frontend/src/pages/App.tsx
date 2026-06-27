import { useState, useEffect, useRef } from "react";
import { Sparkles, MessageSquare, LayoutGrid, ShoppingCart, Check, X } from "lucide-react";
import { useChat } from "../hooks/useChat";
import { useRecommendations } from "../hooks/useRecommendations";
import { useCart } from "../hooks/useCart";
import { useRefresh } from "../hooks/useRefresh";
import { useInstallPrompt } from "../hooks/useInstallPrompt";
import { ChatWindow } from "../components/chat/ChatWindow";
import { ComparisonTable } from "../components/results/ComparisonTable";
import { RecommendationsDrawer } from "../components/recommendations/RecommendationsDrawer";
import { CartDrawer } from "../components/cart/CartDrawer";
import { RefreshButtons } from "../components/refresh/RefreshButtons";
import { OtpModal } from "../components/refresh/OtpModal";
import { HeaderMenu } from "../components/header/HeaderMenu";
import { STRINGS } from "../lib/strings";
import { getSourceTheme } from "../lib/source-theme";

type MobileTab = "chat" | "results";

export default function App() {
  const cart = useCart();
  const { messages, input, setInput, isLoading, sendMessage, productSearch } = useChat(cart);
  const recommendations = useRecommendations();
  // Separate instance powering the first-open "Picks for you" view, so it isn't
  // disturbed by preference searches made inside the recommendations drawer.
  const homeRecs = useRecommendations();
  const refresh = useRefresh();
  const install = useInstallPrompt();
  const [recsOpen, setRecsOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<MobileTab>("chat");

  const resultCount = productSearch.results.length;
  const storeCount = new Set(productSearch.results.map((r) => r.source)).size;

  // Load the first-open recommendations once (the backend caches the engine call).
  useEffect(() => {
    homeRecs.fetch("");
  }, [homeRecs.fetch]);

  // On mobile, jump to the results tab as soon as a search starts so the user
  // sees the loading state and results instead of staying on the chat pane.
  const prevLoading = useRef(false);
  useEffect(() => {
    if (productSearch.loading && !prevLoading.current) {
      setActiveTab("results");
    }
    prevLoading.current = productSearch.loading;
  }, [productSearch.loading]);

  return (
    <div className="flex flex-col h-screen overflow-hidden app-bg">
      {/* Top bar */}
      <header className="glass-strong border-b border-white/10 px-4 sm:px-6 py-3.5 flex items-center gap-3 flex-shrink-0 relative z-20">
        <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-md shadow-blue-500/20 flex-shrink-0">
          <span className="text-white text-xs font-bold tracking-tight">PC</span>
        </div>
        <div className="min-w-0">
          <h1 className="text-[15px] font-semibold text-white tracking-tight leading-none truncate">
            {STRINGS.appTitle}
          </h1>
          <p className="text-[11px] text-white/60 mt-1 leading-none truncate">
            Smart price comparison · powered by AI
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-shrink-0">
          <RefreshButtons state={refresh} />
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            aria-label={`${STRINGS.cartButton} (${cart.count})`}
            className="relative inline-flex items-center gap-1.5 text-xs font-medium text-white/85 px-3 sm:px-3.5 py-1.5 rounded-full border border-white/10 bg-white/10 hover:bg-white/15 transition"
          >
            <ShoppingCart size={14} aria-hidden="true" />
            <span className="hidden sm:inline">{STRINGS.cartButton}</span>
            {cart.count > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold bg-amber-400 text-slate-900">
                {cart.count}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setRecsOpen(true)}
            aria-label={STRINGS.recommendationsButton}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-white px-3 sm:px-3.5 py-1.5 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 glow-indigo hover:from-blue-400 hover:to-indigo-500 transition"
          >
            <Sparkles size={14} aria-hidden="true" />
            <span className="hidden sm:inline">{STRINGS.recommendationsButton}</span>
          </button>
          <span className="hidden sm:inline-flex items-center gap-1.5 text-[10px] text-white/70 tracking-widest uppercase font-semibold px-3 py-1.5 rounded-full border border-white/10 bg-white/10">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/40 animate-pulse" />
            Live
          </span>
          <HeaderMenu install={install} />
        </div>
      </header>

      {/* Mobile tab switcher (hidden on desktop two-pane layout) */}
      <div className="lg:hidden flex-shrink-0 flex items-stretch border-b border-white/10 glass relative z-10">
        <TabButton
          active={activeTab === "chat"}
          onClick={() => setActiveTab("chat")}
          icon={<MessageSquare size={15} aria-hidden="true" />}
          label="Chat"
        />
        <TabButton
          active={activeTab === "results"}
          onClick={() => setActiveTab("results")}
          icon={<LayoutGrid size={15} aria-hidden="true" />}
          label="Results"
          badge={resultCount > 0 ? resultCount : undefined}
        />
      </div>

      {/* Main layout — two panes on desktop, one-at-a-time tabs on mobile */}
      <main className="flex flex-1 overflow-hidden relative z-10">
        {/* Chat pane */}
        <section
          className={`${
            activeTab === "chat" ? "flex" : "hidden"
          } lg:flex w-full lg:w-[38%] flex-shrink-0 border-r border-white/10 flex-col overflow-hidden bg-black/10`}
          aria-label="Chat panel"
        >
          <ChatWindow
            messages={messages}
            inputValue={input}
            onInputChange={setInput}
            onSubmit={(file) => sendMessage(input, file)}
            isLoading={isLoading}
            recommendations={homeRecs}
          />
        </section>

        {/* Comparison pane */}
        <section
          className={`${
            activeTab === "results" ? "flex" : "hidden"
          } lg:flex flex-1 flex-col overflow-hidden`}
          aria-label="Product comparison panel"
        >
          {/* Pane header */}
          <div className="px-4 sm:px-6 py-4 border-b border-white/10 glass flex items-center justify-between flex-shrink-0">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[15px] font-semibold text-white tracking-tight">
                  Product Comparison
                </h2>
                {productSearch.searchedVia === "flipkart" && resultCount > 0 && (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full text-white"
                    style={{ backgroundColor: getSourceTheme("Flipkart").accent }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-white/90 animate-pulse" />
                    {STRINGS.liveFlipkartBadge}
                  </span>
                )}
              </div>
              {resultCount > 0 ? (
                <p className="text-xs text-white/60 mt-1">
                  <span className="text-white font-medium">{resultCount}</span> result
                  {resultCount !== 1 ? "s" : ""} across{" "}
                  <span className="text-white font-medium">{storeCount}</span> store
                  {storeCount !== 1 ? "s" : ""}
                </p>
              ) : (
                <p className="text-xs text-white/40 mt-1">
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
      </main>

      <RecommendationsDrawer
        open={recsOpen}
        onClose={() => setRecsOpen(false)}
        state={recommendations}
      />

      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />

      <OtpModal state={refresh} />

      <RefreshToast state={refresh} />
    </div>
  );
}

function RefreshToast({ state }: { state: ReturnType<typeof useRefresh> }) {
  const { status, dismissStatus } = state;

  // Auto-dismiss after a few seconds whenever a new status appears.
  useEffect(() => {
    if (!status) return;
    const t = setTimeout(dismissStatus, 4000);
    return () => clearTimeout(t);
  }, [status, dismissStatus]);

  if (!status) return null;

  const isError = status.kind === "error";
  return (
    <div
      role={isError ? "alert" : "status"}
      className={`fixed top-4 right-4 z-[60] max-w-xs flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-xs font-medium shadow-2xl ring-1 fade-up ${
        isError
          ? "bg-rose-500/90 text-white ring-rose-300/40"
          : "bg-emerald-500/90 text-white ring-emerald-300/40"
      }`}
    >
      {!isError && <Check size={14} className="mt-0.5 flex-shrink-0" aria-hidden="true" />}
      <span className="flex-1">{status.msg}</span>
      <button
        type="button"
        onClick={dismissStatus}
        aria-label="Dismiss"
        className="flex-shrink-0 -mr-1 text-white/80 hover:text-white transition-colors"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}

function TabButton({ active, onClick, icon, label, badge }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex-1 inline-flex items-center justify-center gap-2 py-2.5 text-sm font-medium border-b-2 transition-colors ${
        active
          ? "border-sky-400 text-white bg-white/5"
          : "border-transparent text-white/50 hover:text-white/80"
      }`}
    >
      {icon}
      {label}
      {badge !== undefined && (
        <span
          className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold ${
            active ? "bg-white/15 text-white" : "bg-white/10 text-white/60"
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
