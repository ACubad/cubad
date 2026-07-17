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
  1–6 is reopened here except adding a rate-limit guard to a few existing routes + one column.
- **Branch:** `feat/phase-7-hardening-scale`, PR into `main` at the end (§8.7).
- **Required reading:** `00-MASTER-PLAN.md` (all of it, esp. §4/§9/§10) · `AGENTS.md` (Next 16
  differs from training data — check `node_modules/next/dist/docs/` before writing any route
  handler, cron route, or `robots.ts`/`sitemap.ts` below) · `app/api/sync/route.ts`,
  `app/api/tutor/route.ts`, `app/api/podcast/route.ts` (this app uses plain Route Handlers for
  every mutation — zero Server Actions exist as of Phase 6, confirmed by grep while authoring
  this doc; Phase 7 code follows suit) · `lib/sync.ts` (the `SyncState` shape `{progress, decks,
  chats?}` that `user_state.state` holds, D3) · `package.json` (current deps).

### Assumptions (Phases 1–6 artifacts not directly inspectable while authoring this doc in
parallel — verify before coding; if wrong, use the real name and note it in the Changelog)

| Assumption | Basis | If wrong |
|---|---|---|
| `lib/supabase/server.ts` exports `async createClient()` — cookie-bound, RLS-enforced (standard `@supabase/ssr` App Router pattern) | D2, D15 | `grep -n export lib/supabase/server.ts`, fix imports below |
| Same file also exports `createServiceRoleClient()` — service-role, bypasses RLS | D15 | same grep; fixes Task 7.27's import |
| Phase 2's server-progress endpoint is `app/api/state/route.ts` (`/api/state`, POST), not a Server Action | master §14 contract registry | if reality differs, apply the same 3-line guard right after the user check wherever the `user_state` write lives |
| Phase 6's claim endpoint is `app/api/claims/route.ts` (POST) | same reasoning | same grep |
| Phase 6 created `public.app_settings` as a generic key/value settings table | Phase 7 scope line: "banner via `app_settings` (seam from Phase 6's table)" | Task 7.34 uses `create table if not exists` — a no-op if already compatible |
| `NEXT_PUBLIC_APP_URL` set in Vercel + `.env.local` | D15 | confirm before Task 7.32/7.33 |

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
language plpgsql security definer set search_path = public
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

grant execute on function public.check_rate_limit(text, int, interval)
  to anon, authenticated, service_role;

-- Nightly full sweep. Keeps 2 days of history (longer than any window used
-- today) so "who got rate-limited last night?" is answerable the next day.
create or replace function public.cleanup_rate_limit_events()
returns void language sql security definer set search_path = public
as $$
  delete from public.rate_limit_events where created_at < now() - interval '2 days';
$$;

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
import { createClient } from "@supabase/supabase-js";

/**
 * Minimal client used ONLY to call check_rate_limit(). Deliberate exception
 * to D15's "all Supabase access through lib/supabase/server.ts": this RPC is
 * SECURITY DEFINER and keyed by an explicit string arg — no session/cookie
 * context needed — and this helper must also work where there are no
 * request cookies at all (Vercel Cron routes). To centralize anyway, swap
 * this for `createServiceRoleClient()` — no call site below changes.
 */
const rateLimitClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
);

export interface RateLimitOptions {
  /** Bucket key, e.g. `sync:ip:203.0.113.4` or `tutor:user:<uuid>`. */
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
    const { data, error } = await rateLimitClient.rpc("check_rate_limit", {
      p_key: key, p_max: max, p_window: `${windowSeconds} seconds`,
    });
    if (error) {
      console.error("checkRateLimit RPC error", { key, error: error.message });
      return true; // fail open
    }
    return data === true;
  } catch (e) {
    console.error("checkRateLimit exception", { key, error: e });
    return true; // fail open
  }
}

