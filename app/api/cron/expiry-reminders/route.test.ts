import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServiceRoleClient, sendExpiryReminder } = vi.hoisted(() => ({
  createServiceRoleClient: vi.fn(),
  sendExpiryReminder: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient }));
vi.mock("@/lib/email/send", () => ({ sendExpiryReminder }));

import { GET, maxDuration } from "./route";

const ROW = {
  id: "entitlement-1",
  user_id: "user-1",
  expires_at: "2026-07-24T06:00:00.000Z",
  reminder_claimed_at: null,
};

type HarnessOptions = {
  concurrentCandidates?: number;
  durableMark?: boolean;
};

function createHarness(options: HarnessOptions = {}) {
  const state = {
    claimedAt: null as string | null,
    reminded: false,
    releases: 0,
  };
  let candidatesWaiting = 0;
  let releaseCandidates: (() => void) | undefined;
  const candidateBarrier = options.concurrentCandidates
    ? new Promise<void>((resolve) => {
        releaseCandidates = resolve;
      })
    : Promise.resolve();

  class Query {
    private table: string;
    private payload: Record<string, unknown> | undefined;
    private selected = false;
    private filters = new Map<string, unknown>();

    constructor(table: string) {
      this.table = table;
    }

    select() {
      this.selected = true;
      return this;
    }

    update(payload: Record<string, unknown>) {
      this.payload = payload;
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters.set(column, value);
      return this;
    }

    is(column: string, value: unknown) {
      this.filters.set(column, value);
      return this;
    }

    or() {
      return this;
    }

    gte() {
      return this;
    }

    lte() {
      return this;
    }

    async maybeSingle() {
      if (this.table === "profiles") {
        return { data: { full_name: "Ada", preferred_lang: "en" }, error: null };
      }

      if (this.payload && "reminded_at" in this.payload) {
        if (options.durableMark === false || state.claimedAt !== this.filters.get("reminder_claimed_at")) {
          return { data: null, error: null };
        }
        state.reminded = true;
        state.claimedAt = null;
        return { data: { id: ROW.id }, error: null };
      }

      if (this.payload && typeof this.payload.reminder_claimed_at === "string") {
        if (state.reminded || state.claimedAt) return { data: null, error: null };
        state.claimedAt = this.payload.reminder_claimed_at;
        return { data: { id: ROW.id }, error: null };
      }

      throw new Error("Unexpected maybeSingle query");
    }

    private async execute() {
      if (!this.payload && this.selected && this.table === "entitlements") {
        if (options.concurrentCandidates) {
          candidatesWaiting++;
          if (candidatesWaiting === options.concurrentCandidates) releaseCandidates?.();
          await candidateBarrier;
        }
        return { data: state.reminded ? [] : [ROW], error: null };
      }

      if (this.payload?.reminder_claimed_at === null && !("reminded_at" in this.payload)) {
        if (state.claimedAt === this.filters.get("reminder_claimed_at")) state.claimedAt = null;
        state.releases++;
        return { data: null, error: null };
      }

      throw new Error("Unexpected awaited query");
    }

    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) {
      return this.execute().then(onfulfilled, onrejected);
    }
  }

  const client = {
    from: (table: string) => new Query(table),
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({
          data: { user: { email: "student@example.com" } },
          error: null,
        })),
      },
    },
  };

  return { client, state };
}

function request(secret = "test-cron-secret") {
  return new Request("https://cubad.test/api/cron/expiry-reminders", {
    headers: { Authorization: `Bearer ${secret}` },
  });
}

describe("/api/cron/expiry-reminders", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    createServiceRoleClient.mockReset();
    sendExpiryReminder.mockReset();
    sendExpiryReminder.mockResolvedValue({ ok: true, id: "email-1" });
  });

  it("fails closed when the cron secret is missing or incorrect", async () => {
    vi.stubEnv("CRON_SECRET", "");
    await expect(GET(request("undefined"))).resolves.toMatchObject({ status: 401 });
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    await expect(GET(request("wrong"))).resolves.toMatchObject({ status: 401 });
    expect(createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("allows only one lease and send across concurrent invocations", async () => {
    const harness = createHarness({ concurrentCandidates: 2 });
    createServiceRoleClient.mockReturnValue(harness.client);

    const responses = await Promise.all([GET(request()), GET(request())]);
    const bodies = await Promise.all(responses.map((response) => response.json()));

    expect(maxDuration).toBe(60);
    expect(bodies.reduce((sum, body) => sum + body.sent, 0)).toBe(1);
    expect(bodies.reduce((sum, body) => sum + body.skipped, 0)).toBe(1);
    expect(sendExpiryReminder).toHaveBeenCalledTimes(1);
    expect(sendExpiryReminder).toHaveBeenCalledWith(
      "student@example.com",
      expect.objectContaining({ subject: "Your access expires in 3 days" }),
      ROW.id
    );
    expect(harness.state).toMatchObject({ reminded: true, claimedAt: null });

    const rerun = await GET(request());
    await expect(rerun.json()).resolves.toEqual({ checked: 0, sent: 0, failed: 0, skipped: 0 });
  });

  it("releases the lease when the provider rejects the email", async () => {
    const harness = createHarness();
    createServiceRoleClient.mockReturnValue(harness.client);
    sendExpiryReminder.mockResolvedValue({ ok: false, error: "provider-failed" });

    const response = await GET(request());

    await expect(response.json()).resolves.toEqual({ checked: 1, sent: 0, failed: 1, skipped: 0 });
    expect(harness.state).toMatchObject({ reminded: false, claimedAt: null, releases: 1 });
  });

  it("does not count a send when the durable marker updates zero rows", async () => {
    const harness = createHarness({ durableMark: false });
    createServiceRoleClient.mockReturnValue(harness.client);

    const response = await GET(request());

    await expect(response.json()).resolves.toEqual({ checked: 1, sent: 0, failed: 1, skipped: 0 });
    expect(sendExpiryReminder).toHaveBeenCalledTimes(1);
    expect(harness.state.reminded).toBe(false);
    expect(harness.state.claimedAt).not.toBeNull();
  });
});
