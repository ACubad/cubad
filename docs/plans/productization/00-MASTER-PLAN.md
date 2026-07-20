# CUBAD Productization — Master Plan

> **For agentic workers:** This is the umbrella document for turning cubad from a personal
> study app into a multi-user, subscription-ready product. Read this document FULLY before
> opening any phase plan. Phase plans live beside this file (`01-…` → `08-…`) and use
> checkbox (`- [ ]`) task syntax. If you are a Claude Code session, use
> superpowers:subagent-driven-development or superpowers:executing-plans to execute a phase
> plan task-by-task. If you are another agent (Codex etc.), execute tasks in order and obey
> §11 (Operating Manual) exactly.

**Goal:** Ship cubad as its own product: dedicated database, real accounts, unified content
model served from the database (admin-uploaded, no redeploys), country/level catalog,
tiered paid access via manually-verified payments + expiring access codes, an admin
dashboard as the control center, and infrastructure that survives real user load.

**Architecture:** Next.js 16 (App Router, Vercel) + a NEW dedicated Supabase project
(Postgres + Auth + Storage + RLS). Content is versioned JSONB in Postgres validated by the
existing schema validator; pages read content through cached server-side fetchers and gate
per-user via an entitlements model. Payments v1 are manual-verification claims that mint
single-use expiring access codes; Selcom/M-Pesa automation plugs into the same entitlement
model later.

**Tech stack:** Next.js 16.2.x · React 19 · Tailwind 4 · TypeScript 5 · Supabase
(`@supabase/supabase-js` + `@supabase/ssr`) · Resend (email) · Vitest (new) · KaTeX ·
react-markdown · Gemini API (tutor/podcasts, unchanged).

---

## 1. Pre-productization baseline (historical snapshot verified 2026-07-12)

> This table describes the app before Phases 1–6. It is historical input, not the continuation
> state. Use §14 and the merged phase handoffs for current contracts; do not resurrect a retired
> route or borrowed infrastructure because it appears below.

| Area | Today |
|---|---|
| App | `cubad/` Next.js 16.2.10 App Router, repo `github.com/ACubad/cubad`, branch `main`, Vercel auto-deploy → cubad.vercel.app |
| Content | Static JSON: `content/subjects.json` + `content/<subject>/unit-N.json`. Loaded by `lib/content.ts` (fs reads + module cache). Schema: `lib/types.ts` (`Unit` is ALREADY a superset: concept/questions/quiz for walkthrough; notes/flashcards/practice for study). Validator: `scripts/validate-content.mjs`. Authoring guides: `docs/authoring/content-schema.md` + `fidelity-addendum.md` |
| Two subjects | `hidroloji` (`kind: "walkthrough"`) and `insaat-yonetimi` (`kind: "study"`). `kind` branches the UI in `app/s/[subject]/page.tsx` (HomeView vs StudyHomeView) and `app/s/[subject]/unit/[slug]/page.tsx` (UnitView vs StudyUnitView). This forked UI is what we unify |
| Progress | 100% client-side localStorage (`lib/progress.tsx`), anonymous cross-device sync via passcode: `lib/sync.ts` (pull → union-merge → push) → `/api/sync` → table `cubad_sync` in the **borrowed** Supabase project "sprout" (`rywcdqpnwwumbpubkofc`, ap-southeast-1), accessed with anon key via REST |
| Podcasts | `/api/podcast` generates (Gemini script + TTS) and stores in sprout's **public** bucket `podcasts` (anon-role writes — a hole we close) |
| Tutor | `/api/tutor` multi-provider BYOK (Gemini default `gemini-3.5-flash`, OpenAI optional) — keep as-is |
| Auth / payments / admin | None. No test framework. No CI |
| Env vars (Vercel + `.env.local`) | `SUPABASE_URL`, `SUPABASE_ANON_KEY` (sprout), `GEMINI_API_KEY`, stale `BLOB_READ_WRITE_TOKEN` |
| i18n | `lib/i18n.tsx`, every user string is `{ tr, en }` (`Bi` type) |

**⚠ Next.js 16 is newer than your training data.** Before writing ANY Next.js code, read the
relevant guide in `node_modules/next/dist/docs/` (this is repo policy — see `AGENTS.md`).
Caching, `params` (async), and route handler conventions have breaking changes.

---

## 2. Product requirements (user's words, gaps filled)

1. **Dedicated database** — new Supabase project owned by this product; migrate off sprout.
2. **Accounts** — signup/login so students save progress server-side. Profile: name, country,
   phone, language, and an education **track** (e.g. Tanzania → NECTA CSEE Form 4).
