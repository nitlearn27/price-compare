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
          className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 shadow-sm"
          aria-hidden="true"
        >
          AI
        </div>
      )}

      {/* Bubble */}
      <div
        className={clsx(
          "max-w-[85%] rounded-2xl overflow-hidden text-sm leading-relaxed shadow-md",
          isUser
            ? "bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-br-sm shadow-blue-500/10"
            : "bg-white/[0.08] border border-white/10 text-white/90 rounded-bl-sm backdrop-blur-sm"
        )}
        aria-label={isUser ? "Your message" : `${STRINGS.assistantName} message`}
      >
        {message.image && (
          <div className="w-full max-h-[400px] overflow-hidden bg-black/20 border-b border-white/5">
            <img 
              src={message.image} 
              alt="Uploaded preview" 
              className="w-full max-h-[400px] object-contain block" 
            />
          </div>
        )}
        {message.content && (
          <div className="px-4 py-2.5">
            {isUser ? (
              <p className="whitespace-pre-wrap">{message.content}</p>
            ) : (
              <div className="prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-invert">
                <ReactMarkdown>{message.content}</ReactMarkdown>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="flex gap-2 items-end" aria-label={STRINGS.typingIndicatorLabel} role="status">
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 shadow-sm">
        AI
      </div>
      <div className="bg-white/[0.08] border border-white/10 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm backdrop-blur-sm">
        <div className="flex gap-1 items-center h-4">
          <span className="typing-dot w-2 h-2 rounded-full bg-white/50" />
          <span className="typing-dot w-2 h-2 rounded-full bg-white/50" />
          <span className="typing-dot w-2 h-2 rounded-full bg-white/50" />
        </div>
      </div>
    </div>
  );
}
