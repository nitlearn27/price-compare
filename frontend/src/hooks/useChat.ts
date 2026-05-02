import { useState, useCallback } from "react";
import type { UIMessage } from "../lib/types";
import { api } from "../lib/api";
import { useProductSearch } from "./useProductSearch";

let _idCounter = 0;
function nextId() {
  return String(++_idCounter);
}

export function useChat() {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const productSearch = useProductSearch();

  const addMessage = useCallback((role: UIMessage["role"], content: string): UIMessage => {
    const msg: UIMessage = { id: nextId(), role, content };
    setMessages((prev) => [...prev, msg]);
    return msg;
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;

      setInput("");
      addMessage("user", trimmed);
      setIsLoading(true);

      const history = [
        ...messages,
        { role: "user" as const, content: trimmed },
      ];

      try {
        const chatResp = await api.chat({ messages: history });
        addMessage("assistant", chatResp.reply);

        if (chatResp.product_query) {
          await productSearch.search(chatResp.product_query);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Something went wrong. Please try again.";
        addMessage("assistant", `Sorry, I ran into an issue: ${msg}`);
      } finally {
        setIsLoading(false);
      }
    },
    [messages, isLoading, addMessage, productSearch]
  );

  const submitExample = useCallback(
    (prompt: string) => {
      setInput(prompt);
      sendMessage(prompt);
    },
    [sendMessage]
  );

  return {
    messages,
    input,
    setInput,
    isLoading,
    sendMessage,
    submitExample,
    productSearch,
  };
}
