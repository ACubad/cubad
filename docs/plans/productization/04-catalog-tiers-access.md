# Phase 4 — Catalog gating, Tiers, Entitlements & Access Codes

> **For agentic workers:** This is phase plan **04** of the cubad productization program.
> Read `00-MASTER-PLAN.md` FULLY before this document — §3 (locked decisions, esp. D6/D7/D8),
> §4 (schema — column names are LAW), §5 (canonical examples), §6 (the access decision),
> §9 (security invariants) and §12 (authoring rules) govern everything below. Execute tasks
> **in order**, top to bottom. Tick each `- [x]` box as you finish its step. Every code block
> is complete and copy-paste ready — there is no "TBD", no "similar to above". If you are a
> Claude Code session, use `superpowers:subagent-driven-development` and route migration / RLS
> / redemption tasks to **opus** subagents, audits to **opus two-pass** (spec compliance, then
> adversarial). If you are a solo agent, self-audit against master §8 + §9 after each task.

**Goal:** Ship the *mechanism* of paid access. After this phase a unit can be gated, a student
who is not entitled sees a lock + paywall, and a student with a valid **access code** can redeem
it to mint a time-boxed **entitlement** that unlocks the content — enforced in the database
(RLS + SECURITY DEFINER functions) AND in server code (defense in depth, master D7). Free-preview
units stay open. No admin UI and no payments yet (those are Phases 5 and 6); this phase delivers
the data functions, the redemption flow, and the student-facing paywall/redeem/expiry surfaces.

**Architecture:** Next.js 16 (App Router, RSC) on the new `cubad-app` Supabase project. The
access rule lives in one place — `public.has_subject_access(uuid)` — and is called from three
callers so they can never drift: the `units`/content RLS, the `get_unit_content` RPC, and the
server helper `lib/access/access.ts`. Redemption is a single atomic `public.redeem_code(text)`
SECURITY DEFINER function (row lock + rate limit + stacking) — never a JS check-then-write.
Codes are stored as `sha256(normalized)`; plaintext is shown once and never persisted or logged.

**Tech stack (unchanged from master):** Next.js 16.2.x · React 19 · Tailwind 4 · TypeScript 5 ·
Supabase (`@supabase/supabase-js` + `@supabase/ssr`) · Vitest · Postgres 15 + `pgcrypto`.

> **⚠ Next.js 16 is newer than your training data.** Before writing ANY Next.js code read the
> relevant guide under `cubad/node_modules/next/dist/docs/` (repo policy — `AGENTS.md`). This
> phase touches Server Actions, `redirect`, `revalidatePath`, async `params`, and `react`'s
> `cache()`. The guides used while authoring this plan:
> `01-app/02-guides/server-actions.md`, `01-app/01-getting-started/07-mutating-data.md`,
> `01-app/03-api-reference/04-functions/redirect.md`, `.../revalidatePath.md`.

---

## Prerequisites

**Phase dependencies (must be merged and green before starting):**

- **Phase 1 — Foundation.** New Supabase project `cubad-app`; `supabase/` CLI project with
  migrations; **the full schema from master §4 already created, with RLS ENABLED on every
  table** (`alter table … enable row level security`); `public.is_admin()` SECURITY DEFINER
  helper; `lib/supabase/server.ts` + `lib/supabase/browser.ts` clients; Vitest wired
  (`npx vitest run` works). The index `entitlements_user_active` and
  `redemption_attempts_user_time` exist (they are in the §4 schema migration).
- **Phase 2 — Auth & profiles.** Supabase Auth (email+password), middleware session refresh,
  `profiles` rows (with `track_id`, `country_code`, `role`), the onboarding wizard, and account
  UI in the Header. A logged-in request can call `await supabase.auth.getUser()`.
- **Phase 3 — Content DB + unified UI.** `units`/`subjects` served from Postgres; the unified
  subject-home and unit page (no `kind` fork); catalog metadata readable by authenticated users;
  and the SECURITY DEFINER RPC **`get_unit_content(subject_slug, unit_slug)`** which today gates
  on `is_free OR is_admin()`. All seeded units are `is_free = true`.

**Assumed artifact names from earlier phases (verify before use; adapt the import if a sibling
phase named it differently — the LOGIC in this plan does not change):**

| Symbol | Assumed location | Used for |
|---|---|---|
| `createClient()` (async, user-scoped SSR client) | `lib/supabase/server.ts` | all user RPC/queries here |
| `createServiceRoleClient()` (service-role client) | `lib/supabase/server.ts` | negative-path test only |
| `is_admin()` | DB function (Phase 1) | RLS + gating |
| `get_unit_content(text, text)` | DB function (Phase 3) | extended in Task 2 |
| the unified **subject-home** component + **unit page** | `app/s/[subject]/…` (Phase 3) | wired in Tasks 9–11 |
| a catalog fetcher returning per-unit `{ id, slug, unit_number, is_free, title, tagline, status }` | Phase 3 (e.g. `lib/content-db.ts`) | lock badges (Task 9) |

> If Phase 3 did not expose a catalog fetcher with `is_free`, read the unit list metadata
> directly from the authenticated server client (RLS permits it): a `units` row exposes
> `id, subject_id, unit_number, slug, is_free, status`; `title`/`tagline` live inside the
> `content` JSON, so Phase 3 must project them for the list. Prefer the Phase 3 fetcher; the
> direct query is the documented fallback and is shown inline where needed.

**Required reading (repo files) before coding:**
`00-MASTER-PLAN.md` · `AGENTS.md` · `lib/types.ts` (the `Bi` type + `Unit` shape) ·
`lib/i18n.tsx` (string pattern — every new string needs `tr` + `en`) · `components/ui.tsx`
(reuse primitives; note there is **no** generic `<Button>` — use the card/link Tailwind
patterns) · `docs/DESIGN.md` (visual language: warm paper, `deniz` accent, `font-display`) ·
`components/HomeView.tsx` (the unit-card list pattern you will extend) · `app/globals.css`
(color tokens: `paper card ink ink-soft ink-faint line line-soft deniz deniz-deep deniz-soft
wash amber amber-soft clay clay-soft moss moss-soft`).

**Working-directory rule:** every command below runs from `cubad/`. Never run two
`next build`/`next dev` at once. `.env.local` stays gitignored.

**Branch:** all work in this phase happens on `feat/phase-4-catalog-tiers-access` (created in
Task 0), merged to `main` via PR only at the end (Task 16). Pushing `main` auto-deploys.

---

## Task 0 — Branch, verify prerequisites, ensure pgcrypto

- [x] From `cubad/`, create the phase branch:
  ```bash
  git checkout main && git pull
  git checkout -b feat/phase-4-catalog-tiers-access
  ```
- [x] Confirm the prerequisite DB objects exist (run against the `cubad-app` dev/branch DB via
  `psql`, the dashboard SQL editor, or MCP `execute_sql` — the Supabase CLI has NO `db execute`
  subcommand, master §14). Expected: each row returns `t`.
  ```sql
  select
    to_regprocedure('public.is_admin()')                       is not null as has_is_admin,
    to_regprocedure('public.get_unit_content(text,text)')      is not null as has_get_unit_content,
    to_regclass('public.entitlements')                          is not null as has_entitlements,
    to_regclass('public.tiers')                                 is not null as has_tiers,
    to_regclass('public.access_codes')                          is not null as has_access_codes,
    to_regclass('public.code_redemptions')                      is not null as has_code_redemptions,
    to_regclass('public.redemption_attempts')                   is not null as has_redemption_attempts,
    to_regclass('public.entitlements_user_active')              is not null as has_active_index;
  ```
  If any is `f`, **stop** — a prerequisite phase is incomplete. Record it under
  `## Changelog / deviations` and surface to the human (master §11). Do not create the missing
  objects yourself; they belong to an earlier phase.
- [x] Confirm RLS is enabled on the tables this phase policies (they should already be, from
  Phase 1). Expected: all `t`.
  ```sql
  select relname, relrowsecurity
  from pg_class
  where relnamespace = 'public'::regnamespace
    and relname in ('tiers','entitlements','access_codes','code_redemptions','redemption_attempts')
  order by relname;
  ```
- [x] Create the migration that guarantees `pgcrypto` (needed for `digest()` in `redeem_code`).
  Supabase ships `pgcrypto` in the `extensions` schema; this is idempotent and safe to re-run.
  ```bash
  supabase migration new phase4_pgcrypto
  ```
  Paste into the generated `supabase/migrations/<ts>_phase4_pgcrypto.sql`:
  ```sql
  -- Phase 4: ensure pgcrypto is available for sha256 code hashing.
  -- On Supabase, extensions live in the dedicated `extensions` schema.
  create extension if not exists pgcrypto with schema extensions;
  ```
- [x] Apply and verify:
  ```bash
  supabase db reset      # full rebuild from scratch must succeed (master §8.5)
  ```
  Then confirm the hashing primitive resolves and matches the JS test vector we will assert in
  Task 5 (this proves SQL↔JS parity up front):
  ```sql
  select encode(extensions.digest('CBD7K3M9PXQ','sha256'),'hex') as sql_hash;
  -- expected: 0469f76c67a68e98cf8c9baea7aebef3e4f96d68eb7fb77cde202c5ca813c449
  ```
- [x] Commit:
  ```bash
  git add supabase/migrations
  git commit -m "phase4: ensure pgcrypto extension for code hashing"
  ```

**Manual verification checklist**
- `supabase db reset` completes with no error.
- The `sql_hash` above is exactly `0469f76c67a68e98cf8c9baea7aebef3e4f96d68eb7fb77cde202c5ca813c449`.

**Failure modes**
- `ERROR: could not open extension control file … pgcrypto`: the platform image lacks pgcrypto.
  This is standard on Supabase; if it truly is missing, record it and stop — it is a platform
  prerequisite, not something to hack around.
- `function extensions.digest(...) does not exist` later: pgcrypto installed in a *different*
  schema. Check with `select extnamespace::regnamespace from pg_extension where extname='pgcrypto';`
  and adjust the `search_path` in Task 2's function accordingly (documented there).

---

## Task 1 — `has_subject_access()` + covering-index sanity

Implements master §6 exactly: an entitlement covers a subject when it is unrevoked, `now()` is
inside `[starts_at, expires_at]`, and its scope is `all`, or `subject` matching this subject, or
`track` whose `track_subjects` contains this subject. It is `SECURITY DEFINER` so it can read
`entitlements` regardless of the caller's RLS, and `STABLE` because it only reads.

- [x] Create the migration:
  ```bash
  supabase migration new phase4_has_subject_access
  ```
  Paste into `supabase/migrations/<ts>_phase4_has_subject_access.sql`:
  ```sql
  -- Phase 4: single source of truth for "does the current user have access to this subject?"
  -- Mirrors master §6. Called from units/content RLS, get_unit_content, and lib/access/access.ts.
  create or replace function public.has_subject_access(p_subject_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
  as $$
    select exists (
      select 1
      from public.entitlements e
      where e.user_id = auth.uid()
        and e.revoked_at is null
        and now() between e.starts_at and e.expires_at
        and (
              e.scope_type = 'all'
          or (e.scope_type = 'subject' and e.scope_id = p_subject_id)
          or (e.scope_type = 'track'   and exists (
                select 1
                from public.track_subjects ts
                where ts.track_id = e.scope_id
                  and ts.subject_id = p_subject_id
              ))
        )
    );
  $$;

  comment on function public.has_subject_access(uuid) is
    'True iff the current auth.uid() holds an active (unrevoked, now within [starts_at,expires_at]) '
    'entitlement covering p_subject_id via scope all/subject/track. Master §6.';

  -- auth.uid() reflects the CALLER''s JWT even in a SECURITY DEFINER function, so the answer is
  -- always about the requesting user. Expose to authenticated users (used as an RPC by the
  -- access helper) and keep it callable by RLS. Anonymous callers get false (auth.uid() is null).
  revoke all on function public.has_subject_access(uuid) from public;
  grant execute on function public.has_subject_access(uuid) to authenticated, service_role;
  ```
- [x] Covering-index sanity — do NOT create a new index; confirm Phase 1's partial index is
  present and used. The query filters `user_id` + `revoked_at is null` and range-scans on the
  timestamps; `entitlements_user_active (user_id, expires_at) where revoked_at is null` covers
  the hot path. `track_subjects` lookups use its composite PK `(track_id, subject_id)`.
  ```sql
  -- must return the partial index definition
  select indexdef from pg_indexes
  where schemaname='public' and indexname='entitlements_user_active';
  ```
- [x] Apply and smoke-test with a fabricated JWT claim (postgres role; no login needed):
  ```sql
  begin;
    -- pretend to be a user with no entitlements:
    set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001"}';
    select public.has_subject_access(gen_random_uuid()) as should_be_false;  -- expected: f
  rollback;
  ```
