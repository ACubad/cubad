import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServiceRoleClient } = vi.hoisted(() => ({
  createServiceRoleClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient }));

import { sendExpiryReminder } from "./send";

describe("sendExpiryReminder", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "test-resend-key");
    vi.stubEnv("EMAIL_FROM", "cubad <hello@example.com>");
    createServiceRoleClient.mockReset();
  });

  it("uses a stable entitlement idempotency key on the Resend REST request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "email-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendExpiryReminder(
        "student@example.com",
        { subject: "Expiry", html: "<p>Expiry</p>", text: "Expiry" },
        "entitlement-123"
      )
    ).resolves.toEqual({ ok: true, id: "email-1" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Idempotency-Key": "entitlement-expiry/entitlement-123",
        }),
      })
    );
  });
});
