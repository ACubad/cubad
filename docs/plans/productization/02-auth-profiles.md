# Phase 2 — Auth, Profiles & Server-side Progress

> **For agentic workers:** This is a phase plan. Read `00-MASTER-PLAN.md` **fully** first — its
> §3 decisions (esp. D2, D3, D11, D15), §4 schema, §8 done-definition, and §9 security
> invariants are LAW and are not re-litigated here. Execute the tasks below **in order**. Tick
> each `- [ ]` as you finish it. Where tests are given, write them **first** (TDD). Every code
> step contains the **complete** code — do not paraphrase or defer. Pin every command to the
> `cubad/` directory. If you are a Claude Code session, route auth/RLS/migration tasks to an
> **opus** subagent and audit twice (spec, then adversarial) per master §11.

**Goal:** Real accounts. A visitor can sign up with email+password, confirm via a Resend
email, be onboarded (name / country / phone / language / track), and have their study
progress saved **server-side** against `user_state` (reusing the proven `lib/sync.ts`
union-merge). Anonymous passcode sync keeps working unchanged. A one-time "import from
passcode" migrates existing users. The header gains an account menu.

**Architecture:** Next.js 16 (App Router) + the new `cubad-app` Supabase project from Phase 1.
Auth is Supabase Auth (email+password, email confirmation) via `@supabase/ssr` — browser
client, server client, and a **root `proxy.ts`** (Next 16's renamed middleware) that refreshes
the session cookie on every request. Server Actions handle form posts; a Route Handler
(`/api/state`) is the authenticated progress transport. A `SECURITY DEFINER` trigger creates a
`profiles` row on `auth.users` insert.

**Tech stack (this phase):** `@supabase/ssr` + `@supabase/supabase-js` (installed in Phase 1),
Resend as custom SMTP (dashboard-only — **no npm dependency** for auth emails), Vitest,
Tailwind 4, `lib/i18n.tsx` `Bi` strings. No OAuth providers (YAGNI v1). No SMS.

---

## ⚠ Next.js 16 reality check (read before writing any code)

`cubad/AGENTS.md` says this is **not** the Next.js in your training data. Two breaking facts
this phase depends on — both **verified against `node_modules/next/dist/docs/` in this repo**:

1. **`middleware.ts` is deprecated and renamed to `proxy.ts`.** The file lives at the repo
   root (same level as `app/`), exports a function named `proxy` (default or named), and
   **defaults to the Node.js runtime**. See
   `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`. The task
   brief calls this "middleware.ts"; the current, correct convention is **`proxy.ts`**, and
   this plan uses it. (A leftover `middleware.ts` from Phase 1 must be deleted — see Task 2.10.)
2. **`cookies()` and `headers()` are async** — always `await cookies()`. Route Handlers use the
   Web `Request`/`Response` API. Server Actions POST back to the page and **must
   re-authenticate inside** (render-time gating is not a security boundary).

**Before you touch a Next API in any task, open its guide in `node_modules/next/dist/docs/`
first.** The relevant ones for this phase:
- `01-app/02-guides/authentication.md`
- `01-app/02-guides/server-actions.md`
- `01-app/01-getting-started/15-route-handlers.md`
- `01-app/03-api-reference/03-file-conventions/proxy.md`

When a Supabase auth/SSR detail is uncertain, consult current Supabase docs (MCP
`search_docs` or web) — do not guess (master §11).

---

## Prerequisites

**Depends on:** Phase 1 (`01-foundation.md`) must be merged. This phase assumes Phase 1 has
delivered:

- New Supabase project `cubad-app` (eu-central-1), Supabase CLI wired, `supabase/migrations/`
  scaffold, and the **full schema migration** from master §4 applied with **RLS enabled** and
  **baseline policies** on `profiles`, `user_state`, `legacy_sync` (owner select/update on
  `profiles`; owner-only on `user_state`; no client access on `legacy_sync`).
- `@supabase/supabase-js` + `@supabase/ssr` installed, and these client factories
  (canonical names per master §14 — do not invent others):
  - `lib/supabase/server.ts` — exports `async createClient()` (cookie-bound anon client)
    **and** `createServiceRoleClient()` (the ONLY service-key touchpoint).
  - `lib/supabase/browser.ts` — exports `createClient()` (singleton browser client).
  - `lib/supabase/middleware.ts` — a helper (e.g. `updateSession`). **This phase does not
    depend on its exact signature**; the root `proxy.ts` here is self-contained (Task 2.10).
- Env vars (D15) present in `.env.local` and Vercel: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`. This
  phase **adds** `RESEND_API_KEY` (used by Supabase SMTP config, not by app code yet).
- Vitest configured (`npx vitest run` works) and CI green.

> **If any prerequisite is missing:** stop, note the exact gap under `## Changelog /
> deviations`, and surface it to the human. Do not re-implement Phase 1 here.

**Required reading (repo files) before starting:**
`00-MASTER-PLAN.md` · `AGENTS.md` · `lib/sync.ts` (the union-merge you will reuse) ·
`lib/progress.tsx` · `app/api/sync/route.ts` (the passcode hash you must stay compatible with) ·
`components/Header.tsx` · `components/SyncManager.tsx` · `components/SyncCard.tsx` ·
`lib/i18n.tsx` · `components/ui.tsx` · `docs/DESIGN.md` · `app/layout.tsx`.

**Branch:** all work happens on `feat/phase-2-auth-profiles`. Do **not** push to `main`
mid-phase (master §8.7). Create it in Task 2.0.

**Environment matrix used this phase (copy exactly — D15 names are LAW):**

| Var | Where | Used by |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | all supabase clients |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | anon/browser/server clients |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | `createServiceRoleClient()` in `lib/supabase/server.ts` (legacy import, tracks reads) |
| `NEXT_PUBLIC_APP_URL` | client + server | `emailRedirectTo`, reset links |
| `RESEND_API_KEY` | Supabase dashboard SMTP + `.env.local` note | auth emails (Supabase sends them) |

---

## Task 2.0 — Preflight & branch

- [x] From `cubad/`, confirm Phase 1 landed and packages exist:
  ```bash
  cd cubad
  git checkout main && git pull
  node -e "require.resolve('@supabase/ssr'); require.resolve('@supabase/supabase-js'); console.log('supabase packages OK')"
  ls lib/supabase/server.ts lib/supabase/browser.ts
  npx supabase migration list >/dev/null 2>&1 && echo "supabase CLI OK" || echo "CHECK: supabase CLI/link"
  ```
  Expected: `supabase packages OK`, both files listed, `supabase CLI OK`.
- [ ] If `@supabase/ssr` is missing (Phase 1 incomplete), install it (do not invent versions):
  ```bash
  npm install @supabase/ssr @supabase/supabase-js
  ```
- [x] Create the phase branch:
  ```bash
  git checkout -b feat/phase-2-auth-profiles
  ```
- [x] Confirm the local DB resets cleanly before you add migrations (baseline sanity):
  ```bash
  npx supabase db reset
  ```
  Expected: applies all Phase 1 migrations with no error. If this fails, stop (Phase 1 bug).

**Failure modes:** `require.resolve` throwing → Phase 1 didn't install packages; install them.
`supabase db reset` failing → a Phase 1 migration is not idempotent; that's a Phase 1 defect —
record it and surface, do not patch Phase 1 migrations from here.

---

## Task 2.1 — Enable email+password auth + confirmation + redirect URLs

Two places must agree: the **Supabase dashboard** (live project) and **`supabase/config.toml`**
(so `supabase db reset` / branches reproduce it).

- [x] **Dashboard** → Authentication → Sign In / Providers → **Email**: enable **Email**,
  enable **Confirm email** (email confirmation ON), keep "Secure email change" ON. Password
  policy: leave Supabase defaults (min length 8) — master says defaults are fine.
- [x] **Dashboard** → Authentication → URL Configuration:
  - **Site URL:** `https://cubad.vercel.app`
  - **Redirect URLs (allow list)** — add all of:
    - `http://localhost:3000/**`
    - `https://cubad.vercel.app/**`
    (The `/**` wildcard covers `/auth/confirm`, `/auth/reset-password`, `/onboarding`.)
- [x] **`supabase/config.toml`** — ensure the `[auth]` block matches (edit or add; keep Phase 1
  keys intact):
  ```toml
  [auth]
  enabled = true
  site_url = "http://localhost:3000"
  additional_redirect_urls = [
    "http://localhost:3000/**",
    "https://cubad.vercel.app/**",
  ]
  jwt_expiry = 3600
  enable_signup = true

  [auth.email]
  enable_signup = true
  double_confirm_changes = true
  enable_confirmations = true      # require email confirmation before first sign-in
  secure_password_change = false
  # min password length is Supabase default (8)
  ```
  > **Why both:** the dashboard is the live prod setting; `config.toml` keeps local dev and
  > future preview branches identical. `site_url` differs by env (localhost locally, the Vercel
  > URL in the dashboard) — that is expected.
- [x] Verify locally:
  ```bash
  npx supabase db reset
  ```
  Expected: no `[auth]` parse errors.

**Failure modes:** forgetting the `/**` wildcard → confirmation/reset links bounce with
"redirect not allowed". `enable_confirmations = false` → users sign in without confirming
(security regression). Do not disable confirmations to "make testing easier".

---

## Task 2.2 — Resend as custom SMTP for auth emails

Supabase's built-in SMTP sends ~2–3 emails/hour — unusable. Route auth emails through Resend
(D2/D10). **No npm package is needed** — Supabase's SMTP client sends; Resend is just the relay.

- [x] Get a Resend API key: resend.com → API Keys → Create (Sending access). Store it:
  - Add `RESEND_API_KEY=re_...` to `cubad/.env.local` (gitignored — for reference/future app
    use; auth emails don't read it from the app).
  - **Never commit it.** Ask the human for the key if you don't have it (master §11).
- [x] **Dashboard** → Authentication → Emails → **SMTP Settings** → enable **Custom SMTP**:
  - **Sender email:** `onboarding@resend.dev`
  - **Sender name:** `cubad`
  - **Host:** `smtp.resend.com`
  - **Port:** `465`
  - **Username:** `resend`
  - **Password:** the `RESEND_API_KEY` value
  - **Minimum interval between emails:** `60` seconds (default is fine).
- [x] **`supabase/config.toml`** — record the SMTP block (password comes from env, never inline):
  ```toml
  [auth.email.smtp]
  enabled = true
  host = "smtp.resend.com"
  port = 465
  user = "resend"
  pass = "env(RESEND_API_KEY)"
  admin_email = "onboarding@resend.dev"
  sender_name = "cubad"
  ```
- [ ] **Send a test** from the dashboard SMTP panel to `ahmedallycubad@gmail.com` and confirm
  delivery.

> **⚠ Free-tier limit (do not skip this note in the runbook):** with the default
> `onboarding@resend.dev` sender, Resend only delivers to the **account owner's own verified
> email**. Sign-up confirmation to any *other* address silently fails until a real domain is
> verified in Resend and the sender is switched to `no-reply@<yourdomain>`. For Phase 2 testing,
> **use `ahmedallycubad@gmail.com` (and `+alias` variants) only.** Domain verification is a
> launch-checklist item (Phase 7), not a blocker here — record it as a known limitation.

**Failure modes:** wrong port/username (must be `resend` literally, not your email) → emails
never send and Supabase shows a generic "Error sending confirmation email". Testing with a
non-owner address on the free sender → looks broken but is the tier limit; use the owner email.

---

## Task 2.3 — Rewrite the confirm + recovery email templates (token_hash flow)

`@supabase/ssr` uses a server-side token exchange: the email links to **`/auth/confirm`** with a
`token_hash`, and our Route Handler (Task 2.14) calls `verifyOtp`. The default templates use
`{{ .ConfirmationURL }}` (client-side hash flow) — we must replace them. **Verified against
current Supabase Next.js server-side-auth docs.**

- [x] **Dashboard** → Authentication → Emails → Templates → **Confirm signup** → set the link to:
  ```html
  <h2>Confirm your cubad account</h2>
  <p>Follow this link to confirm your email and start studying:</p>
  <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/onboarding">Confirm my email</a></p>
  ```
  > `type=email` is correct for signup confirmation (an `EmailOtpType`). `next=/onboarding`
  > sends confirmed users straight into onboarding.
- [x] **Reset password** template → set the link to:
  ```html
  <h2>Reset your cubad password</h2>
  <p>Follow this link to choose a new password:</p>
  <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/auth/reset-password">Reset password</a></p>
  ```
  > `type=recovery` establishes a temporary session; the confirm route then lands the user on
  > `/auth/reset-password` where they set a new password (Task 2.13).
- [x] (Optional but recommended) **Change email address** template → same pattern with
  `type=email_change&next=/account`.

**Manual check:** these are dashboard-only; there is no build to run. Templates are validated
end-to-end in Task 2.22's sign-up flow.

**Failure modes:** leaving `{{ .ConfirmationURL }}` → the link points at Supabase's own verify
endpoint (implicit flow) and our `/auth/confirm` never runs → session not set in cookies.
Mismatched `type` (e.g. `type=signup` instead of `type=email`) → `verifyOtp` returns
`otp_expired`/invalid.

---

## Task 2.4 — Migration: auto-create a profile on signup (SECURITY DEFINER trigger)

**Why a trigger, not a client insert (D2 rationale):** the profile row must exist the instant
`auth.users` gets a row — before any client code runs, for **every** auth method (email now,
OAuth/phone later), with **no race** between confirm and first page load, and **without** a
client-facing INSERT policy on `profiles` (smaller attack surface). A `SECURITY DEFINER`
trigger owned by the DB is the only race-free way.

- [x] Create the migration file:
  ```bash
  npx supabase migration new profile_on_signup_trigger
  ```
- [x] Put this **complete** SQL in the generated file
  (`supabase/migrations/<ts>_profile_on_signup_trigger.sql`):
  ```sql
  -- Create a public.profiles row whenever an auth user is created.
  -- SECURITY DEFINER so it runs with the function owner's rights (bypasses RLS);
  -- search_path='' + fully-qualified names prevent search_path hijacking.
  create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
  begin
    insert into public.profiles (user_id)
    values (new.id)
    on conflict (user_id) do nothing;
    return new;
  end;
  $$;

  drop trigger if exists on_auth_user_created on auth.users;
  create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

  -- Backfill: any users that already exist (e.g. the bootstrap admin from Phase 1)
  -- get a profile too. Idempotent.
  insert into public.profiles (user_id)
  select id from auth.users
  on conflict (user_id) do nothing;
  ```
- [x] Apply and verify locally:
  ```bash
  npx supabase db reset
  ```
  Expected: migration applies clean; `db reset` succeeds from scratch.
- [x] Apply to the live project (via CLI push or MCP `apply_migration` — master D1 allows both):
  ```bash
  npx supabase db push
  ```

**Manual verification:** in the SQL editor (or after a real signup in Task 2.22), confirm a new
`auth.users` row yields exactly one `public.profiles` row with defaults
(`role='student'`, `onboarded_at IS NULL`, empty strings).

**Failure modes:** omitting `set search_path = ''` → the linter (Supabase advisors) flags a
mutable-search-path security warning; fix, don't ignore. Forgetting `on conflict do nothing`
→ the backfill or a re-run errors on the PK.

---

## Task 2.5 — Migration: extend Phase 1's `profiles.role` guard (owner-escalation lock)

Master §4 requires: **owner can update their profile, but NOT the `role` column** (an owner
must never make themselves admin). Phase 1 already ships this guard as function
`public.protect_profile_role()` with trigger `profiles_protect_role` on `public.profiles`
(canonical names per master §14 — **there is exactly ONE role-guard trigger; later phases
extend it via `create or replace` of THAT function, never a second parallel trigger**).
This task replaces the function body with a more robust version: service-role detection via
JWT claims plus freezing `user_id`/`created_at` against owner updates.

- [x] Create the migration:
  ```bash
  npx supabase migration new extend_protect_profile_role
  ```
- [x] Complete SQL:
  ```sql
  -- Extend Phase 1's role guard (same function + trigger names — master §14).
  -- End users may never change their own role, reparent their row, or rewrite created_at.
  -- Service role (admin scripts / definer functions) may change anything.
  create or replace function public.protect_profile_role()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
  begin
    if coalesce((auth.jwt() ->> 'role'), '') = 'service_role' then
      return new;  -- admin / definer path: unrestricted
    end if;

    if new.role is distinct from old.role then
      raise exception 'profiles.role can only be changed by an administrator';
    end if;

    -- Defensive: never allow these to move via an owner update.
    new.user_id    := old.user_id;
    new.role       := old.role;
    new.created_at := old.created_at;
    return new;
  end;
  $$;

  -- Reassert the (single) trigger under its Phase 1 name — idempotent.
  drop trigger if exists profiles_protect_role on public.profiles;
  create trigger profiles_protect_role
    before update on public.profiles
    for each row execute function public.protect_profile_role();
  ```
  > **Note:** onboarding (Task 2.15) updates `full_name`, `country_code`, `phone`,
  > `preferred_lang`, `track_id`, `onboarded_at` — all allowed; only `role`/`user_id`/`created_at`
  > are frozen for end users.
- [x] Apply & verify:
  ```bash
  npx supabase db reset && npx supabase db push
  ```
- [x] Verify exactly ONE role-guard trigger exists on `profiles` (SQL editor / MCP `execute_sql`):
  ```sql
  select tgname from pg_trigger
  where tgrelid = 'public.profiles'::regclass and not tgisinternal;
  ```
  **Expected:** the list includes `profiles_protect_role` and NO other role-guard trigger
  (unrelated triggers like an `updated_at` toucher are fine). If a second guard trigger shows
  up, drop it and record a deviation.

**Negative test (proven in Task 2.22):** an owner `update profiles set role='admin'` must raise
`profiles.role can only be changed by an administrator`.

**Failure modes:** `auth.jwt()` unavailable under `search_path=''` → it is schema-qualified in
the JWT helper; if a Supabase version complains, use
`coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role','')` instead and record
the deviation.

---

## Task 2.6 — Verify the service-role client (Phase 1's `createServiceRoleClient`)

Two Phase-2 code paths need the service-role key, which is allowed **only** in server code
(master §9):
1. the legacy-import action (Task 2.15) — `legacy_sync` has **no client RLS access** (master §4);
2. every **published `tracks` read** (Tasks 2.15/2.16/2.19/2.20) — `tracks` has RLS enabled but
   receives its public read policy only in Phase 3/4, so at Phase 2 the anon/cookie client sees
   **0 rows**; until then service-role reads are required.

Per master §14, the canonical (and ONLY) service-key touchpoint is
**`createServiceRoleClient()` exported from `lib/supabase/server.ts`** (Phase 1 owns it).
Do **NOT** create `lib/supabase/admin.ts` or any `createAdminClient`/`createServiceClient`.

- [x] Verify the export exists:
  ```bash
  grep -n "createServiceRoleClient" lib/supabase/server.ts
  ```
  Expected: at least one `export function createServiceRoleClient` (or equivalent export) match.
  If missing, STOP — that's a Phase 1 gap; record it under `## Changelog / deviations` and
  surface it (do not re-implement it here).
- [ ] Usage rules for this phase (enforced by review, not code): call it only inside Server
  Actions / Route Handlers / server components; never pass its results to the client wholesale
  (select only the columns you render); never import it into a `"use client"` file —
  `lib/supabase/server.ts` is server-only, so the build fails loudly if you try (that's the
  guardrail working, not a bug to route around).

**Failure modes:** the key missing from env → the action throws at runtime (caught and surfaced
as a generic failure in Task 2.15). Do **not** add `NEXT_PUBLIC_` to the service key.

---

## Task 2.7 — Extract the pure union-merge into `lib/merge.ts` (TDD)

`lib/sync.ts` is `"use client"`, but the merge must also run **server-side** (legacy import,
Task 2.15) and in **Vitest**. Extract the pure logic to a directive-free module. **The merge
algorithm is copied verbatim from `lib/sync.ts` — behavior must not change** (master trap:
"union-merge resurrection").

**Write the test first.**

- [x] Create `lib/merge.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { mergeStates, type SyncState } from "./merge";

  const base = (): SyncState => ({ progress: { q: {}, quiz: {}, practice: {} }, decks: {} });

  describe("mergeStates (union-merge, never lose progress)", () => {
    it("keeps the higher step and OR-s done", () => {
      const a = base(); a.progress.q["hidroloji/q1"] = { step: 3, done: false };
      const b = base(); b.progress.q["hidroloji/q1"] = { step: 1, done: true };
      const m = mergeStates(a, b);
      expect(m.progress.q["hidroloji/q1"]).toEqual({ step: 3, done: true });
    });

    it("keeps the higher quiz score", () => {
      const a = base(); a.progress.quiz["hidroloji/u1"] = { score: 4, total: 5 };
      const b = base(); b.progress.quiz["hidroloji/u1"] = { score: 2, total: 5 };
      expect(mergeStates(a, b).progress.quiz["hidroloji/u1"]).toEqual({ score: 4, total: 5 });
    });

    it("OR-s practice answered and prefers a defined correctness", () => {
      const a = base(); a.progress.practice["s/u/p"] = { answered: true, correct: false };
      const b = base(); b.progress.practice["s/u/p"] = { answered: false };
      const m = mergeStates(a, b);
      expect(m.progress.practice["s/u/p"].answered).toBe(true);
      expect(m.progress.practice["s/u/p"].correct).toBe(false);
    });

    it("unions decks; most recent grading wins, tie -> higher box", () => {
      const a = base(); a.decks["hidroloji:d"] = { c1: { box: 2, last: 100 } };
      const b = base(); b.decks["hidroloji:d"] = { c1: { box: 4, last: 50 }, c2: { box: 1, last: 10 } };
      const m = mergeStates(a, b);
      expect(m.decks["hidroloji:d"].c1).toEqual({ box: 2, last: 100 }); // newer last wins
      expect(m.decks["hidroloji:d"].c2).toEqual({ box: 1, last: 10 });  // union keeps b-only
    });

    it("is side-effect free (no window access) so it runs under node", () => {
      expect(() => mergeStates(base(), base())).not.toThrow();
    });
  });
  ```
- [x] Create `lib/merge.ts` with the pure logic **moved from `lib/sync.ts`** (no `"use client"`):
  ```ts
  /**
   * Pure, environment-agnostic study-state model + union-merge.
   * Extracted from lib/sync.ts so it can run in the browser, in Server Actions,
   * and in Vitest. NO window / localStorage access here.
   */

  interface QuestionProgress { step: number; done: boolean; }
  interface QuizScore { score: number; total: number; }
  interface PracticeProgress { answered: boolean; correct?: boolean; }
  interface ProgressState {
    q: Record<string, QuestionProgress>;
    quiz: Record<string, QuizScore>;
    practice: Record<string, PracticeProgress>;
  }
  interface LeitnerEntry { box: number; last: number; }
  type Decks = Record<string, Record<string, LeitnerEntry>>;

  interface ChatMsg { role: "user" | "model"; text: string; }
  interface ChatConvo { id: string; createdAt: number; updatedAt?: number; messages: ChatMsg[]; }
  interface ChatStore { convos: ChatConvo[]; activeId: string | null; }
  type Chats = Record<string, ChatStore>;

  export interface SyncState {
    progress: ProgressState;
    decks: Decks;
    chats?: Chats;
  }
  export type { ProgressState, LeitnerEntry, Decks };

  export const SYNC_CONVOS_PER_TOPIC = 8;
  export const SYNC_MSGS_PER_CONVO = 40;
  export const EMPTY_PROGRESS: ProgressState = { q: {}, quiz: {}, practice: {} };

  export function trimChats(store: ChatStore): ChatStore {
    const byRecency = [...store.convos].sort(
      (a, b) => (a.updatedAt ?? a.createdAt) - (b.updatedAt ?? b.createdAt)
    );
    return {
      activeId: store.activeId,
      convos: byRecency
        .slice(-SYNC_CONVOS_PER_TOPIC)
        .map((c) => ({ ...c, messages: c.messages.slice(-SYNC_MSGS_PER_CONVO) })),
    };
  }

  /** Union-merge: never lose progress from either side. */
  export function mergeStates(local: SyncState, remote: SyncState): SyncState {
    const merged: SyncState = {
      progress: { q: {}, quiz: {}, practice: {} },
      decks: {},
    };

    const rp = remote.progress ?? EMPTY_PROGRESS;
    const lp = local.progress ?? EMPTY_PROGRESS;

    for (const k of new Set([...Object.keys(lp.q ?? {}), ...Object.keys(rp.q ?? {})])) {
      const a = lp.q?.[k];
      const b = rp.q?.[k];
      merged.progress.q[k] = {
        step: Math.max(a?.step ?? 0, b?.step ?? 0),
        done: Boolean(a?.done || b?.done),
      };
    }
    for (const k of new Set([...Object.keys(lp.quiz ?? {}), ...Object.keys(rp.quiz ?? {})])) {
      const a = lp.quiz?.[k];
      const b = rp.quiz?.[k];
      merged.progress.quiz[k] = !a ? b! : !b ? a : a.score >= b.score ? a : b;
    }
    for (const k of new Set([
      ...Object.keys(lp.practice ?? {}),
      ...Object.keys(rp.practice ?? {}),
    ])) {
      const a = lp.practice?.[k];
      const b = rp.practice?.[k];
      merged.progress.practice[k] = {
        answered: Boolean(a?.answered || b?.answered),
        correct: a?.correct ?? b?.correct,
      };
    }

    // chats: union conversations by id; a diverged conversation keeps its longer thread
    const mergedChats: Chats = {};
    for (const topic of new Set([
      ...Object.keys(local.chats ?? {}),
      ...Object.keys(remote.chats ?? {}),
    ])) {
      const a = local.chats?.[topic];
      const b = remote.chats?.[topic];
      if (!a || !b) {
        mergedChats[topic] = trimChats((a ?? b) as ChatStore);
        continue;
      }
      const byId = new Map<string, ChatConvo>();
      for (const c of [...b.convos, ...a.convos]) {
        const prev = byId.get(c.id);
        if (!prev) {
          byId.set(c.id, c);
        } else {
          const pick =
            c.messages.length !== prev.messages.length
              ? c.messages.length > prev.messages.length
                ? c
                : prev
              : (c.updatedAt ?? c.createdAt) >= (prev.updatedAt ?? prev.createdAt)
                ? c
                : prev;
          byId.set(c.id, pick);
        }
      }
      mergedChats[topic] = trimChats({
        convos: [...byId.values()].sort((x, y) => x.createdAt - y.createdAt),
        activeId: a.activeId ?? b.activeId,
      });
    }
    merged.chats = mergedChats;

    for (const deck of new Set([
      ...Object.keys(local.decks ?? {}),
      ...Object.keys(remote.decks ?? {}),
    ])) {
      const a = local.decks?.[deck] ?? {};
      const b = remote.decks?.[deck] ?? {};
      const out: Record<string, LeitnerEntry> = {};
      for (const card of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const ea = a[card];
        const eb = b[card];
        // most recent grading wins; tie -> the higher box
        out[card] = !ea
          ? eb!
          : !eb
            ? ea
            : ea.last > eb.last
              ? ea
              : eb.last > ea.last
                ? eb
                : ea.box >= eb.box
                  ? ea
                  : eb;
      }
      merged.decks[deck] = out;
    }

    return merged;
  }
  ```
- [x] **Now** update `lib/sync.ts` to consume `merge.ts` instead of defining the model inline.
  Replace lines 18–223 of the current file (the interfaces block, `SYNC_CONVOS_PER_TOPIC`,
  `SYNC_MSGS_PER_CONVO`, `EMPTY_PROGRESS`, `trimChats`, `mergeStates`) with imports/re-exports.
  Concretely, at the top of `lib/sync.ts` **after** the `"use client";` line and the file-doc
  comment, keep the event/key constants and add:
  ```ts
  import {
    EMPTY_PROGRESS,
    mergeStates,
    trimChats,
    type SyncState,
    type ProgressState,
    type LeitnerEntry,
  } from "./merge";

  // Re-export so existing importers of `SyncState` from "./sync" keep working.
  export type { SyncState } from "./merge";
  export { mergeStates } from "./merge";
  ```
  Then **delete** from `lib/sync.ts` the now-duplicated declarations: the `QuestionProgress`/
  `QuizScore`/`PracticeProgress`/`ProgressState`/`LeitnerEntry`/`Decks`/`ChatMsg`/`ChatConvo`/
  `ChatStore`/`Chats` interfaces, `export interface SyncState`, `SYNC_CONVOS_PER_TOPIC`,
  `SYNC_MSGS_PER_CONVO`, `EMPTY_PROGRESS`, `trimChats`, and `export function mergeStates`.
  Keep `getSyncCode`, `gatherState`, `applyState`, `syncNow`, `notifyStateChanged`,
  `resetProgress`, and the `SYNC_CODE_KEY` / `SYNC_LAST_KEY` / `STATE_CHANGED_EVENT` /
  `SYNC_APPLIED_EVENT` / `PROGRESS_KEY` / `DECK_PREFIX` / `CHAT_PREFIX` constants.
  `gatherState` still calls `trimChats(...)` (now imported); `syncNow`/`resetProgress` still call
  `mergeStates`/`gatherState`/`applyState`. (Task 2.18 rewrites `syncNow`/`resetProgress` bodies.)
- [x] Run the test (it should pass now, still exercising identical behavior):
  ```bash
  npx vitest run lib/merge.test.ts
  ```
  Expected: 5 passed.

**Failure modes:** leaving a stray `SyncState`/`mergeStates` definition in `sync.ts` → "Duplicate
identifier". A behavior change while "cleaning up" the merge → the deck/quiz tie-breaks are
load-bearing; copy verbatim.

---

## Task 2.8 — Legacy passcode hash helper + compatibility test (TDD)

The import action must produce the **exact same** `legacy_sync.id` that the old passcode sync
wrote: `sha256("cubad:" + code.trim())` in hex (see `app/api/sync/route.ts` `rowId`). One wrong
byte and no legacy row is ever found.

**Write the test first** — the vector below is the **real** `sha256("cubad:test1234")` hex,
computed with Node during planning:

- [x] Create `lib/passcode.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { legacyRowId } from "./passcode";

  describe("legacyRowId — compatible with app/api/sync/route.ts rowId", () => {
    it("hashes 'cubad:' + trimmed code with sha256 (known vector)", () => {
      // Verified: sha256("cubad:test1234") in hex.
      expect(legacyRowId("test1234")).toBe(
        "20c6faf69f11b0623185b05a78936ff422228a7b693d29627ab965a6c00c677f"
      );
    });

    it("trims surrounding whitespace exactly like the legacy route", () => {
      expect(legacyRowId("  test1234 ")).toBe(legacyRowId("test1234"));
    });

    it("is case-sensitive (legacy route did not normalize case)", () => {
      expect(legacyRowId("TEST1234")).not.toBe(legacyRowId("test1234"));
    });
  });
  ```
- [x] Create `lib/passcode.ts`:
  ```ts
  import { createHash } from "node:crypto";

  /**
   * Legacy passcode -> sync row id. MUST match app/api/sync/route.ts `rowId`
   * exactly: sha256("cubad:" + code.trim()) as lowercase hex. Do not normalize
   * case — the legacy rows were keyed on the passcode as typed.
   */
  export function legacyRowId(code: string): string {
    return createHash("sha256").update(`cubad:${code.trim()}`).digest("hex");
  }
  ```
- [x] Run:
  ```bash
  npx vitest run lib/passcode.test.ts
  ```
  Expected: 3 passed.

**Failure modes:** using `code.trim().toLowerCase()` → breaks compatibility with any legacy row
whose passcode had uppercase. Using the Web Crypto `subtle.digest` → fine too, but `node:crypto`
matches the existing route byte-for-byte and runs in Server Actions.

---

## Task 2.9 — Data Access Layer (server-only auth helpers)

Centralize "who is this request" so every server page/action checks the same way (Next auth
guide §DAL). React `cache` de-dupes the `getUser` network call within one render.

- [x] Create `lib/auth/dal.ts`:
  ```ts
  import "server-only";
  import { cache } from "react";
  import { redirect } from "next/navigation";
  import { createClient } from "@/lib/supabase/server";

  export interface Profile {
    user_id: string;
    full_name: string;
    country_code: string;
    phone: string;
    preferred_lang: "tr" | "en";
    track_id: string | null;
    role: "student" | "admin";
    onboarded_at: string | null;
  }

  /** The authenticated user (revalidated against Supabase Auth), or null. */
  export const getSessionUser = cache(async () => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  });

  /** The caller's profile row, or null if signed out. */
  export const getProfile = cache(async (): Promise<Profile | null> => {
    const user = await getSessionUser();
    if (!user) return null;
    const supabase = await createClient();
    const { data } = await supabase
      .from("profiles")
      .select(
        "user_id, full_name, country_code, phone, preferred_lang, track_id, role, onboarded_at"
      )
      .eq("user_id", user.id)
      .maybeSingle();
    return (data as Profile) ?? null;
  });

  /** Require a signed-in user or bounce to sign-in. */
  export async function requireUser() {
    const user = await getSessionUser();
    if (!user) redirect("/auth/sign-in");
    return user;
  }

  /** Require a signed-in AND onboarded user, else bounce appropriately. */
  export async function requireOnboarded() {
    const user = await requireUser();
    const profile = await getProfile();
    if (!profile || !profile.onboarded_at) redirect("/onboarding");
    return { user, profile };
  }

  /** Where to send a user right after auth: onboarding if not done, else account. */
  export async function postAuthDestination(): Promise<string> {
    const profile = await getProfile();
    return profile?.onboarded_at ? "/account" : "/onboarding";
  }
  ```

> **Design decision — where the onboarding gate lives (task asked to decide concretely):**
> The **optimistic** "signed-out → sign-in" redirect for protected areas lives in `proxy.ts`
> (Task 2.10), cheap, cookie-based, no DB read. The **onboarding gate** (`onboarded_at IS NULL
> → /onboarding`) lives in **`requireOnboarded()`, called at the top of each protected server
> page** (`/account` this phase; study pages in Phase 3/4). We do **not** do the onboarding DB
> read in `proxy.ts` — the Next auth guide warns against DB checks in the proxy (it runs on
> every request incl. prefetches). We also do **not** rely solely on a layout for the gate
> (layouts don't re-render on client navigation — auth guide §"Layouts and auth checks"). Each
> Server Action re-checks auth independently (never trusts render-time gating).

**Failure modes:** calling DAL helpers from a client component → build error via `server-only`
(correct). Forgetting `cache` → extra `getUser` round-trips per render (perf only).

---

## Task 2.10 — Root `proxy.ts` — session refresh + optimistic redirects

> **⚠ This is the "middleware" from the task brief, but the file is `proxy.ts` (Next 16).**
> Read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` now.
> Proxy defaults to the Node.js runtime in Next 16 — good for `@supabase/ssr`.

- [ ] **Delete any `middleware.ts` at the repo root** if Phase 1 created one (the root convention
  file — NOT `lib/supabase/middleware.ts`, which is a helper module and stays):
  ```bash
  git rm --cached middleware.ts 2>/dev/null; rm -f middleware.ts
  ```
  (Skip silently if it doesn't exist.)
- [ ] Create `proxy.ts` at the repo root (same level as `app/`). It refreshes the Supabase auth
  cookie on every matched request (mandatory for SSR) and does the two cheap redirects.
  ```ts
  import { createServerClient } from "@supabase/ssr";
  import { NextResponse, type NextRequest } from "next/server";

  // Areas that require a signed-in user (optimistic, cookie-based check only).
  const PROTECTED = ["/onboarding", "/account"];
  // Auth pages a signed-in user shouldn't see (recovery pages are intentionally NOT here).
  const GUEST_ONLY = ["/auth/sign-in", "/auth/sign-up"];

  export async function proxy(request: NextRequest) {
    // Start with a passthrough response we can attach refreshed cookies to.
    let response = NextResponse.next({ request });

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
            response = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    // IMPORTANT: do not run code between createServerClient and getUser().
    // getUser() revalidates the token and triggers the cookie refresh above.
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const path = request.nextUrl.pathname;

    // Carry refreshed cookies onto any redirect we return.
    const redirectWithCookies = (pathname: string, withNext = false) => {
      const url = request.nextUrl.clone();
      url.pathname = pathname;
      url.search = "";
      if (withNext) url.searchParams.set("next", path);
      const r = NextResponse.redirect(url);
      response.cookies.getAll().forEach((c) => r.cookies.set(c));
      return r;
    };

    if (!user && PROTECTED.some((p) => path === p || path.startsWith(p + "/"))) {
      return redirectWithCookies("/auth/sign-in", true);
    }
    if (user && GUEST_ONLY.includes(path)) {
      return redirectWithCookies("/account");
    }

    return response;
  }

  export const config = {
    // Run on everything EXCEPT api routes, Next internals, and static assets.
    matcher: [
      "/((?!api|_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)",
    ],
  };
  ```
  > **Why exclude `api`:** `/api/state` and `/api/sync` do their own auth with their own server
  > clients (Task 2.17). Why keep everything else: page routes and **Server Actions** (which
  > POST to their page) need the session cookie refreshed — the proxy doc warns that excluding a
  > path also skips Server Function calls on it.
- [ ] Typecheck by building (the authority — master §8.2):
  ```bash
  npm run lint && npm run build
  ```
  Expected: compiles; the build log shows a Proxy/Middleware entry.

**Failure modes:** creating `NextResponse.next()` **without** `{ request }` and re-creating it in
`setAll` → the classic "user gets logged out intermittently" bug; use the exact pattern above.
Returning a bare `NextResponse.redirect` **without** copying cookies → the refreshed session is
dropped on that navigation. Over-broad matcher (no asset exclusion) → CSS/JS blocked by redirects.

---

## Task 2.11 — i18n strings (auth / onboarding / account)

All new user-facing strings need `tr` **and** `en` (master §12.5). Insert this block into
`lib/i18n.tsx` inside the `STRINGS` object, immediately **before** the closing
`} as const;` line (keep existing keys intact).

- [ ] Add to `STRINGS`:
  ```ts
    /* ---------- auth & account (Phase 2) ---------- */
    signIn: { en: "Sign in", tr: "Giriş yap" },
    signUp: { en: "Create account", tr: "Hesap oluştur" },
    signOut: { en: "Sign out", tr: "Çıkış yap" },
    account: { en: "Account", tr: "Hesap" },
    settings: { en: "Settings", tr: "Ayarlar" },
    email: { en: "Email", tr: "E-posta" },
    password: { en: "Password", tr: "Parola" },
    confirmPassword: { en: "Confirm password", tr: "Parolayı doğrula" },
    newPassword: { en: "New password", tr: "Yeni parola" },
    fullName: { en: "Full name", tr: "Ad soyad" },
    country: { en: "Country", tr: "Ülke" },
    phone: { en: "Phone (optional)", tr: "Telefon (isteğe bağlı)" },
    preferredLanguage: { en: "Preferred language", tr: "Tercih edilen dil" },
    track: { en: "Study track", tr: "Çalışma programı" },
    chooseTrack: { en: "Choose your track", tr: "Programını seç" },
    chooseCountry: { en: "Choose your country", tr: "Ülkeni seç" },
    haveAccount: { en: "Already have an account?", tr: "Zaten hesabın var mı?" },
    noAccount: { en: "No account yet?", tr: "Henüz hesabın yok mu?" },
    forgotPassword: { en: "Forgot password?", tr: "Parolanı mı unuttun?" },
    forgotPasswordTitle: { en: "Reset your password", tr: "Parolanı sıfırla" },
    forgotPasswordIntro: {
      en: "Enter your email and we'll send you a reset link.",
      tr: "E-postanı gir, sana bir sıfırlama bağlantısı gönderelim.",
    },
    sendResetLink: { en: "Send reset link", tr: "Sıfırlama bağlantısı gönder" },
    resetPasswordTitle: { en: "Choose a new password", tr: "Yeni bir parola seç" },
    updatePassword: { en: "Update password", tr: "Parolayı güncelle" },
    signInTitle: { en: "Sign in to cubad", tr: "cubad'a giriş yap" },
    signUpTitle: { en: "Create your cubad account", tr: "cubad hesabını oluştur" },
    checkEmailTitle: { en: "Check your email", tr: "E-postanı kontrol et" },
    checkEmailBody: {
      en: "We sent you a confirmation link. Click it to activate your account, then sign in.",
      tr: "Sana bir onay bağlantısı gönderdik. Hesabını etkinleştirmek için tıkla, sonra giriş yap.",
    },
    resetSentBody: {
      en: "If that email is registered, a reset link is on its way.",
      tr: "Bu e-posta kayıtlıysa, sıfırlama bağlantısı yolda.",
    },
    /* onboarding */
    onboardingTitle: { en: "Welcome — let's set you up", tr: "Hoş geldin — hadi seni ayarlayalım" },
    onboardingIntro: {
      en: "Tell us a bit about you so we can show the right exams and save your progress.",
      tr: "Sana doğru sınavları gösterip ilerlemeni kaydedebilmemiz için kendinden bahset.",
    },
    finishOnboarding: { en: "Finish setup", tr: "Kurulumu bitir" },
    /* import passcode */
    importPasscodeTitle: { en: "Import progress from a passcode", tr: "Paroladan ilerleme aktar" },
    importPasscodeIntro: {
      en: "Used cubad before with a sync passcode? Enter it once to merge that progress into your account.",
      tr: "Daha önce cubad'ı eşitleme parolasıyla mı kullandın? İlerlemeni hesabına aktarmak için parolayı bir kez gir.",
    },
    importPasscodeBtn: { en: "Import", tr: "Aktar" },
    importPasscodeDone: { en: "Progress imported.", tr: "İlerleme aktarıldı." },
    importPasscodeNotFound: {
      en: "No saved progress found for that passcode.",
      tr: "Bu parola için kayıtlı ilerleme bulunamadı.",
    },
    importPasscodeSkip: { en: "Skip for now", tr: "Şimdilik atla" },
    /* account page */
    accountTitle: { en: "Your account", tr: "Hesabın" },
    yourTrack: { en: "Your track", tr: "Programın" },
    editProfile: { en: "Edit profile", tr: "Profili düzenle" },
    saveChanges: { en: "Save changes", tr: "Değişiklikleri kaydet" },
    profileSaved: { en: "Saved.", tr: "Kaydedildi." },
    /* auth error codes -> messages */
    authErr_invalid_credentials: {
      en: "Wrong email or password.",
      tr: "E-posta veya parola hatalı.",
    },
    authErr_email_not_confirmed: {
      en: "Confirm your email first — check your inbox for the link.",
      tr: "Önce e-postanı onayla — gelen kutundaki bağlantıya bak.",
    },
    authErr_rate_limited: {
      en: "Too many attempts. Wait a minute and try again.",
      tr: "Çok fazla deneme. Bir dakika bekleyip tekrar dene.",
    },
    authErr_weak_password: {
      en: "Password must be at least 8 characters.",
      tr: "Parola en az 8 karakter olmalı.",
    },
    authErr_email_exists: {
      en: "An account with that email already exists. Try signing in.",
      tr: "Bu e-postayla bir hesap zaten var. Giriş yapmayı dene.",
    },
    authErr_expired_or_invalid: {
      en: "That link has expired or is invalid. Request a new one.",
      tr: "Bağlantının süresi dolmuş veya geçersiz. Yenisini iste.",
    },
    authErr_invalid_email: { en: "Enter a valid email.", tr: "Geçerli bir e-posta gir." },
    authErr_passwords_mismatch: { en: "Passwords don't match.", tr: "Parolalar eşleşmiyor." },
    authErr_unknown: {
      en: "Something went wrong. Try again.",
      tr: "Bir şeyler ters gitti. Tekrar dene.",
    },
  ```
- [ ] Lint to confirm no trailing-comma / type error:
  ```bash
  npm run lint
  ```

> **How error codes render:** forms translate a code by building the key
> `` `authErr_${code}` `` and calling `t(...)`. All nine codes above exist, so every code maps.

**Failure modes:** a missing `tr` or `en` on any key → TS error (the `Bi`-shaped `as const`
catches it at build). A typo in an `authErr_*` key vs the code union (Task 2.12) → runtime shows
the raw code; keep the two lists in sync.

---

## Task 2.12 — Auth Server Actions (sign up / in / out, reset, update password)

Read `node_modules/next/dist/docs/01-app/02-guides/server-actions.md` first. Every action
re-authenticates server-side and returns a small serializable state (never raw records).

- [ ] Create `app/auth/actions.ts`:
  ```ts
  "use server";

  import { redirect } from "next/navigation";
  import { revalidatePath } from "next/cache";
  import { createClient } from "@/lib/supabase/server";
  import { postAuthDestination } from "@/lib/auth/dal";

  export type AuthErrorCode =
    | "invalid_credentials"
    | "email_not_confirmed"
    | "rate_limited"
    | "weak_password"
    | "email_exists"
    | "expired_or_invalid"
    | "invalid_email"
    | "passwords_mismatch"
    | "unknown";

  export type AuthState =
    | { ok?: boolean; done?: boolean; errorCode?: AuthErrorCode }
    | undefined;

  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  function mapAuthError(error: { code?: string; status?: number; message?: string }): AuthErrorCode {
    const c = error.code ?? "";
    if (c === "invalid_credentials" || c === "invalid_grant") return "invalid_credentials";
    if (c === "email_not_confirmed") return "email_not_confirmed";
    if (c === "over_email_send_rate_limit" || c === "over_request_rate_limit" || error.status === 429)
      return "rate_limited";
    if (c === "weak_password") return "weak_password";
    if (c === "user_already_exists" || c === "email_exists") return "email_exists";
    if (c === "otp_expired" || c === "otp_disabled") return "expired_or_invalid";
    return "unknown";
  }

  export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");
    const confirm = String(formData.get("confirm") ?? "");
    if (!EMAIL_RE.test(email)) return { errorCode: "invalid_email" };
    if (password.length < 8) return { errorCode: "weak_password" };
    if (password !== confirm) return { errorCode: "passwords_mismatch" };

    const supabase = await createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/confirm?next=/onboarding`,
      },
    });
    if (error) return { errorCode: mapAuthError(error) };
    return { done: true }; // "check your email"
  }

  export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");
    if (!EMAIL_RE.test(email)) return { errorCode: "invalid_email" };
    if (!password) return { errorCode: "invalid_credentials" };

    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { errorCode: mapAuthError(error) };

    const next = String(formData.get("next") ?? "").trim();
    const dest = next && next.startsWith("/") ? next : await postAuthDestination();
    revalidatePath("/", "layout");
    redirect(dest);
  }

  export async function signOut() {
    const supabase = await createClient();
    await supabase.auth.signOut();
    revalidatePath("/", "layout");
    redirect("/");
  }

  export async function requestPasswordReset(_prev: AuthState, formData: FormData): Promise<AuthState> {
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return { errorCode: "invalid_email" };

    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/reset-password`,
    });
    // Don't leak which emails exist: report success regardless, except on rate limit.
    if (error && (error.code === "over_email_send_rate_limit" || error.status === 429)) {
      return { errorCode: "rate_limited" };
    }
    return { done: true };
  }

  export async function updatePassword(_prev: AuthState, formData: FormData): Promise<AuthState> {
    const password = String(formData.get("password") ?? "");
    const confirm = String(formData.get("confirm") ?? "");
    if (password.length < 8) return { errorCode: "weak_password" };
    if (password !== confirm) return { errorCode: "passwords_mismatch" };

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser(); // recovery session set by /auth/confirm
    if (!user) return { errorCode: "expired_or_invalid" };

    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { errorCode: mapAuthError(error) };

    revalidatePath("/", "layout");
    redirect("/account");
  }
  ```

**Failure modes:** wrapping `redirect()` in try/catch → it throws a control-flow signal that must
propagate; never catch it. Returning the Supabase `error` object to the client → leaks internals;
return only the mapped code. `signIn`'s `next` param must be validated to start with `/` (open-
redirect guard) — done above.

---

## Task 2.13 — Auth pages + forms (sign-up / sign-in / forgot / reset)

Visual language: reuse the field/button classes seen in `components/SyncCard.tsx` (rounded
inputs on `bg-paper`, `bg-deniz` pill buttons, `text-clay` errors) and the `bg-card`/`border-line`
card. Bilingual via `useLang().t`.

- [ ] Create `app/auth/layout.tsx` (visual shell only — no auth redirect here; recovery pages
  need to render even when a session exists):
  ```tsx
  import type { ReactNode } from "react";

  export default function AuthLayout({ children }: { children: ReactNode }) {
    return (
      <div className="mx-auto w-full max-w-md py-8">
        <section className="rounded-2xl border border-line bg-card p-6 shadow-sm">{children}</section>
      </div>
    );
  }
  ```
- [ ] Create `components/auth/AuthField.tsx` (tiny shared input, keeps forms terse):
  ```tsx
  "use client";
  export function AuthField({
    id, label, type = "text", autoComplete, required = true, defaultValue,
  }: {
    id: string; label: string; type?: string; autoComplete?: string;
    required?: boolean; defaultValue?: string;
  }) {
    return (
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-ink-soft">{label}</span>
        <input
          id={id}
          name={id}
          type={type}
          required={required}
          autoComplete={autoComplete}
          defaultValue={defaultValue}
          className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-deniz/60"
        />
      </label>
    );
  }
  ```
- [ ] Create `components/auth/SubmitButton.tsx`:
  ```tsx
  "use client";
  import { useFormStatus } from "react-dom";
  export function SubmitButton({ label }: { label: string }) {
    const { pending } = useFormStatus();
    return (
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-full bg-deniz px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-deniz-deep disabled:opacity-40"
      >
        {pending ? "…" : label}
      </button>
    );
  }
  ```
- [ ] Create `components/auth/SignUpForm.tsx`:
  ```tsx
  "use client";
  import { useActionState } from "react";
  import Link from "next/link";
  import { useLang, type StringKey } from "@/lib/i18n";
  import { signUp, type AuthState } from "@/app/auth/actions";
  import { AuthField } from "./AuthField";
  import { SubmitButton } from "./SubmitButton";

  export function SignUpForm() {
    const { t } = useLang();
    const [state, action] = useActionState<AuthState, FormData>(signUp, undefined);

    if (state?.done) {
      return (
        <div>
          <h1 className="mb-2 font-display text-xl font-semibold text-ink">{t("checkEmailTitle")}</h1>
          <p className="text-sm text-ink-soft">{t("checkEmailBody")}</p>
          <Link href="/auth/sign-in" className="mt-4 inline-block text-sm font-semibold text-deniz hover:text-deniz-deep">
            {t("signIn")}
          </Link>
        </div>
      );
    }
    return (
      <form action={action} className="grid gap-3">
        <h1 className="font-display text-xl font-semibold text-ink">{t("signUpTitle")}</h1>
        <AuthField id="email" label={t("email")} type="email" autoComplete="email" />
        <AuthField id="password" label={t("password")} type="password" autoComplete="new-password" />
        <AuthField id="confirm" label={t("confirmPassword")} type="password" autoComplete="new-password" />
        {state?.errorCode && (
          <p className="text-xs text-clay">{t(`authErr_${state.errorCode}` as StringKey)}</p>
        )}
        <SubmitButton label={t("signUp")} />
        <p className="text-xs text-ink-soft">
          {t("haveAccount")}{" "}
          <Link href="/auth/sign-in" className="font-semibold text-deniz hover:text-deniz-deep">
            {t("signIn")}
          </Link>
        </p>
      </form>
    );
  }
  ```
- [ ] Create `components/auth/SignInForm.tsx`:
  ```tsx
  "use client";
  import { useActionState } from "react";
  import Link from "next/link";
  import { useLang, type StringKey } from "@/lib/i18n";
  import { signIn, type AuthState } from "@/app/auth/actions";
  import { AuthField } from "./AuthField";
  import { SubmitButton } from "./SubmitButton";

  export function SignInForm({ next }: { next?: string }) {
    const { t } = useLang();
    const [state, action] = useActionState<AuthState, FormData>(signIn, undefined);
    return (
      <form action={action} className="grid gap-3">
        <h1 className="font-display text-xl font-semibold text-ink">{t("signInTitle")}</h1>
        {next && <input type="hidden" name="next" value={next} />}
        <AuthField id="email" label={t("email")} type="email" autoComplete="email" />
        <AuthField id="password" label={t("password")} type="password" autoComplete="current-password" />
        {state?.errorCode && (
          <p className="text-xs text-clay">{t(`authErr_${state.errorCode}` as StringKey)}</p>
        )}
        <SubmitButton label={t("signIn")} />
        <div className="flex items-center justify-between text-xs text-ink-soft">
          <Link href="/auth/forgot-password" className="font-semibold text-deniz hover:text-deniz-deep">
            {t("forgotPassword")}
          </Link>
          <Link href="/auth/sign-up" className="font-semibold text-deniz hover:text-deniz-deep">
            {t("signUp")}
          </Link>
        </div>
      </form>
    );
  }
  ```
- [ ] Create `components/auth/ForgotPasswordForm.tsx`:
  ```tsx
  "use client";
  import { useActionState } from "react";
  import { useLang, type StringKey } from "@/lib/i18n";
  import { requestPasswordReset, type AuthState } from "@/app/auth/actions";
  import { AuthField } from "./AuthField";
  import { SubmitButton } from "./SubmitButton";

  export function ForgotPasswordForm() {
    const { t } = useLang();
    const [state, action] = useActionState<AuthState, FormData>(requestPasswordReset, undefined);
    if (state?.done) {
      return (
        <div>
          <h1 className="mb-2 font-display text-xl font-semibold text-ink">{t("checkEmailTitle")}</h1>
          <p className="text-sm text-ink-soft">{t("resetSentBody")}</p>
        </div>
      );
    }
    return (
      <form action={action} className="grid gap-3">
        <h1 className="font-display text-xl font-semibold text-ink">{t("forgotPasswordTitle")}</h1>
        <p className="text-sm text-ink-soft">{t("forgotPasswordIntro")}</p>
        <AuthField id="email" label={t("email")} type="email" autoComplete="email" />
        {state?.errorCode && (
          <p className="text-xs text-clay">{t(`authErr_${state.errorCode}` as StringKey)}</p>
        )}
        <SubmitButton label={t("sendResetLink")} />
      </form>
    );
  }
  ```
- [ ] Create `components/auth/ResetPasswordForm.tsx`:
  ```tsx
  "use client";
  import { useActionState } from "react";
  import { useLang, type StringKey } from "@/lib/i18n";
  import { updatePassword, type AuthState } from "@/app/auth/actions";
  import { AuthField } from "./AuthField";
  import { SubmitButton } from "./SubmitButton";

  export function ResetPasswordForm() {
    const { t } = useLang();
    const [state, action] = useActionState<AuthState, FormData>(updatePassword, undefined);
    return (
      <form action={action} className="grid gap-3">
        <h1 className="font-display text-xl font-semibold text-ink">{t("resetPasswordTitle")}</h1>
        <AuthField id="password" label={t("newPassword")} type="password" autoComplete="new-password" />
        <AuthField id="confirm" label={t("confirmPassword")} type="password" autoComplete="new-password" />
        {state?.errorCode && (
          <p className="text-xs text-clay">{t(`authErr_${state.errorCode}` as StringKey)}</p>
        )}
        <SubmitButton label={t("updatePassword")} />
      </form>
    );
  }
  ```
- [ ] Create the pages (each a thin server component). **`app/auth/sign-up/page.tsx`:**
  ```tsx
  import { getSessionUser } from "@/lib/auth/dal";
  import { redirect } from "next/navigation";
  import { SignUpForm } from "@/components/auth/SignUpForm";

  export default async function SignUpPage() {
    if (await getSessionUser()) redirect("/account");
    return <SignUpForm />;
  }
  ```
- [ ] **`app/auth/sign-in/page.tsx`** (reads `next` from search params — note `searchParams` is a
  Promise in Next 16):
  ```tsx
  import { getSessionUser } from "@/lib/auth/dal";
  import { redirect } from "next/navigation";
  import { SignInForm } from "@/components/auth/SignInForm";

  export default async function SignInPage({
    searchParams,
  }: {
    searchParams: Promise<{ next?: string }>;
  }) {
    if (await getSessionUser()) redirect("/account");
    const { next } = await searchParams;
    const safeNext = next && next.startsWith("/") ? next : undefined;
    return <SignInForm next={safeNext} />;
  }
  ```
- [ ] **`app/auth/forgot-password/page.tsx`:**
  ```tsx
  import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
  export default function ForgotPasswordPage() {
    return <ForgotPasswordForm />;
  }
  ```
- [ ] **`app/auth/reset-password/page.tsx`** (recovery session must exist — set by `/auth/confirm`):
  ```tsx
  import { getSessionUser } from "@/lib/auth/dal";
  import { redirect } from "next/navigation";
  import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

  export default async function ResetPasswordPage() {
    if (!(await getSessionUser())) redirect("/auth/forgot-password");
    return <ResetPasswordForm />;
  }
  ```

**Failure modes:** using `useFormState` (removed) instead of `useActionState` (React 19) → import
error. Reading `searchParams`/`params` synchronously → Next 16 runtime error (they're Promises).

---

## Task 2.14 — `/auth/confirm` token-exchange route handler + error page

Read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`. This handler
turns the email `token_hash` into a real session cookie, then redirects to `next`.

