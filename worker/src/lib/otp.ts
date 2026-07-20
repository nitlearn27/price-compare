import type { Settings } from "./config";
import { fetchWithTimeout } from "./http";

// "otp" keyword (word-bounded) followed by the first run of digits after it.
const OTP_PATTERN = /\botp\b\D*(\d+)/i;

/** Return the OTP code if the message contains the `otp` keyword + a number. */
export function extractOtp(text: string): string | null {
  const m = OTP_PATTERN.exec(text);
  return m ? m[1] : null;
}

/** POST the OTP to the configured endpoint. Throws if unconfigured or on HTTP error. */
export async function submitOtp(s: Settings, otp: string): Promise<void> {
  if (!s.otpApiUrl) throw new Error("No OTP endpoint is configured.");
  const resp = await fetchWithTimeout(
    s.otpApiUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ otp }),
    },
    15_000,
  );
  if (resp.status >= 400) throw new Error(`OTP submission failed: HTTP ${resp.status}`);
}
