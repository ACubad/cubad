# Phase 7 — Hardening, Monitoring, Scale, Launch

> **For agentic workers:** Read `00-MASTER-PLAN.md` FULLY before touching this file — §3 (locked
> decisions), §4 (data model — column names are LAW), §8 (definition of done), §9 (security
> invariants), §10 (traps) govern everything below. This document assumes Phases 1–6 are
> **fully delivered**: dedicated Supabase project, auth, DB-backed content, catalog/tiers/access
> codes, admin dashboard, manual payments — the full feature set is live in production. Phase 7
> adds no product features; it makes the product survive contact with real users and gives the
> solo operator (no dedicated ops team) the tools to run it safely.

**Goal:** rate limits on every abusable surface, a runnable security-probe battery, monitoring
you'll actually look at, backups you've actually restored once, indexes for the queries that
matter, a load test proving the free/hobby tier holds 50 concurrent users, an optional
expiry-reminder email, ops runbooks for the incidents most likely to happen, and a launch
checklist that takes the domain from `cubad.vercel.app` to a real product.

**Architecture (recap, unchanged by this phase):** Next.js 16 (App Router, Vercel Hobby/free
tier) + dedicated Supabase project `cubad-app` (Postgres + Auth + Storage + RLS,
`eu-central-1`). All Supabase access goes through `lib/supabase/server.ts` /
`lib/supabase/browser.ts` (D15). Money/access paths are SQL, SECURITY DEFINER, row-locked (D8,
D9, §10). Every user-facing string is bilingual (`Bi = {tr, en}`) via `lib/i18n.tsx`.

**Tech stack (additions this phase):** k6 (load testing, external binary, not an npm dep) ·
`@sentry/nextjs` (OPTIONAL) · Vercel Web Analytics + Speed Insights (`@vercel/analytics`,
`@vercel/speed-insights`) · GitHub Actions (backup cron) · Supabase `pg_cron` extension
(rate-limit housekeeping) · Resend (unchanged, now also used for expiry reminders).

---

## Prerequisites

- **Depends on:** Phase 6 (`06-payments-v1.md`) shipped and merged to `main`. Nothing in Phases
  1–6 is reopened here except adding rate-limit guards to existing mutation transports + one
  optional column.
- **Branch:** `feat/phase-7-hardening-scale`, PR into `main` at the end (§8.7).
- **Required reading:** `00-MASTER-PLAN.md` (all of it, esp. §4/§9/§10) · `AGENTS.md` (Next 16
  differs from training data — check `node_modules/next/dist/docs/` before writing any route
  handler, health/cron route, or `robots.ts`/`sitemap.ts` below) ·
  `app/api/tutor/route.ts`, `app/api/podcast/route.ts`, `app/api/state/route.ts` (existing Route
  Handlers) · `app/upgrade/actions.ts`, `app/admin/payments/actions.ts` (Phase 6 Server Actions;
  there is no `/api/claims`) · `lib/sync.ts` (the `SyncState` shape `{progress, decks, chats?}`
  that `user_state.state` holds, D3) · `lib/email/send.ts` and `lib/email/templates.ts` (Phase 6's
  Resend REST transport; no `resend` npm dependency) · `package.json` (current deps).

### Verified continuation contracts (audited against merged Phases 1–6 on 2026-07-20)

| Contract | Basis | If a future change differs |
|---|---|---|
| `lib/supabase/server.ts` exports `async createClient()` — cookie-bound, RLS-enforced (standard `@supabase/ssr` App Router pattern) | D2, D15 | `grep -n export lib/supabase/server.ts`, fix imports below |
| Same file also exports `createServiceRoleClient()` — service-role, bypasses RLS | D15 | same grep; Task 7.2 must reuse it rather than creating a raw Supabase client |
| Phase 2's server-progress endpoint is `app/api/state/route.ts` (`/api/state`, POST), not a Server Action | master §14 contract registry | if reality differs, apply the same 3-line guard right after the user check wherever the `user_state` write lives |
| The unauthenticated passcode `/api/sync` route was retired and deleted in Phase 3; production must continue returning 404 there | Phase 3/4 handoffs + current route tree | Task 7.3 is a non-regression assertion; do not recreate or monitor the retired route |
| Phase 6 claim submission is the `submitClaim` Server Action in `app/upgrade/actions.ts`; there is no `/api/claims` | merged Phase 6 + master §14 | Task 7.7 returns `{ error: "rate-limited" }` and adds bilingual UI copy; do not create a duplicate API route |
| Phase 6 created `public.app_settings`; its final public policy allow-lists only `payment_instructions`, and an older `app_settings_write_admin` policy may remain inert behind revoked mutation grants | migrations `20260719205635`, `20260719215500` | Task 7.30 extends the public allow-list in a NEW migration and drops the inert historical write policy |
| `NEXT_PUBLIC_APP_URL` is set in Vercel Production, Development, and project-wide Preview; local presence depends on the fresh worktree's ignored `.env.local` | verified Phase 6 closeout | confirm scope with `vercel env ls`; never infer encrypted values from `vercel env pull` |

---

## A. Rate limiting

### Task 7.1 — Migration: `rate_limit_events` + `check_rate_limit()` + cleanup

**Why:** every limiter below needs one shared, atomic, server-side counter — a JS "check then
write" counter is exactly the race §10 warns about. One Postgres function, every call site
shares it.

- [ ] `supabase migration new rate_limiting` from `cubad/`.
- [ ] Contents:

```sql
-- Fixed-window rate limiter shared by every server-side code path. No client
-- role (anon/authenticated) ever touches this table directly — ALL access
-- goes through the SECURITY DEFINER functions below.

create table if not exists public.rate_limit_events (
  id         bigint generated always as identity primary key,
  key        text not null,
  created_at timestamptz not null default now()
);

create index if not exists rate_limit_events_key_time_idx
  on public.rate_limit_events (key, created_at);

alter table public.rate_limit_events enable row level security;
-- Zero policies is intentional: RLS with no policies denies all client
-- access outright. Do not add policies here.
revoke all on public.rate_limit_events from anon, authenticated;

create or replace function public.check_rate_limit(
  p_key text, p_max int, p_window interval
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_count int;
begin
  if p_key is null or length(p_key) = 0 then
    raise exception 'check_rate_limit: p_key is required';
  end if;
  if p_max <= 0 then
    raise exception 'check_rate_limit: p_max must be positive';
  end if;

  -- Serializes concurrent calls for the SAME key so a simultaneous burst
  -- can't all read the same count before any of them inserts (the
  -- check-then-write race, §10). Different keys never block each other.
  perform pg_advisory_xact_lock(hashtextextended(p_key, 0));

  delete from public.rate_limit_events
   where key = p_key and created_at < now() - p_window;

  select count(*) into v_count from public.rate_limit_events
   where key = p_key and created_at >= now() - p_window;

  if v_count >= p_max then
    return false;
  end if;

  insert into public.rate_limit_events (key, created_at) values (p_key, now());
  return true;
end;
$$;

-- Never expose an arbitrary-key limiter RPC to clients: a malicious user could otherwise fill
-- another user's bucket and deny them service. Every call goes through server code.
revoke all on function public.check_rate_limit(text, int, interval)
  from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, int, interval) to service_role;

-- Nightly full sweep. Keeps 2 days of history (longer than any window used
-- today) so "who got rate-limited last night?" is answerable the next day.
create or replace function public.cleanup_rate_limit_events()
returns void language sql security definer set search_path = ''
as $$
  delete from public.rate_limit_events where created_at < now() - interval '2 days';
$$;

revoke all on function public.cleanup_rate_limit_events()
  from public, anon, authenticated;
grant execute on function public.cleanup_rate_limit_events() to service_role;

-- pg_cron is available on all Supabase plans incl. free; enable it under
-- Database → Extensions first if `create extension` alone doesn't stick.
create extension if not exists pg_cron;

select cron.schedule(
  'cleanup-rate-limit-events',
  '17 3 * * *',
  $$select public.cleanup_rate_limit_events();$$
);
```

- [ ] `supabase db reset` locally (§8.5), then push to the real project.
- [ ] Verify: `select * from cron.job where jobname = 'cleanup-rate-limit-events';` → one row,
      `active = true`.
- [ ] Commit: `git add supabase/migrations/*_rate_limiting.sql && git commit -m "feat(phase7): rate_limit_events table + check_rate_limit RPC + nightly cleanup"`

**Verify:** `select check_rate_limit('smoke', 2, interval '1 min');` → `true, true, false` on 3
successive calls; `select count(*) from rate_limit_events where key='smoke';` → `2` (the denied
call inserted nothing). Clean up the row after.

**Failure modes:** `hashtextextended` missing → Postgres <12 (never happens on hosted Supabase).
`pg_cron` unavailable → clean up manually monthly, or fold into the backup Action (Task 7.15) as
an extra `psql -c` step. Under extreme same-key concurrency the advisory lock serializes calls —
correct, but not a distributed-systems-grade limiter; fine for abuse throttling at this scale.

---

### Task 7.2 — `lib/rate-limit.ts` server helper

- [ ] If `server-only` isn't in `package.json`, `npm install server-only`.
- [ ] Create `lib/rate-limit.ts`:

```ts
import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";

export interface RateLimitOptions {
  /** Server-built bucket key, e.g. `tutor:user:<uuid>` or `claims:user:<uuid>`. */
  key: string;
  max: number;
  windowSeconds: number;
}

/**
 * True if under the limit (and records this call). Fails OPEN on any DB
 * error — a limiter outage must never take the product down. Money/access
 * paths keep their own independent hard checks regardless of this helper.
 */
export async function checkRateLimit({
  key, max, windowSeconds,
}: RateLimitOptions): Promise<boolean> {
  try {
    // Task 7.1 grants this arbitrary-key RPC only to service_role. Exposing it to clients would
    // let an attacker fill another user's bucket and create a denial of service.
    const rateLimitClient = createServiceRoleClient();
    const { data, error } = await rateLimitClient.rpc("check_rate_limit", {
      p_key: key, p_max: max, p_window: `${windowSeconds} seconds`,
    });
    if (error) {
      console.error("checkRateLimit RPC error", { namespace: key.split(":")[0], error: error.message });
      return true; // fail open
    }
    if (typeof data !== "boolean") {
      console.error("checkRateLimit malformed result", { namespace: key.split(":")[0] });
      return true; // fail open on a contract mismatch too
    }
    return data;
  } catch (e) {
    console.error("checkRateLimit exception", { namespace: key.split(":")[0], error: e });
    return true; // fail open
  }
}

/** Best-effort fallback bucket for an unauthenticated tutor request on Vercel. */
export function clientIp(request: Request): string {
  const forwarded =
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for") ??
    request.headers.get("x-real-ip");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}
```

- [ ] Commit: `git commit -am "feat(phase7): lib/rate-limit.ts shared limiter helper"`

**Verify:** `npm run build` compiles clean. Temporarily add `app/api/_debug-ratelimit/route.ts`
calling `checkRateLimit({key:'debug', max:2, windowSeconds:30})`, hit it 3x → `true, true,
false`, then delete the throwaway route.

