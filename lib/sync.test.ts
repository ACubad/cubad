import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();

vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({ auth: { getSession } }),
}));

import { syncNow } from "./sync";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("syncNow", () => {
  beforeEach(() => {
    getSession.mockReset();
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("window", {
      localStorage: new MemoryStorage(),
      dispatchEvent: vi.fn(),
    });
  });

  it("does not make a cross-device request without an authenticated account", async () => {
    getSession.mockResolvedValue({ data: { session: null } });

    await expect(syncNow()).resolves.toEqual({ ok: false, mergedFromRemote: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("pulls and pushes only the authenticated account state endpoint", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } } });
    window.localStorage.setItem(
      "cubad:progress:v2",
      JSON.stringify({ q: { "hidroloji/q1": { step: 3, done: false } }, quiz: {}, practice: {} })
    );
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          state: {
            progress: { q: { "hidroloji/q1": { step: 1, done: true } }, quiz: {}, practice: {} },
            decks: {},
          },
        }),
      } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);

    await expect(syncNow()).resolves.toEqual({ ok: true, mergedFromRemote: true });

    expect(fetch).toHaveBeenNthCalledWith(1, "/api/state", { method: "GET" });
    expect(fetch).toHaveBeenNthCalledWith(2, "/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state: {
          progress: { q: { "hidroloji/q1": { step: 3, done: true } }, quiz: {}, practice: {} },
          decks: {},
          chats: {},
        },
      }),
    });
  });
});
