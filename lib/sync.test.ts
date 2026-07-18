import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();

vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({ auth: { getSession } }),
}));

import { clearSignedOutStudyState, resetProgress, SYNC_ACCOUNT_KEY, syncNow } from "./sync";

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

  removeItem(key: string) {
    this.values.delete(key);
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

  it("removes an account projection, including legacy progress, on sign-out", async () => {
    window.localStorage.setItem(SYNC_ACCOUNT_KEY, "user-a");
    window.localStorage.setItem("cubad:progress:v2", JSON.stringify({ q: { a: {} } }));
    window.localStorage.setItem("cubad:progress:v1", JSON.stringify({ q: { old: {} } }));
    window.localStorage.setItem("cubad:cards:hidroloji:unit", JSON.stringify({}));
    window.localStorage.setItem("cubad:chats:topic", JSON.stringify({}));

    await clearSignedOutStudyState();

    expect(window.localStorage.getItem(SYNC_ACCOUNT_KEY)).toBeNull();
    expect(window.localStorage.getItem("cubad:progress:v2")).toBeNull();
    expect(window.localStorage.getItem("cubad:progress:v1")).toBeNull();
    expect(window.localStorage.getItem("cubad:cards:hidroloji:unit")).toBeNull();
    expect(window.localStorage.getItem("cubad:chats:topic")).toBeNull();
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
          updated_at: "2026-07-18T12:00:00.000Z",
          state: {
            progress: { q: { "hidroloji/q1": { step: 1, done: true } }, quiz: {}, practice: {} },
            decks: {},
          },
        }),
      } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);

    await expect(syncNow()).resolves.toEqual({ ok: true, mergedFromRemote: true });

    expect(window.localStorage.getItem(SYNC_ACCOUNT_KEY)).toBe("user-1");

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
        base_updated_at: "2026-07-18T12:00:00.000Z",
      }),
    });
  });

  it("clears a different account's local state before loading the signed-in account", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "user-b" } } } });
    window.localStorage.setItem(SYNC_ACCOUNT_KEY, "user-a");
    window.localStorage.setItem(
      "cubad:progress:v2",
      JSON.stringify({ q: { "hidroloji/a-only": { step: 4, done: true } }, quiz: {}, practice: {} })
    );
    window.localStorage.setItem("cubad:cards:hidroloji:old", JSON.stringify({ old: { box: 3, last: 1 } }));
    window.localStorage.setItem(
      "cubad:chats:old-topic",
      JSON.stringify({ convos: [{ id: "old", createdAt: 1, messages: [] }], activeId: "old" })
    );
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          state: {
            progress: { q: { "hidroloji/b-only": { step: 2, done: false } }, quiz: {}, practice: {} },
            decks: {},
            chats: {},
          },
        }),
      } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);

    await expect(syncNow()).resolves.toEqual({ ok: true, mergedFromRemote: true });

    expect(window.localStorage.getItem(SYNC_ACCOUNT_KEY)).toBe("user-b");
    expect(JSON.parse(window.localStorage.getItem("cubad:progress:v2") ?? "{}"))
      .toEqual({ q: { "hidroloji/b-only": { step: 2, done: false } }, quiz: {}, practice: {} });
    expect(window.localStorage.getItem("cubad:cards:hidroloji:old")).toBeNull();
    expect(window.localStorage.getItem("cubad:chats:old-topic")).toBeNull();
  });

  it("does not push when the authenticated account changes during a pull", async () => {
    getSession
      .mockResolvedValueOnce({ data: { session: { user: { id: "user-a" } } } })
      .mockResolvedValueOnce({ data: { session: { user: { id: "user-b" } } } });
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ state: null }) } as Response);

    await expect(syncNow()).resolves.toEqual({ ok: false, mergedFromRemote: false });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/state", { method: "GET" });
  });

  it("merges a concurrent device conflict and retries against its newer version", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } } });
    window.localStorage.setItem(
      "cubad:progress:v2",
      JSON.stringify({ q: { "hidroloji/local": { step: 3, done: false } }, quiz: {}, practice: {} })
    );
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          updated_at: "2026-07-18T12:00:00.000Z",
          state: {
            progress: { q: { "hidroloji/first": { step: 1, done: true } }, quiz: {}, practice: {} },
            decks: {},
            chats: {},
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          state: {
            progress: { q: { "hidroloji/second": { step: 2, done: true } }, quiz: {}, practice: {} },
            decks: {},
            chats: {},
          },
          updated_at: "2026-07-18T12:00:01.000Z",
        }),
      } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);

    await expect(syncNow()).resolves.toEqual({ ok: true, mergedFromRemote: true });

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenNthCalledWith(2, "/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: expect.stringContaining('"base_updated_at":"2026-07-18T12:00:00.000Z"'),
    });
    const retry = JSON.parse((vi.mocked(fetch).mock.calls[2][1] as RequestInit).body as string);
    expect(retry.base_updated_at).toBe("2026-07-18T12:00:01.000Z");
    expect(retry.state.progress.q).toEqual({
      "hidroloji/first": { step: 1, done: true },
      "hidroloji/local": { step: 3, done: false },
      "hidroloji/second": { step: 2, done: true },
    });
  });

  it("serializes a reset after an automatic sync so old state cannot be re-written last", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } } });
    window.localStorage.setItem(
      "cubad:progress:v2",
      JSON.stringify({ q: { "hidroloji/q1": { step: 3, done: true } }, quiz: {}, practice: {} })
    );
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: null }) } as Response)
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);

    await Promise.all([syncNow(), resetProgress()]);

    const writes = vi.mocked(fetch).mock.calls.filter(
      ([url, init]) => url === "/api/state" && (init as RequestInit | undefined)?.method === "POST"
    );
    expect(writes).toHaveLength(2);
    expect((writes[1][1] as RequestInit).body).toBe(
      JSON.stringify({
        state: { progress: { q: {}, quiz: {}, practice: {} }, decks: {}, chats: {} },
        force: true,
      })
    );
  });

  it("does not force-reset a different account after an auth switch", async () => {
    getSession
      .mockResolvedValueOnce({ data: { session: { user: { id: "user-a" } } } })
      .mockResolvedValueOnce({ data: { session: { user: { id: "user-b" } } } });
    window.localStorage.setItem(
      "cubad:progress:v2",
      JSON.stringify({ q: { "hidroloji/q1": { step: 3, done: true } }, quiz: {}, practice: {} })
    );

    await expect(resetProgress()).resolves.toBe(false);

    expect(fetch).not.toHaveBeenCalled();
  });
});