**Failure modes:** missing server Supabase variables in Vercel Production/Preview throws at first
call and fails open. A typo'd RPC/argument name returns an error or malformed result and also fails
open; keep `p_key`/`p_max`/`p_window` byte-identical to Task 7.1. Never downgrade this helper to an
anon/authenticated client or grant client EXECUTE on `check_rate_limit`. Vercel currently supplies
`x-vercel-forwarded-for` as its proxy-safe client-IP header; re-check the official request-header
docs if the hosting/proxy topology changes.

---

### Task 7.3 — Preserve the retired `/api/sync` boundary

**Why:** Phase 3 removed unauthenticated passcode sync after migrating legacy data. Recreating the
old route would restore an obsolete anonymous attack surface and split progress synchronization
away from the authenticated `/api/state` contract.

- [ ] Confirm `app/api/sync/route.ts` does not exist and `rg -n 'api/sync' app lib components`
      finds no runtime fetch or link.
- [ ] Confirm local and Production `GET /api/sync` and `POST /api/sync` return `404`.
- [ ] Do not add a limiter, monitor, health check, or compatibility shim for this retired path.
      The legacy Sprout data-retention decision remains the separate Task 7.27.
- [ ] No code or commit is expected for this task unless the assertion fails; if it fails, remove
      the regression and document why it existed before continuing.

**Verify:** the application uses only authenticated `GET/POST /api/state` via `lib/sync.ts`.

**Failure modes:** an old planning note is not evidence that a route is live. The Phase 3 and
Phase 4 handoffs plus the current route tree are authoritative.

---

### Task 7.4 — Apply to tutor server-key path (per-user 20/hour; BYOK exempt)

**Why:** Phase 6 currently computes `envKey || body.userKey`, so a configured shared key silently
wins even when the student supplied BYOK. Phase 7's intended "BYOK exempt" contract requires an
explicit BYOK-first correction: a non-empty user key spends the user's provider quota; otherwise
the shared server key is limited.

- [ ] Open `app/api/tutor/route.ts`. Add:

```ts
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
```

- [ ] Find:

```ts
  const provider: Provider = body.provider === "openai" ? "openai" : "gemini";
  const envKey = provider === "openai" ? process.env.OPENAI_API_KEY : process.env.GEMINI_API_KEY;
  const key = envKey || body.userKey;
  if (!key) return Response.json({ error: "no-key" }, { status: 401 });
```

  Replace with:

```ts
  const provider: Provider = body.provider === "openai" ? "openai" : "gemini";
  const envKey = provider === "openai" ? process.env.OPENAI_API_KEY : process.env.GEMINI_API_KEY;
  const userKey = typeof body.userKey === "string" ? body.userKey.trim() : "";
  const key = userKey || envKey;
  if (!key) return Response.json({ error: "no-key" }, { status: 401 });

  const rawModel = (body.model ?? "").trim();
  const model = /^[a-zA-Z0-9._/-]{1,64}$/.test(rawModel) ? rawModel : DEFAULT_MODELS[provider];
  const messages = (body.messages ?? []).slice(-16);
  if (messages.length === 0) return Response.json({ error: "empty" }, { status: 400 });
  body.messages = messages;

  // Rate-limit only the shared server key; an explicitly supplied BYOK key spends its own quota.
  const usingServerKey = !userKey && Boolean(envKey);
  if (usingServerKey) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    // Study pages require login (Master §6); the IP fallback is defense in depth.
    const rlKey = user ? `tutor:user:${user.id}` : `tutor:ip:${clientIp(request)}`;
    const allowed = await checkRateLimit({ key: rlKey, max: 20, windowSeconds: 3600 });
    if (!allowed) {
      return Response.json(
        {
          error: "rate-limited",
          retryAfterSeconds: 3600,
        },
        { status: 429, headers: { "Retry-After": "3600" } }
      );
    }
}
```

- [ ] Remove the original duplicate `rawModel`/`model`/`messages` validation block below the new
      guard; it was moved up so malformed/empty requests do not consume a rate-limit event.
- [ ] In `components/TutorPanel.tsx`, extend the parsed response shape with
      `retryAfterSeconds?: number` and handle `data.error === "rate-limited"` before the generic
      error. Show bilingual copy: Turkish "Paylaşılan eğitmen saatlik sınırına ulaştı. Bir saat
      sonra tekrar dene veya kendi API anahtarını kullan." / English "The shared tutor reached
      its hourly limit. Try again in an hour or use your own API key." Do not clear a saved BYOK
      key for this error.

- [ ] Add route/client tests covering server-key 429, BYOK-first exemption, and bilingual client
      handling. Commit: `git commit -am "feat(phase7): rate-limit shared tutor key and honor BYOK-first"`

**Verify:** see Task 7.8.

**Failure modes:** do not restore `envKey || body.userKey`; it makes the BYOK exemption and the
client's recovery instruction false. `supabase.auth.getUser()` round-trips to Supabase Auth —
check this first if tutor p95 latency misbehaves under load (Task 7.23). Never log either key.

---

### Task 7.5 — Apply to progress-save endpoint (per-user 12/min)

**Why 12/min:** covers legitimate rapid-fire autosave bursts (quiz answers) while stopping a
buggy client loop or scripted abuse.

- [ ] Locate the file (`ls app/api | grep -i state`; master §14 registers it as
      `app/api/state/route.ts` (`/api/state`) — if reality differs, apply the identical guard
      right after the auth check wherever the `user_state` write lives).
- [ ] Add: `import { checkRateLimit } from "@/lib/rate-limit";`
- [ ] Find the point right after the auth check (expected Phase 2 shape):

```ts
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
```

  Insert immediately after, before any body parsing/writing:

```ts

  const allowed = await checkRateLimit({
    key: `progress:user:${user.id}`, max: 12, windowSeconds: 60,
  });
  if (!allowed) {
    return Response.json(
      { error: "rate-limited" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }
```

- [ ] Commit: `git commit -am "feat(phase7): rate-limit progress save to 12 req/min per user"`

**Verify:** see Task 7.8.

**Failure modes:** guard only `POST`; `GET /api/state` must stay unlimited or the
pull-before-push union-merge flow (`lib/sync.ts`) breaks. Do not use the retired `/api/sync`
implementation as a template.

---

### Task 7.6 — Auth pages: verify + document Supabase built-in rate limits

**Why:** Supabase Auth already rate-limits sign-ups/sign-ins/OTP/email/token-refresh — don't
reimplement it, just confirm it's sane and document what "sane" means so it isn't disabled by
accident later.

- [ ] Dashboard → Authentication → Rate Limits (labels may shift between releases — search for
      these concepts if relabeled). Confirm/set:

| Setting | Recommended | Why |
|---|---|---|
| Email sending (sign-up/reset/magic-link) | 30/hour+ once custom SMTP (D2) is wired | Supabase's built-in SMTP quota (~2/hr) is no longer the bottleneck |
| Sign-ups/sign-ins per IP/hour | leave default | stops scripted account floods |
| Token refresh | leave default | generous enough for normal multi-tab use |
| OTP/verification requests | leave default | unused today (no SMS auth, D2) |
| Anonymous sign-ins | **disabled** | app never uses Supabase anonymous auth |
| Unused SSO/Web3 providers | **disabled** | every enabled method is surface area |

- [ ] Write the confirmed values into `docs/ops/runbooks.md` (Task 7.25). No separate commit —
      lands with that task's commit.

**Verify:** 10 rapid disposable sign-ups from one IP (scratch project only) get rejected before
your account list fills with junk; `curl -X POST "$SUPABASE_URL/auth/v1/signup" -d '{}'` doesn't
silently create an anonymous session.

**Failure modes:** these dashboard settings are NOT captured by `supabase db reset` or version
control — re-check after any restore/new-project event, since a fresh project reverts to
Supabase defaults.

---

### Task 7.7 — Apply to claim submission (per-user 10 creates/day)

**Why:** stacks on Phase 6's "max 3 open claims" business rule (queue hygiene) — this stops a
scripted burst of claim creation regardless of how many stay "open."

- [ ] Open the actual Phase 6 transport: `app/upgrade/actions.ts`. There is no `/api/claims`.
- [ ] Add: `import { checkRateLimit } from "@/lib/rate-limit";`
- [ ] In `submitClaim`, insert the guard after authentication and the existing file/tier
      validation, but BEFORE the friendly "max 3 open claims" count and before any claim/storage
      write. This avoids charging malformed browser submissions while still stopping create spam:

```ts

  const allowed = await checkRateLimit({
    key: `claims:user:${user.id}`, max: 10, windowSeconds: 60 * 60 * 24,
  });
  if (!allowed) {
    return { error: "rate-limited" };
  }
```

- [ ] Add `rate-limited` to `ClaimForm.tsx`'s `ERRORS` map with Turkish and English copy. This is
      a Server Action state, so it intentionally does not create an HTTP 429 response or a parallel
      API route.

- [ ] Commit: `git commit -am "feat(phase7): rate-limit claim submission to 10 creates/day per user"`

**Verify:** see Task 7.8.

**Failure modes:** do not create `/api/claims` to satisfy the older plan wording; that would split
one money path across two transports. The three-open-claim trigger remains the authoritative
concurrency-safe business rule; this daily limiter is only an abuse ceiling.

---

### Task 7.8 — Rate-limit probes (route 429s + claim-action denial)

**Why:** all active limiters are authenticated. Pre-seeding each server-built bucket and making
one real call proves the exact boundary without burning 20 real Gemini calls or creating ten
payment claims. Run against local or a disposable Preview, never against Production.

- [ ] Run in the SQL editor (get a disposable real test-user id first:
      `select id from auth.users where email = 'you@test.cubad.dev';`):

```sql
-- Pre-seed a bucket to exactly its limit, make ONE real call through the app,
-- confirm the transport-specific denial, then clean up.

-- tutor: 20/hour
insert into public.rate_limit_events (key, created_at)
select 'tutor:user:<uid>', now() from generate_series(1, 20);
-- curl -X POST http://localhost:3000/api/tutor -H "Content-Type: application/json" \
--   -H "Cookie: <captured session cookie, see Task 7.23>" \
--   -d '{"messages":[{"role":"user","text":"hi"}]}'
-- expect 429, Retry-After: 3600, {"error":"rate-limited","retryAfterSeconds":3600}
delete from public.rate_limit_events where key = 'tutor:user:<uid>';

-- progress save: 12/min
insert into public.rate_limit_events (key, created_at)
select 'progress:user:<uid>', now() from generate_series(1, 12);
-- curl -X POST http://localhost:3000/api/state ... -> expect 429
delete from public.rate_limit_events where key = 'progress:user:<uid>';

-- claim submission: 10/day
insert into public.rate_limit_events (key, created_at)
select 'claims:user:<uid>', now() from generate_series(1, 10);
-- In a real browser/Playwright session for <uid>, submit the existing Phase 6 claim form.
-- Expect the localized rate-limited action-state error, with no payment_claims row or proof
-- object created. There is intentionally no /api/claims curl target.
delete from public.rate_limit_events where key = 'claims:user:<uid>';
```

