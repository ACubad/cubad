import { afterEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => ({ rpc }),
}));

import { checkRateLimit, clientIp } from "@/lib/rate-limit";

afterEach(() => {
  vi.restoreAllMocks();
  rpc.mockReset();
});

describe("checkRateLimit", () => {
  it("uses the service-role RPC contract and returns its boolean", async () => {
    rpc.mockResolvedValue({ data: false, error: null });

    await expect(
      checkRateLimit({ key: "progress:user-1", max: 12, windowSeconds: 60 })
    ).resolves.toBe(false);
    expect(rpc).toHaveBeenCalledWith("check_rate_limit", {
      p_key: "progress:user-1",
      p_max: 12,
      p_window: "60 seconds",
    });
  });

  it.each([
    [{ data: null, error: { message: "unavailable" } }, "RPC error"],
    [{ data: "true", error: null }, "malformed result"],
  ])("fails open for %s", async (result, message) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpc.mockResolvedValue(result);

    await expect(
      checkRateLimit({ key: "claims:user-1", max: 10, windowSeconds: 86_400 })
    ).resolves.toBe(true);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(message),
      expect.objectContaining({ namespace: "claims" })
    );
  });

  it("fails open when client creation or RPC execution throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpc.mockRejectedValue(new Error("network"));

    await expect(
      checkRateLimit({ key: "tutor:user-1", max: 20, windowSeconds: 3_600 })
    ).resolves.toBe(true);
    expect(console.error).toHaveBeenCalledWith(
      "checkRateLimit exception",
      expect.objectContaining({ namespace: "tutor" })
    );
  });
});

describe("clientIp", () => {
  it("prefers Vercel's forwarded address and takes the first hop", () => {
    const request = new Request("https://cubad.test", {
      headers: {
        "x-vercel-forwarded-for": "203.0.113.4, 10.0.0.1",
        "x-forwarded-for": "198.51.100.9",
      },
    });
    expect(clientIp(request)).toBe("203.0.113.4");
  });

  it("falls back through proxy headers and then to unknown", () => {
    expect(
      clientIp(
        new Request("https://cubad.test", {
          headers: { "x-real-ip": "198.51.100.8" },
        })
      )
    ).toBe("198.51.100.8");
    expect(clientIp(new Request("https://cubad.test"))).toBe("unknown");
  });
});