3. **Catalog by country/level** — students see the subjects/exams for their track. Admin
   decides what's visible where.
4. **Unified content implementation** — one rendering path; every future subject uses the
   superset format (podcast → notes → flashcards → questions/walkthroughs → quiz → practice).
5. **Content uploads appear without redeploys** — admin uploads validated unit JSON in the
   dashboard; students see it immediately. (Student self-uploads are a FUTURE design, §08.)
6. **Tiered paid access** — tiers configured by admin later; the *mechanism* ships now.
7. **Payments v1 (manual)** — student pays externally (M-Pesa/bank), submits a claim with a
   proof screenshot/PDF; admin gets an email + dashboard queue; admin verifies against the
   bank account and approves; system generates a single-use **access code**, emails it to the
   student, and grants a time-limited entitlement. Codes can also be pre-generated in batches
   for offline sales. Selcom/M-Pesa API automation is a future design (§08).
8. **Admin dashboard** — control center: content, catalog, users, payments, codes, tiers,
   audit log, KPIs.
9. **Scale** — must not fall over with many users: cached content reads, indexed queries,
   RLS everywhere, rate limits, monitoring, backups, load test.
10. **Executable without the original author** — every phase plan is decision-complete.

---

## 3. Locked architecture decisions

These are DECIDED. Phase plans must not re-litigate them. If reality contradicts a decision
(API removed, quota, etc.), the executing agent records a deviation note in the phase doc's
Changelog and picks the closest compliant alternative — it does not redesign.

