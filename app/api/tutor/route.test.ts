import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, checkRateLimit } = vi.hoisted(() => ({
  getUser: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit,
  clientIp: () => "203.0.113.10",
}));

import { POST } from "./route";

function tutorRequest(extra: Record<string, unknown> = {}) {
  return new Request("https://cubad.test/api/tutor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", text: "hello" }],
      ...extra,
    }),
  });
}

describe("/api/tutor rate limiting", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("GEMINI_API_KEY", "server-test-key");
    vi.stubEnv("OPENAI_API_KEY", "");
    getUser.mockReset();
    checkRateLimit.mockReset();
  });

  it("returns the shared-key 429 contract at the per-user limit", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "student-1" } } });
    checkRateLimit.mockResolvedValue(false);
    const upstream = vi.spyOn(globalThis, "fetch");

    const response = await POST(tutorRequest());

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("3600");
    await expect(response.json()).resolves.toEqual({
      error: "rate-limited",
      retryAfterSeconds: 3_600,
    });
    expect(checkRateLimit).toHaveBeenCalledWith({
      key: "tutor:user:student-1",
      max: 20,
      windowSeconds: 3_600,
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("honors BYOK first and does not spend the shared-key bucket", async () => {
    checkRateLimit.mockResolvedValue(false);
    const upstream = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "BYOK response" }] } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const response = await POST(tutorRequest({ userKey: "user-test-key" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ text: "BYOK response" });
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
    expect(upstream).toHaveBeenCalledOnce();
    const upstreamUrl = String(upstream.mock.calls[0][0]);
    expect(upstreamUrl).toContain("key=user-test-key");
    expect(upstreamUrl).not.toContain("server-test-key");
  });

  it("rejects an empty request before charging the bucket", async () => {
    const response = await POST(tutorRequest({ messages: [] }));

    expect(response.status).toBe(400);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
  });

  it("forwards a valid BYOK image without charging the shared bucket", async () => {
    const upstream = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "Image explanation" }] } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const response = await POST(
      tutorRequest({
        userKey: "user-test-key",
        messages: [
          {
            role: "user",
            text: "Explain this",
            attachments: [
              {
                kind: "image",
                mimeType: "image/png",
                data: "aGVsbG8=",
                name: "diagram.png",
                size: 5,
              },
            ],
          },
        ],
      })
    );

    expect(response.status).toBe(200);
    expect(checkRateLimit).not.toHaveBeenCalled();
    const upstreamInit = upstream.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(String(upstreamInit.body)) as {
      contents: { parts: { inline_data?: { mime_type: string; data: string } }[] }[];
    };
    expect(payload.contents[0].parts[0]).toEqual({
      inline_data: { mime_type: "image/png", data: "aGVsbG8=" },
    });
  });

  it("rejects an invalid attachment before the limiter or provider", async () => {
    const upstream = vi.spyOn(globalThis, "fetch");

    const response = await POST(
      tutorRequest({
        messages: [
          {
            role: "user",
            text: "Explain this",
            attachments: [
              { kind: "image", mimeType: "image/svg+xml", data: "not-base64" },
            ],
          },
        ],
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid-attachment" });
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
  });
});
