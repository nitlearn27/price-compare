import { useEffect, useRef } from "react";
import { LayoutGrid } from "lucide-react";
import type { UIMessage } from "../../lib/types";
import type { RecommendationsState } from "../../hooks/useRecommendations";
import { MessageBubble, TypingIndicator } from "./MessageBubble";
import { ChatInput } from "./ChatInput";
import { RecommendedPicks } from "../recommendations/RecommendedPicks";
import { STRINGS } from "../../lib/strings";

interface Props {
  messages: UIMessage[];
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: (file?: File | null) => void;
  isLoading: boolean;
  recommendations: RecommendationsState;
  /** Number of rows currently in the comparison table. */
  resultCount?: number;
  /** Mobile-only: switch to the results tab. Renders a "View results" chip
   *  after the assistant reply so the user opts in instead of being yanked away. */
  onViewResults?: () => void;
}

export function ChatWindow({
  messages,
  inputValue,
  onInputChange,
  onSubmit,
  isLoading,
  recommendations,
  resultCount = 0,
  onViewResults,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distFromBottom < 80;
  }

  useEffect(() => {
    if (isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isLoading]);

  // First-open state: show the user's recommended picks instead of the chat thread.
  const showPicks = messages.length === 0 && !isLoading;

  return (
    <div className="flex flex-col h-full">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4 space-y-4"
        aria-label="Chat messages"
        aria-live="polite"
      >
        {showPicks ? (
          <RecommendedPicks state={recommendations} />
        ) : (
          <>
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {isLoading && <TypingIndicator />}
            {!isLoading && resultCount > 0 && onViewResults && (
              <div className="lg:hidden flex justify-start pl-9">
                <button
                  type="button"
                  onClick={onViewResults}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-300 bg-sky-400/15 ring-1 ring-sky-400/30 hover:bg-sky-400/25 rounded-full px-3.5 py-1.5 transition-colors"
                >
                  <LayoutGrid size={13} aria-hidden="true" />
                  {STRINGS.viewResultsChip} ({resultCount})
                </button>
              </div>
            )}
          </>
        )}
        <div ref={bottomRef} aria-hidden="true" />
      </div>

      <ChatInput
        value={inputValue}
        onChange={onInputChange}
        onSubmit={onSubmit}
        disabled={isLoading}
      />
    </div>
  );
}
