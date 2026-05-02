import { useRef, type FormEvent, type KeyboardEvent } from "react";
import { Send } from "lucide-react";
import { clsx } from "clsx";
import { STRINGS } from "../../lib/strings";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
}

export function ChatInput({ value, onChange, onSubmit, disabled }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && value.trim()) onSubmit();
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!disabled && value.trim()) onSubmit();
  }

  function handleInput() {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-end gap-2 border-t border-gray-200 bg-white p-4"
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        placeholder={disabled ? STRINGS.typingIndicatorLabel : STRINGS.chatPlaceholder}
        disabled={disabled}
        rows={1}
        className={clsx(
          "flex-1 resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5",
          "text-sm text-gray-900 placeholder:text-gray-400",
          "focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent",
          "transition-colors overflow-hidden",
          disabled && "opacity-60 cursor-not-allowed"
        )}
        aria-label={STRINGS.chatPlaceholder}
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        className={clsx(
          "w-10 h-10 flex items-center justify-center rounded-xl",
          "bg-indigo-600 text-white transition-all",
          "hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2",
          (disabled || !value.trim()) && "opacity-50 cursor-not-allowed"
        )}
        aria-label={STRINGS.chatSendLabel}
      >
        <Send size={16} aria-hidden="true" />
      </button>
    </form>
  );
}
