# Phase 1 — Foundation

> **For agentic workers:** This is one phase plan under the cubad productization project.
> Read `docs/plans/productization/00-MASTER-PLAN.md` FULLY before starting any task below —
> its §3 (locked decisions), §4 (schema), §5 (canonical examples), §8 (definition of done),
> §9 (security invariants) and §12 (authoring rules, which this doc follows) are LAW. This
> doc does not repeat that reasoning; it only turns it into checkboxes. If a step here ever
> looks like it contradicts the master plan, the master plan wins — stop and flag it in
> `## Changelog / deviations` below rather than improvising.

**Goal:** Stand up the new dedicated Supabase project (`cubad-app`, eu-central-1), the
Supabase CLI + migrations scaffold in this repo, the `lib/supabase/*` client helpers, the
full target database schema (RLS-enabled, with only the tables this phase owns getting real
policies), a content seed script that loads the two existing subjects into that schema, a
Vitest test harness, and a CI workflow — all without changing any user-visible behavior of
the live app. Production keeps running exactly as it does today (static `content/*.json`,
sprout project) until Phase 3's cutover.

**Architecture:** Next.js 16 (App Router, Vercel) + a NEW dedicated Supabase project
(Postgres + Auth + Storage + RLS), reached only through `@supabase/ssr`-based clients in
`lib/supabase/`. This phase creates the plumbing; no route imports it yet.

**Tech stack:** Next.js 16.2.x · React 19 · TypeScript 5 · Supabase (`@supabase/supabase-js`
+ `@supabase/ssr`, new deps this phase) · Vitest (new dep this phase) · Supabase CLI (new
dev dep this phase).

---

## Prerequisites

- **Depends on:** nothing. This is Phase 1 — the root of the phase map (master §7).
- **Required reading, in order:** `docs/plans/productization/00-MASTER-PLAN.md` (full, esp.
  §3 D1/D2/D3/D4/D14/D15, §4, §8, §9, §11, §12) · `AGENTS.md` (Next.js 16 is newer than
  training data — read the matching `node_modules/next/dist/docs/` guide before writing
  `lib/supabase/server.ts`/`middleware.ts`, which use `cookies()` from `next/headers`) ·
  `package.json` (this phase adds `@supabase/supabase-js`, `@supabase/ssr`, `vitest`,
  `supabase` CLI as a dev dep) · `.env.example` (current contents; this phase rewrites it) ·
  `scripts/validate-content.mjs` (must keep passing; not modified) · `content/subjects.json`
  + `content/hidroloji/unit-1.json` (the shape the seed script reads —
  `content/insaat-yonetimi/` has 10 unit files, `content/hidroloji/` has 9, 19 total; these
  exact counts recur in this doc's verification checklists) · `lib/types.ts` (the
  `Unit`/`SubjectMeta` shape = the JSONB contract for `units.content`, D4: unchanged) ·
  `lib/content.ts` (its unit-file discovery/sort is what `scripts/seed-content.mjs`,
  Task 8, reimplements as a pure tested helper).
- **Environment needed:** Node ≥ 20.6 (`node --env-file`; Task 8 has a fallback if older) ·
  Docker Desktop installed and running (Supabase CLI's local stack) · a Supabase account able
  to create a project · access to this repo's Vercel project's env var settings · `npx`.
- **Repo root (verified):** `cubad/` (this folder) IS the git repository root for
  `github.com/ACubad/cubad` (`.git` lives here; `git remote -v` points at that repo). All
  paths in this doc — including Task 10's CI YAML — are relative to this root with no
  `working-directory` override needed. Task 1 still has the executor confirm this with
  `git rev-parse --show-toplevel` as a cheap sanity check before branching.

---

## Task 1 — Verify repo root and create the phase branch

- [ ] Sanity-check the repo root: run `git rev-parse --show-toplevel` from inside this
      folder and confirm the printed path ends in `cubad` (case-insensitive, allowing for OS
      path separators). This is expected to pass — `cubad/` is the verified repo root (see
      Prerequisites). If it somehow does not, stop and flag it in `## Changelog / deviations`
      before continuing.
- [ ] Run:
  ```
  git checkout main
  git pull origin main
  git checkout -b feat/phase-1-foundation
  ```
  Expected output ends with `Switched to a new branch 'feat/phase-1-foundation'`.
- [ ] Do not push yet — push happens in Task 11.

**Manual verification:** `git branch --show-current` prints `feat/phase-1-foundation`.

**Failure modes:** if `main` has diverged locally, `git pull origin main` may report a
non-fast-forward error — resolve by discarding local `main` changes (`git checkout main &&
git reset --hard origin/main`) only if you are certain there is no unpushed local work; if in
doubt, stop and ask the human rather than guessing.

---

## Task 2 — Create the Supabase project `cubad-app`

Per master §3 D1: new project, region **eu-central-1** (Frankfurt).

- [ ] **Dashboard path (primary):** go to
      https://supabase.com/dashboard/organizations, pick (or create) the owning
      organization, click **New Project**. Name: `cubad-app`. Database password: click
      **Generate a password**, copy it immediately into a password manager or local secrets
      note (never a file tracked by git) — needed again in Task 3 (`supabase link`). Region:
      **Frankfurt (eu-central-1)**. Plan: your choice (Free is enough for Phase 1–2). Click
      **Create new project** and wait for provisioning (~2 minutes) until the Table Editor
      appears.
- [ ] **MCP/CLI alternative (if a Supabase MCP server is connected):** use its
      project-creation tool (e.g. `create_project`) with `name: "cubad-app"`,
      `region: "eu-central-1"` and the target organization id. Tool names vary by server
      (`mcp__supabase__*` vs `mcp__claude_ai_Supabase__*`) — use whichever is present; the
      dashboard path is the fallback of record. Either way, still open the dashboard
      afterward: the `service_role` secret is deliberately not returned by most MCP
      "list keys" tools and must be read from **Project Settings → API** by hand.
- [ ] Record these five values somewhere safe (password manager / local secrets note, NOT a
      committed file) — you will paste them into `.env.local` and Vercel in Task 4:

  | Value | Where to find it |
  |---|---|
  | Project ref | Settings → General → **Reference ID** (looks like `abcdefghijklmnop`) |
  | Project URL | Settings → API → **Project URL** |
  | `anon` `public` key | Settings → API → **Project API keys → anon public** |
  | `service_role` key | Settings → API → **Project API keys → service_role** (click **Reveal**) |
  | DB password | the one generated during project creation |

**Manual verification:** the dashboard's project overview shows region "Frankfurt
(eu-central-1)" and status "Active".

**Failure modes:** if the org has no available project slots on the current plan, either
free up a slot (pause/delete an unused project) or upgrade — do not create the project in
the wrong region "to unblock" and fix it later; a region change means recreating the
project, so get this right now.

---

## Task 3 — Supabase CLI scaffold in-repo

- [ ] Install the CLI as a dev dependency (keeps the version pinned per-repo instead of
      relying on a global install):
  ```
  npm install --save-dev supabase
  npx supabase --version
  ```
  Expected: prints a version like `2.x.x` with no errors.
- [ ] Initialize the local scaffold:
  ```
  npx supabase init
  ```
  Expected: creates `supabase/config.toml`, `supabase/.gitignore`, and a `supabase/migrations/`
  directory. Exact console wording varies by CLI version; the file-system result (those paths
  existing) is what matters.
- [ ] Authenticate the CLI — pick whichever fits your environment:
  - Interactive (has a browser): `npx supabase login` — opens a browser, approve, then
    prints `Finished supabase login.`
  - Headless (CI, remote shell): generate a personal access token at
    https://supabase.com/dashboard/account/tokens and set it as an env var for this shell —
    PowerShell: `$env:SUPABASE_ACCESS_TOKEN = "<token>"`; bash: `export
    SUPABASE_ACCESS_TOKEN=<token>`. Every `supabase` command below picks it up automatically;
    no `login` step needed.
- [ ] Link the local scaffold to the `cubad-app` project created in Task 2:
  ```
  npx supabase link --project-ref <project-ref-from-task-2>
  ```
  You'll be prompted for the database password from Task 2 (or pass
  `--password "<password>"` / set `SUPABASE_DB_PASSWORD` to skip the prompt). Expected:
  ends with `Finished supabase link.`