- **D1 — New Supabase project** `cubad-app`, region **eu-central-1** (Frankfurt: good for
  both Turkey ~40ms and East Africa ~150ms; sprout's ap-southeast-1 is wrong for both).
  Schema lives in `supabase/migrations/*.sql` in this repo, applied via Supabase CLI (MCP
  `apply_migration` also acceptable). Never edit an applied migration — always add a new one.
- **D2 — Supabase Auth**, email+password with email confirmation, via `@supabase/ssr`
  (browser client + server client + request-interceptor session refresh — note: in
  Next.js 16 the root convention file is `proxy.ts` exporting `proxy()`, NOT
  `middleware.ts`; see the proxy guide in `node_modules/next/dist/docs/`). Phone collected on the
  profile, NOT used for auth v1 (no SMS cost). Custom SMTP through Resend for auth emails
  (Supabase built-in SMTP is ~2 emails/hour — unusable in production).
- **D3 — Server-side progress**: table `user_state` (one row per user, `state` JSONB —
  exactly the existing `SyncState` shape). The proven union-merge from `lib/sync.ts` is
  reused; only the transport changes (authenticated user id instead of passcode hash).
  Legacy passcode sync keeps working against a `legacy_sync` table (rows copied from
  sprout) until sunset; onboarding offers one-time "import progress from my passcode".
- **D4 — Content in Postgres**: `subjects` + `units` tables; a unit row holds the FULL
  existing unit JSON in `content` JSONB (schema unchanged — `lib/types.ts` stays the
  contract). Server fetchers cache reads (Next cache + tag revalidation on publish).
  Static `content/*.json` becomes the seed data and remains in-repo as fixtures.
- **D5 — Unified UI**: kill `kind` branching. One subject home + one unit page render
  sections conditionally from what the unit JSON contains. `SubjectMeta.kind` survives
  temporarily as a section-ORDER hint, then is deleted from `subjects.json`-derived data.
  Existing content keeps working byte-identically.
- **D6 — Catalog**: `tracks` (country + system + level, e.g. TZ/NECTA CSEE/Form 4) ↔
  `track_subjects` join ↔ `subjects`. Profile stores one `track_id` (single-track v1).
  Unauthenticated visitors see the landing page and track catalog; studying (even free
  units) requires an account.
- **D7 — Access = entitlements**: a user may hold entitlements scoped `all` | `track` |
  `subject`, each with `expires_at`. A subject is accessible iff a covering, unexpired,
  unrevoked entitlement exists, OR the unit is `is_free` (per-unit admin toggle for
  previews). Enforced BOTH in RLS and in server code (defense in depth).
- **D8 — Access codes**: stored **hashed** (sha256 of normalized code; plaintext shown once
  at generation + in the student email). Format `CBD-XXXX-XXXX` (Crockford base32, no
  ambiguous chars). Redemption is an atomic SECURITY DEFINER Postgres function (row lock,
  max-redemption check, per-user uniqueness, rate-limited) — never JS-side check-then-write.
  Stacking rule: redeeming while an active same-scope entitlement exists EXTENDS the
  user's access: a **new entitlement row is inserted** with
  `expires_at = greatest(now(), max expires_at of active same-scope entitlements) + duration`;
  existing rows are never mutated (per-grant provenance and revocability are preserved).
  This lives in ONE function, `public.grant_entitlement(p_user uuid, p_scope_type text,
  p_scope_id uuid, p_tier_id uuid, p_duration_days int, p_source text, p_source_id uuid)
  returns uuid` (SECURITY DEFINER, defined in Phase 4) — `redeem_code` and Phase 6's
  `approve_claim` both route through it; never duplicate the stacking arithmetic.
- **D9 — Payments v1**: `payment_claims` + private storage bucket `payment-proofs`
  (object path MUST be `<auth.uid()>/<claim_id>/<filename>` and the storage RLS policy
  enforces the prefix — never trust a user-writable path column). Approval (one
  transaction) generates a code, auto-redeems it for the claimant, emails the code as
  receipt. Rejection emails the reason. Both paths write `admin_audit_log`.
- **D10 — Email = Resend** (`RESEND_API_KEY`), from `onboarding@resend.dev` until a domain
  exists. Admin notification email on new claim + dashboard queue badge. Email sends happen
  AFTER the DB transaction commits and are logged on failure — email failure never rolls
  back a grant.
- **D11 — Admin = role on profile** (`profiles.role`, default `'student'`), checked via a
  SECURITY DEFINER `public.is_admin()` helper (avoids recursive-RLS pitfalls). Role changes
  only via service-role (SQL or dashboard script). `/admin` is a route group in the same
  app: server-side role check in its layout + RLS as the real barrier. Bootstrap: SQL
  statement promoting ahmedallycubad@gmail.com after first login.
- **D12 — Caching under gating**: unit content fetch is shared-cached (tag:
  `content:<subject>`), the per-request entitlement check is a single indexed query. Pages
  with user state render dynamically; heavy JSON never re-reads the DB per request.
- **D13 — i18n**: TR/EN stays; new UI strings follow the existing `lib/i18n.tsx` pattern.
  Swahili is a future third `Bi` key — do not build now (YAGNI).
- **D14 — Tests**: Vitest added in Phase 1 for pure logic (merge, gating, code hashing,
  validators). DB functions get SQL test scripts runnable against a local/branch database.
  No E2E framework in v1 (manual flow checklists per task instead).
- **D15 — New env var names** (old ones retired at cutover):
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
  (server-only), `RESEND_API_KEY`, `ADMIN_NOTIFY_EMAIL`, `NEXT_PUBLIC_APP_URL`,
  `GEMINI_API_KEY` (unchanged). All Supabase access goes through `lib/supabase/server.ts` /
  `lib/supabase/browser.ts` — no more raw REST fetches sprinkled in routes.

---

## 4. Target data model (the shared contract — column names are LAW)

Phase plans turn this into numbered migrations; they may add indexes/comments but MUST NOT
rename anything below. `Bi` = `{"tr": "...", "en": "..."}` JSONB.

```sql
-- ============ catalog ============
create table public.tracks (
  id            uuid primary key default gen_random_uuid(),
  country_code  text not null,                  -- ISO 3166-1 alpha-2: 'TZ', 'TR'
  system        text not null,                  -- 'NECTA CSEE' | 'NECTA ACSEE' | 'University' | ...
  level         text not null,                  -- 'Form 4' | 'Form 5-6' | 'Undergraduate' | ...
  title         jsonb not null,                 -- Bi display name
  status        text not null default 'hidden' check (status in ('published','hidden')),
  sort          int  not null default 0,
  created_at    timestamptz not null default now()
);

create table public.subjects (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,             -- 'hidroloji'
  title       jsonb not null,                   -- Bi
  tagline     jsonb not null,                   -- Bi
  section_order text not null default 'study' check (section_order in ('walkthrough','study')),
  status      text not null default 'draft' check (status in ('draft','published','archived')),
  sort        int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.track_subjects (
  track_id    uuid not null references public.tracks(id) on delete cascade,
  subject_id  uuid not null references public.subjects(id) on delete cascade,
  sort        int  not null default 0,
  primary key (track_id, subject_id)
);

create table public.units (
  id           uuid primary key default gen_random_uuid(),
  subject_id   uuid not null references public.subjects(id) on delete cascade,
  unit_number  int  not null,
  slug         text not null,
  is_free      boolean not null default false,  -- free-preview toggle
  status       text not null default 'draft' check (status in ('draft','published')),
  content      jsonb not null,                  -- FULL Unit JSON (lib/types.ts shape)
  version      int  not null default 1,
  updated_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (subject_id, slug),
  unique (subject_id, unit_number)
);

-- ============ people ============
create table public.profiles (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  full_name      text not null default '',
  country_code   text not null default '',
  phone          text not null default '',
  preferred_lang text not null default 'tr' check (preferred_lang in ('tr','en')),
  track_id       uuid references public.tracks(id) on delete set null,
  role           text not null default 'student' check (role in ('student','admin')),
  onboarded_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.user_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  state      jsonb not null default '{}'::jsonb,   -- SyncState from lib/sync.ts
  updated_at timestamptz not null default now()
);

create table public.legacy_sync (                  -- copied from sprout.cubad_sync
  id         text primary key,                     -- sha256('cubad:'+passcode)
  state      jsonb,
  updated_at timestamptz,
  claimed_by uuid references auth.users(id)        -- set once imported into an account
);

-- ============ monetization ============
create table public.tiers (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,              -- 'monthly-all', 'term-csee', ...
  title         jsonb not null,                    -- Bi
  description   jsonb not null default '{}'::jsonb,
  scope_type    text not null default 'all' check (scope_type in ('all','track','subject')),
  scope_id      uuid,                              -- the track/subject this tier targets
  duration_days int  not null default 30,
  prices        jsonb not null default '[]'::jsonb, -- [{"currency":"TZS","amount":10000,"country":"TZ"}]
  status        text not null default 'hidden' check (status in ('published','hidden')),
  sort          int  not null default 0,
  created_at    timestamptz not null default now(),
  constraint tiers_scope_target check ((scope_type = 'all') = (scope_id is null))
);

create table public.entitlements (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  scope_type  text not null check (scope_type in ('all','track','subject')),
  scope_id    uuid,                                -- null iff scope_type='all'
  tier_id     uuid references public.tiers(id),
  starts_at   timestamptz not null default now(),
  expires_at  timestamptz not null,
  source      text not null check (source in ('code','admin','payment')),
  source_id   uuid,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index entitlements_user_active on public.entitlements (user_id, expires_at)
  where revoked_at is null;

create table public.access_codes (
  id              uuid primary key default gen_random_uuid(),
  code_hash       text not null unique,            -- sha256(normalized code), NEVER plaintext
  tier_id         uuid not null references public.tiers(id),
  scope_type      text not null check (scope_type in ('all','track','subject')),
  scope_id        uuid,
  duration_days   int  not null,
  max_redemptions int  not null default 1,
  redeemed_count  int  not null default 0,
  valid_until     timestamptz,                     -- redemption deadline (null = no deadline)
  batch_id        uuid,
  note            text,
  created_by      uuid references auth.users(id),
  revoked_at      timestamptz,
  created_at      timestamptz not null default now()
);

create table public.code_redemptions (
  id             uuid primary key default gen_random_uuid(),
  code_id        uuid not null references public.access_codes(id),
  user_id        uuid not null references auth.users(id) on delete cascade,
  entitlement_id uuid references public.entitlements(id),
  created_at     timestamptz not null default now(),
  unique (code_id, user_id)
);

create table public.redemption_attempts (          -- brute-force guard
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  created_at timestamptz not null default now()
);
create index redemption_attempts_user_time on public.redemption_attempts (user_id, created_at);

create table public.payment_claims (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  tier_id     uuid not null references public.tiers(id),
  amount      numeric,
  currency    text,                                -- 'TZS' | 'TRY' | 'USD' | ...
  method      text not null check (method in ('mpesa','tigopesa','airtelmoney','bank','other')),
  payer_ref   text not null default '',            -- txn id / sender phone / sender name
  proof_path  text,                                -- storage path in 'payment-proofs'
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text,
  created_at  timestamptz not null default now()
);
create index payment_claims_queue on public.payment_claims (status, created_at);

-- ============ ops ============
create table public.admin_audit_log (
  id         bigint generated always as identity primary key,
  actor      uuid references auth.users(id),
  action     text not null,                        -- 'claim.approve', 'code.generate', 'unit.publish', ...
  entity     text not null,
  entity_id  text,
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
```

**Storage buckets (new project):** `podcasts` (public read, service-role write ONLY — the
anon-write hole in sprout is not carried over) and `payment-proofs` (private; insert
restricted to path prefix `auth.uid()`; read = owner or admin).

**Key DB functions (signatures are contract; bodies in phase plans):**
- `public.is_admin() returns boolean` — SECURITY DEFINER, reads `profiles.role`.
- `public.has_subject_access(p_subject_id uuid) returns boolean` — SECURITY DEFINER; true if
  any active entitlement covers the subject (`all`, its track via `track_subjects`, or the
  subject itself). Used in RLS on `units` and in server code.
- `public.redeem_code(p_code text) returns jsonb` — SECURITY DEFINER; normalizes (uppercase,
  strip non-alphanumerics), hashes, `select … for update`, validates (revoked? deadline?
  count? already redeemed by user? ≤5 attempts/hour via `redemption_attempts`), creates
  entitlement with the stacking rule, increments count, returns
  `{ok:true, entitlement:{…}}` or `{ok:false, error:'invalid-code'|'expired'|'exhausted'|'already-redeemed'|'rate-limited'}`.
- `public.grant_entitlement(p_user uuid, p_scope_type text, p_scope_id uuid, p_tier_id
  uuid, p_duration_days int, p_source text, p_source_id uuid) returns uuid` — SECURITY
  DEFINER; the ONLY implementation of the D8 stacking rule (insert-new-row). Defined in
  Phase 4; called by `redeem_code` (Phase 4) and `approve_claim` (Phase 6).
- `public.approve_claim(p_claim_id uuid, p_code_hash text, p_duration_days int,
  p_reviewer uuid)` — Phase 6; the approve path (claim→code→redemption→entitlement→audit)
  is ONE transaction; `p_reviewer` is explicit because the service-role client has no
  `auth.uid()`.

**RLS invariants (every table gets RLS ON; policies in phase plans):**
- `profiles`: owner select/update (role column NOT updatable by owner — enforce with a
  column-check trigger or separate grant); admin select all.
- `user_state`: owner only. `legacy_sync`: no client access (server routes only).
- `tracks`/`subjects`/`units` published rows: readable when free/entitled (units) — catalog
  metadata (titles, unit list, is_free flags) readable by any authenticated user; unit
  `content` only via `is_free or has_subject_access(...)`. Draft/hidden rows: admin only.
- `tiers` published: readable by all authenticated. `entitlements`: owner select; no client
  writes. `access_codes`: admin only (redemption goes through the RPC). `payment_claims`:
  owner insert/select own pending→any status; admin everything. `admin_audit_log`: admin
  select; inserts via service role/definer functions only.

---

## 5. Canonical examples (use these EXACT values in every phase plan)

- **Track:** `{ country_code: 'TZ', system: 'NECTA CSEE', level: 'Form 4', title: {tr:'Tanzanya — CSEE (Form 4)', en:'Tanzania — CSEE (Form 4)'} }`
- **Tier:** `{ slug: 'term-all', title: {tr:'Dönemlik — Tümü', en:'Term — All access'}, scope_type: 'all', duration_days: 120, prices: [{"currency":"TZS","amount":15000,"country":"TZ"},{"currency":"USD","amount":6,"country":"*"}] }`
- **Code lifecycle:** plaintext `CBD-7K3M-9PXQ` → normalized `CBD7K3M9PXQ` → sha256 hex
  stored in `code_hash`. Student redeems → `code_redemptions` row → entitlement
  `{scope_type:'all', expires_at: now()+120d, source:'code'}`.
- **Claim lifecycle:** student on tier `term-all` pays 15,000 TZS via M-Pesa → creates claim
  `{method:'mpesa', payer_ref:'SFC8KL29XY', amount:15000, currency:'TZS'}` + uploads
  `payment-proofs/<uid>/<claim_id>/receipt.jpg` → admin email + queue → admin checks the
  bank/M-Pesa account statement manually → Approve → transaction mints code, redeems it for
  the student, entitlement active → student emailed code + expiry; claim row shows
  `approved`. Reject path: status `rejected` + `review_note` (student sees it in-app + email).
- **The two seeded subjects:** `hidroloji` (section_order `walkthrough`) and
  `insaat-yonetimi` (section_order `study`), both attached to a seeded
  `TR / University / Undergraduate` track, all units `is_free = true` initially (current
  users lose nothing at cutover).

## 6. Access decision (single source of truth)

```
can_study(user, unit) =
  unit.status = 'published'
  AND unit.subject.status = 'published'
  AND ( unit.is_free
        OR EXISTS entitlement e:
             e.user_id = user
             AND e.revoked_at IS NULL
             AND now() BETWEEN e.starts_at AND e.expires_at
             AND ( e.scope_type = 'all'
                   OR (e.scope_type = 'track'   AND unit.subject ∈ track_subjects(e.scope_id))
                   OR (e.scope_type = 'subject' AND e.scope_id = unit.subject_id) ) )
```
Anonymous visitors: catalog browsing only; any study surface → sign-up wall.
Expiry needs no cron: it's a query-time comparison. (Optional expiry-reminder email is a
Phase 7 nice-to-have.)

