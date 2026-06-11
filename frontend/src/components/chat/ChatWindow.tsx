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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/10 glass flex items-center gap-3 flex-shrink-0">
        <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-md shadow-blue-500/20">
          <Sparkles size={16} className="text-white" aria-hidden="true" />
        </div>
        <div>
          <p className="font-semibold text-white text-[14px] tracking-tight leading-none">
            {STRINGS.assistantName}
          </p>
          <p className="text-[11px] text-white/60 mt-1.5 leading-none">{STRINGS.appSubtitle}</p>
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
      <div className="w-14 h-14 rounded-2xl bg-white/[0.08] border border-white/10 flex items-center justify-center mb-4 shadow-sm">
        <Sparkles size={28} className="text-amber-300" />
      </div>
      <h2 className="font-semibold text-white mb-1">{STRINGS.chatEmptyHeading}</h2>
      <p className="text-sm text-white/60 mb-6">{STRINGS.chatEmptySubtext}</p>
      <div className="flex flex-col gap-2 w-full max-w-xs">
        {STRINGS.chatExamplePrompts.map((prompt) => (
          <button
            key={prompt}
            onClick={() => onExampleClick(prompt)}
            className="text-sm text-left px-4 py-2.5 rounded-xl border border-white/10 bg-white/[0.06] hover:border-white/20 hover:bg-white/10 transition-all duration-150 text-white/80 hover:text-white shadow-sm"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
