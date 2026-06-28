import { RefreshCw, Loader2, KeyRound } from "lucide-react";
import type { UseRefresh } from "../../hooks/useRefresh";
import { getSourceTheme } from "../../lib/source-theme";
import { STRINGS } from "../../lib/strings";
import type { RefreshSource } from "../../lib/types";

interface Props {
  state: UseRefresh;
}

const BUTTONS: { source: RefreshSource; label: string; theme: string }[] = [
  { source: "amazon", label: STRINGS.refreshAmazon, theme: "Amazon" },
  { source: "flipkart", label: STRINGS.refreshFlipkart, theme: "Flipkart" },
];

export function RefreshButtons({ state }: Props) {
  const { refreshing, refresh, amazonOtpAvailable, openOtp } = state;

  return (
    <>
      {BUTTONS.map(({ source, label, theme }) => {
        const accent = getSourceTheme(theme).accent;
        const busy = refreshing === source;
        const isAmazonOtp = source === "amazon" && amazonOtpAvailable;
        const buttonLabel = isAmazonOtp ? STRINGS.enterAmazonOtp : label;
        const disabled = isAmazonOtp ? false : refreshing !== null;
        const clickHandler = isAmazonOtp ? openOtp : () => refresh(source);

        return (
          <button
            key={source}
            type="button"
            onClick={clickHandler}
            disabled={disabled}
            aria-label={buttonLabel}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-white/85 px-3 sm:px-3.5 py-1.5 rounded-full border border-white/10 bg-white/10 hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed transition"
            style={{ borderColor: `${accent}66` }}
          >
            {busy ? (
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            ) : isAmazonOtp ? (
              <KeyRound size={14} aria-hidden="true" style={{ color: accent }} />
            ) : (
              <RefreshCw size={14} aria-hidden="true" style={{ color: accent }} />
            )}
            <span className="hidden sm:inline">{busy ? STRINGS.refreshing : buttonLabel}</span>
          </button>
        );
      })}
    </>
  );
}