- [x] Commit:
  ```bash
  supabase db reset
  git add supabase/migrations
  git commit -m "phase4: has_subject_access() — single source of truth for subject access (master §6)"
  ```

**Manual verification checklist**
- `should_be_false` is `f`.
- `entitlements_user_active` exists as a partial index `WHERE (revoked_at IS NULL)`.
- A full `supabase db reset` still succeeds.

**Failure modes**
- `permission denied for function has_subject_access` when the access helper calls it (Task 6):
  the `grant execute … to authenticated` line above was skipped, or PostgREST's schema cache is
  stale — run `notify pgrst, 'reload schema';` (Supabase auto-reloads within seconds).
- Access wrongly granted via `track` scope: confirm `track_subjects` uses `subject_id` (not
  `subject`) — copy column names from master §4 verbatim.

---

## Task 2 — Extend `get_unit_content` with the entitlement gate

Phase 3's `get_unit_content` gates on `is_free OR is_admin()`. Phase 4 adds
`OR has_subject_access(subject_id)` so entitled students receive gated content. **Never edit an
applied migration** (master D1) — this is a new `create or replace` migration.

- [x] First read Phase 3's current definition and copy its body verbatim as your starting point,
  changing ONLY the access predicate. Find it:
  ```bash
  grep -rn "function public.get_unit_content" cubad/supabase/migrations
  ```
- [x] Create the migration:
  ```bash
  supabase migration new phase4_get_unit_content_entitlement_gate
  ```
  Paste into `supabase/migrations/<ts>_phase4_get_unit_content_entitlement_gate.sql`. The body
  below is the **reference target** — it implements master §6 in full (published subject +
  published unit for non-admins; admin sees drafts). If Phase 3's body differs, keep its
  structure and change only the gate line marked `<<< PHASE 4`:
  ```sql
  -- Phase 4: gate get_unit_content on free OR admin OR entitlement (master §6, D7).
  create or replace function public.get_unit_content(p_subject_slug text, p_unit_slug text)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = public
  as $$
  declare
    v_subject_id     uuid;
    v_subject_status text;
    v_content        jsonb;
    v_is_free        boolean;
    v_unit_status    text;
  begin
    select s.id, s.status into v_subject_id, v_subject_status
    from public.subjects s
    where s.slug = p_subject_slug;

    if v_subject_id is null then
      return null;                              -- unknown subject
    end if;

    select u.content, u.is_free, u.status
      into v_content, v_is_free, v_unit_status
    from public.units u
    where u.subject_id = v_subject_id
      and u.slug = p_unit_slug;

    if v_content is null then
      return null;                              -- unknown unit
    end if;

    -- Admins can read everything, including drafts, for preview.
    if public.is_admin() then
      return v_content;
    end if;

    -- Non-admins: only published units of published subjects are ever visible.
    if v_unit_status <> 'published' or v_subject_status <> 'published' then
      return null;
    end if;

    -- ACCESS GATE — free preview OR active entitlement.        <<< PHASE 4 (added has_subject_access)
    if v_is_free or public.has_subject_access(v_subject_id) then
      return v_content;
    end if;

    return null;                                -- locked: caller renders the paywall
  end;
  $$;

  comment on function public.get_unit_content(text,text) is
    'Returns a unit''s content JSON when readable by the caller: admin (any status) OR published '
    'unit of published subject that is free OR covered by an active entitlement. Else null. Master §6.';
  ```
  > `create or replace` **preserves** existing grants and ownership, so Phase 3's
  > `grant execute … to authenticated` stays in force — do not re-grant. Anonymous study is
  > walled at the page layer (Task 10) and by Phase 3 not granting `anon` execute; do not add an
  > `anon` grant here.
- [x] Apply and verify the gate with fabricated claims. Seed a locked unit locally first (or use
  the Task 14 setup). Quick inline check against a known published, non-free unit:
  ```sql
  begin;
    set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002"}';
    -- for a published, is_free=false unit with no entitlement, expect NULL:
    select public.get_unit_content('hidroloji','unit-1') is null as locked_when_unentitled;
  rollback;
  ```
  (With the default seeds — all `is_free=true` — this returns `f` because free content is
  returned; that is the correct free-preview behaviour. Task 14 flips a unit to prove the lock.)
- [x] Commit:
  ```bash
  supabase db reset
  git add supabase/migrations
  git commit -m "phase4: extend get_unit_content with has_subject_access gate (master §6/D7)"
  ```

**Manual verification checklist**
- `supabase db reset` succeeds; `get_unit_content` still returns free/published content.
- With a non-free unit + no entitlement, the RPC returns `null` (proven fully in Task 14).

**Failure modes**
- Function returns content for a locked unit: the gate line still reads only `is_free`/`is_admin`;
  re-check the `<<< PHASE 4` line.
- `structure of query does not match function result type`: Phase 3's return type differs from
  `jsonb`; keep Phase 3's exact `returns …` clause and only alter the gate.

---

## Task 3 — `grant_entitlement()` + `redeem_code()` — atomic, rate-limited, stacking redemption