- [ ] Record the exact results and cleanup confirmation in `docs/ops/runbooks.md` (Task 7.25).
      No standalone script or commit is required here.

**Verify:** `/api/tutor` and `/api/state` return `429` at the pre-seeded limit. The claim Server
Action returns the localized `rate-limited` state before any DB/storage mutation. After cleanup,
the same keys are allowed again (not permanently sticky), and every disposable user/claim/object
is removed.

**Failure modes:** a pre-seed probe still returning 200 usually means a key mismatch — log the
actual `key` the transport computes and diff it byte-for-byte against what was seeded. Never run
these stateful probes against Production.

---

## B. Security audit battery

### Task 7.9 — `supabase/tests/security-probes.md`

**Why:** every negative-path check from Phases 2/4/6 (RLS, storage, RPC) plus this phase's own
audits (service-key grep, env leak audit, anon-key capability walk, advisors) belong in ONE
runnable checklist, so the pre-launch re-run (Task 7.30) is one document, not an archaeology dig.

- [ ] Create `supabase/tests/security-probes.md`:

```markdown
# Security probe battery

Run before every deploy touching RLS/storage/RPCs, and in full for Task 7.30's pre-launch
re-run. Uses ONLY the anon key + test-user JWTs — never the service role key (it bypasses RLS
by design; testing with it proves nothing about what real users can do).

## 0. Setup

\`\`\`bash
export SUPABASE_URL="https://<ref>.supabase.co"
export ANON_KEY="<anon/publishable key>"
\`\`\`

Create three throwaway accounts via the normal sign-up flow (never insert into `auth.users`
directly): `STUDENT_A` (no entitlements), `STUDENT_B` (no entitlements), `ADMIN` (promoted per
D11). Get each access token:

\`\`\`bash
curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \\
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \\
  -d '{"email":"studentA@test.cubad.dev","password":"<test password>"}' | jq -r .access_token
\`\`\`

Save as `USER_A_JWT`/`USER_B_JWT`/`ADMIN_JWT`. Grant `STUDENT_A` one entitlement (admin
dashboard, or a direct insert in a scratch project — never production) so entitled-vs-not probes
have both cases.

## 1. Service-role key grep audit

\`\`\`bash
grep -rn "SERVICE_ROLE" app/ components/ lib/ --include="*.ts*"
\`\`\`
Expected: the only match is `lib/supabase/server.ts` (and, if it exists,
`app/api/cron/expiry-reminders/route.ts` importing the *client*, never the raw env var). Any
other hit = STOP, do not ship — move the usage into `lib/supabase/server.ts`.

## 2. `NEXT_PUBLIC_` leak audit

\`\`\`bash
grep -rhoE "NEXT_PUBLIC_[A-Z0-9_]+" --include="*.ts*" app lib components | sort -u
\`\`\`
Confirm every printed name is in this table (update it when a new one is intentionally added):

| Var | Safe? | Why |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | project URL isn't secret |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | designed to be public — RLS is the real gate |
| `NEXT_PUBLIC_APP_URL` | yes | absolute links in email/sitemap/robots |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | yes | human-approved public contact rendered on `/privacy` (Task 7.29) |

Any name NOT in this table is a new leak surface — rename it off `NEXT_PUBLIC_` if it shouldn't
be client-visible, then re-run the grep.

## 3. Anon-key capability walk (zero session)

\`\`\`bash
for table in tracks subjects units track_subjects tiers app_settings entitlements access_codes \\
             code_redemptions redemption_attempts payment_claims admin_audit_log \\
             profiles user_state legacy_sync rate_limit_events; do
  echo "== $table =="
  curl -s "$SUPABASE_URL/rest/v1/$table?select=*&limit=5" \\
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"; echo
done
\`\`\`
- `tracks`/`subjects` → only `status='published'` rows.
- `units` → check the `content` field closely. **Invariant under test:** an anonymous request
  must NEVER receive full `content` for a non-`is_free` unit, regardless of the mechanism Phase
  3/4 used to gate it (row policy / security-barrier view / RPC). `is_free=true` content IS
  expected visible.
- `track_subjects`/`tiers` → published-only.
- `app_settings` → only explicitly public keys: `payment_instructions` before Task 7.30; exactly
  `payment_instructions` and `announcement_banner` afterward. Seed a private sentinel key with the
  service role and prove anon/authenticated cannot read it, then remove it.
- Every other table → **must return `[]`** with no session. Any row here is a hole.

## 4. Authenticated cross-account probes (`STUDENT_A` targeting `STUDENT_B`)

With `-H "Authorization: Bearer $USER_A_JWT"`:
- `profiles?user_id=eq.<B>`, `user_state?user_id=eq.<B>`, `entitlements?user_id=eq.<B>`,
  `payment_claims?user_id=eq.<B>`, `code_redemptions?user_id=eq.<B>` → all `[]`. Same queries for
  A's own id → visible.
- `admin_audit_log?select=*` as `STUDENT_A` → `[]` (admin only, no exceptions).
- `PATCH payment_claims?id=eq.<A's own pending claim>` body `{"status":"approved"}` → rejected
  (only `approve_claim()` RPC, admin-gated, can do this).
- direct `insert` into `access_codes` as `STUDENT_A` → rejected (redemption is RPC-only).
- `has_subject_access(<not entitled>)` → `false`; `has_subject_access(<entitled>)` → `true`.
- Unit content fetch: entitled subject → content returned; non-entitled non-free subject →
  content withheld (same invariant as step 3, now under a real session).

## 5. Storage probes

- `podcasts` bucket, anon GET known path → `200` (public read intended).
- `podcasts` bucket, anon or `STUDENT_A` upload → `401`/`403` (service-role write only, closes
  the sprout hole).
- `payment-proofs`, `STUDENT_A` GET `<STUDENT_B>/<claim>/<file>` → fail.
- `payment-proofs`, `STUDENT_A` upload under `<STUDENT_B>`'s prefix → fail (RLS enforces
  `auth.uid()` prefix server-side — never trust a client path column, §9).
- `payment-proofs`, `ADMIN` GET any user's path → succeeds.

## 6. RPC edge-case probes

- `redeem_code('GARBAGE')` → `{ok:false, error:'invalid-code'}`.
- Same valid code redeemed twice by the same user → `already-redeemed`.
- Past `valid_until` → `expired`. At `max_redemptions` for a new user → `exhausted`.
- 6th attempt within an hour (5 already in `redemption_attempts`) → `rate-limited`.
- `approve_claim(...)` called by non-admin `STUDENT_A` → rejected.
- `approve_claim(...)` called twice by `ADMIN` on the same claim → 2nd call mints nothing extra
  (idempotency guard).
- `check_rate_limit(...)` and `cleanup_rate_limit_events()` as anon or either student JWT →
  permission denied; only server-side service-role calls may choose bucket keys.
- `set_app_setting(...)` as anon, student, or admin JWT → permission denied; the admin UI reaches
  it only through a server action using the service role, and the RPC independently validates the
  actor UUID.

## 7. Supabase advisors

Run security AND performance advisors (MCP or dashboard). Expected: zero `ERROR`-level security
findings.

| Finding | Expected here? | Action |
|---|---|---|
| "RLS enabled, no policy" on `rate_limit_events` | Yes, by design | none |
| "Function has mutable search_path" | Should be zero (every SECURITY DEFINER has an explicit safe path, normally `''`) | add a safe path to the offending function |
| "Unindexed foreign key" | cross-check Task 7.17's hot-query list | add the index if it's a hot path, else note and move on |
| "Table has RLS disabled" | should be zero | STOP — direct §9 violation |
| "Leaked password protection disabled" | should be enabled | enable in Auth → Policies |
| "Sequential scan on large table" | cross-check Task 7.17 | add the matching index |

Record the run date + outcome in `docs/ops/runbooks.md`.
```

- [ ] Commit: `git add supabase/tests/security-probes.md && git commit -m "test(phase7): consolidated security probe battery (RLS, storage, RPC, advisors)"`

**Verify:** every checkbox above run once against the real project, results noted inline
(`— OK <date>` / `— FAILED: <what>`) — this is a living checklist, not a read-only doc.

**Failure modes:** this battery was reconciled against the merged Phase 2/4/6 migrations and
handoffs on 2026-07-20. If later code changes a contract, update both the probe and the owning
handoff in the same PR; never weaken a denial merely to make a stale expectation pass. Never
assert "expect N rows" for a large table without `Prefer: count=exact` (§9's "never count
client-side").

---

## C. Monitoring

### Task 7.10 — Vercel Web Analytics + Speed Insights

- [ ] `npm install @vercel/analytics @vercel/speed-insights`
- [ ] In `app/layout.tsx`, inside the root `<body>`:

```tsx
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
// ...
<Analytics />
<SpeedInsights />
```

- [ ] Vercel dashboard → Analytics tab → enable (free tier 2,500 events/mo). Speed Insights tab
      → enable.
- [ ] Commit: `git commit -am "feat(phase7): enable Vercel Web Analytics + Speed Insights"`

**Verify:** deploy, browse a few pages, confirm events/Core Web Vitals appear within minutes.

**Failure modes:** import from the `/next` subpaths shown above (App Router specific), not the
base package, or `next build` may complain about the client/server boundary.

---

### Task 7.11 — Supabase log drains runbook (symptom → log → search)

- [ ] Add to `docs/ops/runbooks.md` (Task 7.25):

| Symptom | Which log | What to search |
|---|---|---|
| Sign-up/login broken | **Auth Logs** | `error_code`: `email_exists`, `invalid_credentials`, `over_email_send_rate_limit` |
| Route 500-ing | **API/Edge Logs** + Vercel function logs | filter by path, status `>=500`, cross-reference timestamp |
| Slow query | **Postgres Logs** + Query Performance tab | `duration:` lines >~200ms; ranked by `pg_stat_statements` |
| Storage upload/download failing | **API Logs**, path `/storage/v1/` | `403` (policy) vs `413` (size) vs `5xx` |
| RPC unexpected error | **Postgres Logs** | search the function name — `raise exception` text appears verbatim |
| Rate limiter seems wrong | SQL editor | `select * from rate_limit_events where key='<key>' order by created_at desc limit 20;` |
| Cron didn't run | **Postgres Logs**, `cron` | `select * from cron.job_run_details order by start_time desc limit 20;` |

**Verify:** open each named log tab once, confirm it exists under that name in your dashboard.

**Failure modes:** free-tier log retention is short (~1-7 days) — copy anything you need into
incident notes immediately.

---

### Task 7.12 — OPTIONAL: Sentry error tracking

**Optional — skip for initial launch if time is short.** Every route already `console.error`s on
its catch block, captured by Vercel's own function logs (Task 7.11). Add Sentry once log-grepping
by hand gets too slow.

- [ ] `npx @sentry/wizard@latest -i nextjs` (generates client/server/edge configs, wraps
      `next.config.ts`).
- [ ] In each config: `Sentry.init({ dsn: "<DSN>", tracesSampleRate: 0.1, /* ... */ });`
- [ ] In `withSentryConfig(...)` options, set `tunnelRoute: "/monitoring"` — proxies Sentry
      ingest through your own domain so ad-blockers (which commonly block `*.sentry.io`) don't
      silently drop error reports.
- [ ] Add `SENTRY_AUTH_TOKEN` to Vercel env vars per the wizard.
- [ ] Commit: `git commit -am "feat(phase7): OPTIONAL Sentry error tracking, 10% sample rate, ad-blocker tunnel"`

**Verify:** trigger a deliberate error, confirm it appears in Sentry within a minute; confirm
Network tab requests go to `/monitoring`, not `ingest.sentry.io`.

**Failure modes:** wrong `SENTRY_AUTH_TOKEN` scope → minified stack traces (source maps didn't
upload). Sentry billing is separate from Vercel/Supabase — check its free event quota.

---

### Task 7.13 — Uptime checks (UptimeRobot / Cron-job.org, free tier)

- [ ] Add `app/api/health/route.ts`. It must make one cheap anonymous SELECT against the existing
      public `tracks` table, return `{"ok":true}` only when Supabase responds successfully, return
      `{"ok":false}` with `503` on a query error, expose no row data/counts, and be
      `dynamic = "force-dynamic"` so the monitor exercises the live dependency rather than cache.
- [ ] Add a route test for the success and upstream-failure cases; never use the service role for
      this public health check.
- [ ] Sign up with `ADMIN_NOTIFY_EMAIL`.
- [ ] Monitor 1: HTTP(s), URL = production home page, expect `200`, 5 min interval.
- [ ] Monitor 2: **Keyword** monitor, URL = `/api/health`, keyword `"ok":true`, 5 min interval
      (a live Supabase connectivity check without reviving the retired `/api/sync`).
- [ ] Alert contact = `ADMIN_NOTIFY_EMAIL` for both. No commit (external config) — note both URLs
      in `docs/ops/runbooks.md`.
- [ ] Commit the route and test: `git add app/api/health && git commit -m "feat(phase7): add minimal Supabase health endpoint"`.

**Verify:** pause/break the target briefly, confirm an alert email arrives within the interval.

**Failure modes:** free tier = up to ~5 min undetected downtime before first alert; fine
pre-revenue, revisit later (Pro = 1 min intervals).

---

## D. Backups

### Task 7.14 — Document backup tiers + Pro upgrade decision point

- [ ] Add to `docs/ops/runbooks.md`:

```markdown
## Backups

