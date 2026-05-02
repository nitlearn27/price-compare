import { useEffect, useRef } from "react";
import { Sparkles } from "lucide-react";
import type { UIMessage } from "../../lib/types";
import { STRINGS } from "../../lib/strings";
import { MessageBubble, TypingIndicator } from "./MessageBubble";
import { ChatInput } from "./ChatInput";

interface Props {
  messages: UIMessage[];
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  onExampleClick: (prompt: string) => void;
}

export function ChatWindow({
  messages,
  inputValue,
  onInputChange,
  onSubmit,
  isLoading,
  onExampleClick,
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

  const showEmpty = messages.length === 0 && !isLoading;

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-200 bg-white flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
          <Sparkles size={16} className="text-white" aria-hidden="true" />
        </div>
        <div>
          <p className="font-semibold text-gray-900 text-sm">{STRINGS.assistantName}</p>
          <p className="text-xs text-gray-400">{STRINGS.appSubtitle}</p>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4 space-y-4"
        aria-label="Chat messages"
        aria-live="polite"
      >
        {showEmpty ? (
          <EmptyState onExampleClick={onExampleClick} />
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

      {/* Input */}
      <ChatInput
        value={inputValue}
        onChange={onInputChange}
        onSubmit={onSubmit}
        disabled={isLoading}
      />
    </div>
  );
}

function EmptyState({ onExampleClick }: { onExampleClick: (p: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-12">
      <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mb-4">
        <Sparkles size={28} className="text-indigo-500" />
      </div>
      <h2 className="font-semibold text-gray-800 mb-1">{STRINGS.chatEmptyHeading}</h2>
      <p className="text-sm text-gray-400 mb-6">{STRINGS.chatEmptySubtext}</p>
      <div className="flex flex-col gap-2 w-full max-w-xs">
        {STRINGS.chatExamplePrompts.map((prompt) => (
          <button
            key={prompt}
            onClick={() => onExampleClick(prompt)}
            className="text-sm text-left px-4 py-2.5 rounded-xl border border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50 transition-colors text-gray-700 hover:text-indigo-700"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