- [ ] Commit the scaffold (migrations dir is still empty at this point — that's fine, it's
      created by `git` tracking `.gitkeep`-style via the next task's first migration file):
  ```
  git add supabase/config.toml supabase/.gitignore package.json package-lock.json
  git commit -m "chore(phase-1): add Supabase CLI scaffold (supabase init + link)"
  ```

**Manual verification:** `npx supabase projects list` includes `cubad-app` with a ● marking
it as the linked project (CLI versions render the linked marker differently; the key fact is
the project appears in the list at all, confirming the access token/login worked).

**Failure modes:**
- `supabase login` in a headless shell hangs waiting for a browser — use the
  `SUPABASE_ACCESS_TOKEN` path instead.
- `supabase link` asks for a password repeatedly / times out — pass `--password` explicitly
  rather than relying on the interactive prompt over a flaky terminal.
- Wrong `--project-ref` (e.g. pasted the project **name** `cubad-app` instead of the
  reference id) fails with "Project not found" — re-check Settings → General → Reference ID.

---

## Task 4 — Env var matrix: `.env.example`, `.env.local`, Vercel

Per master §3 D15. The OLD sprout vars (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) are **not**
removed this phase — they keep powering the live `/api/sync` route against sprout until
Phase 3's cutover. This task only **adds** the new vars alongside them.

- [ ] Replace the entire contents of `.env.example` with:

  ```
  # ===== AI features =====
  # Optional: enables the AI tutor for all visitors.
  # Get a free key at https://aistudio.google.com/apikey
  GEMINI_API_KEY=

  # ===== Legacy Supabase project ("sprout") — anonymous passcode sync =====
  # Still powers the live /api/sync route. Do NOT remove until the Phase 3
  # cutover (docs/plans/productization/03-content-db-unified-ui.md) is done.
  SUPABASE_URL=
  SUPABASE_ANON_KEY=

  # ===== New Supabase project ("cubad-app", eu-central-1) =====
  # From the Supabase dashboard: Project Settings -> API.
  NEXT_PUBLIC_SUPABASE_URL=
  NEXT_PUBLIC_SUPABASE_ANON_KEY=
  # Server-only secret. NEVER prefix with NEXT_PUBLIC_, NEVER import from a
  # "use client" file — it bypasses Row Level Security entirely.
  SUPABASE_SERVICE_ROLE_KEY=

  # ===== Email (Resend) — consumed starting Phase 2/6 =====
  # Values can stay blank until those phases need them; the names are added
  # now so no phase needs a separate env-var-plumbing detour.
  RESEND_API_KEY=
  ADMIN_NOTIFY_EMAIL=

  # ===== App =====
  # Canonical base URL used in emails/redirects, e.g. https://cubad.vercel.app
  NEXT_PUBLIC_APP_URL=
  ```

- [ ] Create your local `.env.local` (already gitignored via `.env*.local` in `.gitignore`)
      by copying the template and filling in real values:
  ```
  cp .env.example .env.local
  ```
  (PowerShell: `Copy-Item .env.example .env.local`.) Then edit `.env.local`:
  - `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` — copy from whatever you're
    currently using locally today (or from Vercel's existing env vars, e.g. via
    `vercel env pull .env.local` if the Vercel CLI is already linked — that only pulls
    vars that already exist in Vercel, so re-add the new ones after).
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
    — paste the three values recorded in Task 2.
  - Leave `RESEND_API_KEY`, `ADMIN_NOTIFY_EMAIL`, `NEXT_PUBLIC_APP_URL` blank for now (or set
    `NEXT_PUBLIC_APP_URL=http://localhost:3000` for local dev).
- [ ] In the Vercel dashboard (Project → Settings → Environment Variables), **add** (do not
      remove anything existing):
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
    `SUPABASE_SERVICE_ROLE_KEY` — scope: Production + Preview + Development.
  - `RESEND_API_KEY`, `ADMIN_NOTIFY_EMAIL`, `NEXT_PUBLIC_APP_URL` — scope: same, values can
    be placeholders/blank if Vercel requires non-empty (use a single space or a clearly-fake
    placeholder like `pending-phase-2` for `RESEND_API_KEY` if the UI rejects empty values).
  - Confirm `SUPABASE_URL` and `SUPABASE_ANON_KEY` (sprout) are still present, untouched.
  - No redeploy is required for this alone — nothing in the app reads the new vars yet — but
    triggering one is harmless.
- [ ] Commit:
  ```
  git add .env.example
  git commit -m "chore(phase-1): add D15 env var matrix to .env.example (old sprout vars kept)"
  ```
  (`.env.local` is never committed — it's gitignored.)

**Manual verification:** `git status` shows `.env.example` staged/committed and `.env.local`
absent from `git status` output entirely (proves it's ignored, not just untracked-and-forgotten).

**Failure modes:**
- Forgetting the `NEXT_PUBLIC_` prefix on the two public vars — Next.js only inlines
  `NEXT_PUBLIC_*` vars into the browser bundle at build time; a missing prefix means a
  future browser client silently gets `undefined` instead of a clear error.
- Pasting the `service_role` key into a `NEXT_PUBLIC_*` var by mistake — this is the single
  worst possible mistake in this whole phase (full RLS bypass, public). Triple-check before
  saving in Vercel.
- Vercel's UI sometimes truncates pasted long keys on paste — always verify by re-opening
  the variable after saving.

---

## Task 5 — `lib/supabase/*` clients (`@supabase/ssr`)

- [ ] Install the two Supabase packages:
  ```
  npm install @supabase/supabase-js @supabase/ssr
  ```
- [ ] Before writing `server.ts`/`middleware.ts`, read the current `cookies()` and
      middleware guide under `node_modules/next/dist/docs/` (per `AGENTS.md` — Next 16's
      `cookies()` contract may differ from what's shown below if it changed again since this
      doc was written; the master plan's Risk #2 exists precisely for this file).
- [ ] Create `lib/supabase/browser.ts`:
  ```ts
  import { createBrowserClient } from "@supabase/ssr";

  /**
   * Supabase client for Client Components. Safe to call from anywhere in the
   * browser bundle — uses only the public URL + anon key (D15: never the
   * service-role key).
   */
  export function createClient() {
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  ```
- [ ] Create `lib/supabase/server.ts` — it exports BOTH server-side factories from master
      §14: the cookie-bound RLS client (`createClient`) and the service-role client
      (`createServiceRoleClient`). Later phases import these exact names; there is NO
      `lib/supabase/admin.ts` and no `createServiceClient`/`createAdminClient`:
  ```ts
  import "server-only";
  import { createServerClient } from "@supabase/ssr";
  import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
  import { cookies } from "next/headers";

  /**
   * Supabase client for Server Components, Server Actions and Route
   * Handlers ONLY. The `server-only` import makes any accidental import
   * from a "use client" file fail the `next build` (not `tsc`) — see the
   * failure-modes note below before "fixing" that error any other way.
   */
  export async function createClient() {
    const cookieStore = await cookies();

    return createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // Called from a Server Component that can't write cookies.
              // Safe to ignore as long as the root proxy.ts (Phase 2)
              // refreshes the session on every request.
            }
          },
        },
      }
    );
  }

  /**
   * Service-role client — bypasses RLS entirely. This factory is the ONLY
   * service-key touchpoint in the codebase (master §14): there is NO
   * lib/supabase/admin.ts and no createServiceClient/createAdminClient.
   * Cookie-less and session-less by design — it must never act "as" a
   * user, only for server-side jobs (legacy_sync access, audit writes,
   * admin operations). The `import "server-only"` guard above protects
   * this module from ever entering a client bundle.
   */
  export function createServiceRoleClient() {
    return createSupabaseJsClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  }
  ```
- [ ] Create `lib/supabase/middleware.ts`:
  ```ts
  import { createServerClient } from "@supabase/ssr";
  import { NextResponse, type NextRequest } from "next/server";

  /**
   * Reusable session-refresh helper. Phase 2 wires session refresh via the
   * root `proxy.ts` (Next 16 convention — never a root `middleware.ts`,
   * master §14) once there is an actual auth flow to protect. This phase
   * only creates the helper (no root proxy.ts yet: an interceptor that
   * runs on every request with nothing to gate would be pure overhead,
   * YAGNI until Phase 2).
   */
  export async function updateSession(request: NextRequest) {
    let supabaseResponse = NextResponse.next({ request });

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value)
            );
            supabaseResponse = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    // Do not add logic between createServerClient() and getUser() below —
    // a stray early return here can make users randomly appear logged out.
    const {
      data: { user },
    } = await supabase.auth.getUser();

    return { supabaseResponse, user };
  }
  ```
- [ ] Commit:
  ```
  git add lib/supabase/browser.ts lib/supabase/server.ts lib/supabase/middleware.ts package.json package-lock.json
  git commit -m "feat(phase-1): add lib/supabase/{browser,server,middleware} SSR clients"
  ```

**Manual verification:**
- `npm run build` still passes with no route importing these files yet (proves they don't
  break the build purely by existing — the real "server-only" test comes in Phase 2 when a
  page actually imports `server.ts`).
- `npm run lint` passes on the three new files.
- `lib/supabase/server.ts` exports exactly two factories — `createClient` (cookie-bound,
  RLS) and `createServiceRoleClient` (service-key) — with those exact names; master §14
  binds later phases to import them verbatim.

**Failure modes:**
- Importing `lib/supabase/server.ts` from any `"use client"` component: `next build` fails
  with an error from the `server-only` package (something like "This module cannot be
  imported from a Client Component module"). This is **correct, expected behavior** — the
  fix is always to move the Supabase call to a Server Component/Action/Route Handler, never
  to delete the `server-only` import.
- Forgetting `await` on `cookies()`: Next's `cookies()` is async in current versions: check
  the guide you read above; a missing `await` surfaces as a runtime error or a Promise where
  a cookie store was expected, not a `tsc` error.
- Calling `.setAll()` from a plain Server Component (not a Server Action/Route Handler)
  throws "Cookies can only be modified in a Server Action or Route Handler" — already
  swallowed by the `try/catch` in `server.ts` above; this is why the catch exists, not a bug
  to "fix" by removing it.

---

## Task 6 — Migration `initial_schema`: full schema + RLS + `is_admin()`

**Scope boundary (read before writing SQL):** this migration owns the ENTIRE table schema
(verbatim from master §4) and enables RLS on every table, but adds real *policies* only for
the four tables this phase owns: `profiles`, `user_state`, `legacy_sync` (zero policies —
service-role only), `admin_audit_log`. It does **not** add policies for `tracks`, `subjects`,
`track_subjects`, `units`, `tiers`, `entitlements`, `access_codes`, `code_redemptions`,
`redemption_attempts`, `payment_claims` — those belong to docs 03, 04 and 06. With RLS
enabled and zero policies, Postgres **default-denies** all access to `anon`/`authenticated`
roles on those tables — this is intentional and expected until later phases add policies; it
is not a bug in this migration. It also does **not** implement `has_subject_access()` or
`redeem_code()` (Phase 4's job) — do not stub them; an empty stub is a security landmine a
later phase could silently rely on.

- [ ] Generate the migration file:
  ```
  npx supabase migration new initial_schema
  ```
  Expected: creates `supabase/migrations/<timestamp>_initial_schema.sql` (empty). The
  timestamp is generated at run time — everywhere else in this doc, this file is called
  "migration `initial_schema`" rather than a fixed filename.
- [ ] Open that file and paste the following as its **entire contents**. The first block
      (down to the `-- ============ ops ============` table + its index) is copied
      **verbatim, byte-for-byte, from master §4** — do not retype it from memory, do not
      rename anything in it. Everything after the `-- Phase 1 additions` marker is new,
      added by this migration per master §4's explicit allowance ("may add indexes/comments
      but MUST NOT rename anything below").

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

  -- ============================================================
  -- Phase 1 additions beyond the literal §4 block above (permitted by
  -- master §4: "Phase plans turn this into numbered migrations; they may
  -- add indexes/comments but MUST NOT rename anything below.")
  -- ============================================================

  -- Needed for idempotent upserts in scripts/seed-content.mjs: Postgres
  -- ON CONFLICT requires a real unique index/constraint on the conflict
  -- columns, and `tracks` above only has a surrogate `id` primary key.
  create unique index tracks_country_system_level_key
    on public.tracks (country_code, system, level);

  -- ============================================================
  -- Row Level Security — every table gets RLS enabled in this same
  -- migration (master §9). Tables not listed under "baseline policies"
  -- below get RLS enabled with ZERO policies: Postgres default-denies
  -- anon/authenticated access in that state. That is intentional — docs
  -- 03 (content/catalog), 04 (tiers/entitlements/codes) and 06
  -- (payment_claims) add their own policies later. `service_role`
  -- (used only by scripts/seed-content.mjs and future server-only code)
  -- bypasses RLS entirely regardless of policies, via Postgres BYPASSRLS.
  -- ============================================================

  alter table public.tracks enable row level security;
  alter table public.subjects enable row level security;
  alter table public.track_subjects enable row level security;
  alter table public.units enable row level security;
  alter table public.profiles enable row level security;
  alter table public.user_state enable row level security;
  alter table public.legacy_sync enable row level security;
  alter table public.tiers enable row level security;
  alter table public.entitlements enable row level security;
  alter table public.access_codes enable row level security;
  alter table public.code_redemptions enable row level security;
  alter table public.redemption_attempts enable row level security;
  alter table public.payment_claims enable row level security;
  alter table public.admin_audit_log enable row level security;

  -- ============================================================
  -- Functions this phase owns. has_subject_access() and redeem_code()
  -- (master §4) are NOT defined here — Phase 4's job.
  -- ============================================================

  -- SECURITY DEFINER + owned by the migration role (which owns `profiles`)
  -- means this function's internal query bypasses RLS on `profiles`,
  -- which is exactly what avoids the recursive-RLS trap described in
  -- master §10: never write a `profiles` policy whose body directly
  -- queries `profiles` again — always go through this function instead.
  create or replace function public.is_admin()
  returns boolean
  language sql
  security definer
  set search_path = public
  stable
  as $$
    select exists (
      select 1 from public.profiles
      where user_id = auth.uid() and role = 'admin'
    );
  $$;

  -- Enforces master §3 D11 ("Role changes only via service-role") at the
  -- database layer, independent of whatever RLS UPDATE policy exists on
  -- profiles below. auth.role() reads the Postgres role Supabase's API
  -- layer authenticated the request as ('anon' | 'authenticated' |
  -- 'service_role') — it is not user-editable.
  create or replace function public.protect_profile_role()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $$
  begin
    if new.role is distinct from old.role and auth.role() <> 'service_role' then
      raise exception 'profiles.role can only be changed by a service-role action (master §3 D11)';
    end if;
    return new;
  end;
  $$;

  -- Phase 2 extends THIS function via `create or replace` (same function
  -- and trigger names) — later phases must never install a second parallel
  -- role-guard trigger (master §14).

  drop trigger if exists profiles_protect_role on public.profiles;
  create trigger profiles_protect_role
    before update on public.profiles
    for each row
    execute function public.protect_profile_role();

  -- ============================================================
  -- Baseline RLS policies — ONLY the tables this phase owns:
  -- profiles, user_state, legacy_sync (deliberately zero policies),
  -- admin_audit_log. Every other table above has RLS ON with NO policy —
  -- do not add policies for tracks/subjects/track_subjects/units/tiers/
  -- entitlements/access_codes/code_redemptions/redemption_attempts/
  -- payment_claims here; those belong to docs 03/04/06.
  -- ============================================================

  create policy "profiles_select_own" on public.profiles
    for select
    using (user_id = auth.uid());

  create policy "profiles_update_own" on public.profiles
    for update
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

  create policy "profiles_select_admin" on public.profiles
    for select
    using (public.is_admin());

  create policy "user_state_select_own" on public.user_state
    for select
    using (user_id = auth.uid());

  create policy "user_state_insert_own" on public.user_state
    for insert
    with check (user_id = auth.uid());

  create policy "user_state_update_own" on public.user_state
    for update
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

  -- legacy_sync: intentionally NO policies. RLS is enabled above; with
  -- zero policies every role except service_role gets zero rows / zero
  -- writes. Only server-side code using the service-role client may ever
  -- touch this table (the Phase 3 sprout-copy script, and later the
  -- rewritten /api/sync route).

  create policy "admin_audit_log_select_admin" on public.admin_audit_log
    for select
    using (public.is_admin());

  -- No insert policy on admin_audit_log: every future write goes through
  -- a SECURITY DEFINER function or the service-role client, in the same
  -- transaction as the mutation it's auditing (master §9).
  ```
- [ ] Save the file. Do not run it yet — that's Task 7.
- [ ] Commit:
  ```
  git add supabase/migrations
  git commit -m "feat(phase-1): migration initial_schema — full schema, RLS on every table, baseline policies"
  ```

**Manual verification (structural, before running it):** open the file and confirm — every
`create table` from master §4 is present with unchanged column names/types; all 14
`enable row level security` statements are present; `is_admin()` and
`protect_profile_role()` exist; exactly 7 `create policy` statements exist (3 on `profiles`,
3 on `user_state`, 1 on `admin_audit_log`) and none on any other table.

**Failure modes:** see Task 7 for runtime failure modes (this task is authoring-only, no SQL
has executed yet). The most common authoring mistake is accidentally "helping" by adding a
policy for a table outside this phase's scope, or an `updated_at`-touch trigger not requested
anywhere in master §4 — resist both; if a later phase needs them, it will add them there.

---

## Task 7 — Apply the migration (local verify, then push to remote)

- [ ] Start the local Supabase stack (Docker must be running):
  ```
  npx supabase start
  ```
  Expected: after pulling images (first run only, can take a few minutes), prints a table of
  local URLs/keys ending with something like:
  ```
  API URL: http://127.0.0.1:54321
  ...
  anon key: eyJ...
  service_role key: eyJ...
  ```
- [ ] Apply all migrations to the local database from scratch:
  ```
  npx supabase db reset
  ```
  Expected: output lists `initial_schema` as applied and ends with
  `Finished supabase db reset on branch main.` with no errors. This is the check master §8
  point 5 requires ("new migrations apply cleanly on a fresh database").
- [ ] Inspect the result via Supabase Studio at http://127.0.0.1:54323 → Table Editor: 14
      tables exist, each showing "RLS enabled". Or via SQL Editor, run:
  ```sql
  select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1;
  ```
  Expected: 14 rows, every `rowsecurity` value `true`.
- [ ] Push the migration to the REMOTE `cubad-app` project (the one linked in Task 3):
  ```
  npx supabase db push
  ```
  Expected: prompts for confirmation, then `Finished supabase db push.` with no errors.
  **MCP alternative:** if a Supabase MCP server is connected, its `apply_migration` tool
  (passing this file's SQL) is also acceptable per master §3 D1 — but still verify
  afterward with `npx supabase db pull --dry-run` (should report no drift) or by checking
  the dashboard's Table Editor directly.
- [ ] Confirm on the **remote** dashboard (Table Editor for `cubad-app`, not local Studio):
      same 14-table / RLS-enabled check as above.

**Manual verification checklist:**
- [ ] `npx supabase db reset` succeeds from a clean slate (re-run it once more right now to
      confirm — it must succeed every time, not just the first time).
- [ ] Remote dashboard shows all 14 tables with RLS enabled.
- [ ] Remote dashboard's SQL Editor: `select public.is_admin();` run as an anonymous/no-auth
      query returns `false` (no error) — proves the function exists and doesn't throw when
      `auth.uid()` is null.

**Failure modes:**
- `Cannot connect to the Docker daemon` — start Docker Desktop, retry.
- `relation "auth.users" does not exist` — you ran this against a bare Postgres instead of a
  real Supabase stack; only `supabase start`'s local stack or an actual Supabase project has
  the `auth` schema.
- `syntax error at or near ...` — almost always a copy/paste truncation; diff the migration
  file against the SQL block in Task 6 line by line.
- `42P01: relation "public.tracks" does not exist` while creating a later table — table order
  was changed; restore the exact top-to-bottom order from Task 6 (FK targets must be created
  before the tables that reference them).
- "stack depth limit exceeded" / infinite recursion when later testing `profiles` queries —
  means a policy directly queries `profiles` instead of calling `is_admin()`; there should be
  no such policy in this migration, so this would indicate the file was hand-edited away from
  Task 6's exact text.
- `supabase db push` reports the remote is already at a different migration state — do not
  force-push over it; investigate with `npx supabase migration list` first (compares local vs
  remote history) before deciding whether a repair is needed.

---

## Task 8 — Seed script `scripts/seed-content.mjs`

Reads `content/subjects.json` + each subject's `content/<slug>/unit-N.json`, and idempotently
upserts them into `subjects`/`units`, plus the canonical Phase 1 track (master §5: "both
attached to a seeded TR / University / Undergraduate track") and its `track_subjects` rows.
`section_order` is set from the old `kind` field (values already match 1:1: `"walkthrough"` /
`"study"`). All units get `is_free = true`, `status = 'published'` (master §5: "all units
`is_free = true` initially — current users lose nothing at cutover").

> Note: the exact title text for the seed track (`{tr: "Türkiye — Üniversite (Lisans)", en:
> "Turkey — University (Undergraduate)"}`) is this plan's own wording — master §5 only fixes
> the `country_code`/`system`/`level` triple (`TR`/`University`/`Undergraduate`), not display
> text. An admin can edit it later via the Phase 5 dashboard; using a placeholder like "TBD"
> is not an option (master §12 forbids placeholders), so this doc picks a real, sensible
> string instead.

- [ ] Create `scripts/seed-content.mjs`:
  ```js
  #!/usr/bin/env node
  // Idempotently seeds the Supabase `subjects`, `units`, `tracks` and
  // `track_subjects` tables from the in-repo content/ fixtures. Safe to
  // re-run: every write is an upsert keyed on a real unique column.
  //
  // Usage:
  //   node --env-file=.env.local scripts/seed-content.mjs
  //
  // Required env vars (service-role — never exposed to the browser):
  //   NEXT_PUBLIC_SUPABASE_URL
  //   SUPABASE_SERVICE_ROLE_KEY
  import fs from "node:fs";
  import path from "node:path";
  import { pathToFileURL } from "node:url";
  import { createClient } from "@supabase/supabase-js";

  const CONTENT_DIR = path.join(process.cwd(), "content");
  const SUBJECTS_FILE = path.join(CONTENT_DIR, "subjects.json");

  // The Phase 1 seed track. Every current subject is free-preview content
  // under this single track until Phase 4 builds the real catalog editor.
  const SEED_TRACK = {
    country_code: "TR",
    system: "University",
    level: "Undergraduate",
    title: {
      tr: "Türkiye — Üniversite (Lisans)",
      en: "Turkey — University (Undergraduate)",
    },
    status: "published",
    sort: 0,
  };

  /**
   * Pure helper: discover + numerically sort unit-N.json files. Mirrors
   * lib/content.ts#getUnits' filter/sort exactly, extracted so it can be
   * unit-tested without touching the filesystem or Supabase (see
   * tests/seed-content.test.ts). A plain string sort would put
   * "unit-10.json" before "unit-2.json" — content/insaat-yonetimi/ has a
   * real unit-10.json today, so this is not a hypothetical bug.
   */
  export function listUnitFiles(files) {
    return files
      .filter((f) => /^unit-\d+\.json$/.test(f))
      .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
  }

  function readJson(p) {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  }

  async function upsertTrack(supabase) {
    const { data, error } = await supabase
      .from("tracks")
      .upsert(SEED_TRACK, { onConflict: "country_code,system,level" })
      .select("id")
      .single();
    if (error) throw new Error(`track upsert failed: ${error.message}`);
    return data.id;
  }

  async function upsertSubject(supabase, meta, sort) {
    const row = {
      slug: meta.slug,
      title: meta.title,
      tagline: meta.tagline,
      section_order: meta.kind, // 'walkthrough' | 'study' — same values as subjects.section_order
      status: "published",
      sort,
    };
    const { data, error } = await supabase
      .from("subjects")
      .upsert(row, { onConflict: "slug" })
      .select("id")
      .single();
    if (error) throw new Error(`subject upsert failed (${meta.slug}): ${error.message}`);
    return data.id;
  }

  async function upsertUnits(supabase, subjectId, subjectSlug) {
    const dir = path.join(CONTENT_DIR, subjectSlug);
    if (!fs.existsSync(dir)) {
      console.warn(`  no content dir for ${subjectSlug}, skipping units`);
      return 0;
    }
    const files = listUnitFiles(fs.readdirSync(dir));
    let count = 0;
    for (const f of files) {
      const unit = readJson(path.join(dir, f));
      const row = {
        subject_id: subjectId,
        unit_number: unit.unit,
        slug: unit.slug,
        is_free: true,
        status: "published",
        content: unit,
      };
      const { error } = await supabase
        .from("units")
        .upsert(row, { onConflict: "subject_id,slug" });
      if (error) throw new Error(`unit upsert failed (${subjectSlug}/${f}): ${error.message}`);
      count++;
    }
    return count;
  }

  async function upsertTrackSubject(supabase, trackId, subjectId, sort) {
    const { error } = await supabase
      .from("track_subjects")
      .upsert(
        { track_id: trackId, subject_id: subjectId, sort },
        { onConflict: "track_id,subject_id" }
      );
    if (error) throw new Error(`track_subjects upsert failed: ${error.message}`);
  }

  async function main() {
    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      console.error(
        "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
          "Run with: node --env-file=.env.local scripts/seed-content.mjs"
      );
      process.exit(1);
    }
    if (!fs.existsSync(SUBJECTS_FILE)) {
      console.error("content/subjects.json not found");
      process.exit(1);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const subjects = readJson(SUBJECTS_FILE);
    console.log(`Seeding ${subjects.length} subjects...`);

    const trackId = await upsertTrack(supabase);
    console.log(`  track TR/University/Undergraduate -> ${trackId}`);

    let totalUnits = 0;
    for (let i = 0; i < subjects.length; i++) {
      const meta = subjects[i];
      const subjectId = await upsertSubject(supabase, meta, i);
      const n = await upsertUnits(supabase, subjectId, meta.slug);
      await upsertTrackSubject(supabase, trackId, subjectId, i);
      console.log(`  ${meta.slug}: ${n} units seeded, attached to track`);
      totalUnits += n;
    }

    console.log(`Done. ${subjects.length} subjects, ${totalUnits} units.`);
  }

  // Only run main() when this file is executed directly (`node
  // scripts/seed-content.mjs`), not when imported (e.g. by
  // tests/seed-content.test.ts for the pure listUnitFiles() helper).
  // pathToFileURL keeps this correct on Windows (backslash paths break a
  // naive `file://${process.argv[1]}` string comparison).
  if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((e) => {
      console.error(e);
      process.exit(1);
    });
  }
  ```
- [ ] Add an npm script. Edit `package.json`'s `"scripts"` block from:
  ```json
    "scripts": {
      "dev": "next dev",
      "build": "next build",
      "start": "next start",
      "lint": "eslint"
    },
  ```
  to:
  ```json
    "scripts": {
      "dev": "next dev",
      "build": "next build",
      "start": "next start",
      "lint": "eslint",
      "test": "vitest run",
      "seed:content": "node --env-file=.env.local scripts/seed-content.mjs"
    },
  ```
  (the `"test"` line is used by Task 9; add both now to avoid a second edit.)
- [ ] Run it against the remote `cubad-app` project (uses the values you put in `.env.local`
      in Task 4):
  ```
  npm run seed:content
  ```
  Expected: ends with `Done. 2 subjects, 19 units.` (9 hidroloji + 10 insaat-yonetimi).
- [ ] Run it again immediately to prove idempotency:
  ```
  npm run seed:content
  ```
  Expected: identical output, `Done. 2 subjects, 19 units.` — no duplicate-key errors.
- [ ] Commit:
  ```
  git add scripts/seed-content.mjs package.json package-lock.json
  git commit -m "feat(phase-1): add idempotent scripts/seed-content.mjs, seed cubad-app content"
  ```

**Manual verification checklist:**
- [ ] Remote dashboard SQL Editor: `select count(*) from tracks;` → `1`.
- [ ] `select count(*) from subjects;` → `2`.
- [ ] `select count(*) from units;` → `19`.
- [ ] `select count(*) from track_subjects;` → `2`.
- [ ] `select slug, section_order, status, sort from subjects order by sort;` → `hidroloji`
      row has `section_order = 'walkthrough'`, `insaat-yonetimi` row has
      `section_order = 'study'`, both `status = 'published'`.
- [ ] `select count(*) from units where is_free = false;` → `0`.
- [ ] Re-running `npm run seed:content` a third time still reports the same counts (proves
      idempotency isn't a first-two-runs fluke).

**Failure modes:**
- Script exits with the missing-env-var message — confirm `.env.local` exists and you ran
  via `npm run seed:content` (which uses `--env-file=.env.local`), not bare `node
  scripts/seed-content.mjs`.
- `relation "subjects" does not exist` — `.env.local`'s `NEXT_PUBLIC_SUPABASE_URL` still
  points at the OLD sprout project (host contains `rywcdqpnwwumbpubkofc`) instead of the new
  `cubad-app` project — fix the URL.
- `new row violates row-level security policy` — you used the anon key instead of the
  service-role key in `SUPABASE_SERVICE_ROLE_KEY`; double-check which key was copied.
- Duplicate rows appear on a second run — check that `tracks_country_system_level_key`
  (Task 6's one non-literal addition to the schema) actually exists:
  `select indexname from pg_indexes where tablename = 'tracks';`.
- `node --env-file` errors with "unknown option" — your Node is older than 20.6; upgrade, or
  fall back to `npm install --save-dev dotenv-cli` and change the script to
  `dotenv -e .env.local -- node scripts/seed-content.mjs`, keeping the rest identical.

---

## Task 9 — Vitest setup + starter test

Per master §3 D14 ("Vitest added in Phase 1 for pure logic"). Tests
`scripts/seed-content.mjs`'s `listUnitFiles` helper from Task 8 — the exact numeric-vs-
lexicographic sort bug class that would otherwise show up as "unit 10 seeded between unit 1
and unit 2" months from now.

- [ ] Install:
  ```
  npm install --save-dev vitest
  ```
- [ ] Create `vitest.config.ts`:
  ```ts
  import { defineConfig } from "vitest/config";

  export default defineConfig({
    test: {
      environment: "node",
      // Discovers both tests/ and colocated *.test.ts(x) files — later
      // phases colocate (e.g. lib/merge.test.ts). node_modules is excluded
      // by Vitest's defaults. Master §14 records this contract.
      include: ["**/*.test.ts", "**/*.test.tsx"],
    },
  });
  ```
- [ ] Create `tests/seed-content.test.ts`:
  ```ts
  import { describe, expect, it } from "vitest";
  import { listUnitFiles } from "../scripts/seed-content.mjs";

  describe("listUnitFiles", () => {
    it("keeps only unit-N.json files", () => {
      const files = ["unit-1.json", "unit-2.json", "README.md", "unit-x.json", "notes.txt"];
      expect(listUnitFiles(files)).toEqual(["unit-1.json", "unit-2.json"]);
    });

    it("sorts numerically, not lexicographically", () => {
      const files = ["unit-10.json", "unit-2.json", "unit-1.json"];
      expect(listUnitFiles(files)).toEqual(["unit-1.json", "unit-2.json", "unit-10.json"]);
    });

    it("returns an empty array when nothing matches", () => {
      expect(listUnitFiles(["subjects.json", "README.md"])).toEqual([]);
    });
  });
  ```
  (`package.json`'s `"test"` script was already added in Task 8 — `"test": "vitest run"`.)
- [ ] Run it:
  ```
  npm test
  ```
  Expected: `Test Files  1 passed (1)`, `Tests  3 passed (3)`, exit code 0.
- [ ] Commit:
  ```
  git add vitest.config.ts tests/seed-content.test.ts package.json package-lock.json
  git commit -m "test(phase-1): add Vitest harness and seed-content listUnitFiles tests"
  ```

**Manual verification:** `npx vitest run` (equivalent to `npm test`) passes with 0 failures;
temporarily breaking the sort (e.g. removing the `parseInt` comparator) makes the second test
fail, confirming the test actually exercises the bug it claims to guard against — revert
after checking.

**Failure modes:**
- Vitest can't resolve the `../scripts/seed-content.mjs` import — confirm the file has no
  top-level code that throws before the `isMain` guard; env-var validation and Supabase
  client creation must live inside `main()` (as written in Task 8), not at module scope,
  otherwise merely importing the file for `listUnitFiles` would crash the test with a missing
  env var.
- The `import.meta.url === pathToFileURL(...)` guard never matches on Windows if you rewrite
  it as a raw string comparison against `process.argv[1]` — keep `pathToFileURL`, don't
  "simplify" it away.
- TypeScript editor squiggles on the `.mjs` import (no type declarations) — harmless;
  `allowJs`/`resolveJsonModule` are already on in `tsconfig.json`, and Vitest runs this via
  esbuild, not `tsc`.

---

## Task 10 — CI workflow `.github/workflows/ci.yml`

Runs on every PR (and on pushes to `main`, for post-merge confidence): install, lint,
validate content, test, build. **No Supabase secrets are configured for this workflow, and
none are needed**: Phase 1 does not wire `lib/supabase/*` into any route yet (Task 5's
manual verification already confirmed `npm run build` passes with these files unused), and
`next.config.ts` has no static-export/build-time data fetching that would need network
access — it only defines `redirects()`. Content still comes from the filesystem via
`lib/content.ts`, unchanged. If a later phase makes a page import `lib/supabase/server.ts`
(or read `NEXT_PUBLIC_SUPABASE_URL` at module scope) in a way that IS bundled into a route,
this workflow will need real secrets at that point — that is out of scope here; flag it in
that phase's doc rather than adding placeholder secrets now.

`cubad/` is the repository root (verified — see Prerequisites), so every path below is
repo-relative and no `working-directory` override is needed.

- [ ] Create `.github/workflows/ci.yml`:
  ```yaml
  name: CI

  on:
    pull_request:
      branches: [main]
    push:
      branches: [main]

  jobs:
    build-and-test:
      runs-on: ubuntu-latest
      steps:
        - name: Checkout
          uses: actions/checkout@v4

        - name: Set up Node
          uses: actions/setup-node@v4
          with:
            node-version: 20
            cache: npm
            cache-dependency-path: package-lock.json

        - name: Install dependencies
          run: npm ci

        - name: Lint
          run: npm run lint

        - name: Validate content
          run: node scripts/validate-content.mjs

        - name: Test
          run: npm test

        - name: Build
          run: npm run build
  ```
- [ ] Commit:
  ```
  git add .github/workflows/ci.yml
  git commit -m "ci(phase-1): add GitHub Actions workflow (lint, validate-content, test, build)"
  ```

**Manual verification:** push the branch (Task 11) and confirm the workflow run shows all
five steps green in the PR's Checks tab.

**Failure modes:**
- CI fails on `npm ci` with a lockfile-out-of-sync error — you installed a dependency
  locally without letting it update `package-lock.json`, or edited `package.json` by hand;
  run `npm install` locally once more and commit the resulting lockfile.
- CI fails on `npm run build` with a Supabase-related error that doesn't reproduce locally —
  check whether a route added after this task now imports `lib/supabase/*`; if so, this
  workflow's "no secrets needed" assumption (stated above) no longer holds and must be
  revisited, not worked around with a fake env var.
- Slow/failing Node setup cache — confirm `cache-dependency-path: package-lock.json`
  matches the lockfile at the repo root (it does — `cubad/` is the repo root).

---

## Task 11 — Push branch and open the PR

- [ ] Confirm the full local gate passes one more time before pushing:
  ```
  npm run lint
  node scripts/validate-content.mjs
  npm test
  npm run build
  ```
  All four must exit 0.
- [ ] Push:
  ```
  git push -u origin feat/phase-1-foundation
  ```
- [ ] Open a PR (GitHub CLI shown; web UI is equally fine):
  ```
  gh pr create --title "Phase 1: Foundation — Supabase project, schema, seed, CI" --body "$(cat <<'EOF'
  ## Summary
  - New Supabase project cubad-app (eu-central-1), CLI-linked, migrations scaffold.
  - Migration `initial_schema`: full target schema (master §4) with RLS enabled on every
    table; baseline policies for profiles/user_state/legacy_sync/admin_audit_log only.
  - lib/supabase/{browser,server,middleware}.ts (@supabase/ssr), unused by any route yet.
  - D15 env var matrix in .env.example; new vars added to Vercel (old sprout vars kept).
  - scripts/seed-content.mjs: idempotent seed of the 2 existing subjects / 19 units / 1
    track from content/*.json into the new schema.
  - Vitest harness + first test (scripts/seed-content.mjs's listUnitFiles).
  - GitHub Actions CI: lint, validate-content, test, build (no Supabase secrets needed).

  No production behavior changes — the live app still reads content/*.json and syncs
  against sprout until Phase 3's cutover.

  ## Test plan
  - [ ] CI green on this PR
  - [ ] `npx supabase db reset` succeeds locally
  - [ ] `npm run seed:content` run twice against cubad-app reports identical counts
  - [ ] Manual verification checklists in docs/plans/productization/01-foundation.md all checked
  EOF
  )"
  ```
- [ ] Do not merge until the phase acceptance checklist below is fully green and a human has
      reviewed the PR (this repo's normal review bar applies).

**Manual verification:** PR shows the 8 commits from Tasks 3–10 (Task 1/2 have no code
commits), CI green, no diff outside the files this doc touched.

**Failure modes:** if `gh pr create` fails with an auth error, use the GitHub web UI instead
— the branch is already pushed, so the PR can be opened manually against `main`.

---

## Phase acceptance checklist

- [ ] `npm run lint` passes.
- [ ] `npm run build` passes with zero Supabase env vars set in the build environment
      (proves CI parity — Task 10's "no secrets needed" claim holds).
- [ ] `node scripts/validate-content.mjs` passes (content untouched by this phase).
- [ ] `npx vitest run` passes (3/3 tests).
- [ ] `npx supabase db reset` succeeds against a completely fresh local database.
- [ ] Supabase dashboard: project `cubad-app` exists, region eu-central-1, status Active.
- [ ] Remote `cubad-app` has all 14 tables from master §4, all with RLS enabled; exactly the
      7 baseline policies from Task 6 exist (3 profiles, 3 user_state, 1 admin_audit_log);
      no policies exist on any other table.
- [ ] `npm run seed:content` run twice against `cubad-app` both times reports
      `Done. 2 subjects, 19 units.` with 1 track and 2 track_subjects rows.
- [ ] Vercel project has `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
      `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `ADMIN_NOTIFY_EMAIL`,
      `NEXT_PUBLIC_APP_URL` set (Production + Preview), and the legacy `SUPABASE_URL` /
      `SUPABASE_ANON_KEY` are still present, untouched.
- [ ] GitHub Actions CI is green on the `feat/phase-1-foundation` PR.
- [ ] Production (`main`, deployed to Vercel) is byte-identical in behavior to before this
      phase — no route imports `lib/supabase/*` yet, content still served from
      `content/*.json`.
- [ ] PR opened, reviewed, and (once approved) merged.

## Rollback

Phase 1 is low-risk by design: nothing in `main`/production reads the new schema, the new
Supabase project, or the new env vars yet (no route imports `lib/supabase/*`). Rollback is
therefore cheap at every level:

- **Before merge:** close the PR without merging. `main` and production are untouched.
  Delete the local branch (`git branch -D feat/phase-1-foundation`) if abandoning entirely.
- **After merge, code-level revert:** `git revert` the merge commit (or the individual
  commits from Tasks 3–10) and push — since nothing downstream depends on these files yet,
  a plain revert is safe.
- **Supabase project:** if `cubad-app` is abandoned, pause or delete it from the dashboard
  (Settings → General → Danger Zone). No production traffic ever depended on it in this
  phase, so there is no user-facing impact.
- **Vercel env vars:** the 6 new vars added in Task 4 are inert (unused by any route) and can
  be deleted from the Vercel dashboard with zero impact if rolling back. The legacy
  `SUPABASE_URL`/`SUPABASE_ANON_KEY` were never touched and need no action.
- **Local Supabase CLI state:** delete the `supabase/` directory, or run
  `npx supabase unlink` to disconnect the CLI from `cubad-app` without deleting the project.

## Changelog / deviations

- **2026-07-16 — post-audit fixes** (spec + adversarial + cross-doc seam audit; bound by
  master §14 "Post-audit contract registry", dated 2026-07-12):
  1. Corrected the baseline policy count from 6 to 7 (3 profiles, 3 user_state,
     1 admin_audit_log) in Task 6's manual verification and the phase acceptance checklist —
     the migration always defined three `user_state` policies; the counts were wrong, not
     the SQL.
  2. Task 5's `lib/supabase/server.ts` now also exports the canonical
     `createServiceRoleClient()` (master §14: the ONLY service-key touchpoint; no
     `lib/supabase/admin.ts`, no `createServiceClient`/`createAdminClient`), plus a matching
     verification bullet.
  3. Re-copied the `tiers` block in Task 6 from the updated master §4 — adds `scope_id uuid`
     and the `tiers_scope_target` check constraint.
  4. Widened `vitest.config.ts` `include` to `["**/*.test.ts", "**/*.test.tsx"]` so later
     phases' colocated tests are discovered (master §14).
  5. Reworded the session-refresh comments in Task 5 (`middleware.ts` helper doc comment and
     `server.ts` catch comment): Next 16's root request interceptor is `proxy.ts`, never a
     root `middleware.ts` (master §14).
  6. Repo-root question resolved: `cubad/` IS the git repo root (verified). Prerequisites,
     Task 1, and Task 10 rewritten from conditional to declarative; the CI
     `working-directory` fallback wording removed. Task 1 keeps the
     `git rev-parse --show-toplevel` sanity check.
  7. Added the SQL comment under `protect_profile_role()` that Phase 2 extends THAT function
     via `create or replace` (same function/trigger names) and no second parallel role-guard
     trigger may ever be installed (master §14).