## 7. Phase map

| Doc | Phase | Ships | Depends on |
|---|---|---|---|
| `01-foundation.md` | 1 | New Supabase project, CLI+migrations scaffold, `lib/supabase/*` clients, env matrix, Vitest, CI (lint+build+validate-content+test), full schema migration + seed script from `content/` | — |
| `02-auth-profiles.md` | 2 | Signup/login/reset/confirm flows, middleware, onboarding wizard (name/country/phone/track), server progress (`user_state`) reusing union-merge, legacy passcode import, account UI in Header | 1 |
| `03-content-db-unified-ui.md` | 3 | DB-backed content fetchers with tag caching, unified subject home + unit page (no `kind` forks), podcasts bucket in new project, publish script, sprout data migration (sync rows + podcast objects), env cutover | 1 (parallel-safe with 2) |
| `04-catalog-tiers-access.md` | 4 | Tracks/track_subjects/tiers CRUD-able data, entitlements, `has_subject_access`, `redeem_code` RPC + redemption UI, free-unit previews, paywall/upgrade surfaces | 2, 3 |
| `05-admin-dashboard.md` | 5 | `/admin`: overview KPIs, content upload+validate+publish, catalog & tier management, user management (grant/revoke), code generation (single+batch, CSV export), audit log viewer | 4 |
| `06-payments-v1.md` | 6 | Claim submission + proof upload (private bucket), Resend emails (admin notify, approval w/ code, rejection), admin review queue, atomic approve path, claim history | 5 |
| `07-hardening-scale.md` | 7 | Rate limits, security audit checklist (RLS probe tests), monitoring (Vercel analytics, Supabase advisors, optional Sentry), backups, load test (k6), performance passes, launch checklist | 6 |
| `08-future-selcom-and-student-uploads.md` | 8 | DESIGN DOCS ONLY: Selcom/M-Pesa checkout+webhook → auto-entitlement; student note-upload pipeline (submission → AI authoring per `docs/authoring/*` → validation → admin review → publish) | — |

