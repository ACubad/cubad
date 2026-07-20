import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, from, getUnit } = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  getUnit: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser }, from }),
  createServiceRoleClient: () => ({ storage: { from: vi.fn() } }),
  isServiceRoleConfigured: () => false,
}));

vi.mock("@/lib/content-db", () => ({ getUnit }));

import { GET, POST } from "./route";

function profileRole(role: "student" | "admin") {
  const maybeSingle = vi.fn(async () => ({ data: { role }, error: null }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  from.mockReturnValue({ select });
}

describe("/api/podcast authorization", () => {
  beforeEach(() => {
    getUser.mockReset();
    from.mockReset();
    getUnit.mockReset();
  });

  it("reports public playback as non-generating for an anonymous visitor", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const response = await GET(new Request("https://cubad.test/api/podcast"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ canGenerate: false, tr: null, en: null });
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects an anonymous generation request before reading content or storage", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const response = await POST(
      new Request("https://cubad.test/api/podcast", {
        method: "POST",
        body: JSON.stringify({ subject: "hidroloji", unitSlug: "giris", lang: "tr", force: true }),
      })
    );

    expect(response.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
    expect(getUnit).not.toHaveBeenCalled();
  });

  it("rejects a signed-in student even when they submit a legacy user key and force flag", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "student-id" } } });
    profileRole("student");

    const response = await POST(
      new Request("https://cubad.test/api/podcast", {
        method: "POST",
        body: JSON.stringify({
          subject: "hidroloji",
          unitSlug: "giris",
          lang: "tr",
          userKey: "attacker-supplied-key",
          force: true,
        }),
      })
    );

    expect(response.status).toBe(403);
    expect(getUnit).not.toHaveBeenCalled();
  });
});
