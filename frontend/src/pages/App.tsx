import { useChat } from "../hooks/useChat";
import { ChatWindow } from "../components/chat/ChatWindow";
import { ComparisonTable } from "../components/results/ComparisonTable";
import { STRINGS } from "../lib/strings";

export default function App() {
  const { messages, input, setInput, isLoading, sendMessage, submitExample, productSearch } =
    useChat();

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-100">
      {/* Top bar */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-3 flex-shrink-0">
        <div className="w-7 h-7 rounded-md bg-indigo-600 flex items-center justify-center">
          <span className="text-white text-xs font-bold">PC</span>
        </div>
        <h1 className="text-base font-semibold text-gray-900">{STRINGS.appTitle}</h1>
      </header>

      {/* Main two-pane layout */}
      <main className="flex flex-1 overflow-hidden">
        {/* Left pane — chat (38%) */}
        <section
          className="w-full lg:w-[38%] flex-shrink-0 border-r border-gray-200 flex flex-col overflow-hidden"
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
          className="hidden lg:flex flex-1 flex-col overflow-hidden bg-white"
          aria-label="Product comparison panel"
        >
          {/* Pane header */}
          <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Product Comparison</h2>
              {productSearch.results.length > 0 && (
                <p className="text-xs text-gray-400 mt-0.5">
                  {productSearch.results.length} result
                  {productSearch.results.length !== 1 ? "s" : ""} across{" "}
                  {new Set(productSearch.results.map((r) => r.source)).size} store
                  {new Set(productSearch.results.map((r) => r.source)).size !== 1 ? "s" : ""}
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
          className="lg:hidden w-full border-t border-gray-200 bg-white"
          aria-label="Product comparison (mobile)"
        >
          <ComparisonTable
            results={productSearch.results}
            loading={productSearch.loading}
            error={productSearch.error}
          />
        </section>
      </main>
    </div>
  );
}
