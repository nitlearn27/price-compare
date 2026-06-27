import { useEffect, useRef } from "react";
import type { UIMessage } from "../../lib/types";
import type { RecommendationsState } from "../../hooks/useRecommendations";
import { MessageBubble, TypingIndicator } from "./MessageBubble";
import { ChatInput } from "./ChatInput";
import { RecommendedPicks } from "../recommendations/RecommendedPicks";

interface Props {
  messages: UIMessage[];
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: (file?: File | null) => void;
  isLoading: boolean;
  recommendations: RecommendationsState;
}

export function ChatWindow({
  messages,
  inputValue,
  onInputChange,
  onSubmit,
  isLoading,
  recommendations,
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
