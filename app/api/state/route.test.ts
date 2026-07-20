import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, from, checkRateLimit } = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser }, from }),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));

import { GET, POST } from "./route";

describe("/api/state", () => {
  beforeEach(() => {
    getUser.mockReset();
    from.mockReset();
    checkRateLimit.mockReset();
    checkRateLimit.mockResolvedValue(true);
  });

  it("rejects unauthenticated reads and writes", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    await expect(GET()).resolves.toMatchObject({ status: 401 });
    await expect(
      POST(new Request("https://cubad.test/api/state", { method: "POST", body: "{}" }))
    ).resolves.toMatchObject({ status: 401 });
    expect(from).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("returns 429 before parsing or writing when the progress bucket is full", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "owner-id" } } });
    checkRateLimit.mockResolvedValue(false);

    const response = await POST(
      new Request("https://cubad.test/api/state", {
        method: "POST",
        body: "not-json",
      })
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    await expect(response.json()).resolves.toEqual({ error: "rate-limited" });
    expect(checkRateLimit).toHaveBeenCalledWith({
      key: "progress:user:owner-id",
      max: 12,
      windowSeconds: 60,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("uses the authenticated user id instead of any client-supplied identity", async () => {
    const maybeSingle = vi.fn(async () => ({ data: { updated_at: "version-1" }, error: null }));
    const select = vi.fn(() => ({ maybeSingle }));
    const insert = vi.fn(() => ({ select }));
    getUser.mockResolvedValue({ data: { user: { id: "owner-id" } } });
    from.mockReturnValue({ insert });

    const response = await POST(
      new Request("https://cubad.test/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state: {
            user_id: "attacker-id",
            progress: { q: {}, quiz: {}, practice: {} },
            decks: {},
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(from).toHaveBeenCalledWith("user_state");
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "owner-id" }));
  });

  it("uses a reset-only forced write without accepting a client user id", async () => {
    const upsert = vi.fn(async () => ({ error: null }));
    getUser.mockResolvedValue({ data: { user: { id: "owner-id" } } });
    from.mockReturnValue({ upsert });

    const response = await POST(
      new Request("https://cubad.test/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: { user_id: "attacker-id" }, force: true }),
      })
    );

    expect(response.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "owner-id" }),
      { onConflict: "user_id" }
    );
  });

  it("returns the latest account state when a normal write loses its version race", async () => {
    const writeMaybeSingle = vi.fn(async () => ({ data: null, error: null }));
    const writeSelect = vi.fn(() => ({ maybeSingle: writeMaybeSingle }));
    const writeVersion = vi.fn(() => ({ select: writeSelect }));
    const writeUser = vi.fn(() => ({ eq: writeVersion }));
    const update = vi.fn(() => ({ eq: writeUser }));
    const readMaybeSingle = vi.fn(async () => ({
      data: { state: { progress: { q: { remote: { step: 2, done: true } } } }, updated_at: "v2" },
      error: null,
    }));
    const readUser = vi.fn(() => ({ maybeSingle: readMaybeSingle }));
    const select = vi.fn(() => ({ eq: readUser }));
    getUser.mockResolvedValue({ data: { user: { id: "owner-id" } } });
    from.mockReturnValueOnce({ update }).mockReturnValueOnce({ select });

    const response = await POST(
      new Request("https://cubad.test/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: { progress: {} }, base_updated_at: "v1" }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "conflict",
      state: { progress: { q: { remote: { step: 2, done: true } } } },
      updated_at: "v2",
    });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ state: { progress: {} } }));
    expect(writeVersion).toHaveBeenCalledWith("updated_at", "v1");
  });

  it("updates only the authenticated row when the supplied version matches", async () => {
    const maybeSingle = vi.fn(async () => ({ data: { updated_at: "v2" }, error: null }));
    const select = vi.fn(() => ({ maybeSingle }));
    const version = vi.fn(() => ({ select }));
    const owner = vi.fn(() => ({ eq: version }));
    const update = vi.fn(() => ({ eq: owner }));
    getUser.mockResolvedValue({ data: { user: { id: "owner-id" } } });
    from.mockReturnValue({ update });

    const response = await POST(
      new Request("https://cubad.test/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: { progress: {} }, base_updated_at: "v1" }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, updated_at: "v2" });
    expect(owner).toHaveBeenCalledWith("user_id", "owner-id");
    expect(version).toHaveBeenCalledWith("updated_at", "v1");
  });

  it("rejects malformed JSON before reaching the database", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "owner-id" } } });

    const response = await POST(
      new Request("https://cubad.test/api/state", { method: "POST", body: "not-json" })
    );

    expect(response.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });
});