/**
 * Best-effort client IP behind Vercel's proxy.
 * Trust caveat: valid only while Vercel is the sole edge in front of the
 * app — if a CDN is ever placed in front of Vercel, re-verify which header
 * carries the true client IP before trusting this.
 * Coarseness caveat: shared/NAT'd networks put many real users behind one
 * IP — fine for /api/sync's coarse per-IP abuse guard, not precise per-user.
 */
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() ?? "unknown";
}
```

- [ ] Commit: `git commit -am "feat(phase7): lib/rate-limit.ts shared limiter helper"`

**Verify:** `npm run build` compiles clean. Temporarily add `app/api/_debug-ratelimit/route.ts`
calling `checkRateLimit({key:'debug', max:2, windowSeconds:30})`, hit it 3x → `true, true,
false`, then delete the throwaway route.

**Failure modes:** missing `NEXT_PUBLIC_SUPABASE_*` env vars in Vercel Production/Preview throw
at first call. A typo'd RPC/argument name makes `data` come back `null`, and `data === true` is
`false` — this **denies** requests silently (fail-open only covers the `error` path) — keep
`p_key`/`p_max`/`p_window` byte-identical to Task 7.1.

---

### Task 7.3 — Apply to `/api/sync` (per-IP 30/min)

**Why:** `/api/sync` is intentionally unauthenticated (legacy passcode sync, D3/§13) — 30/min
per IP stops a scripted passcode scan while normal multi-device sync stays comfortably under it.

- [ ] Open `app/api/sync/route.ts`. Add: `import { checkRateLimit, clientIp } from "@/lib/rate-limit";`
- [ ] Find:

```ts
export async function POST(request: Request) {
  if (!SB_URL || !SB_KEY) {
    return Response.json({ error: "sync-unavailable" }, { status: 503 });
  }
```

  Replace with:

```ts
export async function POST(request: Request) {
  if (!SB_URL || !SB_KEY) {
    return Response.json({ error: "sync-unavailable" }, { status: 503 });
  }

  const ip = clientIp(request);
  const allowed = await checkRateLimit({ key: `sync:ip:${ip}`, max: 30, windowSeconds: 60 });
  if (!allowed) {
    return Response.json(
      { error: "rate-limited" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }
```

- [ ] Commit: `git commit -am "feat(phase7): rate-limit /api/sync to 30 req/min per IP"`

**Verify:** see Task 7.8's consolidated probe.

**Failure modes:** users sharing a NAT/campus IP share a budget — acceptable at 30/min; if it
becomes a real complaint, raise the limit rather than keying on the passcode too (that would
reopen a per-IP passcode-guessing budget). Insertion point is the same regardless of any Phase 3
cutover changes to this route: first line inside `POST`, before any Supabase call.

---

### Task 7.4 — Apply to tutor server-key path (per-user 20/hour; BYOK exempt)

**Why:** `const key = envKey || body.userKey;` in `app/api/tutor/route.ts` means the shared env
key is ALWAYS used when configured — BYOK only ever activates when the site has no env key for
that provider. So "server-key path" = `Boolean(envKey)`, and gating on that single condition
automatically exempts BYOK: a user supplying their own key spends their own quota.

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
  const key = envKey || body.userKey;
  if (!key) return Response.json({ error: "no-key" }, { status: 401 });

  // Rate-limit only the shared server key; BYOK spends the user's own quota.
  const usingServerKey = Boolean(envKey);
  if (usingServerKey) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    // Study pages require login (Master §6); the IP fallback is defense in depth.
    const rlKey = user ? `tutor:user:${user.id}` : `tutor:ip:${clientIp(request)}`;
    const allowed = await checkRateLimit({ key: rlKey, max: 20, windowSeconds: 3600 });
    if (!allowed) {
      // Reuses the existing "quota" TutorError so TutorPanel's current error
      // UI handles this with zero frontend changes.
      return Response.json(
        {
          error: "quota",
          message: "Hourly tutor limit reached on the shared key. Add your own API key in Settings to keep going, or try again in an hour.",
          retryAfterSeconds: 3600,
        },
        { status: 429, headers: { "Retry-After": "3600" } }
      );
    }
  }
```

- [ ] Commit: `git commit -am "feat(phase7): rate-limit tutor server-key path to 20 req/hour per user, BYOK exempt"`

**Verify:** see Task 7.8.

**Failure modes:** if key-selection logic ever inverts (BYOK-first), recompute `usingServerKey`
as `key === envKey`, don't keep `Boolean(envKey)` blindly. `supabase.auth.getUser()` round-trips
to Supabase Auth — check this first if tutor p95 latency misbehaves under load (Task 7.25).

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

**Failure modes:** if the real route batches pull (read) and push (write) in one handler like
`/api/sync` does, only guard the **push** branch — reads must stay unlimited or the
pull-before-push union-merge flow (`lib/sync.ts`) breaks.

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

- [ ] Write the confirmed values into `docs/ops/runbooks.md` (Task 7.29). No separate commit —
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

- [ ] Locate the file (`ls app/api | grep -i claim`; assumed `app/api/claims/route.ts`).
- [ ] Add: `import { checkRateLimit } from "@/lib/rate-limit";`
- [ ] Insert right after the auth check, BEFORE the "max 3 open claims" check (fail fast,
      cheapest check first):

```ts

  const allowed = await checkRateLimit({
    key: `claims:user:${user.id}`, max: 10, windowSeconds: 60 * 60 * 24,
  });
  if (!allowed) {
    return Response.json(
      { error: "rate-limited" },
      { status: 429, headers: { "Retry-After": "86400" } }
    );
  }
```

- [ ] Commit: `git commit -am "feat(phase7): rate-limit claim submission to 10 creates/day per user"`

**Verify:** see Task 7.8.

**Failure modes:** if the real code checks "max 3 open claims" first, keep that order — the
rate limit is a ceiling, not a replacement for the business-rule error message.

---

### Task 7.8 — Rate-limit probes (hammer + expect 429)

**Why two techniques:** looping real `/api/sync` calls is free. Looping `/api/tutor` for real
would burn ~20 real Gemini calls per run — wasteful. So: sync gets a real full-loop probe;
tutor/progress/claims get a cheap, precise **pre-seed-then-single-call** probe.

- [ ] Create `scripts/load/probe-rate-limits.sh`:

```bash
#!/usr/bin/env bash
# Free, no external cost. Run against local dev or a disposable preview —
# never production (writes real rows to rate_limit_events).
set -euo pipefail
BASE_URL="${1:-http://localhost:3000}"

echo "=== /api/sync: 35 requests (limit 30/min) ==="
for i in $(seq 1 35); do
  code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/sync" \
    -H "Content-Type: application/json" -d '{"code":"probe-rl-sync"}')
  echo "  req $i -> $code"
done
echo "Expected: reqs 1-30 -> 200, reqs 31-35 -> 429"
```

- [ ] `chmod +x scripts/load/probe-rate-limits.sh && ./scripts/load/probe-rate-limits.sh` →
      confirm the last 5 lines print `429`.
- [ ] For the authenticated limiters, run in the SQL editor (get a real test user id first:
      `select id from auth.users where email = 'you@test.cubad.dev';`):

```sql
-- Pre-seed a bucket to exactly its limit, make ONE real curl call through the
-- app, confirm 429, then clean up.

-- tutor: 20/hour
insert into public.rate_limit_events (key, created_at)
select 'tutor:user:<uid>', now() from generate_series(1, 20);
-- curl -X POST http://localhost:3000/api/tutor -H "Content-Type: application/json" \
--   -H "Cookie: <captured session cookie, see Task 7.23>" \
--   -d '{"messages":[{"role":"user","text":"hi"}]}'   -- expect 429, {"error":"quota",...}
delete from public.rate_limit_events where key = 'tutor:user:<uid>';

-- progress save: 12/min
insert into public.rate_limit_events (key, created_at)
select 'progress:user:<uid>', now() from generate_series(1, 12);
-- curl -X POST http://localhost:3000/api/state ... -> expect 429
delete from public.rate_limit_events where key = 'progress:user:<uid>';

-- claim submission: 10/day
insert into public.rate_limit_events (key, created_at)
select 'claims:user:<uid>', now() from generate_series(1, 10);
-- curl -X POST http://localhost:3000/api/claims ... -> expect 429
delete from public.rate_limit_events where key = 'claims:user:<uid>';
```

- [ ] Commit: `git add scripts/load/probe-rate-limits.sh && git commit -m "test(phase7): rate-limit hammer probe + SQL pre-seed probes for auth'd limiters"`

**Verify:** all 4 limiters return `429` exactly one request past their max; after the
window/cleanup, the same key is allowed again (not permanently sticky).

**Failure modes:** a pre-seed probe still returning 200 usually means a key mismatch — log the
actual `key` the route computes and diff it byte-for-byte against what was seeded. Don't loop
the full `/api/sync` probe repeatedly against production.

---

## B. Security audit battery

### Task 7.9 — `supabase/tests/security-probes.md`

**Why:** every negative-path check from Phases 2/4/6 (RLS, storage, RPC) plus this phase's own
audits (service-key grep, env leak audit, anon-key capability walk, advisors) belong in ONE
runnable checklist, so the pre-launch re-run (Task 7.34) is one document, not an archaeology dig.

- [ ] Create `supabase/tests/security-probes.md`:

```markdown
# Security probe battery

Run before every deploy touching RLS/storage/RPCs, and in full for Task 7.34's pre-launch
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

Any name NOT in this table is a new leak surface — rename it off `NEXT_PUBLIC_` if it shouldn't
be client-visible, then re-run the grep.

## 3. Anon-key capability walk (zero session)

\`\`\`bash
for table in tracks subjects units track_subjects tiers entitlements access_codes \\
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

## 7. Supabase advisors

Run security AND performance advisors (MCP or dashboard). Expected: zero `ERROR`-level security
findings.

| Finding | Expected here? | Action |
|---|---|---|
| "RLS enabled, no policy" on `rate_limit_events` | Yes, by design | none |
| "Function has mutable search_path" | Should be zero (every SECURITY DEFINER sets `search_path=public`) | add it to the offending function |
| "Unindexed foreign key" | cross-check Task 7.17's hot-query list | add the index if it's a hot path, else note and move on |
| "Table has RLS disabled" | should be zero | STOP — direct §9 violation |
| "Leaked password protection disabled" | should be enabled | enable in Auth → Policies |
| "Sequential scan on large table" | cross-check Task 7.17 | add the matching index |

Record the run date + outcome in `docs/ops/runbooks.md`.
```

- [ ] Commit: `git add supabase/tests/security-probes.md && git commit -m "test(phase7): consolidated security probe battery (RLS, storage, RPC, advisors)"`

**Verify:** every checkbox above run once against the real project, results noted inline
(`— OK <date>` / `— FAILED: <what>`) — this is a living checklist, not a read-only doc.

**Failure modes:** this doc is derived from Master §4/§6 since Phases 2/4/6's own RLS text isn't
readable while authoring Phase 7 in parallel — if a phase deviated (its own Changelog says so),
update the probe here to match reality. Never assert "expect N rows" for a large table without
`Prefer: count=exact` (§9's "never count client-side").

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

- [ ] Add to `docs/ops/runbooks.md` (Task 7.29):

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

- [ ] Sign up with `ADMIN_NOTIFY_EMAIL`.
- [ ] Monitor 1: HTTP(s), URL = production home page, expect `200`, 5 min interval.
- [ ] Monitor 2: **Keyword** monitor, URL = `/api/sync`, keyword `"enabled":true`, 5 min interval
      (doubles as a Supabase connectivity check per the existing `GET` handler).
- [ ] Alert contact = `ADMIN_NOTIFY_EMAIL` for both. No commit (external config) — note both URLs
      in `docs/ops/runbooks.md`.

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

- [ ] No separate commit — lands with Task 7.29.

**Verify:** current plan tier in Supabase Billing matches what's documented.

**Failure modes:** "DAU > 50" needs an actual query, not vibes — see Task 7.29 for the SQL if
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

- [ ] No separate commit — lands with Task 7.29. Actually run the drill now, not just document it.

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

  // "giris" = unit-1's real slug (content/hidroloji/unit-1.json), is_free by seed default.
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
  const res = http.post(
    `${BASE_URL}/api/state`,
    JSON.stringify({ progress: { q: {}, quiz: {}, practice: {} }, decks: {} }),
    { headers: { "Content-Type": "application/json", Cookie: SESSION_COOKIE } }
  );
  console.log(`iteration -> ${res.status}`);
  sleep(1); // ~1 req/sec => 15 requests inside one 60s window
}
```

- [ ] Run: `k6 run -e BASE_URL=https://cubad.vercel.app -e SESSION_COOKIE="$(cat scripts/load/.session-cookie)" scripts/load/scenario-c-progress-save.js`
- [ ] Expected: iterations 1-12 print `200`, 13-15 print `429` (±1 for window-boundary jitter).
- [ ] Commit: `git add scripts/load/scenario-c-progress-save.js && git commit -m "test(phase7): k6 scenario C - progress save hammer, confirms 12/min limiter engages"`

**Verify:** console shows the 200→429 transition around request 12/13.

**Failure modes:** Vercel request queueing can shift the exact transition point by one — assert
that 429s START appearing, not the exact iteration number.

---

### Task 7.23 — Run all scenarios, pass criteria, failure diagnosis

- [ ] Run against the deployed Vercel URL (Hobby tier), never `localhost` (no cold starts/real
      latency/concurrency limits locally, so pass/fail there is meaningless):

```bash
k6 run -e BASE_URL=https://cubad.vercel.app scripts/load/scenario-a-anonymous-browse.js
k6 run -e BASE_URL=https://cubad.vercel.app -e SESSION_COOKIE="$(cat scripts/load/.session-cookie)" scripts/load/scenario-b-authed-study.js
k6 run -e BASE_URL=https://cubad.vercel.app -e SESSION_COOKIE="$(cat scripts/load/.session-cookie)" scripts/load/scenario-c-progress-save.js
```

- [ ] **Pass criteria:** A — `p(95)<500ms`, zero `5xx`. B — `p(95)<800ms`, zero `5xx`. C —
      limiter transition confirmed around call 12/13.
- [ ] Record the k6 summary output into `docs/ops/runbooks.md`'s load-test section (Task 7.29)
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
  add column if not exists reminded_at timestamptz;
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
- [ ] Create `app/api/cron/expiry-reminders/route.ts`:

```ts
import { createServiceRoleClient } from "@/lib/supabase/server";
import { Resend } from "resend";

export const maxDuration = 60;

const resend = new Resend(process.env.RESEND_API_KEY);

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

  const { data: rows, error } = await supabase
    .from("entitlements")
    .select("id, user_id, expires_at")
    .is("revoked_at", null)
    .is("reminded_at", null)
    .gte("expires_at", windowStart)
    .lte("expires_at", windowEnd);

  if (error) {
    console.error("expiry-reminders query failed", error);
    return Response.json({ error: "query-failed" }, { status: 500 });
  }

  let sent = 0, failed = 0;
  for (const row of rows ?? []) {
    try {
      const { data: userResp } = await supabase.auth.admin.getUserById(row.user_id);
      const email = userResp?.user?.email;
      if (!email) { failed++; continue; }

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, preferred_lang")
        .eq("user_id", row.user_id)
        .maybeSingle();
      const lang = profile?.preferred_lang === "en" ? "en" : "tr";

      await resend.emails.send({
        from: process.env.EMAIL_FROM || "onboarding@resend.dev",
        to: email,
        subject: reminderSubject(lang),
        text: reminderBody(lang, row.expires_at, profile?.full_name ?? ""),
      });

      await supabase.from("entitlements")
        .update({ reminded_at: new Date().toISOString() })
        .eq("id", row.id);
      sent++;
    } catch (e) {
      console.error("expiry-reminders send failed", row.id, e);
      failed++; // no reminded_at set — tomorrow's run retries this row
    }
  }

  return Response.json({ checked: rows?.length ?? 0, sent, failed });
}
```

- [ ] Confirm `RESEND_API_KEY`/`EMAIL_FROM` are the SAME vars Phase 6 already uses for claim
      emails — no new email infra, just a new trigger + template. Match the tone of Phase 6's
      existing transactional copy.
- [ ] Commit: `git add supabase/migrations/*_entitlements_reminded_at.sql vercel.json app/api/cron/expiry-reminders/route.ts && git commit -m "feat(phase7): OPTIONAL daily expiry-reminder cron (72h window, bilingual email)"`

**Verify:** seed a test entitlement (`expires_at = now()+72h`, `reminded_at = null`), `curl -H
"Authorization: Bearer $CRON_SECRET" .../api/cron/expiry-reminders` → `sent:1`, email arrives,
`reminded_at` set. Re-run immediately → `checked:0` (no duplicate). Without the header → `401`.

**Failure modes:** falls back to `onboarding@resend.dev` if `EMAIL_FROM`/Task 7.28 hasn't landed
— fine for testing, set the real value before relying on it in production.

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

- [ ] Create `app/privacy/page.tsx`:

```tsx
"use client";

import { useLang } from "@/lib/i18n";
import { Callout } from "@/components/ui";

export default function PrivacyPage() {
  const { bi } = useLang();
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
        <a className="underline" href={`mailto:${process.env.NEXT_PUBLIC_ADMIN_CONTACT_EMAIL ?? "hello@cubad.app"}`}>
          {process.env.NEXT_PUBLIC_ADMIN_CONTACT_EMAIL ?? "hello@cubad.app"}
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

**Verify:** page renders in both languages; linked from the footer on every page.

**Failure modes:** this is a minimum-viable notice, not legal advice — revisit with real counsel
if the product later needs GDPR/KVKK-specific compliance.

---

### Task 7.30 — Final security re-run, Pro-tier decision, announcement banner

- [ ] Re-run `supabase/tests/security-probes.md` (Task 7.9) in full against production
      immediately before announcing launch. Fix anything that fails — never launch on a known
      failure.
- [ ] Revisit Task 7.14's Pro-tier criteria (>0 paying users OR >50 DAU) — upgrade BEFORE the
      public announcement if either is already true.
- [ ] Announcement banner via `app_settings` — **Phase 6 owns this table** (master §14: single
      anon-readable SELECT policy `app_settings_public_read`; writes admin-only via
      `set_app_setting`). First VERIFY it exists as Phase 6 shipped it:

```bash
psql "$DB_URL" -c "select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'app_settings';"
# Expected: exactly ONE row -> app_settings_public_read | SELECT
psql "$DB_URL" -c "\d public.app_settings"
# Expected columns: key (text, pk), value (jsonb), updated_at, updated_by
```

- [ ] `supabase migration new app_settings_seam` — idempotent converge-to-one-policy: a no-op
      guard if the verification above showed Phase 6 delivered everything, a repair if it showed
      the table or policy missing:

```sql
-- Phase 6 owns public.app_settings (master §14). Everything below is a
-- belt-and-braces guard that converges to Phase 6's contract: ONE
-- anon-readable SELECT policy; writes go through set_app_setting only —
-- do NOT add a direct client write policy here.
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.app_settings enable row level security;

-- Idempotent recreate — converges to exactly one SELECT policy, recreated
-- verbatim as Phase 6 defines it. Readable by anyone: the banner must
-- render for anonymous visitors too.
drop policy if exists app_settings_public_read on public.app_settings;
create policy app_settings_public_read on public.app_settings for select using (true);

insert into public.app_settings (key, value)
values ('announcement_banner',
  '{"enabled": false, "level": "info", "message": {"tr": "", "en": ""}}'::jsonb)
on conflict (key) do nothing;
```

  Apply. Add an admin-dashboard form to edit the row (toggle `enabled`, bilingual `message`,
  `level`) — writes go through Phase 6's `set_app_setting` RPC (admin-only per §14, never a
  direct client write); reuse Phase 5's settings editor if one exists. Read it (cached like
  content, D12) in the root layout/landing page and render a dismissible banner via
  `bi(value.message)` when `enabled`.
- [ ] Commit: `git add supabase/migrations/*_app_settings_seam.sql && git commit -m "feat(phase7): launch checklist - final security re-run, Pro-tier decision, announcement banner via app_settings"`

**Verify:** toggling `enabled` shows/hides the live banner within one cache cycle; security
battery re-run shows zero unresolved failures; Pro-tier decision explicitly recorded in
`docs/ops/runbooks.md`.

**Failure modes:** if Phase 6's `app_settings` has different column names, `create table if not
exists` is a no-op and the `insert ... on conflict` fails — check `\d public.app_settings` first
and adapt to the real shape rather than fighting it.

---

## Phase acceptance checklist

- [ ] `check_rate_limit()` RPC live; `rate_limit_events` locked down (RLS, no policies, revoked
      grants); nightly cleanup scheduled.
- [ ] All 4 limiters return `429` past their limit: `/api/sync` (30/min/IP), tutor server-key
      (20/hour/user, BYOK exempt), progress save (12/min/user), claims (10/day/user).
- [ ] Supabase Auth built-in rate limits reviewed/documented; anonymous sign-ins disabled.
- [ ] `supabase/tests/security-probes.md` exists, run end-to-end at least once, all passing.
- [ ] Supabase security + performance advisors run; zero unresolved `ERROR`-level findings.
- [ ] Vercel Web Analytics + Speed Insights live and reporting.
- [ ] Log-drain runbook table exists; each log tab confirmed to exist.
- [ ] (Optional) Sentry wired with 10% sample + tunnel, or explicitly skipped.
- [ ] Uptime monitors live on `/` and `/api/sync`, alerting to `ADMIN_NOTIFY_EMAIL`.
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
  `app/api/sync/route.ts`, `app/api/tutor/route.ts`, `app/api/state/route.ts`,
  `app/api/claims/route.ts`. The `check_rate_limit`/`rate_limit_events` migration can stay
  (unused, harmless) or be reverted with a NEW migration dropping the function/table — never
  edit an applied migration (§10).
- **Docs (security probes, runbooks):** no rollback risk, delete if unwanted.
- **Monitoring:** remove `<Analytics/>`/`<SpeedInsights/>`/Sentry config; disable in dashboards.
  Zero product impact.
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
     admin-dashboard form through that RPC.

(further entries filled in by the executing agent as work proceeds)