- [ ] Create `app/auth/confirm/route.ts`:
  ```ts
  import { type EmailOtpType } from "@supabase/supabase-js";
  import { type NextRequest, NextResponse } from "next/server";
  import { createClient } from "@/lib/supabase/server";

  export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const token_hash = searchParams.get("token_hash");
    const type = searchParams.get("type") as EmailOtpType | null;
    const rawNext = searchParams.get("next") ?? "/";
    const next = rawNext.startsWith("/") ? rawNext : "/"; // open-redirect guard

    if (token_hash && type) {
      const supabase = await createClient();
      const { error } = await supabase.auth.verifyOtp({ type, token_hash });
      if (!error) {
        // Strip the secret token from the URL before redirecting.
        const url = request.nextUrl.clone();
        url.pathname = next;
        url.search = "";
        return NextResponse.redirect(url);
      }
    }

    const errUrl = request.nextUrl.clone();
    errUrl.pathname = "/auth/error";
    errUrl.search = "";
    return NextResponse.redirect(errUrl);
  }
  ```
- [ ] Create `app/auth/error/page.tsx` (friendly dead-end for expired/invalid links; the
  content lives in a client child so it can use i18n):
  ```tsx
  import { AuthErrorNotice } from "@/components/auth/AuthErrorNotice";
  export default function AuthErrorPage() {
    return <AuthErrorNotice />;
  }
  ```
