import { useEffect, useRef, useState } from "react";
import { KeyRound, X, Loader2, ShieldCheck } from "lucide-react";
import type { UseRefresh } from "../../hooks/useRefresh";
import { STRINGS } from "../../lib/strings";

interface Props {
  state: UseRefresh;
}

export function OtpModal({ state }: Props) {
  const { otpOpen, otpSubmitting, otpError, submitOtp, closeOtp } = state;
  const [code, setCode] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset the field each time the modal opens; focus the input and wire Escape.
  useEffect(() => {
    if (!otpOpen) return;
    setCode("");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeOtp();
    };
    document.addEventListener("keydown", onKey);
    inputRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [otpOpen, closeOtp]);

  const trimmed = code.trim();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed || otpSubmitting) return;
    void submitOtp(trimmed);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] transition-opacity duration-300 ${
          otpOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={closeOtp}
        aria-hidden="true"
      />

      {/* Centered dialog */}
      <div
        className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-opacity duration-200 ${
          otpOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={STRINGS.otpTitle}
          className={`w-full max-w-sm glass-strong border border-white/10 rounded-2xl shadow-2xl flex flex-col outline-none transition-transform duration-200 ${
            otpOpen ? "scale-100" : "scale-95"
          }`}
        >
          {/* Header */}
          <header className="px-5 py-4 border-b border-white/10 flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-md shadow-blue-500/20 flex-shrink-0">
              <KeyRound size={16} className="text-white" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-white tracking-tight leading-none">
                {STRINGS.otpTitle}
              </h2>
              <p className="text-[11px] text-white/60 mt-1 leading-tight">
                {STRINGS.otpSubtitle}
              </p>
            </div>
            <button
              type="button"
              onClick={closeOtp}
              aria-label={STRINGS.otpClose}
              className="ml-auto w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          {/* Body / form */}
          <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={STRINGS.otpPlaceholder}
              className="w-full rounded-xl bg-white/[0.06] border border-white/10 px-4 py-2.5 text-white text-center text-lg tracking-[0.3em] placeholder:tracking-normal placeholder:text-white/30 outline-none focus:border-indigo-400/60 focus:bg-white/[0.08] transition"
            />

            {otpError && (
              <p
                role="alert"
                className="text-xs font-medium text-rose-300 bg-rose-500/15 ring-1 ring-rose-400/30 rounded-lg px-3 py-2"
              >
                {otpError}
              </p>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={closeOtp}
                className="flex-1 rounded-xl px-4 py-2.5 text-sm font-medium text-white/80 border border-white/10 bg-white/[0.04] hover:bg-white/10 transition"
              >
                {STRINGS.otpCancel}
              </button>
              <button
                type="submit"
                disabled={!trimmed || otpSubmitting}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white bg-gradient-to-br from-blue-500 to-indigo-600 glow-indigo hover:from-blue-400 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {otpSubmitting ? (
                  <>
                    <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                    {STRINGS.otpSubmitting}
                  </>
                ) : (
                  <>
                    <ShieldCheck size={15} aria-hidden="true" />
                    {STRINGS.otpSubmit}
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