**Supabase automated backups:** Free tier — 1 daily backup, retained 1 day. Pro tier ($25/mo
base) — 7 daily backups + optional PITR (restore to any second in the retention window).

**Upgrade to Pro when EITHER is true:**
1. More than 0 paying users (first claim approved, entitlement live) — real money means real
   recovery expectations.
2. DAU exceeds 50 (check via `admin_audit_log` growth or a `user_state.updated_at` distinct-day
   count) — losing a day of everyone's progress on a free-tier outage becomes a real cost.

Manual dashboard action (Settings → Billing), no code change. Belt-and-braces: the GitHub Action
below (Task 7.15) gives an independent nightly copy from day one, regardless of Supabase's plan.
```

- [ ] No separate commit — lands with Task 7.25.

**Verify:** current plan tier in Supabase Billing matches what's documented.

**Failure modes:** "DAU > 50" needs an actual query, not vibes — see Task 7.25 for the SQL if
the admin KPIs (Phase 5) don't already surface it.

---

### Task 7.15 — `.github/workflows/backup.yml`

- [ ] Get the **direct** (port `5432`, session-mode — NOT the `6543` transaction pooler,
      `pg_dump` needs session-level features) connection string from Supabase → Settings →
      Database → Connection string. Add as GitHub secret `SUPABASE_DB_URL`.
- [ ] Create `.github/workflows/backup.yml`:

```yaml
name: Nightly database backup

on:
  schedule:
    - cron: "17 2 * * *"    # 02:17 UTC — off-peak for both Turkey and East Africa
  workflow_dispatch: {}

jobs:
  backup:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Install postgresql-client
        run: sudo apt-get update && sudo apt-get install -y postgresql-client

      - name: Dump database
        env:
          SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}
        run: |
          set -euo pipefail
          STAMP=$(date -u +%Y%m%d-%H%M%S)
          echo "DUMP_STAMP=$STAMP" >> "$GITHUB_ENV"
          # Raw pg_dump: fewest moving parts in CI, no Supabase CLI login
          # needed. (Alternative: `npx supabase db dump --db-url
          # "$SUPABASE_DB_URL" -f cubad-backup-$STAMP.sql` — equivalent.)
          pg_dump "$SUPABASE_DB_URL" --no-owner --no-privileges --format=plain \
            --file="cubad-backup-$STAMP.sql"
          gzip "cubad-backup-$STAMP.sql"

      - name: Upload backup artifact
        uses: actions/upload-artifact@v4
        with:
          name: cubad-backup-${{ env.DUMP_STAMP }}
          path: cubad-backup-${{ env.DUMP_STAMP }}.sql.gz
          retention-days: 14

      # OPTIONAL off-GitHub copy. Uncomment once RCLONE_CONFIG_BASE64 (base64
      # of an rclone.conf with a Drive remote "gdrive") is added as a secret.
      # - name: Install rclone
      #   run: curl https://rclone.org/install.sh | sudo bash
      # - name: Configure rclone
      #   run: |
      #     mkdir -p ~/.config/rclone
      #     echo "${{ secrets.RCLONE_CONFIG_BASE64 }}" | base64 -d > ~/.config/rclone/rclone.conf
      # - name: Copy to Google Drive
      #   run: rclone copy "cubad-backup-${{ env.DUMP_STAMP }}.sql.gz" gdrive:cubad-backups/
```

- [ ] Commit: `git add .github/workflows/backup.yml && git commit -m "ci(phase7): nightly pg_dump backup to a 14-day GitHub Actions artifact"`
- [ ] Trigger once manually (Actions → this workflow → Run workflow) before trusting the schedule.

**Verify:** manual run succeeds; artifact downloads, non-empty, `gunzip -t` reports no errors.

**Failure modes:** using port `6543` instead of `5432` is the #1 setup mistake (`pg_dump` fails
on unsupported statements). If `SUPABASE_DB_URL`'s password ever rotates, update the GitHub
secret too or backups silently fail — check the Actions run history periodically.

---

### Task 7.16 — Restore drill runbook

- [ ] Add to `docs/ops/runbooks.md`:

```markdown
## Restore drill (run once now, and after any real incident)

1. Download the latest artifact: GitHub → Actions → "Nightly database backup" → latest run →
   Artifacts (or `gh run download <run-id>`).
2. `gunzip cubad-backup-<stamp>.sql.gz`.
3. Create a **scratch** Supabase project (never restore into production/dev) — delete it when done.
4. Get its direct connection string (same port-5432 caveat as Task 7.15).
5. `psql "$SCRATCH_DB_URL" -f cubad-backup-<stamp>.sql`
6. Verify counts against the same query run on production:

\`\`\`sql
select 'subjects' as t, count(*) from public.subjects
union all select 'units', count(*) from public.units
union all select 'profiles', count(*) from public.profiles
union all select 'entitlements', count(*) from public.entitlements
order by t;
\`\`\`

7. Spot-check one `units.content` row renders sensibly (not truncated/corrupted).
8. Delete the scratch project.
9. Record the drill date + outcome below.

**Drill log:** (empty — fill in after each drill)
```

- [ ] No separate commit — lands with Task 7.25. Actually run the drill now, not just document it.

**Verify:** restore completes without SQL errors; row counts match production at backup time
(or "close enough given elapsed time" — no table suspiciously empty).

**Failure modes:** `create extension` errors during restore if the scratch project lacks
`pgcrypto`/`pg_cron` pre-enabled — enable them first (Database → Extensions) or strip those
lines from the dump.

---

## E. Performance

### Task 7.17 — DB query/index audit + missing-index migration + aggregate hygiene

**Hot queries, cross-checked against Master §4's existing indexes:**