Each phase ends with the app deployable and everything before it still working. Cutover off
sprout happens at the END of Phase 3 (until then production keeps running on sprout).

## 8. What "done" means (every task, every phase)

1. All checkboxes of the task done, in order (tests first where given).
2. `npm run lint` and `npm run build` pass **run from `cubad/`** (RSC/bundling errors do
   not show up in tsc — the build is the authority; never run two builds concurrently).
3. `node scripts/validate-content.mjs` passes whenever content or its schema is touched.
4. `npx vitest run` passes (once Phase 1 lands).
5. New migrations apply cleanly on a fresh database (`supabase db reset` locally succeeds).
6. The manual verification checklist at the end of the task passes (these enumerate real
   flows: "sign up → confirm → onboard → see track subjects").
7. Committed with the given message; pushed only when the phase doc says so (pushes to
   `main` auto-deploy production — mid-phase work stays on the phase branch
   `feat/phase-N-<slug>`, merged via PR at phase end).

## 9. Security invariants (violations = stop and fix, never ship)

- `SUPABASE_SERVICE_ROLE_KEY` appears ONLY in server code paths (`lib/supabase/server.ts`
  consumers); never in a client component, never in `NEXT_PUBLIC_*`.
- Every new table: `alter table … enable row level security` in the same migration.
- Storage object paths are constructed server-side from `auth.uid()` — a privileged delete
  or read must never take a user-supplied path (cross-account deletion primitive).