- [ ] Create `components/auth/AuthErrorNotice.tsx`:
  ```tsx
  "use client";
  import Link from "next/link";
  import { useLang } from "@/lib/i18n";
  export function AuthErrorNotice() {
    const { t } = useLang();
    return (
      <div>
        <h1 className="mb-2 font-display text-xl font-semibold text-ink">{t("checkEmailTitle")}</h1>
        <p className="text-sm text-ink-soft">{t("authErr_expired_or_invalid")}</p>
        <div className="mt-4 flex gap-3 text-sm font-semibold">
          <Link href="/auth/sign-in" className="text-deniz hover:text-deniz-deep">{t("signIn")}</Link>
          <Link href="/auth/forgot-password" className="text-deniz hover:text-deniz-deep">{t("forgotPassword")}</Link>
        </div>
      </div>
    );
  }
  ```
  > `/auth/error` renders inside `app/auth/layout.tsx`'s card. `Link` is imported only in the
  > notice component — the page itself imports nothing but the notice.

**Failure modes:** `verifyOtp` returning `otp_expired` → link reused or older than the token TTL;
the error page is the correct UX. `type` mismatch vs the template (Task 2.3) → always invalid.

---

## Task 2.15 — Onboarding + legacy-import Server Actions & country list

- [ ] Create `lib/countries.ts` (static seed — master requires at least TZ/TR/KE/UG + "other"):
  ```ts
  import type { Bi } from "./types";
  export const COUNTRIES: { code: string; name: Bi }[] = [
    { code: "TZ", name: { en: "Tanzania", tr: "Tanzanya" } },
    { code: "TR", name: { en: "Türkiye", tr: "Türkiye" } },
    { code: "KE", name: { en: "Kenya", tr: "Kenya" } },
    { code: "UG", name: { en: "Uganda", tr: "Uganda" } },
    { code: "other", name: { en: "Other", tr: "Diğer" } },
  ];
  export const COUNTRY_CODES = COUNTRIES.map((c) => c.code);
  ```
