import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useRefresh } from "../../src/hooks/useRefresh";

function okResponse(body: unknown = { detail: "ok" }) {
  return new Response(JSON.stringify(body), { status: 200 });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("useRefresh", () => {
  it("starts idle", () => {
    const { result } = renderHook(() => useRefresh());
    expect(result.current.refreshing).toBeNull();
    expect(result.current.status).toBeNull();
    expect(result.current.otpOpen).toBe(false);
  });

  it("flipkart refresh sets success status and does NOT open the OTP modal", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse());
    const { result } = renderHook(() => useRefresh());

    await act(async () => {
      await result.current.refresh("flipkart");
    });

    expect(result.current.status?.kind).toBe("success");
    expect(result.current.otpOpen).toBe(false);
    expect(result.current.refreshing).toBeNull();
  });

  it("amazon refresh makes OTP available on success, and calling openOtp opens the OTP modal", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse());
    const { result } = renderHook(() => useRefresh());

    await act(async () => {
      await result.current.refresh("amazon");
    });

    expect(result.current.amazonOtpAvailable).toBe(true);
    expect(result.current.otpOpen).toBe(false);
    expect(result.current.status?.kind).toBe("success");

    act(() => {
      result.current.openOtp();
    });
    expect(result.current.otpOpen).toBe(true);
  });

  it("sets an error status when refresh fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "nope" }), { status: 502 }),
    );
    const { result } = renderHook(() => useRefresh());

    await act(async () => {
      await result.current.refresh("amazon");
    });

    expect(result.current.status?.kind).toBe("error");
    expect(result.current.otpOpen).toBe(false);
    expect(result.current.amazonOtpAvailable).toBe(false);
  });

  it("submitOtp closes the modal on success", async () => {
    // Fresh Response per call — a Response body can only be read once.
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(okResponse()));
    const { result } = renderHook(() => useRefresh());

    await act(async () => {
      await result.current.refresh("amazon");
    });
    expect(result.current.amazonOtpAvailable).toBe(true);
    expect(result.current.otpOpen).toBe(false);

    act(() => {
      result.current.openOtp();
    });
    expect(result.current.otpOpen).toBe(true);

    await act(async () => {
      await result.current.submitOtp("600939");
    });

    expect(result.current.otpOpen).toBe(false);
    expect(result.current.amazonOtpAvailable).toBe(false);
    expect(result.current.otpError).toBeNull();
    // The entered code is forwarded to /api/otp.
    const lastCall = fetchMock.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe("/api/otp");
    expect(String((lastCall?.[1] as RequestInit).body)).toContain("600939");
  });

  it("submitOtp surfaces an error and keeps the modal open", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "bad code" }), { status: 502 }),
      );
    const { result } = renderHook(() => useRefresh());

    await act(async () => {
      await result.current.refresh("amazon");
    });

    act(() => {
      result.current.openOtp();
    });
    expect(result.current.otpOpen).toBe(true);

    await act(async () => {
      await result.current.submitOtp("000000");
    });

    expect(result.current.otpOpen).toBe(true);
    expect(result.current.otpError).toBe("bad code");
  });

  it("reverts amazonOtpAvailable to false after 3 minutes", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse());
    const { result } = renderHook(() => useRefresh());

    await act(async () => {
      await result.current.refresh("amazon");
    });

    expect(result.current.amazonOtpAvailable).toBe(true);

    act(() => {
      vi.advanceTimersByTime(3 * 60 * 1000);
    });

    expect(result.current.amazonOtpAvailable).toBe(false);
    vi.useRealTimers();
  });
});
