import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, from, select, limit } = vi.hoisted(() => ({
  createClient: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient }));

import { GET, dynamic } from "./route";

describe("/api/health", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-anon-key");
    createClient.mockReset();
    from.mockReset();
    select.mockReset();
    limit.mockReset();

    createClient.mockReturnValue({ from });
    from.mockReturnValue({ select });
    select.mockReturnValue({ limit });
  });

  it("checks the live public tracks table and reports success without returning row data", async () => {
    limit.mockResolvedValue({ data: [{ id: "not-exposed" }], error: null });

    const response = await GET();

    expect(dynamic).toBe("force-dynamic");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(createClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "public-anon-key",
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    expect(from).toHaveBeenCalledWith("tracks");
    expect(select).toHaveBeenCalledWith("id");
    expect(limit).toHaveBeenCalledWith(1);
  });

  it("returns a data-free 503 when Supabase rejects the query", async () => {
    limit.mockResolvedValue({ data: null, error: { message: "upstream unavailable" } });

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false });
  });
});