- [ ] Create `app/onboarding/actions.ts`:
  ```ts
  "use server";

  import { redirect } from "next/navigation";
  import { revalidatePath } from "next/cache";
  import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
  import { legacyRowId } from "@/lib/passcode";
  import { mergeStates, type SyncState } from "@/lib/merge";
  import { COUNTRY_CODES } from "@/lib/countries";

  export type OnboardState = { errorKey?: string } | undefined;

  const EMPTY: SyncState = { progress: { q: {}, quiz: {}, practice: {} }, decks: {} };

  export async function completeOnboarding(_prev: OnboardState, formData: FormData): Promise<OnboardState> {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/auth/sign-in");

    const full_name = String(formData.get("full_name") ?? "").trim();
    const country_code = String(formData.get("country_code") ?? "").trim();
    const phone = String(formData.get("phone") ?? "").trim();
    const preferred_lang = String(formData.get("preferred_lang") ?? "tr");
    const track_id = String(formData.get("track_id") ?? "").trim();

    if (full_name.length < 2) return { errorKey: "fullName" };
    if (!COUNTRY_CODES.includes(country_code)) return { errorKey: "country" };
    if (preferred_lang !== "tr" && preferred_lang !== "en") return { errorKey: "preferredLanguage" };

    // track_id must be a real, published track (single-track per D6).
    // WHY service-role: tracks gets a public read policy in Phase 3/4; until then
    // the anon/cookie client sees 0 rows, so service-role read is required.
    const service = createServiceRoleClient();
    const { data: track } = await service
      .from("tracks")
      .select("id")
      .eq("id", track_id)
      .eq("status", "published")
      .maybeSingle();
    if (!track) return { errorKey: "track" };

    const { error } = await supabase
      .from("profiles")
      .update({
        full_name,
        country_code,
        phone,
        preferred_lang,
        track_id,
        onboarded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);
    if (error) return { errorKey: "unknown" };

    revalidatePath("/", "layout");
    redirect("/account");
  }

  export type ImportResult =
    | { ok: true }
    | { ok: false; errorKey: "importPasscodeNotFound" | "authErr_unknown" | "importPasscodeBad" };

  export async function importPasscode(_prev: ImportResult | undefined, formData: FormData): Promise<ImportResult> {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, errorKey: "authErr_unknown" };

    const code = String(formData.get("passcode") ?? "").trim();
    if (code.length < 4 || code.length > 128) return { ok: false, errorKey: "importPasscodeBad" };

    const id = legacyRowId(code);
    const service = createServiceRoleClient(); // legacy_sync has no client RLS access

    const { data: legacy, error: readErr } = await service
      .from("legacy_sync")
      .select("state, claimed_by")
      .eq("id", id)
      .maybeSingle();
    if (readErr) return { ok: false, errorKey: "authErr_unknown" };
    if (!legacy || !legacy.state) return { ok: false, errorKey: "importPasscodeNotFound" };

    // Merge into whatever the account already has (owner RLS on user_state).
    const { data: cur } = await supabase
      .from("user_state")
      .select("state")
      .eq("user_id", user.id)
      .maybeSingle();
    const local = (cur?.state as SyncState) ?? EMPTY;
    const merged = mergeStates(local, legacy.state as SyncState);

    const { error: upErr } = await supabase
      .from("user_state")
      .upsert(
        { user_id: user.id, state: merged, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
    if (upErr) return { ok: false, errorKey: "authErr_unknown" };

    // Mark claimed (informational only). Re-import is allowed and idempotent-safe:
    // the union-merge never loses data, so claiming a second time — even a row
    // already claimed by another account — just re-merges. claimed_by is not a lock.
    await service.from("legacy_sync").update({ claimed_by: user.id }).eq("id", id);

    revalidatePath("/account");
    return { ok: true };
  }
  ```