This is the security core (master D8 + §4 signatures + §9). One migration defines TWO functions:
`grant_entitlement` — the ONLY implementation of the D8 stacking rule (a master §4 contract;
Phase 6's `approve_claim` calls the same function — never duplicate the stacking arithmetic) —
and `redeem_code`, which validates the code under a row lock and mints via `grant_entitlement`.
Redemption stays atomic: one function call, one transaction, so two parallel requests can never
double-redeem. Read the ordering rationale below before writing it.

**Ordering decision (WHY the rate limiter is FIRST):** master §9 says *"failed redemptions are
recorded"* and D8 requires the limiter to survive brute force. The brute-force case is an
attacker guessing many *invalid* codes. If the attempt were recorded only after the
`invalid-code` early-return, invalid guesses would never consume attempts and the limiter would
be useless. Therefore we **insert the attempt row first, then count**, at the very top — before
any validation that can early-return. Every call (success or failure) consumes exactly one
attempt. The 6th call within an hour is blocked.

**Stacking decision (WHY we INSERT a new entitlement, never UPDATE — and why it lives in ONE
function):** master D8 says redeeming while an active same-scope entitlement exists EXTENDS the
user's access:
`new expires_at = greatest(now(), current max expires_at of matching active same-scope entitlement) + duration_days`.
Per the master §4 contract this arithmetic exists exactly ONCE, in
`public.grant_entitlement(p_user, p_scope_type, p_scope_id, p_tier_id, p_duration_days, p_source,
p_source_id) returns uuid` (defined below, BEFORE `redeem_code`). It **inserts a new
`entitlements` row** with the computed `expires_at`, and never touches the old row.
`redeem_code` (this phase) and `approve_claim` (Phase 6) both route through it. Reasons for
insert-not-update: (1) the `entitlements` table is an append-only ledger — every grant is
auditable and refundable/revocable individually; (2) `has_subject_access` is an `EXISTS`
over covering rows, so overlapping rows are harmless — the furthest-out expiry naturally wins;
(3) no lost-update race on an in-place `UPDATE`. `scope_id` is compared with `is not distinct
from` so the `all` scope (null `scope_id`) matches correctly.

- [x] Create the migration:
  ```bash
  supabase migration new phase4_redeem_code
  ```
  Paste into `supabase/migrations/<ts>_phase4_redeem_code.sql`:
  ```sql
  -- Phase 4: grant_entitlement (the ONLY D8 stacking implementation — master §4 contract) +
  -- atomic single-use access-code redemption. Master D8, §4 signatures, §9 invariants.

  -- ---------------------------------------------------------------------------
  -- grant_entitlement: inserts a NEW entitlement row — never UPDATEs an existing
  -- one — with expires_at = greatest(now(), max expires_at of the user's active
  -- unrevoked same-scope entitlements) + p_duration_days. Returns the new
  -- entitlement id. Called by redeem_code (below) and by Phase 6's approve_claim;
  -- the stacking arithmetic must never be duplicated anywhere else.
  -- ---------------------------------------------------------------------------
  create or replace function public.grant_entitlement(
    p_user          uuid,
    p_scope_type    text,
    p_scope_id      uuid,
    p_tier_id       uuid,
    p_duration_days int,
    p_source        text,
    p_source_id     uuid
  )
  returns uuid
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_max_expires timestamptz;
    v_expires     timestamptz;
    v_ent_id      uuid;
  begin
    -- STACKING: extend from the furthest-out active same-scope expiry (or from now()).
    -- scope_id uses IS NOT DISTINCT FROM so the 'all' scope (null scope_id) matches correctly.
    select max(e.expires_at) into v_max_expires
    from public.entitlements e
    where e.user_id = p_user
      and e.revoked_at is null
      and e.scope_type = p_scope_type
      and e.scope_id is not distinct from p_scope_id;

    v_expires := greatest(now(), coalesce(v_max_expires, now()))
               + make_interval(days => p_duration_days);

    -- Append-only ledger: always a NEW row; per-grant provenance and revocability preserved.
    insert into public.entitlements
      (user_id, scope_type, scope_id, tier_id, starts_at, expires_at, source, source_id)
    values
      (p_user, p_scope_type, p_scope_id, p_tier_id, now(), v_expires, p_source, p_source_id)
    returning id into v_ent_id;

    return v_ent_id;
  end;
  $$;

  comment on function public.grant_entitlement(uuid,text,uuid,uuid,int,text,uuid) is
    'The ONLY implementation of the D8 stacking rule: inserts a NEW entitlement row with '
    'expires_at = greatest(now(), max active same-scope expires_at) + p_duration_days. Called by '
    'redeem_code (Phase 4) and approve_claim (Phase 6). Master §4 contract.';

  -- Internal-only: callable from other SECURITY DEFINER functions and the service role — NEVER
  -- by clients (a direct client call would be a free self-grant primitive).
  revoke execute on function public.grant_entitlement(uuid,text,uuid,uuid,int,text,uuid)
    from public, anon, authenticated;
  grant execute on function public.grant_entitlement(uuid,text,uuid,uuid,int,text,uuid)
    to service_role;

  -- ---------------------------------------------------------------------------
  -- redeem_code: rate-limit → normalize+hash → lock → validate → mint via
  -- grant_entitlement → record redemption → increment counter.
  -- Returns jsonb: {ok:true, entitlement:{...}} on success,
  --   or {ok:false, error:'invalid-code'|'expired'|'exhausted'|'already-redeemed'|'rate-limited'}.
  -- ---------------------------------------------------------------------------
  create or replace function public.redeem_code(p_code text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public, extensions
  as $$
  declare
    v_uid          uuid := auth.uid();
    v_norm         text;
    v_hash         text;
    v_attempts     int;
    v_code         public.access_codes%rowtype;
    v_expires      timestamptz;
    v_ent_id       uuid;
  begin
    -- Callable only by an authenticated user. The grant restricts to `authenticated`, but guard
    -- defensively in case a service role calls it without a JWT.
    if v_uid is null then
      raise exception 'redeem_code requires an authenticated user';
    end if;

    -- 1) RATE LIMIT FIRST: record this attempt, THEN count. Failures consume attempts too, so the
    --    brute-force (invalid-code guessing) case is actually limited. 6th attempt in an hour blocks.
    insert into public.redemption_attempts (user_id) values (v_uid);

    select count(*) into v_attempts
    from public.redemption_attempts
    where user_id = v_uid
      and created_at > now() - interval '1 hour';

    if v_attempts > 5 then
      return jsonb_build_object('ok', false, 'error', 'rate-limited');
    end if;

    -- 2) Normalize (uppercase, strip non-alphanumerics) and hash (sha256 hex). Must match
    --    lib/access/codes.ts byte-for-byte: both do ONLY upper+strip, then sha256 of the UTF-8 bytes.
    v_norm := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]+', '', 'g'));
    v_hash := encode(extensions.digest(v_norm, 'sha256'), 'hex');

    -- 3) Lock the code row for the duration of the transaction (serializes concurrent redemptions).
    select * into v_code
    from public.access_codes
    where code_hash = v_hash
    for update;

    -- 4) Validate in order. Revoked/unknown both return 'invalid-code' so we never leak that a
    --    given hash exists.
    if v_code.id is null or v_code.revoked_at is not null then
      return jsonb_build_object('ok', false, 'error', 'invalid-code');
    end if;

    if v_code.valid_until is not null and now() > v_code.valid_until then
      return jsonb_build_object('ok', false, 'error', 'expired');
    end if;

    if v_code.redeemed_count >= v_code.max_redemptions then
      return jsonb_build_object('ok', false, 'error', 'exhausted');
    end if;

    if exists (
      select 1 from public.code_redemptions
      where code_id = v_code.id and user_id = v_uid
    ) then
      return jsonb_build_object('ok', false, 'error', 'already-redeemed');
    end if;

    -- 5) MINT via grant_entitlement — the single D8 stacking implementation (defined above):
    --    new append-only row, expires_at = greatest(now(), max active same-scope expiry) + duration.
    v_ent_id := public.grant_entitlement(
      v_uid, v_code.scope_type, v_code.scope_id, v_code.tier_id,
      v_code.duration_days, 'code', v_code.id
    );
    select expires_at into v_expires from public.entitlements where id = v_ent_id;

    -- 6) Redemption record + counter. The unique(code_id,user_id) on code_redemptions is the
    --    final race guard behind the lock.
    insert into public.code_redemptions (code_id, user_id, entitlement_id)
    values (v_code.id, v_uid, v_ent_id);

    update public.access_codes
    set redeemed_count = redeemed_count + 1
    where id = v_code.id;

    return jsonb_build_object(
      'ok', true,
      'entitlement', jsonb_build_object(
        'id',         v_ent_id,
        'scope_type', v_code.scope_type,
        'scope_id',   v_code.scope_id,
        'expires_at', v_expires,
        'source',     'code'
      )
    );

  exception
    when unique_violation then
      -- Two concurrent redemptions of the same code by the same user raced past the EXISTS check;
      -- the unique(code_id,user_id) constraint rejects the loser. Treat as already-redeemed.
      return jsonb_build_object('ok', false, 'error', 'already-redeemed');
  end;
  $$;

  comment on function public.redeem_code(text) is
    'Atomic single-use code redemption: rate-limit (attempt recorded first), normalize+sha256, '
    'lock code FOR UPDATE, validate (invalid/expired/exhausted/already-redeemed), mint stacked '
    'entitlement via grant_entitlement, increment count. Master D8/§9.';

  -- Authenticated users only; anon and public cannot call it.
  revoke all on function public.redeem_code(text) from public, anon;
  grant execute on function public.redeem_code(text) to authenticated, service_role;
  ```
  > **Concurrency for the last slot (two-session proof):** in READ COMMITTED (Postgres default),
  > session B's `SELECT … FOR UPDATE` blocks until session A commits, then re-reads the *latest*
  > committed row. So if A took the last slot (`redeemed_count` goes `1 → 2` with
  > `max_redemptions = 2`), B reads `redeemed_count = 2 ≥ 2` and returns `exhausted`. This is
  > exercised concretely in Task 13.
- [x] Apply:
  ```bash
  supabase db reset
  ```
- [x] Commit:
  ```bash
  git add supabase/migrations
  git commit -m "phase4: grant_entitlement() + redeem_code() — atomic rate-limited stacking redemption (master D8/§4/§9)"
  ```

**Edge cases enumerated (each has a probe in Task 13):**

| Branch | Condition | Returns |
|---|---|---|
| invalid / revoked | no row for hash, or `revoked_at` set | `{ok:false, error:'invalid-code'}` |
| expired deadline | `valid_until` in the past | `{ok:false, error:'expired'}` |
| exhausted | `redeemed_count >= max_redemptions` | `{ok:false, error:'exhausted'}` |
| double redemption (same user) | prior `code_redemptions` row (or unique violation) | `{ok:false, error:'already-redeemed'}` |
| rate limited | 6th call within one hour | `{ok:false, error:'rate-limited'}` |
| concurrent last slot | two sessions, one slot | winner `ok:true`, loser `exhausted` |
| happy path / stacking | valid + slot free | `{ok:true, entitlement:{…}}` (expiry stacked) |

**Manual verification checklist**
- `supabase db reset` succeeds.
- `select to_regprocedure('public.grant_entitlement(uuid,text,uuid,uuid,int,text,uuid)') is not null;`
  → `t`.
- Calling `redeem_code('nope')` for a logged-in fabricated JWT returns
  `{"ok": false, "error": "invalid-code"}` (and inserted one `redemption_attempts` row).

**Failure modes**
- `function extensions.digest(...) does not exist`: pgcrypto in a different schema — see Task 0
  failure notes; change `set search_path = public, <schema-holding-pgcrypto>`.
- Rate limit never trips: you counted *before* inserting, or used `>= 5` — it must be insert
  first, then `> 5`.
- Stacking resets instead of extends: `grant_entitlement` compared `scope_id` with `=` instead of
  `is not distinct from` (nulls never `=`), so the `all`-scope match is missed.
- Client can call `grant_entitlement` directly (free self-grant): the
  `revoke execute … from public, anon, authenticated` was skipped — only `service_role` and
  other SECURITY DEFINER functions may reach it.
- `null value in column "expires_at"`: `duration_days` was null on the code — it is `not null`
  in the schema; a bad seed. Do not make `expires_at` nullable.

---

## Task 4 — RLS policies for monetization tables

RLS is already ENABLED (Phase 1); with no policies these tables are deny-all to clients — safe,
but students need to *read* published tiers, their own entitlements, and their own redemptions.
Access codes and redemption attempts stay invisible to clients (writes only via the SECURITY
DEFINER functions, which run as owner and bypass RLS). Multiple permissive `SELECT` policies are
OR-ed by Postgres.

- [x] Create the migration:
  ```bash
  supabase migration new phase4_monetization_rls
  ```
  Paste into `supabase/migrations/<ts>_phase4_monetization_rls.sql`:
  ```sql
  -- Phase 4: RLS policies for tiers / entitlements / access_codes / code_redemptions /
  -- redemption_attempts. Master §4 RLS invariants + §9. RLS was enabled in Phase 1; re-enabling
  -- here is idempotent and harmless.
  alter table public.tiers               enable row level security;
  alter table public.entitlements        enable row level security;
  alter table public.access_codes        enable row level security;
  alter table public.code_redemptions    enable row level security;
  alter table public.redemption_attempts enable row level security;

  -- ---- tiers: published readable by any authenticated user; admin does everything ----
  drop policy if exists tiers_read_published on public.tiers;
  create policy tiers_read_published on public.tiers
    for select to authenticated
    using (status = 'published' or public.is_admin());

  drop policy if exists tiers_admin_all on public.tiers;
  create policy tiers_admin_all on public.tiers
    for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

  -- ---- entitlements: owner (and admin) may SELECT; NO client writes ----
  -- Writes happen only inside SECURITY DEFINER functions (redeem_code, and admin grant/revoke in
  -- later phases), which run as the function owner and bypass RLS. No insert/update/delete policy.
  drop policy if exists entitlements_owner_select on public.entitlements;
  create policy entitlements_owner_select on public.entitlements
    for select to authenticated
    using (user_id = auth.uid() or public.is_admin());

  -- ---- access_codes: admin only. Redemption reads happen inside redeem_code (definer). ----
  drop policy if exists access_codes_admin_all on public.access_codes;
  create policy access_codes_admin_all on public.access_codes
    for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

  -- ---- code_redemptions: owner sees own; admin sees all. NO client writes. ----
  drop policy if exists code_redemptions_owner_select on public.code_redemptions;
  create policy code_redemptions_owner_select on public.code_redemptions
    for select to authenticated
    using (user_id = auth.uid() or public.is_admin());

  -- ---- redemption_attempts: NO client access at all. RLS enabled + zero policies = deny all.
  -- Inserts happen inside redeem_code (definer). Intentionally no policy here.
  ```
- [x] Apply:
  ```bash
  supabase db reset
  ```
- [x] Commit:
  ```bash
  git add supabase/migrations
  git commit -m "phase4: RLS policies for tiers/entitlements/access_codes/code_redemptions/redemption_attempts"
  ```

**Manual verification checklist** (full curl battery is Task 15; quick SQL check here)
- As a fabricated non-admin JWT, `select count(*) from access_codes` returns `0` rows (RLS hides
  them); `insert into entitlements …` raises `new row violates row-level security policy`.
  ```sql
  begin;
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
    select count(*) from public.access_codes;                 -- expected: 0
    -- expected: ERROR new row violates row-level security policy for table "entitlements"
    insert into public.entitlements(user_id,scope_type,expires_at,source)
      values (auth.uid(),'all', now()+interval '1 day','code');
  rollback;
  ```

**Failure modes**
- Student can read tiers even when hidden: the `using` on `tiers_read_published` must be
  `status = 'published' or public.is_admin()`, not just `is_admin()`.
- `infinite recursion detected in policy for relation "profiles"`: you referenced `profiles`
  directly in a policy — always go through `public.is_admin()` (master D11, §10).
- Redemption suddenly fails with `permission denied for table access_codes`: something made
  `redeem_code` `SECURITY INVOKER`; it must be `SECURITY DEFINER` (Task 3).

---

## Task 5 — `lib/access/codes.ts` code utility + Vitest

Server-side code generation/normalization/hashing, used by the admin phase (batch generation)
and payments phase (auto-mint). Pure Node `crypto`; no Supabase. TDD: write the test first.

- [x] Create the test `lib/access/codes.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { generateCode, normalizeCode, hashCode } from "./codes";

  describe("normalizeCode", () => {
    it("uppercases and strips non-alphanumerics", () => {
      expect(normalizeCode("cbd-7k3m-9pxq")).toBe("CBD7K3M9PXQ");
      expect(normalizeCode("CBD 7K3M 9PXQ")).toBe("CBD7K3M9PXQ");
      expect(normalizeCode(" cbd_7k3m/9pxq ")).toBe("CBD7K3M9PXQ");
      expect(normalizeCode("CBD-7K3M-9PXQ")).toBe("CBD7K3M9PXQ");
    });
  });

  describe("hashCode", () => {
    it("is sha256 hex of the normalized string (SQL-parity vector)", () => {
      // Must equal encode(digest('CBD7K3M9PXQ','sha256'),'hex') in Postgres.
      expect(hashCode("CBD7K3M9PXQ")).toBe(
        "0469f76c67a68e98cf8c9baea7aebef3e4f96d68eb7fb77cde202c5ca813c449"
      );
    });
    it("normalize + hash composes for a messy user input", () => {
      expect(hashCode(normalizeCode("cbd-7k3m-9pxq"))).toBe(
        "0469f76c67a68e98cf8c9baea7aebef3e4f96d68eb7fb77cde202c5ca813c449"
      );
    });
  });

  describe("generateCode", () => {
    it("matches CBD-XXXX-XXXX with Crockford-safe symbols only", () => {
      for (let i = 0; i < 500; i++) {
        const c = generateCode();
        expect(c).toMatch(/^CBD-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
        // never any ambiguous I, L, O, U
        expect(c.slice(4)).not.toMatch(/[ILOU]/);
      }
    });
    it("normalizes back to an 11-char CBD-prefixed token", () => {
      const c = generateCode();
      const n = normalizeCode(c);
      expect(n).toHaveLength(11);
      expect(n.startsWith("CBD")).toBe(true);
    });
    it("is practically unique across a large batch", () => {
      const seen = new Set<string>();
      for (let i = 0; i < 20000; i++) seen.add(generateCode());
      // 32^8 ≈ 1.1e12 space; collisions across 20k are astronomically unlikely.
      expect(seen.size).toBe(20000);
    });
  });
  ```
- [x] Create `lib/access/codes.ts`:
  ```ts
  import { randomBytes, createHash } from "node:crypto";

  /**
   * Crockford base32 alphabet, EXCLUDING the ambiguous I, L, O, U.
   * 32 symbols → 5 bits each. 8 symbols ≈ 40 bits of entropy per code.
   *
   * Collision math: the space is 32^8 = 2^40 ≈ 1.0995e12 codes. By the birthday bound the
   * expected number of collisions among N codes is ≈ N^2 / (2·32^8). At N = 100,000 that is
   * ≈ (1e5)^2 / (2·1.0995e12) ≈ 0.0045 — under a 0.5% chance of ANY collision across 100k codes.
   * Uniqueness is still enforced by the `unique (code_hash)` constraint on access_codes; the
   * admin generator (Phase 5) retries generation on a unique-violation. This is a convenience
   * margin, not the guarantee.
   */
  const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // 32 symbols, no I L O U

  /** Plaintext access code, format `CBD-XXXX-XXXX` (shown to the user exactly once). */
  export function generateCode(): string {
    const bytes = randomBytes(8); // one byte per symbol; low 5 bits are uniform over 0..31
    let body = "";
    for (let i = 0; i < 8; i++) {
      body += CROCKFORD[bytes[i] & 31];
    }
    return `CBD-${body.slice(0, 4)}-${body.slice(4, 8)}`;
  }

  /**
   * Canonical form used for hashing: uppercase, then strip everything that is not [A-Z0-9].
   * We deliberately do NOT fold Crockford ambiguities (O→0, I→1, …): the hash must match the
   * SQL `redeem_code` normalization BYTE-FOR-BYTE, and that function does only upper+strip.
   * Excluding ambiguous characters at generation time (see CROCKFORD) removes the practical need.
   */
  export function normalizeCode(input: string): string {
    return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  /** sha256 hex of an ALREADY-normalized code. Matches Postgres `encode(digest(x,'sha256'),'hex')`. */
  export function hashCode(normalized: string): string {
    return createHash("sha256").update(normalized, "utf8").digest("hex");
  }
  ```
- [x] Run the tests (from `cubad/`):
  ```bash
  npx vitest run lib/access/codes.test.ts
  ```
  Expected: all tests pass (the two hash assertions confirm SQL↔JS parity).
- [x] Commit:
  ```bash
  git add lib/access/codes.ts lib/access/codes.test.ts
  git commit -m "phase4: lib/access/codes.ts (generate/normalize/hash) + vitest with SQL-parity vector"
  ```

**Manual verification checklist**
- `npx vitest run lib/access/codes.test.ts` → green.
- `hashCode("CBD7K3M9PXQ")` equals the Task 0 SQL hash exactly.

**Failure modes**
- Hash mismatch with SQL: someone added Crockford folding or trimmed differently in one side, or
  used a different encoding. Keep both sides at upper+strip only; hash the UTF-8 string.
- Regex `[^A-Z0-9]` before `toUpperCase()` would drop lowercase letters — uppercase FIRST.
- `randomBytes is not a function`: importing from `"crypto"` in an edge runtime — this module is
  server-only (`node:crypto`); never import it into a client component.

---

## Task 6 — `lib/access/access.ts` server access helper (request-scoped cache)

The page-facing helper. `getAccess(subjectId)` answers subject-level entitlement; unit pages pass
the unit's `is_free` to fold in the free-preview reason. The underlying entitlement query is
memoized **per request** with React `cache()` so a subject home rendering 8 unit cards runs the
access query **once**, not eight times.

**Why request-scoped (React `cache()`) and NEVER a cross-request cache:** the answer is
*per-user* (`auth.uid()`-dependent). React `cache()` memoizes only within a single server render
pass — it is not shared between requests or users. Using `unstable_cache`/`fetch` data-cache with
a shared key would let one user's access decision be served to another — a privilege-escalation
bug. Content JSON is safely shared-cached by tag (identical for everyone); the *access decision*
must not be. Gated pages must also be dynamic (Task 10 sets `force-dynamic`) so nothing about a
specific user is baked into a static page.

- [x] Create `lib/access/access.ts`:
  ```ts
  import "server-only";
  import { cache } from "react";
  import { createClient } from "@/lib/supabase/server";

  export type AccessReason = "free" | "entitled" | "locked";
  export interface Access {
    canStudy: boolean;
    reason: AccessReason;
  }

  /**
   * Does the current user hold an active entitlement covering this subject?
   * Single indexed EXISTS query, executed by the SAME SECURITY DEFINER function that RLS and
   * get_unit_content use — so the TS answer can never drift from the DB rule (master §6). Chosen
   * over an ad-hoc client-side query precisely for that single-source-of-truth guarantee.
   *
   * Memoized per request via React cache(): keyed by subjectId only, so per-unit callers with
   * different is_free flags all share one round-trip. NOT shared across requests/users.
   */
  export const getSubjectAccess = cache(async (subjectId: string): Promise<boolean> => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("has_subject_access", {
      p_subject_id: subjectId,
    });
    if (error) {
      // Fail CLOSED: on any error, deny. Never let an error open the gate.
      console.error("has_subject_access failed", error.message);
      return false;
    }
    return data === true;
  });

  /**
   * Page-facing access decision. Pass the unit's is_free to get the 'free' reason; omit it to ask
   * the pure subject-level question ('entitled' | 'locked'). Free content is still account-walled
   * at the page layer (master D6) — this helper answers "can this signed-in user study it?".
   */
  export async function getAccess(subjectId: string, isFree = false): Promise<Access> {
    if (isFree) return { canStudy: true, reason: "free" };
    const entitled = await getSubjectAccess(subjectId);
    return entitled
      ? { canStudy: true, reason: "entitled" }
      : { canStudy: false, reason: "locked" };
  }

  /**
   * The furthest-out active-entitlement expiry for the current user, as an ISO string, or null.
   * Drives the Header/settings "Access until …" badge. Owner-select RLS permits this read.
   * Memoized per request.
   */
  export const getActiveEntitlementExpiry = cache(async (): Promise<string | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("entitlements")
      .select("expires_at")
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return data.expires_at as string;
  });
  ```
- [x] Sanity-typecheck the module compiles in the build (deferred to the phase build in Task 16;
  no isolated command needed). Confirm the import path `@/lib/supabase/server` resolves to
  Phase 1's server client and that it exports `createClient`. If Phase 1 named the async server
  client differently, adjust the import here only.
- [x] Commit:
  ```bash
  git add lib/access/access.ts
  git commit -m "phase4: lib/access/access.ts — request-scoped, fail-closed access helper via RPC"
  ```

**Manual verification checklist**
- The module imports `server-only` (guarantees it never ships to the client bundle).
- On any RPC error, `getSubjectAccess` returns `false` (fail closed).

**Failure modes**
- Build error "`server-only` cannot be imported from a Client Component": a client component
  imported `access.ts` — only Server Components / Server Actions may. Pass the resulting boolean
  down as a prop instead.
- Access query runs N times for N units: you memoized `getAccess` (varies by `isFree`) instead of
  `getSubjectAccess` (keyed by `subjectId`). Keep the `cache()` on the subject-level function.
- `createClient` used without `await`: it is async in Next 16 (cookies are async). Always
  `const supabase = await createClient()`.

---

## Task 7 — i18n strings for paywall / redeem / lock / expiry

All new user-facing copy, `tr` + `en` (master §12.5, D13). Add to the `STRINGS` object in
`lib/i18n.tsx`. These keys are referenced by Tasks 8–12.

- [x] In `lib/i18n.tsx`, insert this block inside the `STRINGS = { … }` object (e.g. just before
  the closing `} as const;`). Do not remove existing keys.
  ```ts
    /* ---------- access / paywall / redeem (Phase 4) ---------- */
    locked: { en: "Locked", tr: "Kilitli" },
    freePreview: { en: "Free preview", tr: "Ücretsiz önizleme" },
    unlockAccess: { en: "Unlock access", tr: "Erişimi aç" },
    paywallTitle: { en: "This unit is locked", tr: "Bu konu kilitli" },
    paywallIntro: {
      en: "Choose a plan to unlock this content, or enter an access code you already have.",
      tr: "Bu içeriği açmak için bir plan seç ya da elindeki erişim kodunu gir.",
    },
    choosePlan: { en: "Choose a plan", tr: "Bir plan seç" },
    daysLabel: { en: "days", tr: "gün" },
    iHaveCode: { en: "I have a code", tr: "Kodum var" },
    redeemTitle: { en: "Enter your access code", tr: "Erişim kodunu gir" },
    redeemIntro: {
      en: "Type the code exactly as you received it. Codes are single-use.",
      tr: "Kodu sana verildiği gibi yaz. Kodlar tek kullanımlıktır.",
    },
    redeemPlaceholder: { en: "CBD-XXXX-XXXX", tr: "CBD-XXXX-XXXX" },
    redeemSubmit: { en: "Redeem code", tr: "Kodu kullan" },
    redeemPending: { en: "Redeeming…", tr: "Kullanılıyor…" },
    redeemSuccessTitle: { en: "Access unlocked!", tr: "Erişim açıldı!" },
    redeemSuccessBody: {
      en: "You can now study this content on all your devices.",
      tr: "Artık bu içeriği tüm cihazlarında çalışabilirsin.",
    },
    accessUntil: { en: "Access until", tr: "Erişim bitişi" },
    yourSubjects: { en: "Your subjects", tr: "Derslerin" },
    signInToStudy: { en: "Sign in to study", tr: "Çalışmak için giriş yap" },

    /* redeem_code error enum → bilingual messages */
    redeemErrInvalidCode: {
      en: "That code is not valid. Check the spelling and try again.",
      tr: "Bu kod geçersiz. Yazımını kontrol edip tekrar dene.",
    },
    redeemErrExpired: {
      en: "This code has passed its redemption deadline.",
      tr: "Bu kodun kullanım süresi dolmuş.",
    },
    redeemErrExhausted: {
      en: "This code has reached its redemption limit.",
      tr: "Bu kod kullanım limitine ulaşmış.",
    },
    redeemErrAlreadyRedeemed: {
      en: "You have already redeemed this code.",
      tr: "Bu kodu zaten kullandın.",
    },
    redeemErrRateLimited: {
      en: "Too many attempts. Please try again in about an hour.",
      tr: "Çok fazla deneme yapıldı. Lütfen yaklaşık bir saat sonra tekrar dene.",
    },
    redeemErrGeneric: {
      en: "Something went wrong. Please try again.",
      tr: "Bir şeyler ters gitti. Lütfen tekrar dene.",
    },
  ```
- [x] Commit:
  ```bash
  git add lib/i18n.tsx
  git commit -m "phase4: bilingual strings for paywall/redeem/lock/expiry"
  ```

**Manual verification checklist**
- `lib/i18n.tsx` still compiles (the object is `as const`; every new key has both `en` and `tr`).
- No duplicate keys were introduced (search for `paywallTitle` etc. returns one hit each).

**Failure modes**
- Type error `Property 'redeemErrInvalidCode' does not exist on type …`: the `StringKey` type is
  derived from `STRINGS`, so a mistyped key name anywhere else won't resolve — fix the caller.

---

## Task 8 — `LockBadge` primitive

A small, reusable badge for locked/free unit affordances, matching the existing pill styling in
`components/ui.tsx` (e.g. `LikelihoodBadge`).

- [x] Add to `components/ui.tsx` (it is already a client module using `useLang`):
  ```tsx
  /* ---------------- lock / free badges (Phase 4) ---------------- */

  export function LockBadge() {
    const { t } = useLang();
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-wash px-2 py-0.5 text-[11px] font-semibold text-ink-soft"
        title={t("locked")}
      >
        <span aria-hidden>🔒</span>
        {t("locked")}
      </span>
    );
  }

  export function FreeBadge() {
    const { t } = useLang();
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-moss-soft px-2 py-0.5 text-[11px] font-semibold text-moss">
        {t("freePreview")}
      </span>
    );
  }
  ```
- [x] Commit:
  ```bash
  git add components/ui.tsx
  git commit -m "phase4: LockBadge / FreeBadge UI primitives"
  ```

**Manual verification checklist**
- Importing `{ LockBadge, FreeBadge }` from `@/components/ui` resolves.

**Failure modes**
- Emoji renders as tofu in some fonts — acceptable; the text label carries the meaning and the
  `title` gives a tooltip. Do not add an icon dependency for this.

---

## Task 9 — Show lock badges on the subject home unit list

Wire access into the Phase 3 **unified subject-home** component (the one that maps over units and
renders unit cards — the successor of `components/HomeView.tsx`). A unit is locked iff
`!unit.is_free && !subjectAccess`. Compute `subjectAccess` **once** on the server and pass it down.

- [x] In the subject-home **page** (server component, `app/s/[subject]/page.tsx` after Phase 3),
  resolve subject-level access once and hand it to the list. Reference implementation — merge
  into Phase 3's page, keeping its data fetching:
  ```tsx
  // app/s/[subject]/page.tsx  (server component)
  import { getSubjectAccess } from "@/lib/access/access";
  // ... Phase 3 imports: the catalog fetcher + the unified SubjectHome component ...

  export const dynamic = "force-dynamic"; // access is per-user; never statically cache this page

  export default async function SubjectHomePage({
    params,
  }: {
    params: Promise<{ subject: string }>;
  }) {
    const { subject: subjectSlug } = await params;
    const catalog = await getSubjectCatalog(subjectSlug); // Phase 3: { subject:{id,...}, units:[...] }
    if (!catalog) notFound();

    const subjectAccess = await getSubjectAccess(catalog.subject.id);

    return (
      <SubjectHome
        subject={catalog.subject}
        units={catalog.units}
        subjectAccess={subjectAccess}
      />
    );
  }
  ```
  > If Phase 3 kept `generateStaticParams`/SSG for this route, remove it for the gated home (the
  > `force-dynamic` export above is required — a per-user lock cannot be prerendered). Catalog
  > metadata for the *cards* is fine to fetch dynamically; the heavy unit `content` is not read
  > here at all.
- [x] In the unified `SubjectHome` (client) component, accept `subjectAccess` and render a badge
  per card. Add, inside the `units.map(...)` card (adapting the Phase 3 markup — this mirrors the
  `HomeView.tsx` card):
  ```tsx
  import { LockBadge, FreeBadge } from "@/components/ui";

  // props: { subject: {...}, units: Array<{ id; slug; unit_number; is_free; title; tagline }>,
  //          subjectAccess: boolean }

  // inside the card header row, next to the unit number:
  {u.is_free ? <FreeBadge /> : subjectAccess ? null : <LockBadge />}
  ```
  A locked card stays clickable (it links to the unit page, which shows the paywall). Do not
  disable the link — the paywall is the conversion surface.
- [x] Commit:
  ```bash
  git add app/s/[subject]/page.tsx components/SubjectHome.tsx
  git commit -m "phase4: lock/free badges on subject-home unit list"
  ```

**Manual verification checklist**
- With default seeds (all `is_free=true`) every card shows the green "Free preview" badge, none
  show a lock.
- After Task 14 flips a unit to `is_free=false` for an unentitled user, that card shows 🔒 Locked.

**Failure modes**
- Access query fires once per card in the network tab: `getSubjectAccess` must be the `cache()`d
  function and called once in the page, then passed as a prop — do not call it inside the map.
- The page 500s with "Dynamic server usage" on a statically-generated route: add
  `export const dynamic = "force-dynamic"`.

---

## Task 10 — Gate the unit page + `PaywallPanel`

The unit page is where the wall stands. Flow (master D6/§6): anonymous → sign-up wall; signed-in
but locked → paywall; free/entitled/admin → content.

- [x] Create `components/PaywallPanel.tsx` (server component — fetches tiers + the user's country
  for price selection). It renders published tiers with the right price and a link to `/redeem`.
  ```tsx
  import "server-only";
  import Link from "next/link";
  import { createClient } from "@/lib/supabase/server";
  import { PaywallCopy } from "./PaywallCopy";

  interface Price {
    currency: string;
    amount: number;
    country: string;
  }
  interface Tier {
    id: string;
    slug: string;
    title: { tr: string; en: string };
    description: { tr: string; en: string };
    duration_days: number;
    prices: Price[];
  }

  /** Pick the price for the user's country, falling back to '*', then to the first listed. */
  function pickPrice(prices: Price[], country: string): Price | null {
    if (!prices || prices.length === 0) return null;
    return (
      prices.find((p) => p.country === country) ??
      prices.find((p) => p.country === "*") ??
      prices[0]
    );
  }

  export async function PaywallPanel({ subjectSlug }: { subjectSlug: string }) {
    const supabase = await createClient();

    const [{ data: profile }, { data: tiers }] = await Promise.all([
      supabase.from("profiles").select("country_code").maybeSingle(),
      supabase
        .from("tiers")
        .select("id,slug,title,description,duration_days,prices")
        .eq("status", "published")
        .order("sort", { ascending: true }),
    ]);

    const country = profile?.country_code ?? "";
    const withPrice = (tiers ?? []).map((t) => ({
      tier: t as Tier,
      price: pickPrice((t as Tier).prices, country),
    }));

    // All client-facing copy/formatting lives in PaywallCopy (client) so it can use useLang().
    return (
      <PaywallCopy
        tiers={withPrice}
        redeemHref={`/redeem?next=/s/${subjectSlug}`}
      />
    );
  }
  ```
- [x] Create `components/PaywallCopy.tsx` (client — renders the panel with bilingual strings and
  the design language: warm `card`, `deniz` accent, rounded-2xl):
  ```tsx
  "use client";

  import Link from "next/link";
  import { useLang } from "@/lib/i18n";

  interface Price {
    currency: string;
    amount: number;
    country: string;
  }
  interface Tier {
    id: string;
    slug: string;
    title: { tr: string; en: string };
    description: { tr: string; en: string };
    duration_days: number;
    prices: Price[];
  }

  export function PaywallCopy({
    tiers,
    redeemHref,
  }: {
    tiers: { tier: Tier; price: Price | null }[];
    redeemHref: string;
  }) {
    const { t, bi } = useLang();
    return (
      <section className="rise-in mx-auto max-w-2xl">
        <div className="rounded-2xl border border-line bg-card p-6 sm:p-8">
          <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink-soft">
            <span aria-hidden>🔒</span>
            {t("locked")}
          </div>
          <h1 className="font-display text-2xl font-semibold text-deniz-deep">
            {t("paywallTitle")}
          </h1>
          <p className="mt-2 text-ink-soft">{t("paywallIntro")}</p>

          <h2 className="mt-6 mb-3 font-display text-lg font-semibold text-ink">
            {t("choosePlan")}
          </h2>
          <div className="grid gap-3">
            {tiers.map(({ tier, price }) => (
              <div
                key={tier.id}
                className="flex items-center justify-between rounded-xl border border-line bg-paper px-4 py-3"
              >
                <div>
                  <p className="font-medium text-ink">{bi(tier.title)}</p>
                  <p className="text-sm text-ink-soft">
                    {tier.duration_days} {t("daysLabel")}
                    {bi(tier.description) ? ` · ${bi(tier.description)}` : ""}
                  </p>
                </div>
                {price && (
                  <div className="text-right font-mono text-sm font-semibold text-deniz-deep">
                    {price.amount.toLocaleString()} {price.currency}
                  </div>
                )}
              </div>
            ))}
            {tiers.length === 0 && (
              <p className="text-sm text-ink-faint">—</p>
            )}
          </div>

          <div className="mt-6 border-t border-line pt-5">
            <Link
              href={redeemHref}
              className="inline-flex items-center gap-2 rounded-xl bg-deniz px-4 py-2.5 font-semibold text-white transition-colors hover:bg-deniz-deep"
            >
              {t("iHaveCode")}
            </Link>
          </div>
        </div>
      </section>
    );
  }
  ```
- [x] Gate the unit **page** (server component `app/s/[subject]/unit/[slug]/page.tsx` after
  Phase 3). Reference implementation — merge into Phase 3's page:
  ```tsx
  import { notFound, redirect } from "next/navigation";
  import { createClient } from "@/lib/supabase/server";
  import { getAccess } from "@/lib/access/access";
  import { PaywallPanel } from "@/components/PaywallPanel";
  // Phase 3 imports: the catalog fetcher, getUnitContent (wraps get_unit_content RPC), UnitView

  export const dynamic = "force-dynamic"; // per-user gate; never prerender

  export default async function UnitPage({
    params,
  }: {
    params: Promise<{ subject: string; slug: string }>;
  }) {
    const { subject: subjectSlug, slug } = await params;

    // 1) Anonymous → sign-up wall (master D6: studying requires an account, even free units).
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      redirect(`/auth/sign-in?next=/s/${subjectSlug}/unit/${slug}`);
    }

    // 2) Catalog metadata (existence, subject id, is_free) — NOT the heavy content.
    const meta = await getUnitMeta(subjectSlug, slug); // Phase 3: { subjectId, isFree, title } | null
    if (!meta) notFound();

    // 3) Access decision (free folds in here).
    const access = await getAccess(meta.subjectId, meta.isFree);
    if (!access.canStudy) {
      return <PaywallPanel subjectSlug={subjectSlug} />;
    }

    // 4) Entitled/free/admin → fetch the gated content and render.
    const content = await getUnitContent(subjectSlug, slug); // Phase 3 fetcher over the RPC
    if (!content) notFound(); // defense in depth: RPC also enforces the gate
    return <UnitView subject={subjectSlug} unit={content} />;
  }
  ```
  > `getUnitMeta`/`getUnitContent`/`UnitView` are the Phase 3 deliverables (names may vary). The
  > important, non-negotiable shape is: check auth → check existence via cheap metadata → decide
  > access via `getAccess` → only then read `content`. Defense in depth: even if the page logic
  > were bypassed, `get_unit_content` (Task 2) and the `units` RLS still return null for a locked
  > unit (master D7).
- [x] Commit:
  ```bash
  git add components/PaywallPanel.tsx components/PaywallCopy.tsx app/s/[subject]/unit/[slug]/page.tsx
  git commit -m "phase4: unit-page gate + PaywallPanel (anon wall / locked paywall / entitled content)"
  ```

**Manual verification checklist**
- Logged-out visit to a unit URL → redirected to `/auth/sign-in?next=…`.
- Logged-in, unentitled, non-free unit → PaywallPanel with the published tier + `I have a code`.
- Free or entitled unit → content renders as before.

**Failure modes**
- `redirect()` "caught" and page continues: `redirect` throws a control-flow signal — never wrap
  it in a `try/catch` that swallows it, and never call it after streaming has begun.
- Paywall shows for a free unit: `getAccess(subjectId, meta.isFree)` was called without the
  `isFree` argument. Free must short-circuit to `{canStudy:true, reason:'free'}`.
- Both paywall and content briefly flash: the route is not `force-dynamic`, so a stale static
  shell rendered first. Add the export.

---

## Task 11 — `/redeem` page, server action, and form

The redemption surface. A Server Action calls `redeem_code`; the client form shows a pending
state and maps the RPC error enum to bilingual copy; success shows a simple state and refreshes
access. (No confetti — a calm success panel, per the design language.)

- [x] Create the Server Action `app/redeem/actions.ts`:
  ```ts
  "use server";

  import { revalidatePath } from "next/cache";
  import { createClient } from "@/lib/supabase/server";

  export type RedeemState =
    | { status: "idle" }
    | { status: "success"; expiresAt: string | null }
    | { status: "error"; error: string };

  const KNOWN_ERRORS = new Set([
    "invalid-code",
    "expired",
    "exhausted",
    "already-redeemed",
    "rate-limited",
  ]);

  // useActionState signature: (prevState, formData) => nextState
  export async function redeemAction(
    _prev: RedeemState,
    formData: FormData
  ): Promise<RedeemState> {
    const supabase = await createClient();

    // Authenticate INSIDE the action — render-time gating is not a security boundary (Next.js
    // Server Actions guide: every action is an untrusted POST entry point).
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { status: "error", error: "generic" };

    const raw = String(formData.get("code") ?? "");
    if (!raw.trim()) return { status: "error", error: "invalid-code" };

    const { data, error } = await supabase.rpc("redeem_code", { p_code: raw });
    if (error) {
      console.error("redeem_code rpc error", error.message);
      return { status: "error", error: "generic" };
    }

    const result = data as
      | { ok: true; entitlement: { expires_at: string } }
      | { ok: false; error: string };

    if (result.ok) {
      // Access changed globally for this user → bust the router cache so gated pages and the
      // "Access until" badge recompute on next navigation. Gated pages are dynamic, so this
      // mainly refreshes the client router tree.
      revalidatePath("/", "layout");
      return { status: "success", expiresAt: result.entitlement.expires_at };
    }

    const code = KNOWN_ERRORS.has(result.error) ? result.error : "generic";
    return { status: "error", error: code };
  }
  ```
- [x] Create the client form `components/RedeemForm.tsx`:
  ```tsx
  "use client";

  import { useActionState } from "react";
  import { useLang } from "@/lib/i18n";
  import { redeemAction, type RedeemState } from "@/app/redeem/actions";
  import type { StringKey } from "@/lib/i18n";

  const ERROR_KEY: Record<string, StringKey> = {
    "invalid-code": "redeemErrInvalidCode",
    expired: "redeemErrExpired",
    exhausted: "redeemErrExhausted",
    "already-redeemed": "redeemErrAlreadyRedeemed",
    "rate-limited": "redeemErrRateLimited",
    generic: "redeemErrGeneric",
  };

  const initial: RedeemState = { status: "idle" };

  export function RedeemForm() {
    const { t } = useLang();
    const [state, action, pending] = useActionState(redeemAction, initial);

    if (state.status === "success") {
      return (
        <div className="rise-in rounded-2xl border border-moss/30 bg-moss-soft p-6 text-center">
          <p className="text-2xl" aria-hidden>✓</p>
          <h2 className="mt-1 font-display text-xl font-semibold text-moss">
            {t("redeemSuccessTitle")}
          </h2>
          <p className="mt-1 text-ink-soft">{t("redeemSuccessBody")}</p>
        </div>
      );
    }

    return (
      <form action={action} className="rounded-2xl border border-line bg-card p-6">
        <h1 className="font-display text-2xl font-semibold text-deniz-deep">
          {t("redeemTitle")}
        </h1>
        <p className="mt-2 text-ink-soft">{t("redeemIntro")}</p>

        <input
          name="code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder={t("redeemPlaceholder")}
          className="mt-4 w-full rounded-xl border border-line bg-paper px-4 py-3 text-center font-mono text-lg tracking-widest text-ink outline-none focus:border-deniz/60"
        />

        {state.status === "error" && (
          <p className="mt-3 text-sm font-medium text-clay" role="alert">
            {t(ERROR_KEY[state.error] ?? "redeemErrGeneric")}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-4 w-full rounded-xl bg-deniz px-4 py-3 font-semibold text-white transition-colors hover:bg-deniz-deep disabled:opacity-60"
        >
          {pending ? t("redeemPending") : t("redeemSubmit")}
        </button>
      </form>
    );
  }
  ```
- [x] Create the page `app/redeem/page.tsx` (server component — auth wall, then the form):
  ```tsx
  import { redirect } from "next/navigation";
  import { createClient } from "@/lib/supabase/server";
  import { RedeemForm } from "@/components/RedeemForm";

  export const dynamic = "force-dynamic";

  export default async function RedeemPage({
    searchParams,
  }: {
    searchParams: Promise<{ next?: string }>;
  }) {
    const { next } = await searchParams;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      const dest = next ? `/redeem?next=${encodeURIComponent(next)}` : "/redeem";
      redirect(`/auth/sign-in?next=${encodeURIComponent(dest)}`);
    }

    return (
      <main className="mx-auto max-w-md px-4 py-10">
        <RedeemForm />
      </main>
    );
  }
  ```
- [x] Commit:
  ```bash
  git add app/redeem/actions.ts app/redeem/page.tsx components/RedeemForm.tsx
  git commit -m "phase4: /redeem page + server action + bilingual RedeemForm"
  ```

**Manual verification checklist**
- Visiting `/redeem` logged-out → `/auth/sign-in?next=/redeem`.
- Submitting a bad code → red bilingual "not valid" message; the input stays.
- Submitting a valid code (create one via Task 14 setup) → green success panel; navigating back
  to the previously-locked unit now shows content.
- Toggling EN/TR re-renders every message in the chosen language.

**Failure modes**
- `useActionState is not a function`: it is a React 19 hook imported from `react` (not
  `react-dom`). The form must be a Client Component (`"use client"`).
- Action returns but UI never updates: the `<form action={action}>` must use the `action`
  returned by `useActionState`, not `redeemAction` directly.
- "Failed to find Server Action" after a redeploy mid-session: expected per the Server Actions
  guide (action IDs rotate); a page refresh recovers. Not a bug.
- Success but access still locked on the unit page: the unit route is not dynamic, or you cached
  the access decision cross-request. Both are addressed by Tasks 6 and 10 — verify `force-dynamic`.

---

## Task 12 — "Access until …" badge + track catalog on the home

Two small surfaces: the entitlement-expiry badge (Header/settings) and the student's track
subjects on the home. Restate the governing rule while wiring the catalog.

**Rule (master D6, restated):** *the catalog is a lens, the entitlement is the wall.* The home
shows the subjects of the student's **track** (`track_subjects` join, published only) for
discovery. A subject **outside** the track is NOT hard-blocked — it stays directly reachable by
URL (`/s/<slug>`) and is governed solely by free/entitlement at the unit level. Never add a
track-membership check to the subject or unit pages; catalog visibility and access are
independent axes.

- [x] Create the expiry badge. Server wrapper `components/AccessBadgeServer.tsx`:
  ```tsx
  import "server-only";
  import { getActiveEntitlementExpiry } from "@/lib/access/access";
  import { AccessBadge } from "./AccessBadge";

  export async function AccessBadgeServer() {
    const expiresAt = await getActiveEntitlementExpiry();
    if (!expiresAt) return null; // no active entitlement → render nothing
    return <AccessBadge expiresAt={expiresAt} />;
  }
  ```
  Client renderer `components/AccessBadge.tsx` (formats the date in the active language):
  ```tsx
  "use client";

  import { useLang } from "@/lib/i18n";

  export function AccessBadge({ expiresAt }: { expiresAt: string }) {
    const { t, lang } = useLang();
    const formatted = new Intl.DateTimeFormat(lang === "tr" ? "tr-TR" : "en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(expiresAt));
    return (
      <span className="rounded-full bg-deniz-soft px-2.5 py-1 text-xs font-medium text-deniz-deep">
        {t("accessUntil")} {formatted}
      </span>
    );
  }
  ```
  Render `<AccessBadgeServer />` in the app shell where Phase 2 placed the account UI — the
  server layout (`app/layout.tsx`) adjacent to `<Header />`, or on the account/settings page.
  Because it is a Server Component it can live directly in a server layout:
  ```tsx
  // in app/layout.tsx (or the account/settings server page), near the header:
  import { AccessBadgeServer } from "@/components/AccessBadgeServer";
  // ...
  {/* renders nothing when there is no active entitlement */}
  <AccessBadgeServer />
  ```
  > It formats "Access until 12 Nov 2026" (`en-GB`) / "Erişim bitişi 12 Kas 2026" (`tr-TR`).
  > Placement is flexible; the component is self-contained. Prefer the settings/account area if
  > the header layout is tight.
- [x] Wire the track catalog on the home. In the authenticated home (`app/page.tsx` or the
  Phase 2/3 dashboard), list the student's track subjects. Reference server component +
  helper. Add to `lib/access/access.ts`:
  ```ts
  export interface CatalogSubject {
    id: string;
    slug: string;
    title: { tr: string; en: string };
    tagline: { tr: string; en: string };
  }

  /** The published subjects attached to the current user's track (empty if no track). */
  export const getMyTrackSubjects = cache(async (): Promise<CatalogSubject[]> => {
    const supabase = await createClient();
    const { data: profile } = await supabase
      .from("profiles")
      .select("track_id")
      .maybeSingle();
    if (!profile?.track_id) return [];

    const { data, error } = await supabase
      .from("track_subjects")
      .select("subjects!inner(id,slug,title,tagline,status)")
      .eq("track_id", profile.track_id)
      .eq("subjects.status", "published")
      .order("sort", { ascending: true });
    if (error || !data) return [];

    return data
      .map((r) => (r as unknown as { subjects: CatalogSubject & { status: string } }).subjects)
      .filter(Boolean);
  });
  ```
  And a home section (server component fragment) that renders them with the existing card style:
  ```tsx
  // e.g. components/TrackCatalog.tsx  (server component)
  import "server-only";
  import Link from "next/link";
  import { getMyTrackSubjects } from "@/lib/access/access";
  import { TrackCatalogHeading } from "./TrackCatalogHeading"; // client, for the bilingual heading
  import { SubjectTitle } from "./SubjectTitle"; // client, bilingual card body

  export async function TrackCatalog() {
    const subjects = await getMyTrackSubjects();
    if (subjects.length === 0) return null;
    return (
      <section>
        <TrackCatalogHeading />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {subjects.map((s) => (
            <Link
              key={s.id}
              href={`/s/${s.slug}`}
              className="group rounded-2xl border border-line bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-deniz/40 hover:shadow-[0_8px_24px_rgba(14,90,109,0.10)]"
            >
              <SubjectTitle title={s.title} tagline={s.tagline} />
            </Link>
          ))}
        </div>
      </section>
    );
  }
  ```
  ```tsx
  // components/TrackCatalogHeading.tsx  (client — bilingual heading via useLang)
  "use client";
  import { useLang } from "@/lib/i18n";
  export function TrackCatalogHeading() {
    const { t } = useLang();
    return (
      <h2 className="mb-4 font-display text-2xl font-semibold text-ink">{t("yourSubjects")}</h2>
    );
  }
  ```
  ```tsx
  // components/SubjectTitle.tsx  (client — bilingual card body)
  "use client";
  import { useLang } from "@/lib/i18n";
  import type { Bi } from "@/lib/types";
  export function SubjectTitle({ title, tagline }: { title: Bi; tagline: Bi }) {
    const { bi } = useLang();
    return (
      <>
        <h3 className="font-display text-lg font-semibold text-ink group-hover:text-deniz-deep">
          {bi(title)}
        </h3>
        <p className="mt-1 line-clamp-2 text-sm text-ink-soft">{bi(tagline)}</p>
      </>
    );
  }
  ```
  Render `<TrackCatalog />` in the authenticated home. Subjects outside the track are not listed
  here but remain reachable at `/s/<slug>` — the wall is entitlement, not catalog membership.
- [x] Commit:
  ```bash
  git add lib/access/access.ts components/AccessBadge.tsx components/AccessBadgeServer.tsx \
          components/TrackCatalog.tsx components/TrackCatalogHeading.tsx components/SubjectTitle.tsx \
          app/layout.tsx app/page.tsx
  git commit -m "phase4: Access-until badge + track catalog on home (catalog is a lens, entitlement is the wall)"
  ```

**Manual verification checklist**
- A user with an active entitlement sees "Access until <date>" in their chosen language; a user
  with none sees no badge (the component returns null).
- The home lists only the track's published subjects; a non-track subject is absent from the home
  but still opens at `/s/<slug>` (and is then gated per unit).

**Failure modes**
- Nested-select shape error on `track_subjects.select("subjects!inner(...)")`: adjust to Phase 3's
  actual FK name; the `!inner` join requires the FK `track_subjects.subject_id → subjects.id`
  (master §4). Fall back to two queries if the embed is awkward.
- Date shows the wrong locale: the badge is a Client Component reading `useLang().lang`; a Server
  Component cannot know the client language — keep the split (server fetch → client format).

---

## Task 13 — SQL probe script for every `redeem_code` branch

A runnable psql script that seeds fixtures and asserts each branch. It uses fabricated JWT claims
(`set local request.jwt.claims`) so `auth.uid()` resolves without a login, and computes code
hashes inline with the same `digest` the function uses (guaranteeing parity).

> **Test-user note:** `entitlements`/`code_redemptions` FK to `auth.users`, so the script needs a
> real `auth.users` row. Create a throwaway user first (Supabase dashboard, the Admin API, or the
> SQL insert below) and paste its UUID into `:test_uid`. On some Supabase versions a bare
> `insert into auth.users` needs a few columns; the insert below covers the common set — if it
> errors, create the user via the Auth Admin API and set `:test_uid` to its id.

- [x] Create `supabase/tests/04-access.sql`:
  ```sql
  -- Phase 4 redeem_code branch coverage. Run against a dev/branch DB with psql:
  --   psql "$DB_URL" -f supabase/tests/04-access.sql
  -- This file uses psql meta-commands (\set, \echo) — it MUST run under psql, not the SQL editor
  -- (and the Supabase CLI has NO `db execute` subcommand, master §14).
  -- Every RAISE NOTICE 'PASS ...' must appear; any EXCEPTION fails.

  \set ON_ERROR_STOP on

  -- 0) Throwaway test user (id fixed for reproducibility). Adjust columns if your Supabase
  --    version rejects this minimal insert; otherwise create via the Auth Admin API.
  insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at,
                          email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated',
          'phase4-probe@example.com', '', now(), now(), now(), '{}', '{}')
  on conflict (id) do nothing;

  -- A second user for the double/concurrent scenarios.
  insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at,
                          email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated',
          'phase4-probe2@example.com', '', now(), now(), now(), '{}', '{}')
  on conflict (id) do nothing;

  -- 1) A subject + a published tier to point codes at.
  insert into public.subjects (id, slug, title, tagline, status)
  values ('33333333-3333-3333-3333-333333333333', 'probe-subject',
          '{"tr":"Deneme","en":"Probe"}', '{"tr":"","en":""}', 'published')
  on conflict (slug) do nothing;

  -- scope_id is REQUIRED for non-'all' tiers (tiers_scope_target constraint, master §4).
  insert into public.tiers (id, slug, title, scope_type, scope_id, duration_days, prices, status)
  values ('44444444-4444-4444-4444-444444444444', 'probe-tier',
          '{"tr":"Deneme","en":"Probe"}', 'subject',
          '33333333-3333-3333-3333-333333333333', 30, '[]'::jsonb, 'hidden')
  on conflict (slug) do nothing;

  -- Helper to make a code hash the SAME way redeem_code does (upper+strip already applied here).
  -- We insert codes with plaintext already normalized so the hash is exact.
  -- VALID code:
  insert into public.access_codes
    (code_hash, tier_id, scope_type, scope_id, duration_days, max_redemptions, valid_until)
  values (encode(extensions.digest('CBDVALID001','sha256'),'hex'),
          '44444444-4444-4444-4444-444444444444', 'subject',
          '33333333-3333-3333-3333-333333333333', 30, 5, null)
  on conflict (code_hash) do nothing;

  -- EXPIRED (deadline in the past):
  insert into public.access_codes
    (code_hash, tier_id, scope_type, scope_id, duration_days, max_redemptions, valid_until)
  values (encode(extensions.digest('CBDEXPIRED0','sha256'),'hex'),
          '44444444-4444-4444-4444-444444444444', 'subject',
          '33333333-3333-3333-3333-333333333333', 30, 5, now() - interval '1 day')
  on conflict (code_hash) do nothing;

  -- EXHAUSTED (redeemed_count == max):
  insert into public.access_codes
    (code_hash, tier_id, scope_type, scope_id, duration_days, max_redemptions, redeemed_count)
  values (encode(extensions.digest('CBDEXHAUST0','sha256'),'hex'),
          '44444444-4444-4444-4444-444444444444', 'subject',
          '33333333-3333-3333-3333-333333333333', 30, 1, 1)
  on conflict (code_hash) do nothing;

  -- REVOKED:
  insert into public.access_codes
    (code_hash, tier_id, scope_type, scope_id, duration_days, max_redemptions, revoked_at)
  values (encode(extensions.digest('CBDREVOKED0','sha256'),'hex'),
          '44444444-4444-4444-4444-444444444444', 'subject',
          '33333333-3333-3333-3333-333333333333', 30, 5, now())
  on conflict (code_hash) do nothing;

  -- ============ assertions ============
  do $$
  declare r jsonb;
  begin
    perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);

    -- SQL↔JS hash parity check:
    if encode(extensions.digest('CBD7K3M9PXQ','sha256'),'hex')
       <> '0469f76c67a68e98cf8c9baea7aebef3e4f96d68eb7fb77cde202c5ca813c449' then
      raise exception 'FAIL hash parity';
    end if;
    raise notice 'PASS hash-parity';

    -- invalid:
    r := public.redeem_code('CBD-NOPE-NOPE');
    assert r->>'error' = 'invalid-code', 'expected invalid-code, got '||r::text;
    raise notice 'PASS invalid-code';

    -- revoked → invalid-code:
    r := public.redeem_code('CBD-REVO-KED0');
    assert r->>'error' = 'invalid-code', 'expected invalid-code (revoked), got '||r::text;
    raise notice 'PASS revoked→invalid-code';

    -- expired:
    r := public.redeem_code('CBD-EXPI-RED0');
    assert r->>'error' = 'expired', 'expected expired, got '||r::text;
    raise notice 'PASS expired';

    -- exhausted:
    r := public.redeem_code('CBD-EXHA-UST0');
    assert r->>'error' = 'exhausted', 'expected exhausted, got '||r::text;
    raise notice 'PASS exhausted';

    -- happy path:
    r := public.redeem_code('CBD-VALI-D001');
    assert (r->>'ok')::boolean is true, 'expected ok, got '||r::text;
    raise notice 'PASS valid-redeem';

    -- reset the brute-force window for the next scenario group (the five calls above would
    -- otherwise make this attempt #6 → 'rate-limited' instead of 'already-redeemed')
    delete from public.redemption_attempts where user_id = '11111111-1111-1111-1111-111111111111';

    -- double redemption by same user:
    r := public.redeem_code('CBD-VALI-D001');
    assert r->>'error' = 'already-redeemed', 'expected already-redeemed, got '||r::text;
    raise notice 'PASS already-redeemed';
  end $$;

  -- Stacking: redeem another subject-scope code and confirm expiry extended, not reset.
  insert into public.access_codes
    (code_hash, tier_id, scope_type, scope_id, duration_days, max_redemptions)
  values (encode(extensions.digest('CBDSTACK001','sha256'),'hex'),
          '44444444-4444-4444-4444-444444444444', 'subject',
          '33333333-3333-3333-3333-333333333333', 30, 5)
  on conflict (code_hash) do nothing;

  -- reset the brute-force window for the next scenario group
  delete from public.redemption_attempts
    where user_id = '11111111-1111-1111-1111-111111111111';

  do $$
  declare r jsonb; n int; max_exp timestamptz;
  begin
    perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
    r := public.redeem_code('CBD-STAC-K001');
    assert (r->>'ok')::boolean is true, 'stack redeem should succeed';
    select count(*), max(expires_at) into n, max_exp
    from public.entitlements
    where user_id = '11111111-1111-1111-1111-111111111111'
      and scope_type='subject' and scope_id='33333333-3333-3333-3333-333333333333';
    -- two rows (append-only ledger), furthest expiry ~60 days out (30 + 30 stacked):
    assert n = 2, 'expected 2 entitlement rows (append-only), got '||n;
    assert max_exp > now() + interval '55 days', 'expected stacked expiry ~60d, got '||max_exp::text;
    raise notice 'PASS stacking (append-only, extended expiry)';
  end $$;

  -- Rate limit: user 2 makes 6 invalid attempts in the hour; the 6th is rate-limited.
  do $$
  declare r jsonb; i int;
  begin
    perform set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', true);
    for i in 1..5 loop
      r := public.redeem_code('CBD-XXXX-'||lpad(i::text,4,'0'));
      assert r->>'error' = 'invalid-code', 'attempt '||i||' should be invalid-code, got '||r::text;
    end loop;
    r := public.redeem_code('CBD-XXXX-0006');
    assert r->>'error' = 'rate-limited', 'attempt 6 should be rate-limited, got '||r::text;
    raise notice 'PASS rate-limited (6th attempt)';
  end $$;

  -- Cleanup so the script is re-runnable.
  delete from public.code_redemptions
    where user_id in ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');
  delete from public.entitlements
    where user_id in ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');
  delete from public.redemption_attempts
    where user_id in ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');
  update public.access_codes set redeemed_count = 0
    where code_hash = encode(extensions.digest('CBDVALID001','sha256'),'hex')
       or code_hash = encode(extensions.digest('CBDSTACK001','sha256'),'hex');

  \echo 'ALL PHASE-4 REDEEM PROBES PASSED'
  ```
- [x] **Concurrent last-slot test (two psql sessions — cannot be scripted in one transaction).**
  Document and run manually:
  1. Seed a code with `max_redemptions = 1, redeemed_count = 0` (plaintext `CBDLASTSLOT`).
  2. In **session A**: `begin;` then `set local request.jwt.claims='{"sub":"111…1"}';` then
     `select public.redeem_code('CBDLASTSLOT');` — **do not commit yet** (holds the `FOR UPDATE`
     lock on the code row).
  3. In **session B**: `begin;` `set local request.jwt.claims='{"sub":"222…2"}';`
     `select public.redeem_code('CBDLASTSLOT');` — this **blocks** on the lock.
  4. In **session A**: `commit;` (A got `ok:true`, `redeemed_count → 1`).
  5. Session B unblocks, re-reads the row (`redeemed_count = 1 ≥ max 1`), returns
     `{"ok":false,"error":"exhausted"}`. `commit;` B.
  Expected: exactly one success, one `exhausted`; `redeemed_count = 1`; one `code_redemptions`
  row. This proves the row lock prevents over-redemption of the last slot.
- [x] Run the automated script with **psql** (the file uses psql meta-commands like
  `\set ON_ERROR_STOP` and `\echo`, which only psql interprets; the Supabase CLI has NO
  `db execute` subcommand — master §14). Get `DB_URL` from the Supabase dashboard → Connect →
  connection string (or `supabase status` for a local stack); never commit it.
  ```bash
  psql "$DB_URL" -f supabase/tests/04-access.sql
  ```
  Expected: a `PASS …` line for each branch and a final `ALL PHASE-4 REDEEM PROBES PASSED`.
- [x] Commit:
  ```bash
  git add supabase/tests/04-access.sql
  git commit -m "phase4: SQL probe script covering every redeem_code branch + concurrency runbook"
  ```

**Manual verification checklist**
- Every `PASS` notice prints; the script ends with `ALL PHASE-4 REDEEM PROBES PASSED`.
- The two-session runbook yields exactly one success and one `exhausted`.

**Failure modes**
- `insert into auth.users` rejected: your Supabase version needs extra columns (e.g.
  `instance_id`). Create the user via the Auth Admin API instead and set the two UUIDs to match.
- `assert` not firing: `plpgsql.check_asserts` is off — assertions are on by default; if disabled,
  replace `assert` with explicit `if … then raise exception`.
- Rate-limit assertion flaky across re-runs: the cleanup `delete from redemption_attempts` at the
  end must run; if a prior run aborted mid-way, clear attempts manually before re-running.

---

## Task 14 — Free-preview → lock → paywall → redeem, end-to-end (manual)

With default seeds every unit is `is_free=true`, so nothing locks. This task proves the wall works
by flipping one unit, then walking the full student flow. Run on a dev/branch DB you can mutate.

- [x] **Baseline (nothing locks).** Log in as a normal student with no entitlement. Open any
  subject home → every unit card shows "Free preview"; open any unit → content renders. Confirm
  no lock appears.
- [x] **Flip one unit to non-free** (pick `hidroloji` unit-1; adjust slug to a real seeded unit):
  ```sql
  update public.units u
  set is_free = false
  from public.subjects s
  where u.subject_id = s.id and s.slug = 'hidroloji' and u.slug = 'unit-1';
  -- verify:
  select s.slug, u.slug, u.is_free, u.status
  from public.units u join public.subjects s on s.id=u.subject_id
  where s.slug='hidroloji' and u.slug='unit-1';   -- expect is_free = f
  ```
- [x] **Lock shows.** Reload the subject home as the unentitled student → the `unit-1` card now
  shows 🔒 Locked (other cards still "Free preview"). Open `unit-1` → the **PaywallPanel** renders
  with the published tier (Task 15 seeds it) and the "I have a code" button. Confirm the heavy
  content is NOT in the page source (view-source / network: `get_unit_content` returned null).
- [x] **Mint a code and redeem.** As an admin (or directly in SQL for the test), create a code
  for the subject scope and note the plaintext. Because codes are stored hashed, insert the hash
  of a known plaintext:
  ```sql
  -- plaintext CBD-TEST-0001 → normalized CBDTEST0001
  insert into public.access_codes
    (code_hash, tier_id, scope_type, scope_id, duration_days, max_redemptions)
  select encode(extensions.digest('CBDTEST0001','sha256'),'hex'),
         t.id, 'subject', s.id, 30, 1
  from public.tiers t, public.subjects s
  where t.slug='term-all' and s.slug='hidroloji';
  ```
  In the app: click "I have a code" → `/redeem` → type `CBD-TEST-0001` (with or without dashes —
  normalization handles it) → submit.
- [x] **Unlocked.** Expect the green success panel. Navigate back to `hidroloji/unit-1` → content
  now renders (reason `entitled`). The Header/settings shows "Access until <~30 days out>".
- [x] **Reset for a clean state** (optional): flip the unit back and clear the test grant:
  ```sql
  update public.units u set is_free = true
  from public.subjects s
  where u.subject_id=s.id and s.slug='hidroloji' and u.slug='unit-1';
  -- (leave the entitlement or delete it for your test user as desired)
  ```

**Manual verification checklist (the flow, exact expected UI)**

| Step | State | Expected UI |
|---|---|---|
| Baseline | all `is_free=true` | all cards "Free preview"; all units open |
| Flip `unit-1` | `is_free=false`, unentitled | `unit-1` card 🔒 Locked; others free |
| Open locked unit | unentitled | PaywallPanel + tier price + "I have a code"; no content |
| Redeem `CBD-TEST-0001` | valid | green "Access unlocked!" panel |
| Reopen unit | entitled | content renders; "Access until <date>" in header |

**Failure modes**
- Card shows locked but the unit still opens with content: the unit page did not call `getAccess`
  before reading content, or `force-dynamic` is missing (stale prerender). Re-check Task 10.
- Redeem succeeds but the unit stays locked: the redeem action didn't `revalidatePath('/','layout')`
  or the unit route is statically cached — verify Tasks 10 and 11.

---

## Task 15 — Seed the canonical tier + negative-path verification battery

First seed a published tier so the paywall has something to show (master §5 canonical values),
then run the security battery via raw PostgREST (master §12.6). These curls prove RLS actually
holds against a real student token.

- [x] Seed the canonical `term-all` tier (published). Create the migration:
  ```bash
  supabase migration new phase4_seed_term_all_tier
  ```
  Paste into `supabase/migrations/<ts>_phase4_seed_term_all_tier.sql`:
  ```sql
  -- Phase 4: seed the canonical tier (master §5) so the paywall renders. Admin can edit later.
  -- scope_id is intentionally omitted → null, as REQUIRED for scope_type='all' by the
  -- tiers_scope_target constraint (master §4).
  insert into public.tiers (slug, title, description, scope_type, duration_days, prices, status, sort)
  values (
    'term-all',
    '{"tr":"Dönemlik — Tümü","en":"Term — All access"}',
    '{"tr":"","en":""}',
    'all',
    120,
    '[{"currency":"TZS","amount":15000,"country":"TZ"},{"currency":"USD","amount":6,"country":"*"}]'::jsonb,
    'published',
    0
  )
  on conflict (slug) do nothing;
  ```
  ```bash
  supabase db reset
  git add supabase/migrations
  git commit -m "phase4: seed canonical term-all tier (published) for paywall"
  ```
- [x] Gather test values (do NOT commit secrets): `NEXT_PUBLIC_SUPABASE_URL`, the anon key, and a
  **student** access token. Get a student token via the password grant (use a confirmed test
  student, not an admin):
  ```bash
  export SB_URL="https://<project-ref>.supabase.co"
  export ANON="<anon-key>"
  export STUDENT_JWT=$(curl -s "$SB_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON" -H "Content-Type: application/json" \
    -d '{"email":"student@example.com","password":"<password>"}' | jq -r .access_token)
  echo "${STUDENT_JWT:0:12}…"   # sanity: non-empty
  ```
- [x] **(a) Read `access_codes` as a student.** RLS is admin-only, so the student sees zero rows.
  Under Supabase defaults the `authenticated` role has table SELECT privilege and RLS filters the
  rows, so the SECURE, EXPECTED result is an **empty array** (no code hashes leak) — not an error.
  ```bash
  curl -s "$SB_URL/rest/v1/access_codes?select=*" \
    -H "apikey: $ANON" -H "Authorization: Bearer $STUDENT_JWT"
  # expected body: []
  ```
  Pass condition: `[]` (zero rows). A non-empty result is a security failure — stop and fix the
  `access_codes` policy.
- [x] **(b) Insert an entitlement as a student.** No client INSERT policy exists → RLS rejects.
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X POST "$SB_URL/rest/v1/entitlements" \
    -H "apikey: $ANON" -H "Authorization: Bearer $STUDENT_JWT" \
    -H "Content-Type: application/json" -H "Prefer: return=representation" \
    -d '{"user_id":"'"$(curl -s "$SB_URL/auth/v1/user" -H "apikey: $ANON" -H "Authorization: Bearer $STUDENT_JWT" | jq -r .id)"'","scope_type":"all","expires_at":"2030-01-01T00:00:00Z","source":"code"}'
  # expected HTTP: 403  — body: {"code":"42501","message":"new row violates row-level security policy for table \"entitlements\"", ...}
  ```
  Pass condition: HTTP `403` with code `42501`. Any `2xx` means a write policy leaked in — stop.
- [x] **(c) Redeem the same code twice.** First mint `CBD-NEG1-0001` for the student to redeem
  (admin/SQL — insert `encode(digest('CBDNEG10001','sha256'),'hex')`). Then:
  ```bash
  # first redemption:
  curl -s -X POST "$SB_URL/rest/v1/rpc/redeem_code" \
    -H "apikey: $ANON" -H "Authorization: Bearer $STUDENT_JWT" \
    -H "Content-Type: application/json" -d '{"p_code":"CBD-NEG1-0001"}'
  # expected: {"ok":true,"entitlement":{...}}

  # second redemption (same student, same code):
  curl -s -X POST "$SB_URL/rest/v1/rpc/redeem_code" \
    -H "apikey: $ANON" -H "Authorization: Bearer $STUDENT_JWT" \
    -H "Content-Type: application/json" -d '{"p_code":"CBD-NEG1-0001"}'
  # expected: {"ok":false,"error":"already-redeemed"}
  ```
- [x] **(d) Redeem a revoked code.** Mint `CBD-NEG2-0002` with `revoked_at = now()`, then:
  ```bash
  curl -s -X POST "$SB_URL/rest/v1/rpc/redeem_code" \
    -H "apikey: $ANON" -H "Authorization: Bearer $STUDENT_JWT" \
    -H "Content-Type: application/json" -d '{"p_code":"CBD-NEG2-0002"}'
  # expected: {"ok":false,"error":"invalid-code"}   (revoked is indistinguishable from unknown — no leak)
  ```
- [x] Record the four results in the PR description. All four must match the expected outputs.

**Manual verification checklist**
- (a) `[]` · (b) `403 / 42501` · (c) `ok:true` then `already-redeemed` · (d) `invalid-code`.

**Failure modes**
- (a) returns rows: `access_codes` has an over-broad SELECT policy, or you tested with an admin
  token. Use a student.
- (b) returns `200/201`: an INSERT/ALL policy with a permissive `with check` leaked onto
  `entitlements`. Only SELECT should be client-exposed.
- `rpc/redeem_code` returns `404`: PostgREST hasn't picked up the function — it must be in the
  exposed `public` schema and granted to `authenticated`; run `notify pgrst, 'reload schema';`.
- `401 Invalid JWT`: the student token expired (default 1h) — re-run the password grant.

---

## Task 16 — Full gate, PR, and phase acceptance

- [x] From `cubad/`, run the full gate (master §8). Never run two builds at once.
  ```bash
  npm run lint
  npx vitest run
  node scripts/validate-content.mjs   # content/schema untouched this phase, but keep the gate green
  npm run build
  supabase db reset                   # fresh DB applies every migration cleanly
  psql "$DB_URL" -f supabase/tests/04-access.sql   # DB_URL: dashboard connection string (see Task 13)
  ```
  Expected: lint clean; all vitest green; validator OK; build succeeds; reset succeeds; probes
  print `ALL PHASE-4 REDEEM PROBES PASSED`.
- [x] Open the PR from `feat/phase-4-catalog-tiers-access` → `main`. In the description, paste:
  the four negative-path results (Task 15), the probe output (Task 13), and the Task 14 table.
  ```bash
  git push -u origin feat/phase-4-catalog-tiers-access
  gh pr create --base main --head feat/phase-4-catalog-tiers-access \
    --title "Phase 4 — Catalog gating, tiers, entitlements & access codes" \
    --body "Implements docs/plans/productization/04-catalog-tiers-access.md. See checklist + negative-path evidence."
  ```
- [x] Merge only after review (merging to `main` auto-deploys — master §8.7).

---

## Phase acceptance checklist (runnable)

Run from `cubad/` against a fresh dev/branch DB. Every line must pass.

- [x] `supabase db reset` — all Phase 1–4 migrations apply cleanly from scratch.
- [x] `select to_regprocedure('public.has_subject_access(uuid)') is not null;` → `t`.
- [x] `select to_regprocedure('public.redeem_code(text)') is not null;` → `t`.
- [x] `select to_regprocedure('public.grant_entitlement(uuid,text,uuid,uuid,int,text,uuid)') is not null;` → `t`.
- [x] `get_unit_content` returns `null` for a published non-free unit with no entitlement, and
      content once an entitlement is granted (Task 14).
- [x] `psql "$DB_URL" -f supabase/tests/04-access.sql` → `ALL PHASE-4 REDEEM PROBES PASSED`.
- [x] Two-session concurrent last-slot test → one `ok:true`, one `exhausted` (Task 13).
- [x] `npx vitest run lib/access/codes.test.ts` → green; hash vector equals the SQL hash.
- [x] `npm run lint` and `npm run build` pass.
- [x] Negative-path battery (Task 15) → (a) `[]`, (b) `403/42501`, (c) `already-redeemed`,
      (d) `invalid-code`.
- [x] UI: locked unit shows lock + paywall; `/redeem` unlocks; "Access until <date>" appears;
      home lists only track subjects while a non-track subject stays reachable by URL.
- [x] RLS: student cannot read `access_codes` (empty) nor insert `entitlements` (403).
- [x] Defense in depth confirmed: even bypassing the page, `get_unit_content` and `units` RLS
      return null for a locked unit.

---

## Rollback

This phase is additive (new functions, new policies, new files, one seed). To revert safely:

1. **Code:** `git revert` the phase merge commit (or close the PR unmerged). The new files under
   `lib/access/`, `components/PaywallPanel.tsx`, `components/PaywallCopy.tsx`,
   `components/RedeemForm.tsx`, `components/AccessBadge*.tsx`, `components/TrackCatalog*.tsx`,
   `components/SubjectTitle.tsx`, `app/redeem/*`, and the badge additions in `components/ui.tsx`
   / `lib/i18n.tsx` are self-contained; removing them restores Phase 3 behavior.
2. **Database (never edit an applied migration — add a new reverting migration):**
   ```sql
   -- restore the Phase 3 gate (free OR admin only):
   -- re-apply Phase 3's original get_unit_content body via create or replace.
   drop policy if exists tiers_read_published        on public.tiers;
   drop policy if exists tiers_admin_all             on public.tiers;
   drop policy if exists entitlements_owner_select   on public.entitlements;
   drop policy if exists access_codes_admin_all      on public.access_codes;
   drop policy if exists code_redemptions_owner_select on public.code_redemptions;
   drop function if exists public.redeem_code(text);
   drop function if exists public.grant_entitlement(uuid,text,uuid,uuid,int,text,uuid);
   drop function if exists public.has_subject_access(uuid);
   delete from public.tiers where slug = 'term-all';
   ```
   Dropping the policies returns those tables to deny-all-to-clients (safe). Leaving RLS enabled
   is correct. Do not drop `pgcrypto` (harmless, may be used elsewhere).
3. **No data loss:** entitlements/redemptions created during the phase are historical rows; they
   are inert once the gate reverts to `is_free OR is_admin()` (all seeded units are free).
4. Because all seeded units are `is_free = true`, reverting this phase leaves every student with
   the same open access they had after Phase 3 — no user loses anything.

---

## Changelog / deviations

- **2026-07-19 — review security hardening:** PR review identified that the public Supabase anon
  role could call `claim_unit_preview(uuid,text)` with attacker-chosen hashes. A new additive
  migration revokes anon execution; anonymous choices now use the trusted Next.js service-role
  path, while authenticated execution retains `auth.uid()` binding. The same migration restores
  admin draft parity in raw `units` RLS and schedules a daily indexed purge of expired anonymous
  capability rows. Review follow-ups also centralize same-site redirect validation (including
  backslash rejection), bind paywall profile reads by `user_id`, stabilize the date badge, and
  add an admin-only draft catalog loader. Applied migration history was not edited to retrofit
  `NOT VALID` constraint syntax after the fact.
- **2026-07-19 — approved first-chosen-preview extension (recorded before gate implementation):**
  The product owner explicitly superseded the original D6/D7 account-only, static-`is_free`
  assumption. A visitor or unentitled student may study exactly one full unit of their choice.
  `has_subject_access(uuid)` remains entitlement-only; `is_free` is retained for schema/catalog
  compatibility but is not sufficient by itself to release content. The chosen unit is instead
  bound to a strict-RLS, one-row-per-user durable selection for authenticated users, and to a
  random browser capability for anonymous visitors. Only the capability's SHA-256 digest is
  stored, with no fingerprint, IP address, identity, or progress data. An anonymous choice is
  promoted on signup/sign-in when the account has no prior selection, and never overwrites an
  existing durable account choice. Clearing browser data creates a new unlinkable capability, so
  anonymous abuse cannot be made impossible without requiring authentication; this limitation is
  explicit. `get_unit_content(text,text)`, the server helper, unit page, and every child study
  route must agree on selected-unit OR covering-entitlement OR admin access. This requires
  additive preview-selection tables/functions and a new replacement migration for the existing
  RPC; no applied migration is edited. Payments remain Phase 6.
- **2026-07-19 — clean-stack profile privilege repair:** Local browser onboarding exposed that
  the earlier profile owner policies existed but `authenticated` had no explicit table-level
  `SELECT`/`UPDATE` grants under the repository's `auto_expose_new_tables = false` baseline. An
  additive migration grants only those two privileges. Existing owner-only RLS and the single
  `profiles_protect_role` trigger remain the authorization boundary; no insert/delete or role
  escalation path is added.

- **2026-07-16 — post-audit fixes (coordinator audit, applied before execution):**
  1. **Task 13 probe script no longer trips its own rate limiter.** The first DO block's five
     `redeem_code` calls made the double-redeem probe attempt #6 (→ `rate-limited`, aborting the
     script). `redemption_attempts` for test user `1111…1` are now cleared immediately before the
     double-redeem assertion and again before the stacking DO block.
  2. **Stacking extracted into `public.grant_entitlement(p_user, p_scope_type, p_scope_id,
     p_tier_id, p_duration_days, p_source, p_source_id) returns uuid`** per the new master §4
     contract / disambiguated D8 (Task 3 migration, defined before `redeem_code`; SECURITY
     DEFINER, insert-new-row semantics, execute revoked from `public, anon, authenticated`).
     `redeem_code` now mints via `grant_entitlement` and reads back `expires_at` for its return
     payload — behavior identical to the previous inline arithmetic. Phase 6's `approve_claim`
     calls the same function. Rollback, Task 3 checklist and the phase acceptance checklist
     updated to cover the new function.
  3. **Auth-wall redirects corrected to Phase 2's real route** per master §14: `/login?next=` →
     `/auth/sign-in?next=` (Task 10 unit-page code + checklist; Task 11 redeem-page code +
     checklist).
  4. **`createServiceClient` → `createServiceRoleClient`** (Prerequisites table) per master §14.
  5. **Tier seeds verified against the new `tiers_scope_target` constraint** (master §4): the
     Task 15 `term-all` seed (scope_type `'all'`, `scope_id` omitted → null) is compliant as-is
     (comment added); the Task 13 probe-tier insert (scope_type `'subject'`) now sets `scope_id`
     explicitly — it previously omitted it and would have violated the constraint and aborted
     the probe script.
  6. **`supabase db execute` replaced everywhere** (Task 0 prose, Task 13 file header + run step,
     Task 16 gate, phase acceptance checklist) per master §14 — the CLI's `db` group has no
     `execute` subcommand, and the probe file uses psql meta-commands (`\set ON_ERROR_STOP`,
     `\echo`). Probe-file runs now use `psql "$DB_URL" -f supabase/tests/04-access.sql` (DB_URL
     from the dashboard connection string); SQL editor / MCP `execute_sql` remain valid only for
     inline SQL without meta-commands.

_(executing agents record further deviations here per master §11)_
