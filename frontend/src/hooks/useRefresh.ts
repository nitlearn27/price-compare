import { useCallback, useState, useRef, useEffect } from "react";
import { api } from "../lib/api";
import { STRINGS } from "../lib/strings";
import type { RefreshSource } from "../lib/types";

export interface RefreshStatus {
  kind: "success" | "error";
  msg: string;
}

export interface UseRefresh {
  /** The source currently being refreshed, or null when idle. */
  refreshing: RefreshSource | null;
  /** Transient toast feedback for the last refresh, else null. */
  status: RefreshStatus | null;
  /** Whether the Amazon OTP modal is open. */
  otpOpen: boolean;
  /** Whether an OTP submission is in flight. */
  otpSubmitting: boolean;
  /** Error surfaced inside the OTP modal, else null. */
  otpError: string | null;
  /** Trigger a store refresh. */
  refresh: (source: RefreshSource) => Promise<void>;
  /** Submit the entered OTP code. Closes the modal on success. */
  submitOtp: (code: string) => Promise<void>;
  /** Close the OTP modal without submitting. */
  closeOtp: () => void;
  /** Dismiss the transient status toast. */
  dismissStatus: () => void;
  /** Whether Amazon OTP is available to be entered. */
  amazonOtpAvailable: boolean;
  /** Open the Amazon OTP modal. */
  openOtp: () => void;
}

export function useRefresh(): UseRefresh {
  const [refreshing, setRefreshing] = useState<RefreshSource | null>(null);
  const [status, setStatus] = useState<RefreshStatus | null>(null);
  const [otpOpen, setOtpOpen] = useState(false);
  const [otpSubmitting, setOtpSubmitting] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [amazonOtpAvailable, setAmazonOtpAvailable] = useState(false);

  const otpTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (otpTimeoutRef.current) {
        clearTimeout(otpTimeoutRef.current);
      }
    };
  }, []);

  const refresh = useCallback(
    async (source: RefreshSource) => {
      if (refreshing) return;
      setRefreshing(source);
      setStatus(null);

      if (source === "amazon") {
        setAmazonOtpAvailable(false);
        if (otpTimeoutRef.current) {
          clearTimeout(otpTimeoutRef.current);
          otpTimeoutRef.current = null;
        }
      }

      try {
        await api.refreshOrders(source);
        if (source === "amazon") {
          setOtpError(null);
          setAmazonOtpAvailable(true);
          otpTimeoutRef.current = setTimeout(() => {
            setAmazonOtpAvailable(false);
          }, 3 * 60 * 1000); // 3 minutes
          setStatus({ kind: "success", msg: STRINGS.refreshAmazonSuccess });
        } else {
          setStatus({ kind: "success", msg: STRINGS.refreshFlipkartSuccess });
        }
      } catch (err) {
        setStatus({
          kind: "error",
          msg: err instanceof Error ? err.message : STRINGS.refreshError,
        });
      } finally {
        setRefreshing(null);
      }
    },
    [refreshing],
  );

  const submitOtp = useCallback(
    async (code: string) => {
      if (otpSubmitting) return;
      setOtpSubmitting(true);
      setOtpError(null);
      try {
        await api.submitOtp(code);
        setOtpOpen(false);
        setAmazonOtpAvailable(false);
        if (otpTimeoutRef.current) {
          clearTimeout(otpTimeoutRef.current);
          otpTimeoutRef.current = null;
        }
        setStatus({ kind: "success", msg: STRINGS.otpSuccess });
      } catch (err) {
        setOtpError(err instanceof Error ? err.message : STRINGS.otpError);
      } finally {
        setOtpSubmitting(false);
      }
    },
    [otpSubmitting],
  );

  const closeOtp = useCallback(() => setOtpOpen(false), []);
  const openOtp = useCallback(() => {
    setOtpError(null);
    setOtpOpen(true);
  }, []);
  const dismissStatus = useCallback(() => setStatus(null), []);

  return {
    refreshing,
    status,
    otpOpen,
    otpSubmitting,
    otpError,
    refresh,
    submitOtp,
    closeOtp,
    dismissStatus,
    amazonOtpAvailable,
    openOtp,
  };
}