- Aggregates that gate anything (redemption counts, KPI queries) run IN SQL
  (count/sum/RPC), never as a JS reduce over fetched rows (PostgREST caps at 1000 rows and
  silently truncates).
- Codes: plaintext never stored, never logged, shown once.
- All admin mutations write `admin_audit_log` in the same transaction.
- Auth pages and `redeem_code` are rate-limited; failed redemptions are recorded.

## 10. Risks & traps (learned the hard way — read before coding)

| Trap | Reality / rule |
|---|---|
| Next 16 differs from training data | Read `node_modules/next/dist/docs/` guide for the API you touch, FIRST |
| `tsc` green ≠ app builds | `import "server-only"` and RSC-boundary breaks appear only in `next build`. The build gate is mandatory |
| RLS recursion on `profiles` | Admin checks via SECURITY DEFINER `is_admin()`, not a policy that selects from `profiles` inside a `profiles` policy |
| PostgREST 1000-row cap | Any count/sum in SQL. A silent undercount toward MORE access is a security bug |
| Check-then-write races | Redemption/approval logic lives in SQL functions with row locks — two parallel requests must not double-redeem |
| Public bucket + anon writes (sprout) | New buckets: service-role writes only; proofs bucket private with prefix-enforced policies |
| Vercel 300s function cap | Podcast generation stays pre-generated/off-peak; nothing in the paid path may approach the cap |
| Union-merge resurrection | Progress reset must PUSH plain state (no merge) — preserved behavior from `lib/sync.ts` |
| Supabase free-tier email limits | Resend SMTP for auth emails before ANY real signup traffic |
| Migration drift | Never edit applied migrations; `supabase db reset` must always succeed from scratch |

