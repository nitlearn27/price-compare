import ReactMarkdown from "react-markdown";
import { clsx } from "clsx";
import type { UIMessage } from "../../lib/types";
import { STRINGS } from "../../lib/strings";

interface Props {
  message: UIMessage;
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";

  return (
    <div
      className={clsx(
        "flex gap-2 items-end",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      {/* Avatar */}
      {!isUser && (
        <div
          className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
          aria-hidden="true"
        >
          AI
        </div>
      )}

      {/* Bubble */}
      <div
        className={clsx(
          "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm",
          isUser
            ? "bg-indigo-600 text-white rounded-br-sm"
            : "bg-white text-gray-800 border border-gray-100 rounded-bl-sm"
        )}
        aria-label={isUser ? "Your message" : `${STRINGS.assistantName} message`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="flex gap-2 items-end" aria-label={STRINGS.typingIndicatorLabel} role="status">
      <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
        AI
      </div>
      <div className="bg-white border border-gray-100 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
        <div className="flex gap-1 items-center h-4">
          <span className="typing-dot w-2 h-2 rounded-full bg-gray-400" />
          <span className="typing-dot w-2 h-2 rounded-full bg-gray-400" />
          <span className="typing-dot w-2 h-2 rounded-full bg-gray-400" />
        </div>
      </div>
    </div>
  );
}