> **Already-claimed decision (task asked to decide):** **allow re-import.** `claimed_by` is
> informational, not a lock — because `mergeStates` is idempotent-safe (union, never loses
> progress), re-importing the same passcode is harmless, and importing a passcode someone else
> claimed simply merges that progress in. We overwrite `claimed_by` with the current importer.

**Failure modes:** using `supabase` (anon/user client) to read `legacy_sync` **or `tracks`** →
returns empty (no RLS policy yet) → every import "not found" / every track "invalid". Must use
`createServiceRoleClient()`. Writing `user_state` with the service-role client would bypass
owner RLS — use the **user** client for the upsert so RLS is exercised (defense in depth).

---

## Task 2.16 — Onboarding page + wizard + reusable import form

- [ ] Create `components/ImportPasscodeForm.tsx` (used in onboarding **and** account):
  ```tsx
  "use client";
  import { useActionState } from "react";
  import { useLang } from "@/lib/i18n";
  import { importPasscode, type ImportResult } from "@/app/onboarding/actions";

  export function ImportPasscodeForm() {
    const { t } = useLang();
    const [state, action] = useActionState<ImportResult | undefined, FormData>(importPasscode, undefined);
    return (
      <div className="rounded-2xl border border-line bg-card p-5">
        <h2 className="mb-1 font-display text-lg font-semibold text-ink">🔑 {t("importPasscodeTitle")}</h2>
        <p className="mb-3 text-sm text-ink-soft">{t("importPasscodeIntro")}</p>
        <form action={action} className="flex flex-wrap gap-2">
          <input
            type="text"
            name="passcode"
            placeholder={t("importPasscodeTitle")}
            className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm sm:max-w-xs"
          />
          <button
            type="submit"
            className="rounded-full bg-deniz px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-deniz-deep"
          >
            {t("importPasscodeBtn")}
          </button>
        </form>
        {state?.ok && <p className="mt-2 text-xs text-moss">✓ {t("importPasscodeDone")}</p>}
        {state && !state.ok && state.errorKey === "importPasscodeNotFound" && (
          <p className="mt-2 text-xs text-clay">{t("importPasscodeNotFound")}</p>
        )}
        {state && !state.ok && state.errorKey !== "importPasscodeNotFound" && (
          <p className="mt-2 text-xs text-clay">{t("authErr_unknown")}</p>
        )}
      </div>
    );
  }
  ```