## 11. Operating manual for executing agents

- **Loop per task:** read the task fully → make the change exactly as specified → run the
  task's commands → tick the checkbox in the phase doc → commit with the given message.
- **Blocked twice on the same step?** Stop. Write what you tried and the exact errors into
  the phase doc under `## Changelog / deviations`, and surface it to the human. Do not
  improvise around a locked decision.
- **Plan vs reality:** reality wins; smallest compliant deviation; record it.
- **Routing (for Claude Code orchestrators):** standard tasks → sonnet subagents; auth,
  RLS, payments, migrations → opus; audits → opus two-pass (spec compliance, then
  adversarial). Solo agents (Codex): execute sequentially and self-audit against §8 + §9
  after each phase.
- **Never** run two `next build`/`next dev` processes concurrently in one checkout; never
  run the test suite during a build; pin the working directory to `cubad/` for every command.
- **Secrets:** ask the human for keys (Supabase, Resend) via the env checklist in Phase 1 —
  never invent, never commit them. `.env.local` stays gitignored.
- **Supabase docs:** when an API detail is uncertain, consult current Supabase docs (MCP
  `search_docs` or web) — do not guess from memory.

## 12. Phase-plan authoring rules (for the agents WRITING plan docs 01–08)

1. Start with the standard header (For agentic workers / Goal / Architecture / Tech stack),
   then `## Prerequisites` (phase deps + required reading list of repo files), then tasks.
2. Tasks are bite-sized (2–5 min steps), checkbox steps, with: exact file paths
   (create/modify), COMPLETE code for every code step (no "add validation here", no TBD,
   no "similar to Task N" — repeat the code), exact commands with expected output, a
   commit step with message, a **manual verification checklist**, and a **failure modes**
   note (what typically goes wrong in this task + the fix).
3. Column names, function signatures, env var names, bucket names, route paths: copy from
   THIS document exactly. Canonical examples (§5) verbatim where relevant.
4. Every phase doc ends with: `## Phase acceptance checklist` (runnable), `## Rollback`
   (how to revert the phase safely), and an empty `## Changelog / deviations` section.
5. UI tasks: follow the existing visual language (read `docs/DESIGN.md`, reuse
   `components/ui.tsx` primitives, Tailwind 4, `Bi` strings through `lib/i18n.tsx`).
   All new user-facing strings need both `tr` and `en`.
6. TDD where the logic is pure (Vitest); DB behavior gets SQL probe scripts; UI gets manual
   checklists. Every task that touches money, access, or auth needs at least one
   negative-path verification (wrong user, expired, replay, etc.).
7. Write for an engineer with zero context for this codebase and no access to the plan
   author. Spell out both the WHAT and the WHY of anything non-obvious.

## 13. Cutover plan (executed inside Phase 3, kept here for visibility)

1. Build phases 1–3 against the new project; production keeps using sprout untouched.
2. Migration script (service keys of BOTH projects, run locally): copy `cubad_sync` rows →
   `legacy_sync`; copy every object of sprout bucket `podcasts` → new `podcasts` bucket.
3. Flip Vercel env vars to the new project (D15 names); deploy; smoke-test: passcode sync
   still round-trips, podcasts still play, tutor unaffected.
4. Sprout is then left untouched (do NOT delete its data for 60 days — rollback = flip env
   vars back).
5. New accounts + "import from passcode" (Phase 2 UI) migrate users off passcodes organically.

## 14. Post-audit contract registry (2026-07-12 — binds all phase docs)

The phase docs were adversarially audited after writing; these reconciliations are LAW and
override any stray older wording inside a phase doc:

- **Supabase client factories** (all in `lib/supabase/`, Phase 1 owns): browser →
  `createClient()` from `browser.ts`; server (cookie-bound, RLS) → `async createClient()`
  from `server.ts`; service-role → `createServiceRoleClient()` from `server.ts` (the ONLY
  service-key touchpoint; there is NO `lib/supabase/admin.ts` and no `createServiceClient`
  / `createAdminClient`).
- **Auth routes** (Phase 2 owns): `/auth/sign-in`, `/auth/sign-up`, `/auth/forgot-password`,
  `/auth/reset-password`, `/auth/confirm`. There is NO `/login` route — sign-in walls
  redirect to `/auth/sign-in?next=<path>`.
- **Root request interceptor**: `proxy.ts` (Next 16), never a root `middleware.ts`.
- **Migrations**: always created with `npx supabase migration new <name>` (timestamp
  prefixes). Never hand-write sequence-numbered filenames like `0003_...` — they sort
  before timestamped migrations and break `supabase db reset` ordering.
- **Profiles role guard**: one trigger only — function `protect_profile_role()`, trigger
  `profiles_protect_role` (Phase 1 names). Later phases extend via `create or replace` of
  THAT function, never a second parallel trigger.
- **`profiles.email`**: added by Phase 5 (column + backfill + trigger update), not Phase 2.
- **Content RPCs** (Phase 3 owns; Phase 4 extends gate): `get_unit_content(p_subject_slug
  text, p_unit_slug text)`, `list_units_meta(p_subject_slug text)`.
- **`app_settings`** (key text pk, value jsonb, updated_by, updated_at — Phase 6 owns):
  one public SELECT policy with an explicit key allow-list. Phase 6's final policy allows only
  `payment_instructions`; Phase 7 must extend that allow-list to
  `('payment_instructions', 'announcement_banner')` in a NEW migration when it adds the banner.
  Never restore `using (true)`. Writes are service-role-only through `set_app_setting`; the
  historical `app_settings_write_admin` policy may still exist but is inert because authenticated
  roles have no INSERT/UPDATE/DELETE table privileges, and Phase 7 may drop that policy.
- **`tiers.scope_id`**: exists (see §4) — null iff `scope_type='all'`; admin tier CRUD must
  set it for track/subject tiers.
- **Progress endpoint** (Phase 2): `app/api/state/route.ts` (`/api/state`).
- **Retired progress endpoint** (Phase 3): `/api/sync` and passcode sync were deleted after the
  legacy migration. `/api/state` is now the only runtime progress transport; `/api/sync` must
  remain 404.
- **Upgrade flow routes** (Phase 6): `/upgrade`, `/upgrade/pay/[tierSlug]`,
  `/upgrade/claims`; Phase 4's paywall panel carries BOTH `redeemHref` (`/redeem?next=…`)
  and `upgradeHref` (`/upgrade?next=…`).
- **Payment mutation transport** (Phase 6): there is NO `/api/claims` route. Claim submission and
  cancellation are Server Actions in `app/upgrade/actions.ts`; approval, rejection, and payment-
  instruction updates are Server Actions in `app/admin/payments/actions.ts`. Later hardening must
  modify these actual actions rather than creating a parallel claim API.
- **Vitest**: config discovers colocated tests — `include: ["**/*.test.ts", "**/*.test.tsx"]`
  (node_modules excluded by default), not `tests/**` only.
- **Additional env vars beyond D15** (all legitimate): `REVALIDATE_SECRET` (Phase 3),
  `EMAIL_FROM` (Phase 6; supersedes the hardcoded sender in D10), `CRON_SECRET` (Phase 7),
  `SUPABASE_DB_URL` (GitHub Actions secret, Phase 7), `NEXT_PUBLIC_SUPPORT_EMAIL` (Phase 7;
  intentionally public, human-approved privacy/support address), plus sprout-migration one-offs
  `SPROUT_URL`/`SPROUT_SERVICE_KEY` (Phase 3 script, local only).
- **Executing SQL runbooks/probes**: the Supabase CLI has no `db execute` subcommand — use
  `psql "$DB_URL" -f <file>` (psql meta-commands like `\set` only work there), the
  dashboard SQL editor, or MCP `execute_sql`.

## 15. Glossary

**Track** country+system+level a student studies under · **Tier** a sellable package
(scope+duration+prices) · **Entitlement** a user's time-boxed access grant · **Access
code** redeemable voucher minting an entitlement · **Claim** a student's "I paid" report
awaiting manual verification · **Unit JSON** the superset content format of `lib/types.ts` ·
**Sprout** the old borrowed Supabase project · **Free unit** `is_free` preview unit.
