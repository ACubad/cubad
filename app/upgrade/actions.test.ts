import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, from, createServiceRoleClient, checkRateLimit } = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  createServiceRoleClient: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/email/send", () => ({ sendAdminNewClaim: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser }, from }),
  createServiceRoleClient,
}));

import { submitClaim } from "./actions";

function validClaimForm() {
  const data = new FormData();
  data.set("tierId", "11111111-1111-4111-8111-111111111111");
  data.set("method", "mpesa");
  data.set("payerRef", "SFC8KL29XY");
  data.set("amount", "15000");
  data.set("currency", "TZS");
  data.set(
    "proof",
    new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "proof.png", {
      type: "image/png",
    })
  );
  return data;
}

describe("submitClaim rate limiting", () => {
  beforeEach(() => {
    getUser.mockReset();
    from.mockReset();
    createServiceRoleClient.mockReset();
    checkRateLimit.mockReset();
  });

  it("returns the action-state denial before claim or storage writes", async () => {
    const maybeSingle = vi.fn(async () => ({
      data: { id: "11111111-1111-4111-8111-111111111111", title: { en: "Term" } },
      error: null,
    }));
    const status = vi.fn(() => ({ maybeSingle }));
    const id = vi.fn(() => ({ eq: status }));
    const select = vi.fn(() => ({ eq: id }));

    getUser.mockResolvedValue({ data: { user: { id: "student-1", email: "student@example.test" } } });
    from.mockReturnValueOnce({ select });
    checkRateLimit.mockResolvedValue(false);

    await expect(submitClaim({}, validClaimForm())).resolves.toEqual({ error: "rate-limited" });
    expect(checkRateLimit).toHaveBeenCalledWith({
      key: "claims:user:student-1",
      max: 10,
      windowSeconds: 86_400,
    });
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("tiers");
    expect(createServiceRoleClient).not.toHaveBeenCalled();
  });
});