- [ ] Create `components/OnboardingWizard.tsx`:
  ```tsx
  "use client";
  import { useActionState } from "react";
  import { useLang } from "@/lib/i18n";
  import type { Bi } from "@/lib/types";
  import { COUNTRIES } from "@/lib/countries";
  import { completeOnboarding, type OnboardState } from "@/app/onboarding/actions";
  import { SubmitButton } from "@/components/auth/SubmitButton";

  export interface TrackOption {
    id: string;
    title: Bi;
    country_code: string;
    system: string;
    level: string;
  }

  export function OnboardingWizard({ tracks }: { tracks: TrackOption[] }) {
    const { t, bi, lang } = useLang();
    const [state, action] = useActionState<OnboardState, FormData>(completeOnboarding, undefined);
    const err = (field: string) =>
      state?.errorKey === field ? (
        <p className="mt-1 text-xs text-clay">{t("authErr_unknown")}</p>
      ) : null;

    return (
      <form action={action} className="grid gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">{t("onboardingTitle")}</h1>
          <p className="mt-1 text-sm text-ink-soft">{t("onboardingIntro")}</p>
        </div>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink-soft">{t("fullName")}</span>
          <input name="full_name" required minLength={2}
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm" />
          {err("fullName")}
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink-soft">{t("country")}</span>
          <select name="country_code" required defaultValue=""
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm">
            <option value="" disabled>{t("chooseCountry")}</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>{bi(c.name)}</option>
            ))}
          </select>
          {err("country")}
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink-soft">{t("phone")}</span>
          <input name="phone" type="tel" autoComplete="tel"
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm" />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink-soft">{t("preferredLanguage")}</span>
          <select name="preferred_lang" defaultValue={lang}
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm">
            <option value="tr">Türkçe</option>
            <option value="en">English</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink-soft">{t("track")}</span>
          <select name="track_id" required defaultValue=""
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm">
            <option value="" disabled>{t("chooseTrack")}</option>
            {tracks.map((tr) => (
              <option key={tr.id} value={tr.id}>{bi(tr.title)}</option>
            ))}
          </select>
          {err("track")}
        </label>

        <SubmitButton label={t("finishOnboarding")} />
      </form>
    );
  }
  ```
- [ ] Create `app/onboarding/page.tsx` (server component — auth-gate + fetch published tracks;
  bounce if already onboarded):
  ```tsx
  import { redirect } from "next/navigation";
  import { createServiceRoleClient } from "@/lib/supabase/server";
  import { getSessionUser, getProfile } from "@/lib/auth/dal";
  import { OnboardingWizard, type TrackOption } from "@/components/OnboardingWizard";
  import { ImportPasscodeForm } from "@/components/ImportPasscodeForm";

  export default async function OnboardingPage() {
    const user = await getSessionUser();
    if (!user) redirect("/auth/sign-in?next=/onboarding");
    const profile = await getProfile();
    if (profile?.onboarded_at) redirect("/account");

    // WHY service-role: tracks gets a public read policy in Phase 3/4; until then
    // the cookie/anon client sees 0 rows, so service-role read is required. We only
    // pass id + display fields of PUBLISHED rows to the client — safe to expose.
    const service = createServiceRoleClient();
    const { data: tracks } = await service
      .from("tracks")
      .select("id, title, country_code, system, level")
      .eq("status", "published")
      .order("sort", { ascending: true });

    return (
      <div className="mx-auto grid w-full max-w-md gap-6 py-6">
        <section className="rounded-2xl border border-line bg-card p-6">
          <OnboardingWizard tracks={(tracks as TrackOption[]) ?? []} />
        </section>
        <ImportPasscodeForm />
      </div>
    );
  }
  ```
- [ ] **Ensure at least one published track exists** so the wizard has a choice. Phase 1 seeds a
  `TR / University / Undergraduate` track (master §5); make sure it's **published**. Run once
  against the live DB (dashboard SQL editor, `psql "$DB_URL" -f <file>`, or MCP `execute_sql` —
  per master §14 the Supabase CLI has **no** `db execute` subcommand), idempotent:
  ```sql
  -- Publish the seeded TR/University/Undergraduate track; insert it if Phase 1 didn't.
  update public.tracks set status = 'published'
   where country_code = 'TR' and system = 'University' and level = 'Undergraduate';

  insert into public.tracks (country_code, system, level, title, status, sort)
  select 'TR', 'University', 'Undergraduate',
         '{"tr":"Türkiye — Üniversite (Lisans)","en":"Turkey — University (Undergraduate)"}'::jsonb,
         'published', 0
  where not exists (
    select 1 from public.tracks
    where country_code = 'TR' and system = 'University' and level = 'Undergraduate'
  );
  ```
  > Catalog CRUD is Phase 4; this is the minimum data Phase 2 needs to function. Record it as a
  > seed touch-up, not a schema change.