| Hot query | Existing index | Verdict |
|---|---|---|
| Unit content by `(subject_id, slug)` | `unique(subject_id, slug)` | covered |
| `user_state` by PK | PK | covered |
| Entitlements by `user_id` (every gated page load) | `entitlements_user_active(user_id, expires_at) where revoked_at is null` | covered |
| Claims queue by status+recency | `payment_claims_queue(status, created_at)` | covered |
| Admin audit log by recency | none beyond `id` PK | **missing** |
| Published units for a subject (`subject_id=X, status='published'`) | only the `(subject_id, slug)`/`(subject_id, unit_number)` uniques | **missing composite** |
| Tracks carrying a subject (reverse of `track_subjects`'s `(track_id, subject_id)` PK) | none | **missing** |
| A user's redemption history | none beyond `(code_id, user_id)` unique | **missing** |

- [ ] `supabase migration new perf_indexes`:

```sql
-- Small tables at this stage (hundreds-to-low-thousands of rows) — plain
-- `create index` (brief write lock) is fine. Switch to `create index
-- concurrently` by hand (SQL editor, autocommit, outside this transactional
-- migration) if a table grows large before this runs.

create index if not exists admin_audit_log_created_at_idx
  on public.admin_audit_log (created_at desc);

create index if not exists units_subject_status_idx
  on public.units (subject_id, status);

create index if not exists track_subjects_subject_idx
  on public.track_subjects (subject_id);

create index if not exists code_redemptions_user_idx
  on public.code_redemptions (user_id);
```

- [ ] `supabase db reset` locally, then apply. Commit:
      `git add supabase/migrations/*_perf_indexes.sql && git commit -m "perf(phase7): add indexes for audit log recency, unit status, track reverse lookup, redemption history"`
- [ ] **Aggregate hygiene** (Master §9: gating/KPI aggregates run IN SQL, never JS `.reduce()`
      over fetched rows — PostgREST caps at 1000 rows and silently truncates):
      `grep -rn "\.reduce(\|\.length\b" app/admin --include="*.ts*"` — for every hit, confirm
      it's operating on an already-scoped, already-paginated result for display, not computing a
      total that should be a SQL `count(*)`/`sum(...)`/RPC. Fix any real violation as a small
      scoped change and note it in the Changelog.

**Verify:** `explain analyze select * from admin_audit_log order by created_at desc limit 50;`
shows an Index Scan (repeat for the other 3 indexes). Every KPI number in `/admin` traced to a
SQL aggregate.

**Failure modes:** `explain analyze` on a tiny table may still show a seq scan (correct planner
behavior below a page or two of rows) — not a bug, re-check at realistic row counts. A silent
undercount that loosens an access decision is a security bug per §9, not just cosmetic — treat
access/money hits as high priority.

---

### Task 7.18 — Next.js bundle + image/asset audit

- [ ] `npm run build` from `cubad/`, read the Route table (`○`=static, `●`=SSG,
      `ƒ`=dynamic; "First Load JS" = client JS incl. shared chunks). Normal for this app: a
      shared baseline (~100-150KB gzipped for React 19 + Next 16) plus heavier deltas on
      `react-markdown`/`rehype-katex` routes (unit/walkthrough pages) — expected, not a
      regression. Flag: any route jumping >~50KB with no matching feature added, or any route
      >~300KB First Load JS.
- [ ] Optional deeper dive only if something looks wrong: `npm install -D @next/bundle-analyzer`,
      wrap `next.config.ts` with `require('@next/bundle-analyzer')({enabled: process.env.ANALYZE
      === 'true'})(...)`, run `ANALYZE=true npm run build` for a treemap. No permanent dependency
      unless kept.
- [ ] Image/asset confirmation (no changes expected): podcast files still serve from the new
      project's public `podcasts` bucket (D4); `katex/dist/katex.min.css`'s `.woff2` fonts still
      load `200`/`304` (Network tab on a unit page with math), not `404`.

**Verify:** full `npm run build` output saved once as the pre-launch baseline; both asset checks
pass on a fresh page load.

**Failure modes:** Next 16's build-output format may differ from the description above — check
`node_modules/next/dist/docs/` (per `AGENTS.md`) before assuming something's broken. If either
asset check fails, file it as its own small fix task rather than silently patching inside this
audit.

---

## F. Load testing (k6)

### Task 7.19 — Install k6, scaffold `scripts/load/`

- [ ] Install k6 (`winget install k6` / `brew install k6` / see
      [k6.io/docs/get-started/installation](https://k6.io/docs/get-started/installation)) — a
      standalone binary, not an npm dependency.
- [ ] Create `scripts/load/`. Add to `.gitignore`: `scripts/load/.session-cookie` (holds a real
      captured session cookie — never commit it).
- [ ] Document the cookie-capture method once, in `scripts/load/README-session.txt`:

```text
How to get a session cookie for the k6 authenticated scenarios (B and C):

1. Create/reuse a disposable test student account via normal sign-up; confirm email.
2. Log in through a real browser at $BASE_URL/auth/sign-in.
3. DevTools -> Application -> Cookies -> copy every cookie starting "sb-" (may be
   2+ if chunked). Format: "sb-<ref>-auth-token=<value>; sb-<ref>-auth-token.0=<value>; ..."
4. Save into scripts/load/.session-cookie (gitignored).
5. This is a real, live session. Supabase access tokens expire (~1hr default);
   a captured cookie used by a script does NOT get refreshed like a real
   browser session does. For runs longer than ~1hr, re-capture before the run.
```

- [ ] Commit: `git add .gitignore scripts/load/README-session.txt && git commit -m "chore(phase7): scaffold scripts/load/ for k6 load tests"`

**Verify:** `k6 version` prints a version.

**Failure modes:** if `.session-cookie` is ever accidentally committed, treat the test account's
session as compromised — sign it out everywhere (Supabase Dashboard → Auth → Users → "Sign out
of all sessions") and re-capture.

---

### Task 7.20 — Scenario A: anonymous browse (50 VUs, 2 min)

- [ ] Create `scripts/load/scenario-a-anonymous-browse.js`:

```js
import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "https://cubad.vercel.app";

export const options = {
  scenarios: {
    anonymous_browse: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 50 },
        { duration: "60s", target: 50 },
        { duration: "30s", target: 0 },
      ],
    },
  },
  thresholds: {
    "http_req_duration{route:home}": ["p(95)<500"],
    "http_req_duration{route:subject}": ["p(95)<500"],
    "http_req_duration{route:free_unit}": ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
  },
};

export default function () {
  const home = http.get(`${BASE_URL}/`, { tags: { route: "home" } });
  check(home, { "home 200": (r) => r.status === 200 });
  sleep(1);

  const subject = http.get(`${BASE_URL}/s/hidroloji`, { tags: { route: "subject" } });
  check(subject, { "subject 200": (r) => r.status === 200 });
  sleep(1);

  // "giris" is a real published unit slug. Anonymous visitors receive the public preview-choice
  // or paywall shell with HTTP 200; this scenario measures that route, not protected unit content.
  const unit = http.get(`${BASE_URL}/s/hidroloji/unit/giris`, { tags: { route: "free_unit" } });
  check(unit, { "free unit 200": (r) => r.status === 200 });
  sleep(2);
}
```

- [ ] Commit: `git add scripts/load/scenario-a-anonymous-browse.js && git commit -m "test(phase7): k6 scenario A - anonymous browse, 50 VUs"`

**Verify/failure modes:** run in Task 7.23 alongside the others. If Phase 6 walled off even
catalog browsing (Master §6 "any study surface → sign-up wall" could have been widened),
confirm `/` and `/s/hidroloji` are still meant to be public before treating a redirect as a
failure.

---

### Task 7.21 — Scenario B: authed study loop

**Practical approach:** capture ONE real session cookie (Task 7.19's README) and replay it as a
header on plain GETs — no attempt to script the login flow itself in k6. This load-tests page
rendering under the entitlement-check + caching model (D12), which is the actual scale concern.

- [ ] Create `scripts/load/scenario-b-authed-study.js`:

```js
import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "https://cubad.vercel.app";
const SESSION_COOKIE = __ENV.SESSION_COOKIE; // see scripts/load/README-session.txt

export const options = {
  scenarios: {
    authed_study_loop: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 50 },
        { duration: "60s", target: 50 },
        { duration: "30s", target: 0 },
      ],
    },
  },
  thresholds: {
    // Looser than Scenario A: entitlement check (D12) adds latency on top
    // of the shared content cache — some extra cost here is expected.
    http_req_duration: ["p(95)<800"],
    http_req_failed: ["rate<0.01"],
  },
};

export default function () {
  if (!SESSION_COOKIE) throw new Error("Set -e SESSION_COOKIE=... (see README-session.txt)");
  const headers = { Cookie: SESSION_COOKIE };

  const account = http.get(`${BASE_URL}/account`, { headers });
  check(account, { "account 200": (r) => r.status === 200 });
  sleep(1);

  const unit = http.get(`${BASE_URL}/s/hidroloji/unit/giris`, { headers });
  check(unit, { "unit 200": (r) => r.status === 200 });
  sleep(2);
}
```

- [ ] Commit: `git add scripts/load/scenario-b-authed-study.js && git commit -m "test(phase7): k6 scenario B - authed study loop, 50 VUs, captured session cookie"`

**Verify:** run in Task 7.23.

**Failure modes:** all 50 VUs share ONE account's cookie — under-represents per-user diversity
but does stress the real concern (shared connection pool + content cache under concurrency);
provisioning 5-10 rotating test accounts is a future enhancement, not required to pass. The
captured session expires mid-run for long tests — `401`/redirects partway through means
re-capture, not an app bug.

---

### Task 7.22 — Scenario C: progress-save hammering (verifies the 12/min limiter)

- [ ] Create `scripts/load/scenario-c-progress-save.js`:

```js
import http from "k6/http";
import { sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "https://cubad.vercel.app";
const SESSION_COOKIE = __ENV.SESSION_COOKIE;

export const options = { vus: 1, iterations: 15 }; // one user hammering its OWN limit

export default function () {
  if (!SESSION_COOKIE) throw new Error("Set -e SESSION_COOKIE=... (see README-session.txt)");
  const headers = { "Content-Type": "application/json", Cookie: SESSION_COOKIE };

  // Use a disposable test account only. GET supplies the compare-and-swap token required by the
  // real /api/state contract; never overwrite a real student's progress for a load probe.
  const pulled = http.get(`${BASE_URL}/api/state`, { headers });
  if (pulled.status !== 200) {
    console.log(`pull -> ${pulled.status}`);
    return;
  }
  const remote = pulled.json();
  const res = http.post(
    `${BASE_URL}/api/state`,
    JSON.stringify({
      state: remote.state ?? { progress: { q: {}, quiz: {}, practice: {} }, decks: {}, chats: {} },
      base_updated_at: remote.updated_at,
    }),
    { headers }
  );
  console.log(`iteration -> ${res.status}`);
  sleep(1); // ~1 req/sec => 15 requests inside one 60s window
}
```

- [ ] Before the run, delete prior `progress:user:<uid>` rate-limit rows for the disposable account
      and confirm its current `/api/state` GET returns 200. Run from Bash:
      `k6 run -e BASE_URL=https://cubad.vercel.app -e SESSION_COOKIE="$(cat scripts/load/.session-cookie)" scripts/load/scenario-c-progress-save.js`.
      PowerShell equivalent:
      `$sessionCookie = Get-Content -Raw scripts/load/.session-cookie; k6 run -e BASE_URL=https://cubad.vercel.app -e SESSION_COOKIE=$sessionCookie scripts/load/scenario-c-progress-save.js`.
- [ ] Expected: iterations 1-12 print `200`, 13-15 print `429` (±1 for window-boundary jitter).
- [ ] Commit: `git add scripts/load/scenario-c-progress-save.js && git commit -m "test(phase7): k6 scenario C - progress save hammer, confirms 12/min limiter engages"`

**Verify:** console shows the 200→429 transition around request 12/13.

**Failure modes:** the old illustrative body `{progress,decks}` is invalid and returns `400`
because the real route requires a top-level `state` plus compare-and-swap `base_updated_at` for an
existing row. Vercel request queueing can shift the exact transition point by one — assert that
429s START appearing, not the exact iteration number. Delete the disposable account/state and its
rate-limit rows after all scenarios.

---

### Task 7.23 — Run all scenarios, pass criteria, failure diagnosis

- [ ] Run against the deployed Vercel URL (Hobby tier), never `localhost` (no cold starts/real
      latency/concurrency limits locally, so pass/fail there is meaningless):

```bash
k6 run -e BASE_URL=https://cubad.vercel.app scripts/load/scenario-a-anonymous-browse.js
k6 run -e BASE_URL=https://cubad.vercel.app -e SESSION_COOKIE="$(cat scripts/load/.session-cookie)" scripts/load/scenario-b-authed-study.js
k6 run -e BASE_URL=https://cubad.vercel.app -e SESSION_COOKIE="$(cat scripts/load/.session-cookie)" scripts/load/scenario-c-progress-save.js
```

On PowerShell, load the ignored cookie once with
`$sessionCookie = Get-Content -Raw scripts/load/.session-cookie` and pass
`-e SESSION_COOKIE=$sessionCookie` to Scenarios B/C; do not print it into the terminal log.

- [ ] **Pass criteria:** A — `p(95)<500ms`, zero `5xx`. B — `p(95)<800ms`, zero `5xx`. C —
      limiter transition confirmed around call 12/13.
- [ ] Record the k6 summary output into `docs/ops/runbooks.md`'s load-test section (Task 7.25)
      as the pre-launch baseline.

**Diagnosis when A/B fails p95 (in order of likelihood):**
1. **Missing cache tag → per-request DB reads** instead of D12's shared, tag-revalidated cache.
   Check Supabase → Database → Query Performance during the test window: if the content query's
   `calls` scales ~1:1 with request count instead of staying flat, the cache isn't working — cross-
   check the content fetcher uses `fetch(..., { next: { tags: ['content:<subject>'] } })` (or
   `unstable_cache`/`revalidateTag`) with the EXACT tag string the publish action revalidates.
2. Vercel cold starts — check the function-duration graph; a spike only during ramp-up, not the
   steady-state stage, self-resolves and isn't a real problem.
3. Entitlement check not using its index — re-run Task 7.17's `explain analyze` technique.
- [ ] Fix genuine issues as their own small task, re-run the affected scenario, note in the
      Changelog.

**Failure modes:** see above — the recurring one is judging pass/fail against `localhost`.

---

## G. Expiry reminder (OPTIONAL — clearly marked, nice-to-have per Master §6)

### Task 7.24 — Migration + cron route + bilingual email

- [ ] `supabase migration new entitlements_reminded_at`:

```sql
alter table public.entitlements
  add column if not exists reminded_at timestamptz,
  add column if not exists reminder_claimed_at timestamptz;

create index if not exists entitlements_expiry_reminder_idx
  on public.entitlements (expires_at)
  where revoked_at is null and reminded_at is null;
```

  Apply (`supabase db reset` locally, then push).
- [ ] Add `CRON_SECRET` to Vercel env vars (`openssl rand -hex 32`) — Vercel auto-attaches
      `Authorization: Bearer <CRON_SECRET>` to its own scheduled hits of routes in `vercel.json`.
- [ ] Add/edit `vercel.json` at `cubad/` root:

```json
{
  "crons": [
    { "path": "/api/cron/expiry-reminders", "schedule": "0 6 * * *" }
  ]
}
```

  (Daily at 06:00 UTC — Vercel Hobby supports daily-granularity crons; if that's changed, any
  scheduler hitting this URL with the same header works just as well, e.g. UptimeRobot's daily
  monitor type.)
- [ ] Reuse Phase 6's audited Resend REST transport; do not add a second email client or a new
      `resend` dependency. Extend private `sendOne` with an optional `idempotencyKey?: string` and,
      when present, add HTTP header `Idempotency-Key: <value>` to the existing Resend REST request.
      Keep all existing callers unchanged. Then add this server-only wrapper:

```ts
export function sendExpiryReminder(
  recipient: string,
  content: EmailContent,
  entitlementId: string
): Promise<SendResult> {
  return sendOne(
    "entitlement.expiry_reminder",
    recipient,
    content,
    `entitlement-expiry/${entitlementId}`
  );
}
```

  Resend's [idempotency-key contract](https://resend.com/docs/dashboard/emails/idempotency-keys)
  currently retains keys for 24 hours. The database lease below is the primary overlap guard; the
  provider key also makes an ambiguous network retry safe during that window.

- [ ] Create `app/api/cron/expiry-reminders/route.ts`:

```ts
import { createServiceRoleClient } from "@/lib/supabase/server";
import { sendExpiryReminder } from "@/lib/email/send";
import { escapeHtml } from "@/lib/email/templates";

export const maxDuration = 60;

function reminderSubject(lang: "tr" | "en") {
  return lang === "tr" ? "Erişiminiz 3 gün içinde sona eriyor" : "Your access expires in 3 days";
}

function reminderBody(lang: "tr" | "en", expiresAt: string, name: string) {
  const date = new Date(expiresAt).toLocaleDateString(lang === "tr" ? "tr-TR" : "en-US", {
    day: "numeric", month: "long", year: "numeric",
  });
  return lang === "tr"
    ? `Merhaba ${name || ""},\n\ncubad erişiminiz ${date} tarihinde sona erecek. Kaldığınız yerden devam etmek için erişiminizi yenilemeyi unutmayın.\n\nSevgiler,\ncubad ekibi`
    : `Hi ${name || ""},\n\nYour cubad access expires on ${date}. Renew to keep studying without interruption.\n\nBest,\nThe cubad team`;
}

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  // 72h window, +/-12h tolerance so a once-daily cron never misses an
  // entitlement that falls between two runs.
  const HOUR = 60 * 60 * 1000;
  const windowStart = new Date(Date.now() + HOUR * (72 - 12)).toISOString();
  const windowEnd = new Date(Date.now() + HOUR * (72 + 12)).toISOString();
  const staleClaim = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from("entitlements")
    .select("id, user_id, expires_at, reminder_claimed_at")
    .is("revoked_at", null)
    .is("reminded_at", null)
    .or(`reminder_claimed_at.is.null,reminder_claimed_at.lt.${staleClaim}`)
    .gte("expires_at", windowStart)
    .lte("expires_at", windowEnd);

  if (error) {
    console.error("expiry-reminders query failed", error);
    return Response.json({ error: "query-failed" }, { status: 500 });
  }

  const releaseClaim = async (id: string, claimAt: string) => {
    const { error: releaseError } = await supabase
      .from("entitlements")
      .update({ reminder_claimed_at: null })
      .eq("id", id)
      .eq("reminder_claimed_at", claimAt)
      .is("reminded_at", null);
    if (releaseError) console.error("expiry-reminders claim release failed", id);
  };

  let sent = 0, failed = 0, skipped = 0;
  for (const row of rows ?? []) {
    const claimAt = new Date().toISOString();
    try {
      // Atomic compare-and-set lease: overlapping cron invocations may select the same candidate,
      // but only one can claim it. Postgres rechecks the predicates after any row-lock wait.
      const { data: claimed, error: claimError } = await supabase
        .from("entitlements")
        .update({ reminder_claimed_at: claimAt })
        .eq("id", row.id)
        .is("revoked_at", null)
        .is("reminded_at", null)
        .or(`reminder_claimed_at.is.null,reminder_claimed_at.lt.${staleClaim}`)
        .select("id")
        .maybeSingle();
      if (claimError) {
        console.error("expiry-reminders claim failed", row.id);
        failed++;
        continue;
      }
      if (!claimed) { skipped++; continue; }

      const { data: userResp } = await supabase.auth.admin.getUserById(row.user_id);
      const email = userResp?.user?.email;
      if (!email) { await releaseClaim(row.id, claimAt); failed++; continue; }

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, preferred_lang")
        .eq("user_id", row.user_id)
        .maybeSingle();
      const lang = profile?.preferred_lang === "en" ? "en" : "tr";

      const text = reminderBody(lang, row.expires_at, profile?.full_name ?? "");
      const emailResult = await sendExpiryReminder(
        email,
        {
          subject: reminderSubject(lang),
          text,
          html: `<div style="font-family:system-ui,-apple-system,Arial,sans-serif;white-space:pre-line">${escapeHtml(text)}</div>`,
        },
        row.id
      );
      if (!emailResult.ok) {
        await releaseClaim(row.id, claimAt);
        failed++;
        continue; // sendOne audited the failure; a later run may retry this entitlement
      }

      const { data: marked, error: markError } = await supabase
        .from("entitlements")
        .update({ reminded_at: new Date().toISOString(), reminder_claimed_at: null })
        .eq("id", row.id)
        .eq("reminder_claimed_at", claimAt)
        .is("reminded_at", null)
        .select("id")
        .maybeSingle();
      if (markError || !marked) {
        // Do not report a send as successful unless the durable marker was committed. Keep the
        // lease for operator inspection; retry with the same Resend idempotency key within 24h.
        console.error("expiry-reminders durable mark failed", row.id);
        failed++;
        continue;
      }
      sent++;
    } catch (e) {
      console.error("expiry-reminders send failed", row.id, e);
      await releaseClaim(row.id, claimAt);
      failed++;
    }
  }

  return Response.json({ checked: rows?.length ?? 0, sent, failed, skipped });
}
```

- [ ] Confirm `RESEND_API_KEY`/`EMAIL_FROM` are the SAME vars Phase 6 already uses for claim
      emails — no new email infra. Match the tone of Phase 6's existing transactional copy.
- [ ] Add tests proving two concurrent invocations yield one lease/send, a provider failure releases
      the lease, a zero-row/failed durable mark does not increment `sent`, and the REST request uses
      the stable entitlement idempotency header. Regenerate `lib/database.types.ts`.
- [ ] Commit: `git add supabase/migrations/*_entitlements_reminded_at.sql lib/database.types.ts vercel.json lib/email/send.ts app/api/cron/expiry-reminders && git commit -m "feat(phase7): OPTIONAL leased, idempotent expiry reminders"`

**Verify:** seed a test entitlement (`expires_at = now()+72h`, `reminded_at = null`), start two
authorized requests concurrently, and confirm their combined result has exactly `sent:1`; the
email arrives once, `reminded_at` is set, and `reminder_claimed_at` is null. Re-run immediately →
`checked:0` (no duplicate). Without `Authorization: Bearer $CRON_SECRET` → `401`.

**Failure modes:** falls back to `onboarding@resend.dev` if `EMAIL_FROM`/Task 7.26 hasn't landed
— fine for testing, set the real value before relying on it in production. A durable-mark failure
leaves the lease for inspection and reports `failed`, never `sent`; retry manually with the same
idempotency key within Resend's 24-hour window. No database transaction can atomically commit an
external email, so the lease, checked writes, audited failure, and provider idempotency key are all
required parts of this contract.

---

## H. Ops runbooks

### Task 7.25 — `docs/ops/runbooks.md`

- [ ] Create `docs/ops/runbooks.md`, assembling the sections already authored in Tasks 7.6, 7.11,
      7.13, 7.14, 7.16, 7.23, in that order, PLUS the incident runbooks below:

```markdown
# cubad ops runbooks

Living document — update in place as reality teaches you things.

## Content update won't appear

Symptom: admin published/edited a unit, students still see the old version.

1. Confirm the publish action ran `revalidateTag('content:<subject-slug>')` (Phase 3).
2. Confirm the content fetcher requests with the SAME tag string, byte-for-byte, case-sensitive.
   A mismatch silently never revalidates.
3. This does NOT need a redeploy — content lives in Postgres (D4). Wanting to redeploy to "fix"
   stale content is a sign the bug is really #2.
4. Check for an unexpected long `Cache-Control` if a CDN layer sits in front of the page.
5. Last resort: also `revalidatePath('/s/<slug>')` and the unit path from the publish action.

## User says their code is invalid

\`\`\`sql
-- Normalize EXACTLY like redeem_code() does (D8: uppercase, strip
-- non-alphanumerics, sha256 hex) — use Phase 4's actual implementation if it differs.
select ac.id, ac.max_redemptions, ac.redeemed_count, ac.valid_until, ac.revoked_at,
       ac.scope_type, ac.scope_id, ac.tier_id
  from public.access_codes ac
 where ac.code_hash = encode(
   digest(upper(regexp_replace('<CODE-AS-TYPED>', '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex');

-- if a row comes back, check in order: revoked_at not null (revoked),
-- valid_until < now() (expired), redeemed_count >= max_redemptions (exhausted)
select * from public.code_redemptions where code_id = '<id above>';   -- already-redeemed?
select * from public.redemption_attempts
 where user_id = '<uid>' and created_at > now() - interval '1 hour';  -- >=5 -> rate-limited
\`\`\`
No row at all → typo/never existed (Crockford base32, D8, avoids 0/O/1/I/l confusion) — suspect
a copy-paste error from the email.

## Payment email not arriving

1. Resend Dashboard → Logs, search by recipient — did Resend even attempt the send?
2. Check `admin_audit_log` for the `claim.approve` entry — per D10, email failure never rolls
   back the grant, so check `entitlements` directly before assuming nothing happened.
3. Ask the user to check spam (cold-sender-domain issue, common on `onboarding@resend.dev`
   until Task 7.30 lands).
4. Custom domain: check SPF/DKIM still valid via Resend's verification page.
5. Check Resend API key validity/quota if sends fail outright.

## Restore from backup

Same steps as the "Restore drill" section above, except you restore into a project you intend
to KEEP (cut the app over to it), not a scratch project. Flip Vercel env vars once verified,
per the Master §13 cutover pattern.

## Rotate service role key

1. Supabase → Settings → API → regenerate `service_role` key.
2. Update `SUPABASE_SERVICE_ROLE_KEY` in Vercel (Production, Preview, Development).
3. Redeploy.
4. Verify: admin dashboard loads; expiry-reminder cron authenticates on its next run (or trigger
   manually).
5. Re-run the service-key grep audit (Task 7.9 §1) to confirm no hardcoded old value.
6. Log below: who, when, why (routine / suspected compromise / offboarding).

**Rotation log:** (empty)

## Sprout decommission (60+ days after cutover, Master §13)

1. Confirm 60+ days elapsed with no passcode-sync support reports.
2. Export one final safety snapshot of sprout's `cubad_sync` rows + `podcasts` bucket objects.
3. Delete `cubad_sync` (rows/table) from sprout.
4. Delete all `podcasts` bucket objects from sprout.
5. Rotate/revoke sprout's anon key, or pause/delete the project.
6. Remove leftover Vercel env vars referencing sprout (retired per D15 at cutover).
7. Mark complete with the date below.

**Decommission log:** (empty)
```

- [ ] Commit: `git add docs/ops/runbooks.md && git commit -m "docs(phase7): ops runbooks - content/codes/email incidents, restore, key rotation, sprout decommission"`

**Verify:** every SQL snippet run once against a real (or read-only production) DB, no typos.

**Failure modes:** will drift as Phases 2-6's exact implementations solidify — treat "confirm X
matches Y" as a prompt to go check, not a guarantee.

---

## I. Launch checklist

### Task 7.26 — Domain + custom email sender

- [ ] Vercel → Domains → Add → follow DNS instructions → wait for "Valid Configuration".
- [ ] Resend → Domains → Add Domain → add SPF/DKIM (and optional DMARC) DNS records → Verify.
- [ ] Update `EMAIL_FROM` (Production + Preview) to `noreply@<yourdomain>`. Redeploy. Send one
      real test email (e.g. approve a test claim), confirm it arrives, not spam-flagged.

**Verify:** Vercel shows "Valid Configuration"; Resend shows "Verified"; test email headers show
`SPF: pass`, `DKIM: pass`.

**Failure modes:** DNS propagation delays are the usual holdup — wait/re-check DNS before
assuming Resend/Vercel are broken.

---

### Task 7.27 — Supabase Auth redirect URLs for the domain

- [ ] Dashboard → Authentication → URL Configuration: Site URL → production domain. Additional
      Redirect URLs → production auth callback path, Vercel preview wildcard (if previews need
      auth), `http://localhost:3000/**`.
- [ ] Test sign-up/reset from the production domain — confirm the email link lands back there.

**Verify:** full sign-up → confirm → login round trip on the production domain.

**Failure modes:** forgetting this after Task 7.26 is the #1 cause of "confirmation link goes to
a broken URL" right after a domain migration — check here first.

---

### Task 7.28 — `robots.txt` / sitemap sanity

- [ ] Check `node_modules/next/dist/docs/` for the current Metadata Files API before writing
      (per `AGENTS.md`).
- [ ] `app/robots.ts`:

```ts
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api/"] },
    sitemap: `${process.env.NEXT_PUBLIC_APP_URL}/sitemap.xml`,
  };
}
```

- [ ] `app/sitemap.ts`:

```ts
import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://cubad.vercel.app";
  return [
    { url: base, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/auth/sign-in`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/auth/sign-up`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    // Extend with published subjects/tracks if catalog pages should be indexable.
  ];
}
```

- [ ] Commit: `git add app/robots.ts app/sitemap.ts && git commit -m "feat(phase7): robots.txt + sitemap for launch"`

**Verify:** `/robots.txt` and `/sitemap.xml` render in production; `/admin` and `/api/`
disallowed.

**Failure modes:** if `/admin`'s real path differs, fix the `disallow` list to match.

---

### Task 7.29 — Legal minimum: bilingual privacy page

- [ ] Human-owned prerequisite: choose a public support/privacy email address that may be exposed
      in page HTML. Do not silently expose `ADMIN_NOTIFY_EMAIL` and do not use a fictitious
      `hello@cubad.app` before that domain/mailbox exists. Configure the chosen value as
      `NEXT_PUBLIC_SUPPORT_EMAIL` in local `.env.local`, Vercel Production, Development, and
      project-wide Preview; verify names/scopes without printing unrelated encrypted values.
- [ ] Create `app/privacy/page.tsx`:

```tsx
"use client";

import { useLang } from "@/lib/i18n";
import { Callout } from "@/components/ui";

const CONTACT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;

export default function PrivacyPage() {
  const { bi } = useLang();
  if (!CONTACT_EMAIL) throw new Error("NEXT_PUBLIC_SUPPORT_EMAIL is required for /privacy");
  return (
    <main className="mx-auto max-w-2xl px-6 py-12 text-[#1c2b33]">
      <h1 className="mb-6 font-serif text-3xl">{bi({ tr: "Gizlilik", en: "Privacy" })}</h1>

      <p className="mb-4">
        {bi({
          tr: "cubad, hesabınızı oluşturmak ve çalışma ilerlemenizi kaydetmek için aşağıdaki bilgileri toplar:",
          en: "cubad collects the following information to create your account and save your study progress:",
        })}
      </p>
      <ul className="mb-6 list-disc space-y-1 pl-6">
        <li>{bi({ tr: "E-posta adresi (hesap girişi için)", en: "Email address (for account login)" })}</li>
        <li>{bi({ tr: "Ad soyad", en: "Full name" })}</li>
        <li>{bi({ tr: "Telefon numarası", en: "Phone number" })}</li>
        <li>{bi({ tr: "Ülke ve eğitim düzeyi (uygun içeriği göstermek için)", en: "Country and education track (to show relevant content)" })}</li>
        <li>{bi({ tr: "Çalışma ilerlemeniz (tamamlanan sorular, sınav sonuçları, kartlar)", en: "Study progress (completed questions, quiz scores, flashcard state)" })}</li>
      </ul>

      <Callout>
        {bi({
          tr: "Ödeme bilgisi saklanmaz: kart veya mobil para kimlik bilgileriniz cubad sunucularına hiç ulaşmaz. Yalnızca ödeme talebiniz (yöntem, tutar, referans numarası) ve yüklediğiniz makbuz görseli saklanır; bu bilgiler yalnızca ödemenizi doğrulamak için kullanılır.",
          en: "Payment data is not stored: your card or mobile-money credentials never reach cubad's servers. Only your payment claim (method, amount, reference number) and the receipt image you upload are stored, used solely to verify your payment.",
        })}
      </Callout>

      <p className="mt-6">
        {bi({ tr: "Sorularınız için: ", en: "Questions: " })}
        <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>
          {CONTACT_EMAIL}
        </a>
      </p>
    </main>
  );
}
```

  (If `Callout`'s prop shape has changed by the time this lands, check `components/ui.tsx` and
  adjust the usage, keeping the bilingual content unchanged.)

- [ ] Add a footer link to `/privacy` in `components/Footer.tsx` (bilingual label).
- [ ] Commit: `git add app/privacy/page.tsx components/Footer.tsx && git commit -m "feat(phase7): bilingual privacy page (legal minimum for launch)"`

**Verify:** page renders in both languages; linked from the footer on every page; the public email
is the human-approved address in local/Preview/Production and receives a real test message.

**Failure modes:** this is a minimum-viable notice, not legal advice — revisit with real counsel
if the product later needs GDPR/KVKK-specific compliance.

---

### Task 7.30 — Final security re-run, Pro-tier decision, announcement banner

- [ ] Re-run `supabase/tests/security-probes.md` (Task 7.9) in full against production
      immediately before announcing launch. Fix anything that fails — never launch on a known
      failure.
- [ ] Revisit Task 7.14's Pro-tier criteria (>0 paying users OR >50 DAU) — upgrade BEFORE the
      public announcement if either is already true.
- [ ] Announcement banner via `app_settings` — **Phase 6 owns this table**. Its final public policy
      explicitly allows only `payment_instructions`; Phase 7 must extend that allow-list without
      making every future setting public. Writes remain service-role-only via `set_app_setting`.
      First VERIFY the exact shipped state:

```bash
psql "$DB_URL" -c "select policyname, cmd, qual from pg_policies where schemaname = 'public' and tablename = 'app_settings' order by policyname;"
# Expected public-read row: app_settings_public_read | SELECT | key IN ('payment_instructions').
# A historical app_settings_write_admin | ALL policy may also exist; it is inert because the
# authenticated role has no INSERT/UPDATE/DELETE table privileges. The migration below drops it.
psql "$DB_URL" -c "\d public.app_settings"
# Expected columns: key (text, pk), value (jsonb), updated_at, updated_by
```

- [ ] If the table/function/policy does not match the verified Phase 6 handoff, stop and diagnose;
      do not silently recreate it. Otherwise run `supabase migration new app_settings_seam` for
      this additive allow-list extension:

```sql
-- Phase 6 owns public.app_settings (master §14). Its absence is a failed prerequisite.
-- Phase 7 adds exactly one new public-safe key.
alter table public.app_settings enable row level security;

revoke insert, update, delete on table public.app_settings from anon, authenticated;
grant select on table public.app_settings to anon, authenticated;

-- Drop the historical direct-admin policy. It was already inert behind revoked mutation grants,
-- and all writes continue through the audited service-role-only set_app_setting RPC.
drop policy if exists app_settings_write_admin on public.app_settings;

-- Extend, never replace with using(true): future unrelated settings stay private by default.
drop policy if exists app_settings_public_read on public.app_settings;
create policy app_settings_public_read on public.app_settings for select
using (key in ('payment_instructions', 'announcement_banner'));

insert into public.app_settings (key, value)
values ('announcement_banner',
  '{"enabled": false, "level": "info", "message": {"tr": "", "en": ""}}'::jsonb)
on conflict (key) do nothing;
```

- [ ] Apply the migration and regenerate `lib/database.types.ts`.
- [ ] Create `lib/settings/announcement.ts`: define/validate `{enabled:boolean, level:
      "info"|"warning"|"success", message:{tr:string,en:string}}`. Read only the
      `announcement_banner` row through Supabase REST with the public anon key and a cached Next
      `fetch` tagged `announcement-banner` (60-second revalidation); return a disabled safe default
      on malformed/missing data and log no secret/value body.
- [ ] Create `app/admin/settings/actions.ts`: `updateAnnouncementBanner` calls
      `requireAdminAction`, trims both messages, requires both when enabled, caps each at 500
      characters, validates the level, writes only key `announcement_banner` via Phase 6's
      service-role-only `set_app_setting`, then calls `updateTag("announcement-banner")`. Never add
      direct client table writes.
- [ ] Create `app/admin/settings/page.tsx` + `BannerSettingsForm.tsx`: protected admin editor for
      enabled, level, Turkish message, and English message. Add `/admin/settings` to
      `components/admin/AdminNav.tsx`; do not overload the payment-instructions form.
- [ ] Create `components/AnnouncementBanner.tsx`: client dismissal UI with level styling and
      bilingual `bi(message)` output. `app/layout.tsx` reads the cached setting and renders the
      component below `Header` only when enabled; the data fetch must not make every page request
      perform an uncached database query.
- [ ] Add parser/action/component tests for malformed data, validation, RPC key/value, cache
      invalidation, language rendering, and dismissal.
- [ ] Commit every touched file, not only the migration:
      `git add supabase/migrations/*_app_settings_seam.sql lib/database.types.ts lib/settings app/admin/settings components/AnnouncementBanner.tsx components/admin/AdminNav.tsx app/layout.tsx && git commit -m "feat(phase7): audited launch announcement banner"`.

**Verify:** toggling `enabled` shows/hides the live banner immediately after `updateTag`; both
languages and all three levels render; dismissal hides it for the current mounted session; an
anonymous request can read only the two allow-listed keys; security battery re-run shows zero
unresolved failures; Pro-tier decision is explicitly recorded in `docs/ops/runbooks.md`.

**Failure modes:** `using (true)` is a security regression because this is a reusable settings
table. If the shipped policy differs, inspect the applied Phase 6 hardening migration and preserve
an explicit allow-list. Do not add client mutation grants or a direct write policy; the admin form
must use `set_app_setting`. Do not put `createServiceRoleClient` in the public banner read path or
turn the root layout into an uncached per-request DB query.

---

## Phase acceptance checklist

- [ ] `check_rate_limit()` RPC live; `rate_limit_events` locked down (RLS, no policies, revoked
      grants); nightly cleanup scheduled.
- [ ] All 3 active limiters engage past their limit: tutor server-key (20/hour/user, BYOK exempt)
      and progress save (12/min/user) return `429`; the Phase 6 claim
      Server Action (10/day/user) returns its localized `rate-limited` action state before writes.
- [ ] Supabase Auth built-in rate limits reviewed/documented; anonymous sign-ins disabled.
- [ ] `supabase/tests/security-probes.md` exists, run end-to-end at least once, all passing.
- [ ] Supabase security + performance advisors run; zero unresolved `ERROR`-level findings.
- [ ] Vercel Web Analytics + Speed Insights live and reporting.
- [ ] Log-drain runbook table exists; each log tab confirmed to exist.
- [ ] (Optional) Sentry wired with 10% sample + tunnel, or explicitly skipped.
- [ ] Uptime monitors live on `/` and `/api/health`, alerting to `ADMIN_NOTIFY_EMAIL`; retired
      `/api/sync` still returns 404 and has not been recreated.
- [ ] Backup Action has a successful manual run with a downloadable artifact.
- [ ] Restore drill actually performed once, counts verified and logged.
- [ ] Pro-tier criteria documented; current tier matches the decision.
- [ ] `perf_indexes` migration applied; each index confirmed used via `explain analyze`.
- [ ] Bundle + image/asset audit baseline recorded.
- [ ] No client-side `.reduce()`/`.length` computing a gating or KPI total.
- [ ] All 3 k6 scenarios run against the real Vercel deployment; A/B p95 thresholds met, zero
      5xx, C's rate-limit transition confirmed.
- [ ] (Optional) Expiry-reminder cron live and tested end-to-end, or explicitly skipped.
- [ ] `docs/ops/runbooks.md` covers auth limits, log drains, uptime, backups/Pro decision,
      restore log, load-test baseline, and all 6 incident runbooks.
- [ ] Custom domain live; `EMAIL_FROM` updated; Auth redirect URLs updated; sign-up/reset round
      trip verified on the production domain.
- [ ] `robots.txt`/`sitemap.xml` live and sane.
- [ ] Bilingual `/privacy` page live and linked from the footer.
- [ ] Announcement banner (`app_settings`) live and admin-togglable; final security re-run
      passes immediately before public launch.
- [ ] `npm run lint` and `npm run build` pass from `cubad/`.
- [ ] `node scripts/validate-content.mjs` and `npx vitest run` pass.
- [ ] All new migrations apply cleanly on `supabase db reset` from scratch.
- [ ] PR from `feat/phase-7-hardening-scale` into `main`, merged.

---

## Rollback

Phase 7 is additive hardening on a fully-shipped product — nothing here changes core product
behavior, so rollback is narrow per area:

- **Rate limiting:** remove the small, clearly-delimited guard blocks from
  `app/api/tutor/route.ts`, `app/api/state/route.ts`, and `app/upgrade/actions.ts`. The
  `check_rate_limit`/`rate_limit_events` migration can stay
  (unused, harmless) or be reverted with a NEW migration — never edit an applied migration
  (§10). If dropping it, first iterate matching rows in `cron.job` and call
  `cron.unschedule(jobid)` for job name `cleanup-rate-limit-events`; only then drop
  `cleanup_rate_limit_events()`, `check_rate_limit(text,int,interval)`, and
  `rate_limit_events` in that order. Verify the job and objects are all absent so pg_cron cannot
  keep invoking a deleted function.
- **Docs (security probes, runbooks):** no rollback risk, delete if unwanted.
- **Monitoring:** remove `<Analytics/>`/`<SpeedInsights/>`/Sentry config; disable in dashboards.
  Remove `app/api/health/route.ts` only if the external dependency monitor is also repointed or
  disabled. Zero core-product impact.
- **Backups:** disable/delete `.github/workflows/backup.yml`; no app impact (separate CI job).
- **Indexes:** a new migration with `drop index if exists ...` if one ever hurts writes
  (unlikely at this scale); never edit the migration that created it.
- **Load test scripts:** delete `scripts/load/`; zero app impact (not imported by the app).
- **Expiry reminder:** remove the `crons` entry from `vercel.json` and/or the route file; leave
  `reminded_at` (harmless) or drop it in a new migration.
- **Launch items (domain/DNS/redirects):** a real operational event, not a quick rollback — keep
  the default `cubad.vercel.app` URL alive as a safety net rather than removing it.

---

## Changelog / deviations

- **2026-07-16 — post-audit seam corrections (per coordinator audit + master §14 contract
  registry; no scope changes):**
  1. Progress endpoint corrected from assumed `app/api/progress/route.ts` to Phase 2's actual
     `app/api/state/route.ts` (`/api/state`) — fixed in the Prerequisites assumptions table,
     Task 7.5 (locate step + path), Task 7.8 (probe curl), Task 7.22 (k6 scenario C URL), and
     Rollback. Rate-limit bucket key strings (`progress:user:<uid>`) intentionally unchanged —
     they are internal limiter keys, not routes.
  2. Auth routes reconciled with §14 (no `/login` exists): Task 7.19's cookie-capture README now
     says `/auth/sign-in`; Task 7.28's sitemap entries changed `/login` → `/auth/sign-in` and,
     under the same reconciliation, `/signup` → `/auth/sign-up`.
  3. Task 7.30's `app_settings` block reconciled with §14 (Phase 6 owns the table, single
     anon-readable SELECT policy, writes via `set_app_setting`): added a psql verification step
     (pg_policies + `\d`), kept `create table if not exists` as a belt-and-braces guard only,
     made the SELECT policy idempotent (`drop policy if exists` + verbatim recreate → converges
     to one policy), REMOVED the previously-planned `app_settings_admin_write` direct-write
     policy (writes go through Phase 6's `set_app_setting` RPC instead), and routed the
     admin-dashboard form through that RPC. **Historical only:** the `create table if not exists`
     and generic public-read wording in this 2026-07-16 entry was superseded by the 2026-07-20
     audit below and must not be executed.

- **2026-07-20 — post-Phase-6 reality reconciliation (overrides any conflicting illustrative
  code above or in the 2026-07-16 note):**
  1. Phase 6 uses Server Actions for claims and admin payment mutations. All `/api/claims`
     assumptions, curl probes, rollback paths, and the claim limiter were corrected to
     `app/upgrade/actions.ts::submitClaim`; its denial is a localized action state, not HTTP 429.
  2. `check_rate_limit` is service-role-only. Granting arbitrary-key EXECUTE to anon/authenticated
     would let one client exhaust another user's bucket. `lib/rate-limit.ts` now reuses the
     canonical service-role factory and fails open on RPC errors or malformed results.
  3. Phase 6's final `app_settings_public_read` policy allows only `payment_instructions`; the
     announcement migration extends that explicit allow-list to `announcement_banner`, drops the
     inert historical direct-write policy, and never uses `using (true)`.
  4. The optional expiry reminder reuses Phase 6's audited Resend REST transport and sets
     `reminded_at` only after `SendResult.ok`; no second SDK/client is introduced.
  5. Stale task-number cross-references were aligned to Tasks 7.23, 7.25, 7.26, and 7.30.
  6. `/api/sync` was retired in Phase 3 and must remain 404. Its limiter/probe/monitor instructions
     were removed; authenticated `/api/state` remains the sole progress transport, and uptime now
     uses a minimal `/api/health` Supabase check.
  7. Tutor limiting now makes BYOK-first real (`body.userKey` before the shared env key), adds an
     explicit bilingual client 429 state, validates request content before charging the bucket,
     and never logs either key.
  8. The k6 progress scenario now sends the real `/api/state` `{state, base_updated_at}`
     compare-and-swap contract with a disposable account, rather than the obsolete invalid body.
  9. The banner task now names its reader, admin action/page, navigation, cache tag/invalidation,
     validation, component, tests, and complete commit scope. The privacy task requires a
     human-approved public `NEXT_PUBLIC_SUPPORT_EMAIL`; it cannot expose the admin-notify address
     or invent a mailbox.
  10. Post-review reconciliation aligned the tutor probe with the `rate-limited`/3600-second
      response, made optional reminders use a conditional database lease, checked durable marker,
      and stable Resend idempotency key, and required tests for concurrent runs/failure paths.
  11. Limiter rollback now unschedules `cleanup-rate-limit-events` before dropping its function or
      table, preventing recurring pg_cron failures after rollback.
  12. The announcement implementation and commit checklists now have explicit, valid Markdown
      nesting so agents and linters interpret every item at the intended level.

(further entries filled in by the executing agent as work proceeds)
