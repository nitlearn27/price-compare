import { useState, useCallback } from "react";
import type { UIMessage, CartItem } from "../lib/types";
import { api } from "../lib/api";
import { useProductSearch } from "./useProductSearch";

let _idCounter = 0;
function nextId() {
  return String(++_idCounter);
}

export function useChat(cart?: { add: (item: CartItem) => void }) {
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
    async (text: string, file?: File | null) => {
      const trimmed = text.trim();
      if ((!trimmed && !file) || isLoading) return;

      setInput("");
      setIsLoading(true);

      let fileBase64: string | null = null;
      let mimeType = "image/jpeg";
      if (file) {
        mimeType = file.type;
        const reader = new FileReader();
        const readPromise = new Promise<string>((resolve) => {
          reader.onloadend = () => {
            resolve(reader.result as string);
          };
        });
        reader.readAsDataURL(file);
        fileBase64 = await readPromise;
      }

      const userMsg = addMessage("user", trimmed || "Uploaded an image to identify products");
      if (fileBase64) {
        userMsg.image = fileBase64;
      }

      try {
        if (file) {
          const rawBase64 = fileBase64 ? fileBase64.split(",")[1] : "";
          
          productSearch.setLoading(true);
          
          const response = await api.identifyImage({ image: rawBase64, mime_type: mimeType });
          addMessage("assistant", response.reply);
          
          productSearch.setResults(response.results, "salesforce");

          if (response.must_have && response.must_have.length > 0 && cart) {
            response.must_have.forEach((item) => {
              cart.add({
                id: item.id,
                name: item.title,
                source: item.source,
              });
            });
          }
        } else {
          const history = [
            ...messages,
            { role: "user" as const, content: trimmed },
          ];
          // The agent runs a tool-use loop server-side: it searches, reasons over
          // the results (falling back to live Flipkart itself when needed), and
          // returns the chat reply, the comparison table, and any cart additions
          // in a single response.
          productSearch.setLoading(true);
          const agentResp = await api.agentChat({ messages: history });
          addMessage("assistant", agentResp.reply);
          productSearch.setResults(agentResp.results, "salesforce");

          if (cart) {
            agentResp.cart.forEach((item) =>
              cart.add({ id: item.id, name: item.name, source: item.source }),
            );
          }

          // Phase 2: slow live-store results were deferred — fetch them now and
          // append to the table so the user sees the fast catalog rows first.
          const pending = agentResp.pending_live;
          if (pending) {
            productSearch.setLoadingLive(true);
            try {
              const live = await api.productsLive({
                query: pending.query,
                sources: pending.sources,
                min_price: pending.min_price,
                max_price: pending.max_price,
              });
              productSearch.appendResults(live.results);
            } catch {
              productSearch.setLoadingLive(false); // keep the catalog rows on failure
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Something went wrong. Please try again.";
        addMessage("assistant", `Sorry, I ran into an issue: ${msg}`);
        productSearch.setError(msg);
      } finally {
        setIsLoading(false);
      }
    },
    [messages, isLoading, addMessage, productSearch, cart]
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