**Failure modes:** empty track dropdown → no published track; run the SQL above. `searchParams`
not needed here. If `getProfile()` returns null (trigger didn't fire), the page still renders —
but that signals Task 2.4 didn't apply; verify the trigger.

---

## Task 2.17 — Server-side progress transport (`/api/state` Route Handler)

Authenticated replacement for the passcode transport, against `user_state` (owner RLS). Read the
route-handlers guide first.

- [ ] Create `app/api/state/route.ts`:
  ```ts
  import { createClient } from "@/lib/supabase/server";

  export const dynamic = "force-dynamic"; // reads cookies/user — never cache

  export async function GET() {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });

    const { data, error } = await supabase
      .from("user_state")
      .select("state, updated_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) return Response.json({ error: "upstream" }, { status: 502 });

    return Response.json({ state: data?.state ?? null, updated_at: data?.updated_at ?? null });
  }

  export async function POST(request: Request) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });

    let body: { state?: unknown };
    try {
      body = (await request.json()) as { state?: unknown };
    } catch {
      return Response.json({ error: "invalid request" }, { status: 400 });
    }
    if (body.state === undefined) return Response.json({ error: "no-state" }, { status: 400 });

    // Same size guard as the legacy sync route.
    if (JSON.stringify(body.state).length > 3_000_000) {
      return Response.json({ error: "too-large" }, { status: 413 });
    }

    // user_id comes from the authenticated session, NOT the client body — no spoofing.
    const { error } = await supabase
      .from("user_state")
      .upsert(
        { user_id: user.id, state: body.state, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
    if (error) return Response.json({ error: "upstream" }, { status: 502 });

    return Response.json({ ok: true });
  }
  ```
  > **Security:** `user_id` is derived from `auth.getUser()`, and `user_state`'s owner RLS
  > policy (`user_id = auth.uid()`) is the real barrier — even if the body carried a `user_id`,
  > the upsert would be rejected. Never trust a client-supplied id (master §9).

**Failure modes:** setting `user_id` from `body` → cross-account write attempt (RLS blocks it,
but don't do it). Forgetting `force-dynamic` → a cached GET could serve another user's state in
theory; keep it dynamic.

---

## Task 2.18 — Adapt `lib/sync.ts` to target the account endpoint when signed in

**Preserve every existing behavior** for anonymous passcode users; add an account path when a
Supabase session exists. Reuse `mergeStates`/`gatherState`/`applyState`. **Reset stays a plain
push (no merge)** — the master "union-merge resurrection" trap.

- [ ] At the top of `lib/sync.ts` (after the `"use client";` and doc comment, alongside the
  `merge` imports added in Task 2.7), add the browser client import:
  ```ts
  import { createClient } from "@/lib/supabase/browser";
  ```
- [ ] Add these helpers (place after `getSyncCode`):
  ```ts
  /** The signed-in Supabase user id, or null. Cheap: reads the local session. */
  async function getAccountUserId(): Promise<string | null> {
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return session?.user?.id ?? null;
    } catch {
      return null;
    }
  }

  /** True when either an account session OR a passcode is available to sync with. */
  export async function syncEnabled(): Promise<boolean> {
    if (getSyncCode()) return true;
    return (await getAccountUserId()) !== null;
  }
  ```
- [ ] Replace the **whole** existing `syncNow` function with this account-aware version
  (the passcode branch is byte-identical to today's logic, just factored out):
  ```ts
  /** Pull remote, merge with local, apply locally, push merged. */
  export async function syncNow(): Promise<{ ok: boolean; mergedFromRemote: boolean }> {
    const uid = await getAccountUserId();
    return uid ? syncNowAccount() : syncNowPasscode();
  }

  async function syncNowAccount(): Promise<{ ok: boolean; mergedFromRemote: boolean }> {
    const pull = await fetch("/api/state", { method: "GET" });
    if (!pull.ok) return { ok: false, mergedFromRemote: false };
    const remote = (await pull.json()) as { state: SyncState | null };

    const local = gatherState();
    const merged = remote.state ? mergeStates(local, remote.state) : local;
    applyState(merged);

    const push = await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: merged }),
    });
    if (push.ok) {
      try {
        window.localStorage.setItem(SYNC_LAST_KEY, String(Date.now()));
      } catch {}
      window.dispatchEvent(new CustomEvent(SYNC_APPLIED_EVENT));
    }
    return { ok: push.ok, mergedFromRemote: Boolean(remote.state) };
  }

  async function syncNowPasscode(): Promise<{ ok: boolean; mergedFromRemote: boolean }> {
    const code = getSyncCode();
    if (!code) return { ok: false, mergedFromRemote: false };

    const pull = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!pull.ok) return { ok: false, mergedFromRemote: false };
    const remote = (await pull.json()) as { state: SyncState | null };

    const local = gatherState();
    const merged = remote.state ? mergeStates(local, remote.state) : local;
    applyState(merged);

    const push = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, state: merged }),
    });
    if (push.ok) {
      try {
        window.localStorage.setItem(SYNC_LAST_KEY, String(Date.now()));
      } catch {}
      window.dispatchEvent(new CustomEvent(SYNC_APPLIED_EVENT));
    }
    return { ok: push.ok, mergedFromRemote: Boolean(remote.state) };
  }
  ```
- [ ] Replace the **whole** existing `resetProgress` function. The local-wipe block is unchanged;
  only the server push becomes account-aware (**plain push of the wiped state, no merge**):
  ```ts
  /**
   * Reset study progress locally AND on the server (plain push, no merge —
   * otherwise the union-merge would resurrect the old state on the next sync).
   * @param subject a subject slug to reset only that subject, or undefined for everything
   */
  export async function resetProgress(subject?: string): Promise<boolean> {
    try {
      const raw = window.localStorage.getItem(PROGRESS_KEY);
      if (raw) {
        if (!subject) {
          window.localStorage.removeItem(PROGRESS_KEY);
        } else {
          const p = JSON.parse(raw) as ProgressState;
          const strip = <T,>(obj: Record<string, T> | undefined): Record<string, T> =>
            Object.fromEntries(
              Object.entries(obj ?? {}).filter(([k]) => !k.startsWith(`${subject}/`))
            );
          const next: ProgressState = {
            q: strip(p.q),
            quiz: strip(p.quiz),
            practice: strip(p.practice),
          };
          window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(next));
        }
      }
      const toRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k?.startsWith(DECK_PREFIX) && (!subject || k.startsWith(`${DECK_PREFIX}${subject}:`))) {
          toRemove.push(k);
        }
      }
      toRemove.forEach((k) => window.localStorage.removeItem(k));
    } catch {
      return false;
    }

    // make every open view reload the (now reset) state
    window.dispatchEvent(new CustomEvent(SYNC_APPLIED_EVENT));

    // overwrite the server copy (plain push) so other devices reset too
    const uid = await getAccountUserId();
    if (uid) {
      try {
        const res = await fetch("/api/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: gatherState() }),
        });
        if (res.ok) {
          window.localStorage.setItem(SYNC_LAST_KEY, String(Date.now()));
          return true;
        }
        return false;
      } catch {
        return false;
      }
    }

    const code = getSyncCode();
    if (code) {
      try {
        const res = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, state: gatherState() }),
        });
        if (res.ok) {
          window.localStorage.setItem(SYNC_LAST_KEY, String(Date.now()));
          return true;
        }
        return false;
      } catch {
        return false;
      }
    }
    return true;
  }
  ```
- [ ] Update `components/SyncManager.tsx` so account users (with no passcode) also auto-sync.
  Replace its body with:
  ```tsx
  "use client";

  import { useEffect, useRef } from "react";
  import { STATE_CHANGED_EVENT, syncEnabled, syncNow } from "@/lib/sync";

  /**
   * Invisible component mounted once in the root layout. Pull-merge-pushes on
   * page load and (debounced) after every local study-state change — for either
   * an account session or a passcode.
   */
  export function SyncManager() {
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const busy = useRef(false);

    useEffect(() => {
      let cancelled = false;
      let started: ReturnType<typeof setTimeout> | null = null;
      void (async () => {
        if ((await syncEnabled()) && !cancelled) {
          started = setTimeout(() => void syncNow(), 800);
        }
      })();
      return () => {
        cancelled = true;
        if (started) clearTimeout(started);
      };
    }, []);

    useEffect(() => {
      const onChange = () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(async () => {
          if (busy.current) return;
          if (!(await syncEnabled())) return;
          busy.current = true;
          try {
            await syncNow();
          } finally {
            busy.current = false;
          }
        }, 3000);
      };
      window.addEventListener(STATE_CHANGED_EVENT, onChange);
      return () => {
        window.removeEventListener(STATE_CHANGED_EVENT, onChange);
        if (timer.current) clearTimeout(timer.current);
      };
    }, []);

    return null;
  }
  ```
  > **`SyncCard` (passcode UI) is left unchanged** — it still works for anonymous users. A polished
  > "you're signed in, sync is automatic" state for `SyncCard` is a Phase 3 UI-cleanup nicety, not
  > required here. Record it as deferred.
- [ ] Build to confirm the client bundle is happy importing the browser supabase client:
  ```bash
  npm run build
  ```

**Failure modes:** `getAccountUserId()` throwing on SSR → guarded by try/catch returning null.
Account users double-syncing to *both* endpoints → `syncNow` branches exclusively on `uid`, so
only one path runs. Reset accidentally merging → keep it a plain `gatherState()` push.

---

## Task 2.19 — Account page (profile summary + settings + import + sign out)

- [ ] Create `components/EditProfileForm.tsx` (client — edits the mutable profile fields via the
  onboarding action, which already permits them):
  ```tsx
  "use client";
  import { useActionState } from "react";
  import { useLang } from "@/lib/i18n";
  import type { Bi } from "@/lib/types";
  import { COUNTRIES } from "@/lib/countries";
  import { completeOnboarding, type OnboardState } from "@/app/onboarding/actions";
  import { SubmitButton } from "@/components/auth/SubmitButton";
  import type { TrackOption } from "@/components/OnboardingWizard";
  import type { Profile } from "@/lib/auth/dal";

  export function EditProfileForm({ profile, tracks }: { profile: Profile; tracks: TrackOption[] }) {
    const { t, bi } = useLang();
    const [state, action] = useActionState<OnboardState, FormData>(completeOnboarding, undefined);
    return (
      <form action={action} className="grid gap-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink-soft">{t("fullName")}</span>
          <input name="full_name" required minLength={2} defaultValue={profile.full_name}
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink-soft">{t("country")}</span>
          <select name="country_code" defaultValue={profile.country_code}
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm">
            {COUNTRIES.map((c) => (<option key={c.code} value={c.code}>{bi(c.name)}</option>))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink-soft">{t("phone")}</span>
          <input name="phone" type="tel" defaultValue={profile.phone}
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink-soft">{t("preferredLanguage")}</span>
          <select name="preferred_lang" defaultValue={profile.preferred_lang}
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm">
            <option value="tr">Türkçe</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink-soft">{t("track")}</span>
          <select name="track_id" defaultValue={profile.track_id ?? ""}
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm">
            {tracks.map((tr) => (<option key={tr.id} value={tr.id}>{bi(tr.title)}</option>))}
          </select>
        </label>
        <SubmitButton label={t("saveChanges")} />
      </form>
    );
  }
  ```
  > `completeOnboarding` re-sets `onboarded_at` (idempotent) and redirects to `/account` on
  > success, which doubles as the "saved" confirmation. Reusing it avoids a second action.
- [ ] Create `components/AccountHeadingClient.tsx` (client — shows the account email + track
  title via i18n; the track title is resolved on the server and passed in as a `Bi`):
  ```tsx
  "use client";
  import { useLang } from "@/lib/i18n";
  import type { Bi } from "@/lib/types";
  export function AccountHeadingClient({ email, trackTitle }: { email: string; trackTitle: Bi | null }) {
    const { t, bi } = useLang();
    return (
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">{t("accountTitle")}</h1>
        <p className="mt-1 text-sm text-ink-soft">{email}</p>
        {trackTitle && (
          <p className="mt-1 text-sm">
            <span className="text-ink-faint">{t("yourTrack")}: </span>
            <span className="font-semibold text-deniz-deep">{bi(trackTitle)}</span>
          </p>
        )}
      </div>
    );
  }
  ```
- [ ] Create `app/account/page.tsx` (server — `requireOnboarded()` gates it; it resolves the
  current track's `Bi` title from the fetched `tracks` list and passes it down):
  ```tsx
  import { requireOnboarded } from "@/lib/auth/dal";
  import { createServiceRoleClient } from "@/lib/supabase/server";
  import { EditProfileForm } from "@/components/EditProfileForm";
  import { ImportPasscodeForm } from "@/components/ImportPasscodeForm";
  import { SignOutButton } from "@/components/auth/SignOutButton";
  import { AccountHeadingClient } from "@/components/AccountHeadingClient";
  import type { TrackOption } from "@/components/OnboardingWizard";

  export default async function AccountPage() {
    const { user, profile } = await requireOnboarded();
    // WHY service-role: tracks gets a public read policy in Phase 3/4; until then
    // the cookie/anon client sees 0 rows. Only published display fields are exposed.
    const service = createServiceRoleClient();
    const { data: tracks } = await service
      .from("tracks")
      .select("id, title, country_code, system, level")
      .eq("status", "published")
      .order("sort", { ascending: true });

    const trackList = (tracks as TrackOption[] | null) ?? [];
    const current = trackList.find((tr) => tr.id === profile.track_id) ?? null;

    return (
      <div className="mx-auto grid w-full max-w-md gap-6 py-6">
        <AccountHeadingClient email={user.email ?? ""} trackTitle={current?.title ?? null} />
        <section className="rounded-2xl border border-line bg-card p-6">
          <EditProfileForm profile={profile} tracks={trackList} />
        </section>
        <ImportPasscodeForm />
        <SignOutButton />
      </div>
    );
  }
  ```
- [ ] Create `components/auth/SignOutButton.tsx`:
  ```tsx
  "use client";
  import { useLang } from "@/lib/i18n";
  import { signOut } from "@/app/auth/actions";
  export function SignOutButton() {
    const { t } = useLang();
    return (
      <form action={signOut}>
        <button
          type="submit"
          className="rounded-full border border-clay/40 px-4 py-2 text-sm font-semibold text-clay transition-colors hover:bg-clay-soft"
        >
          {t("signOut")}
        </button>
      </form>
    );
  }
  ```

**Failure modes:** `requireOnboarded()` redirect loop if `onboarded_at` never set → verify Task
2.15 wrote it. Passing the whole `profile` (incl. `role`) to a client form is fine here (no
secrets), but never render `role` as an editable field.

---

## Task 2.20 — Header account UI (signed-out vs signed-in)

Keep the app **static-first**: the account menu reads auth state **client-side** so it does not
force every page dynamic. Consistent with `Header.tsx` patterns. The menu's profile data
(name + track title) comes from a tiny `/api/me` route handler, NOT from a browser Supabase
query — `tracks` gets its public read policy only in Phase 3/4, so at Phase 2 a browser-side
`tracks` read (direct or via a `profiles → tracks` embed) returns **0 rows**; the route resolves
the track title server-side with `createServiceRoleClient()`.

- [ ] Create `app/api/me/route.ts`:
  ```ts
  import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

  export const dynamic = "force-dynamic"; // per-user — never cache

  export async function GET() {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return Response.json({ me: null });

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, track_id")
      .eq("user_id", user.id)
      .maybeSingle();

    // WHY service-role: tracks gets a public read policy in Phase 3/4; until then
    // the cookie/anon client sees 0 rows. Only the published track's Bi title is
    // returned — safe to expose.
    let trackTitle: unknown = null;
    if (profile?.track_id) {
      const service = createServiceRoleClient();
      const { data: track } = await service
        .from("tracks")
        .select("title")
        .eq("id", profile.track_id)
        .eq("status", "published")
        .maybeSingle();
      trackTitle = track?.title ?? null;
    }

    return Response.json({
      me: { email: user.email ?? "", fullName: profile?.full_name ?? "", trackTitle },
    });
  }
  ```
- [ ] Create `components/AccountMenu.tsx`:
  ```tsx
  "use client";
  import { useEffect, useState } from "react";
  import Link from "next/link";
  import { useLang } from "@/lib/i18n";
  import type { Bi } from "@/lib/types";
  import { createClient } from "@/lib/supabase/browser";
  import { signOut } from "@/app/auth/actions";

  interface AccountInfo { email: string; fullName: string; trackTitle: Bi | null; }

  export function AccountMenu() {
    const { t, bi } = useLang();
    const [info, setInfo] = useState<AccountInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(false);

    useEffect(() => {
      const supabase = createClient();
      let active = true;
      const load = async () => {
        try {
          // /api/me resolves profile + track title server-side (a browser-side
          // tracks read would return 0 rows until Phase 3/4 adds its policy).
          const res = await fetch("/api/me");
          const body = (await res.json()) as { me: AccountInfo | null };
          if (active) setInfo(body.me);
        } catch {
          if (active) setInfo(null);
        } finally {
          if (active) setLoading(false);
        }
      };
      void load();
      // re-fetch whenever the auth state changes (sign-in/out in this tab)
      const { data: sub } = supabase.auth.onAuthStateChange(() => void load());
      return () => { active = false; sub.subscription.unsubscribe(); };
    }, []);

    if (loading) return null; // avoid an auth flash on first paint
    if (!info) {
      return (
        <Link
          href="/auth/sign-in"
          className="ml-2 rounded-full bg-deniz px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-deniz-deep"
        >
          {t("signIn")}
        </Link>
      );
    }
    const initial = (info.fullName || info.email || "?").trim().charAt(0).toUpperCase();
    return (
      <div className="relative ml-2">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-deniz text-sm font-semibold text-white"
        >
          {initial}
        </button>
        {open && (
          <>
            <button
              aria-hidden
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-30 cursor-default"
            />
            <div
              role="menu"
              className="absolute right-0 z-40 mt-2 w-48 rounded-xl border border-line bg-card p-2 shadow-lg"
            >
              {info.trackTitle && (
                <p className="px-2 py-1 text-[11px] text-ink-faint">{bi(info.trackTitle)}</p>
              )}
              <Link
                href="/account"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="block rounded-lg px-2 py-1.5 text-sm text-ink-soft hover:bg-wash hover:text-deniz-deep"
              >
                {t("account")}
              </Link>
              <form action={signOut}>
                <button
                  type="submit"
                  role="menuitem"
                  className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-clay hover:bg-clay-soft"
                >
                  {t("signOut")}
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    );
  }
  ```
  > The browser Supabase client is used ONLY for `onAuthStateChange` reactivity here — all data
  > comes from `/api/me`. Do not add a browser-side `tracks` query or a `profiles → tracks`
  > embed: `tracks` has no client-readable policy until Phase 3/4.
- [ ] Modify `components/Header.tsx` to render `<AccountMenu />` after the language toggle. Add the
  import and drop the component into the `<nav>`:
  ```tsx
  // add near the other imports:
  import { AccountMenu } from "./AccountMenu";
  ```
  and immediately **after** the language-toggle `</div>` (the `role="group"` block) inside
  `<nav>`, add:
  ```tsx
          <AccountMenu />
  ```
  No other Header changes; the language toggle and nav links stay exactly as they are.
- [ ] Build:
  ```bash
  npm run build
  ```

**Failure modes:** an empty/missing track name in the menu → the user's track isn't `published`
or `/api/me` failed (check the network tab; the menu degrades gracefully to no track line).
Reintroducing a browser-side `tracks` read "because it's simpler" → silently 0 rows at Phase 2
(no policy) — keep the `/api/me` indirection. A menu that won't close → the invisible overlay
button handles outside-clicks.

---

## Task 2.21 — Wire it together, then run the full gate

- [ ] Confirm the root layout still mounts `SyncManager` (unchanged) and the header. No layout
  edit is required (the account menu lives inside `Header`, which the layout already renders).
- [ ] Run the full done-gate (master §8), **one build at a time**:
  ```bash
  npx vitest run
  npm run lint
  npm run build
  node scripts/validate-content.mjs
  ```
  Expected: vitest all-pass (merge + passcode suites), lint clean, build succeeds, content
  validator passes (content untouched this phase, but run it — master §8.3).
- [ ] Confirm migrations still reset from scratch:
  ```bash
  npx supabase db reset
  ```

**Failure modes:** running vitest during `next build` → never do both at once (master §11). A
build-only RSC error (e.g. importing `server-only` DAL into a client file) that `tsc` didn't
catch → the build is the authority; fix the boundary.

---

## Task 2.22 — Negative-path verification (RLS probes + auth flows)

Every money/access/auth task needs at least one negative path (master §12.6). Do **all** of these.

### A. Manual auth flow checklist (against `npm run dev`, using the owner email only)

- [ ] **Sign up → confirm → onboard:** `/auth/sign-up` with `ahmedallycubad@gmail.com` → "check
  your email" → click the emailed link → lands on `/onboarding` (session set) → fill the wizard →
  redirected to `/account` showing the track name.
- [ ] **Wrong password:** `/auth/sign-in` with a bad password → inline "Wrong email or password."
- [ ] **Unconfirmed email:** create a second account (use a `+alias`), do **not** confirm, try to
  sign in → "Confirm your email first…".
- [ ] **Rate limit:** trigger several rapid resets from `/auth/forgot-password` → eventually "Too
  many attempts."
- [ ] **Expired/invalid link:** open `/auth/confirm?token_hash=bad&type=email` → redirected to
  `/auth/error` with the expired-or-invalid message.
- [ ] **Password reset round-trip:** forgot-password → email link → `/auth/reset-password` → set a
  new password → redirected to `/account`, and the new password works on next sign-in.
- [ ] **Sign out:** account menu → Sign out → header shows the **Sign in** button again.
- [ ] **Unauthenticated `/onboarding` redirects:** in a fresh incognito window, visit
  `http://localhost:3000/onboarding` → redirected to `/auth/sign-in?next=/onboarding` (this is the
  `proxy.ts` optimistic gate). Same for `/account`.
- [ ] **Server progress round-trip:** signed in, answer a question / grade a flashcard → within a
  few seconds `SyncManager` POSTs to `/api/state`; reload in another browser signed into the same
  account → progress is present. **Reset progress** → other device resets too (plain push, no
  resurrection).
- [ ] **Legacy import:** enter a known legacy passcode in `/account` → "Progress imported."; enter
  a nonsense passcode → "No saved progress found for that passcode."

### B. RLS probes (SQL editor or `curl` against the REST API)

Get two real user ids (User A, User B) and their access tokens (sign in as each in dev; copy the
`access_token` from the `sb-*-auth-token` cookie or via the browser client's `getSession()`).

- [ ] **User A cannot READ User B's `user_state`.** As User A's token:
  ```bash
  curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/user_state?user_id=eq.<USER_B_ID>&select=state" \
    -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer <USER_A_ACCESS_TOKEN>"
  ```
  **Expected:** `[]` (empty — RLS filters B's row out; **never** B's state).
- [ ] **User A cannot WRITE User B's `user_state`.** As User A's token:
  ```bash
  curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/user_state" \
    -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer <USER_A_ACCESS_TOKEN>" \
    -H "Content-Type: application/json" -H "Prefer: resolution=merge-duplicates" \
    -d '{"user_id":"<USER_B_ID>","state":{"pwned":true}}'
  ```
  **Expected:** an RLS error (HTTP 401/403, `code` `42501` / "new row violates row-level security
  policy"). **Not** a 200. Confirm B's row is unchanged.
- [ ] **Owner cannot escalate `role`.** In the SQL editor, impersonate User A
  (`set local role authenticated; set local request.jwt.claims to '{"sub":"<USER_A_ID>","role":"authenticated"}';`)
  then:
  ```sql
  update public.profiles set role = 'admin' where user_id = '<USER_A_ID>';
  ```
  **Expected:** `ERROR: profiles.role can only be changed by an administrator` (Task 2.5 trigger).
  Reset role: `reset role;`.
- [ ] **`legacy_sync` has no client access.** As any user token:
  ```bash
  curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/legacy_sync?select=id&limit=1" \
    -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer <ANY_USER_ACCESS_TOKEN>"
  ```
  **Expected:** `[]` (RLS blocks it; the import action reaches it only via the service role).
- [ ] **`/api/state` rejects the unauthenticated caller.** With no cookie:
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/state"
  ```
  **Expected:** `401`.
- [ ] Run the **Supabase advisors** (security lints) and confirm no new errors from this phase:
  ```
  (MCP) supabase.get_advisors(type: "security")
  ```
  **Expected:** no `function_search_path_mutable` on `handle_new_user` /
  `protect_profile_role` (both set `search_path=''`), and no "RLS disabled" on any table.

**Failure modes:** a 200 on the cross-account write probe → the `user_state` owner policy is
missing a `WITH CHECK` (fix in a new migration, do not ship). Advisors flagging a mutable search
path → add `set search_path = ''` and re-migrate.

---

## Commits

Commit in logical groups on `feat/phase-2-auth-profiles` (never push to `main` mid-phase). Use
these messages:

- [ ] After Tasks 2.1–2.3: config only (config.toml) — `chore(auth): supabase email auth, Resend SMTP, token_hash templates`
- [ ] After Tasks 2.4–2.6: `feat(db): profile-creation trigger, extend role guard, verify service-role client`
- [ ] After Tasks 2.7–2.9: `refactor(sync): extract pure merge; add passcode hash + auth DAL (with tests)`
- [ ] After Task 2.10: `feat(auth): root proxy.ts session refresh + optimistic route guards`
- [ ] After Tasks 2.11–2.14: `feat(auth): sign-up/in/out, reset, confirm route + bilingual UI`
- [ ] After Tasks 2.15–2.16: `feat(onboarding): wizard, country list, legacy passcode import`
- [ ] After Tasks 2.17–2.18: `feat(progress): /api/state transport; account-aware sync + reset`
- [ ] After Tasks 2.19–2.20: `feat(account): account page + header account menu`
- [ ] After Tasks 2.21–2.22: `test(auth): full gate + RLS negative-path verification`

Each commit message body may note any deviation. Open the phase PR only after Task 2.22 passes.

---

## Phase acceptance checklist (runnable)

- [ ] `npx vitest run` — all pass (incl. `lib/merge.test.ts`, `lib/passcode.test.ts`).
- [ ] `npm run lint` — clean.
- [ ] `npm run build` (run alone) — succeeds; build log shows a Proxy entry.
- [ ] `node scripts/validate-content.mjs` — passes.
- [ ] `npx supabase db reset` — all migrations apply from scratch.
- [ ] `supabase.get_advisors(type:"security")` — no new errors from this phase.
- [ ] Manual auth flow checklist (Task 2.22.A) — every item verified.
- [ ] RLS probes (Task 2.22.B) — every probe returns the **expected denial**.
- [ ] Passcode sync for **anonymous** users still round-trips (regression — the passcode path is
  unchanged).
- [ ] App still deploys and all pre-Phase-2 surfaces work (units, walkthroughs, tutor, podcasts).

## Rollback

This phase adds files/migrations and lightly edits `lib/sync.ts`, `lib/i18n.tsx`,
`components/SyncManager.tsx`, `components/Header.tsx`. To revert safely:

1. **Code:** the work is isolated on `feat/phase-2-auth-profiles`. If unmerged, discard the
   branch. If merged, `git revert` the phase PR merge commit — production returns to Phase 1
   behavior (localStorage + passcode sync intact; no auth surfaces).
2. **Root `proxy.ts`:** deleting the file removes all session refresh + guards (no crash — pages
   just stop refreshing the cookie). Deleting it is the fastest kill-switch if the proxy
   misbehaves.
3. **Migrations (2.4, 2.5):** additive and reversible. To undo Task 2.4 without a full DB
   rollback:
   ```sql
   drop trigger if exists on_auth_user_created on auth.users;
   drop function if exists public.handle_new_user();
   ```
   Task 2.5 only **replaced the body** of Phase 1's `public.protect_profile_role()` — do NOT
   drop that function or the `profiles_protect_role` trigger (they are Phase 1's guard). To
   roll back Task 2.5, re-run the `create or replace function public.protect_profile_role()`
   statement from Phase 1's original migration, restoring the original body.
   `profiles`/`user_state` rows created meanwhile are harmless and can stay.
4. **Dashboard settings (Tasks 2.1–2.3):** disabling Custom SMTP and email confirmations reverts
   auth to "off"; the templates can be reset to defaults. No data loss.
5. **No cutover risk:** production still runs on **sprout** until Phase 3 (master §13) — Phase 2
   ships against the new project without moving live traffic, so a rollback here does not touch
   the sprout-backed passcode sync users rely on today.

## Changelog / deviations

- **2026-07-16 — post-audit fixes (plan-authoring stage, before any execution; per master §14
  contract registry):**
  1. All `tracks` reads (onboarding page Task 2.16, track validation in `completeOnboarding`
     Task 2.15, account page Task 2.19, header menu Task 2.20 via new `/api/me` route) now use
     `createServiceRoleClient()` — `tracks` has RLS enabled but receives its public read policy
     only in Phase 3/4, so cookie/anon clients see 0 rows at Phase 2 (onboarding would have been
     impossible to complete). Removed the false claim that authenticated users could read
     published `tracks` rows at this phase.
  2. Deleted the planned `lib/supabase/admin.ts` / `createAdminClient`; Phase 2 uses Phase 1's
     canonical `createServiceRoleClient()` from `lib/supabase/server.ts` (Task 2.6 is now a
     verification of that export). Env matrix + prerequisites updated.
  3. Task 2.5 no longer creates a parallel role-guard trigger: it `create or replace`s Phase 1's
     `public.protect_profile_role()` (keeping trigger name `profiles_protect_role`) with the
     extended body; removed the false "idempotent with any Phase 1 guard" wording; added a
     single-trigger verification query; rollback section corrected to restore Phase 1's body
     instead of dropping the guard. Advisors probe updated to the canonical function name.
  4. Seed SQL EN track title aligned to Phase 1's exact string
     (`"Turkey — University (Undergraduate)"`); also replaced the nonexistent
     `supabase db execute` with dashboard SQL editor / `psql` / MCP `execute_sql` per §14.
  5. Removed the unused `import Link` from `app/auth/error/page.tsx` (Task 2.14).
  6. No change needed for test discovery — Phase 1's Vitest `include` now covers colocated
     `**/*.test.ts` files.

_(executing agents record further deviations below per master §11)_

- **2026-07-18 — Task 2.1:** The linked existing project `qjcaangaxpkihxxzexpq` was updated
  through authenticated `supabase config push` rather than the dashboard UI. The remote Site URL
  is `https://cubad.vercel.app`; the committed local config intentionally remains
  `http://localhost:3000`. Pre-existing remote MFA and OTP settings were preserved after the
  initial config-sync drift check.
- **2026-07-18 — Task 2.2:** A real Resend key was supplied in the ignored `.env.local` and
  custom SMTP was configured for the existing `cubad` project. The current Supabase SMTP page has
  no dashboard "Send test" control, so delivery will be verified by the required real sign-up
  flow in Task 2.22 rather than by a nonexistent dashboard action.
- **2026-07-18 — Task 2.3:** Confirm-signup, reset-password, and change-email templates were
  configured in the existing Supabase dashboard with the required `token_hash` routes. End-to-end
  delivery and token exchange remain part of the Task 2.22 auth-flow gate.
