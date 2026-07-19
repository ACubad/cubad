# Phase 5 — Admin Dashboard

> **For agentic workers:** This is phase plan **05** of the cubad productization program. Read
> `00-MASTER-PLAN.md` FULLY before this document — §3 (locked decisions, esp. D11), §4 (schema —
> column names are LAW), §5 (canonical examples), §9 (security invariants) and §12 (authoring
> rules) govern everything below. Execute tasks **in order**, top to bottom. Tick each `- [ ]`
> box as you finish its step. Every code block is complete and copy-paste ready — there is no
> "TBD", no "similar to above". If you are a Claude Code session, use
> `superpowers:subagent-driven-development` and route migration/RLS tasks to **opus** subagents,
> audits to **opus two-pass** (spec compliance, then adversarial). If you are a solo agent,
> self-audit against master §8 + §9 after each task.

**Goal:** Ship `/admin` — the control center non-technical staff (starting with the site owner)
use to run the product day to day: publish/validate content without a redeploy, manage the
country/level catalog and paid tiers, look up and adjust individual users' access, generate
pre-paid access codes, watch a handful of KPIs, and read an audit trail of every privileged
action. This phase does **not** build the payments-claim review queue (Phase 6 owns that UI) —
it only reserves the nav slot and the badge-count seam for Phase 6 to hang its work on.

**Architecture:** Next.js 16 (App Router, RSC) on the `cubad-app` Supabase project, reusing every
data model Phases 1–4 already shipped (catalog, tiers, entitlements, access codes). `/admin` is a
Next.js route group with a server-side guard in its layout (`app/admin/layout.tsx`) — this is a
**UX** guard only; the real barrier is Postgres RLS (`public.is_admin()`, already delivered).
Every admin mutation in this phase is implemented as **one SECURITY DEFINER Postgres function**
that performs the write and inserts into `admin_audit_log` in the same call — Postgres function
bodies are atomic per invocation, which is how master §9's "same transaction" requirement is
actually satisfied (Supabase-js has no ad-hoc multi-statement client transaction API). A single
shared TS helper, `logAdminAction()`, wraps the equivalent RPC for the rare mutation that isn't
already wrapped in its own function. Content validation logic is extracted out of
`scripts/validate-content.mjs` into a real TypeScript module (`lib/content/validate.ts`) so the
admin upload UI and the CLI script share one implementation.

**Tech stack (unchanged from master):** Next.js 16.2.x · React 19 · Tailwind 4 · TypeScript 5 ·
Supabase (`@supabase/supabase-js` + `@supabase/ssr`) · Vitest · Postgres 15.

**Admin UI language — decision:** English only. `/admin` is operated by the site owner (admin),
not students; every other surface in this product is bilingual (`Bi`, `lib/i18n.tsx`) but that
system is deliberately **not** used inside `/admin` — plain English strings throughout. This is a
locked decision for this phase, not an oversight; do not wire `useLang()`/`t()`/`bi()` into any
file under `app/admin/` or `components/admin/`.

> **⚠ Next.js 16 is newer than your training data.** Before writing ANY Next.js code, read the
> relevant guide under `cubad/node_modules/next/dist/docs/` (repo policy — `AGENTS.md`). The
> guides used while authoring this plan, and why: `01-app/01-getting-started/07-mutating-data.md`
> and `01-app/02-guides/forms.md` (Server Actions, `.bind()` for extra args, `useActionState`),
> `01-app/02-guides/data-security.md` (every Server Action must re-verify auth — a page-level
> guard does not protect the actions it renders), `01-app/03-api-reference/04-functions/cookies.md`
> (`cookies()` is async), `01-app/03-api-reference/03-file-conventions/route-groups.md` (multiple
> root layouts — considered and deliberately **not** used here, see Prerequisites).

---

## Prerequisites

**Phase dependency:** Phase 4 (`04-catalog-tiers-access.md`) merged. Transitively this means
Phases 1–3 are also live: full schema + RLS (`public.is_admin()`, `public.has_subject_access()`),
Supabase Auth + profiles + onboarding, and Postgres-backed content with the unified
`SubjectHome`/`UnitPage` components.

**Confirmed artifact names from earlier phases** (verified by reading the actual phase-plan
files, not guessed — cite the line if you need to double-check):

| Symbol | Location | Confirmed by |
|---|---|---|
| `createClient()` — async, cookie-scoped, RLS-respecting Supabase client | `lib/supabase/server.ts` | `01-foundation.md` Task 5 |
| `is_admin()` — SECURITY DEFINER, reads `profiles.role`, `set search_path = public` | DB function | `01-foundation.md` Task 6 |
| `getSubjects`, `getSubject`, `getUnits`, `getUnit`, `toSubjectMeta(row): SubjectMeta`, `toUnit(row): Unit`, `revalidateContent(subjectSlug?: string): void` (sync) | `lib/content-db.ts` (flat file, not nested) | `03-content-db-unified-ui.md` |
| `SubjectHome({ subject, units })`, **`UnitPage({ subject, unit }: { subject: SubjectMeta; unit: Unit })`** | `components/SubjectHome.tsx`, `components/UnitPage.tsx` | `03-content-db-unified-ui.md` Task 8 |
| `generateCode(): string`, `normalizeCode(input: string): string`, `hashCode(normalized: string): string` (all sync) | `lib/access/codes.ts` | `04-catalog-tiers-access.md` Task 5 |
| Sign-in route (redirect target for unauthenticated visitors) | `/auth/sign-in` (accepts `?next=`) | `02-auth-profiles.md` Task 2.13 |
| `admin_audit_log` table: RLS **enabled, zero policies** (admin-select policy added by Task 2 below) | DB table | `01-foundation.md` Task 6 |
| `scripts/validate-content.mjs` exports `errors`, `warn`, `resetDiagnostics()`, `checkUnit(u, sectionOrder, where)`, plus 10 `check*`/`isBi` helpers (interim, shared-array based) | script | `03-content-db-unified-ui.md` Task 11 |
| `scripts/upsert-unit.mjs` — interim CLI publish path, imports the four names above from `./validate-content.mjs` | script | `03-content-db-unified-ui.md` Task 11 |
| `app/api/revalidate/route.ts` — `GET ?secret=...&subject=...`, calls `revalidateContent` | route | `03-content-db-unified-ui.md` Task 11 |

**Service-role client:** `createServiceRoleClient()` from `@/lib/supabase/server` per master
§14; all sibling docs comply. (This phase uses it in exactly **one file** — Task 7's draft
preview.)

**`profiles.email`:** added by THIS phase — Task 1 delivers the column, the backfill from
`auth.users`, and the trigger update (per master §14: "added by Phase 5, not Phase 2"). Phase 6
depends on Phase 5 and consumes the column as delivered.

**Required reading (repo files) before coding:**
`00-MASTER-PLAN.md` · `AGENTS.md` · `scripts/validate-content.mjs` (fully — Task 4 refactors it) ·
`lib/types.ts` (`Bi`, `Unit`, `SubjectMeta` shapes) · `components/ui.tsx` (existing primitives —
`DataTable` is the visual model for this phase's `AdminTable`) · `docs/DESIGN.md` (visual
language: warm paper, `deniz` accent, `font-display`) · `lib/i18n.tsx` (read it to confirm this
phase deliberately does **not** use it) · `app/globals.css` (color tokens: `paper card ink
ink-soft ink-faint line line-soft deniz deniz-deep deniz-soft wash amber amber-soft clay
clay-soft moss moss-soft`) · `app/layout.tsx` (the ONE existing root layout — see the nesting
decision below) · `docs/plans/productization/03-content-db-unified-ui.md` Tasks 8 and 11
(the components and interim scripts this phase builds directly on top of) · `docs/plans/
productization/04-catalog-tiers-access.md` Task 4 (the monetization RLS policies this phase's
admin actions run under).

**Design decision — `/admin` nests inside the existing single root layout, it does not get its
own.** Next.js supports multiple root layouts via route groups (see the route-groups guide cited
above), which would let `/admin` render without the public `<Header>`/`<Footer>`/`max-w-5xl`
constraint. This phase deliberately does **not** do that: it would require moving every existing
top-level page (`app/page.tsx`, `app/s/**`, and whatever `app/auth/**`/`app/onboarding/**`
Phase 2 added) into a route group, which this doc cannot safely author sight-unseen for files
owned by sibling phase docs. The accepted trade-off: the public `Header` (wordmark + language
toggle) still renders above `/admin/*`, and content sits inside the root layout's `max-w-5xl`
container. `app/admin/layout.tsx` claws back a little width with a negative margin and every wide
table gets its own `overflow-x-auto` wrapper. A fully separate admin shell is a reasonable later
polish item, not required now.

**Working-directory rule:** every command below runs from `cubad/`. Never run two `next build`/
`next dev` at once. `.env.local` stays gitignored.

**Branch:** all work in this phase happens on `feat/phase-5-admin-dashboard`, merged to `main`
via PR only at the end (last task). Pushing `main` auto-deploys.

---

## Task 0 — Branch, verify prerequisites

- [ ] Create and switch to the phase branch:
  ```bash
  git checkout main
  git pull
  git checkout -b feat/phase-5-admin-dashboard
  ```
- [ ] Confirm Phase 4 is actually merged and the DB objects it promises exist (the Supabase CLI
      has no `db execute` subcommand — master §14; `DB_URL` below is the project's Postgres
      connection string, from the dashboard's Connect panel, and is reused by every inline-SQL
      check in this doc):
  ```bash
  psql "$DB_URL" -c "select to_regprocedure('public.is_admin()') is not null as is_admin, to_regprocedure('public.has_subject_access(uuid)') is not null as has_access, to_regprocedure('public.redeem_code(text)') is not null as redeem;"
  ```
  Expected: all three columns `t`. If any is missing, **stop** — do not improvise a replacement;
  the phase you depend on isn't actually done yet. Record this in `## Changelog / deviations` and
  surface it to the human (master §11).
- [ ] Confirm the interim content-publish path from Phase 3 is present (this phase's Task 4
      edits it):
  ```bash
  grep -n "export function checkUnit" scripts/validate-content.mjs
  grep -n "checkUnit, errors, warn, resetDiagnostics" scripts/upsert-unit.mjs
  ```
  Expected: both greps print a match. If not, Phase 3's Task 11 hasn't landed — stop and record.
- [ ] Confirm the full gate is green before touching anything:
  ```bash
  npm run lint
  npx vitest run
  node scripts/validate-content.mjs
  npm run build
  ```
  Expected: all four succeed. This is your baseline — if Task N later breaks one of these, you
  broke it, not a prior phase.

**Manual verification:** `git status` shows a clean tree on the new branch before Task 1 starts.

**Failure modes:** `to_regprocedure` returns `null` instead of erroring on a missing function —
don't skip actually checking the boolean, a typo'd function name silently "passes" a `select`
that returns no rows only if you also check row count; the query above always returns exactly
one row of three booleans, so a `f` is unambiguous.

---

## Task 1 — Migration: `profiles.email` seam

The admin Users page (Task 10) needs to search and display student emails. `auth.users` is
Supabase's internal schema — not exposed via PostgREST, and reading it directly would require a
service-role client on every Users-page request (this phase deliberately uses service-role in
exactly one file, Task 7, not here). The standard, RLS-friendly fix: keep a denormalized copy of
the email on `public.profiles`, kept in sync by triggers on `auth.users`.

This task **extends** Phase 2's existing `public.handle_new_user()` function
(`02-auth-profiles.md` Task 2.4, trigger `on_auth_user_created`) rather than adding a competing
trigger — two `AFTER INSERT` triggers on the same table both trying to write the same new row
would depend on trigger-firing order (alphabetical by name in Postgres), which is fragile. Editing
the function body via `CREATE OR REPLACE` is safe and is **not** "editing an applied migration" —
it's a new migration that replaces a function's definition, exactly like Phase 3 and Phase 4 both
do to functions defined by earlier phases.

- [ ] Create the migration:
  ```bash
  npx supabase migration new profiles_email_seam
  ```
- [ ] Fill the generated file (`supabase/migrations/<ts>_profiles_email_seam.sql`). The
      `alter table` statement and the `sync_profile_email` function/trigger below are copy-paste
      ready. The `handle_new_user` replacement is a **MERGE, not a paste**: open Phase 2's
      **current** `handle_new_user` body in your migration history (the latest
      `create or replace` in migration order wins — Phase 2 created it in
      `<ts>_profile_on_signup_trigger.sql`; check whether any later migration replaced it again)
      and **ADD the email column to its insert (and to its on-conflict update, if one is
      present)** — do NOT paste this minimal body over a richer one, or you will silently drop
      whatever a later migration added to it. The SQL below shows the expected RESULT for the
      Phase-2-as-written baseline (whose body inserts only `(user_id)`):
  ```sql
  -- Phase 5 Task 1: denormalize auth.users.email onto public.profiles so the admin Users page
  -- (RLS-scoped, no service-role) can search/display it. See 05-admin-dashboard.md Task 1.
  alter table public.profiles add column if not exists email text not null default '';

  -- MERGE RESULT (see the instruction above this block): Phase 2's profile-creation function
  -- (02-auth-profiles.md Task 2.4) with the email copy ADDED to its insert + on-conflict
  -- update. If your migration history's current body is richer than the Phase-2 baseline,
  -- merge the email column into THAT body instead of using this one verbatim. Matches that
  -- function's exact style: `security definer`, `set search_path = ''`, fully-qualified names
  -- (search-path-hijacking hardening) — do not switch this one function to
  -- `search_path = public` just to match the rest of this file's new functions; match the
  -- function you are editing, not the neighbors you are adding.
  create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
  begin
    insert into public.profiles (user_id, email)
    values (new.id, new.email)
    on conflict (user_id) do update set email = excluded.email;
    return new;
  end;
  $$;
  -- Trigger `on_auth_user_created` already points at this function name (Phase 2 created it) —
  -- no trigger statement needs to change, only the function body above.

  -- Keep it in sync if a user's auth email ever changes (password reset flows, support-driven
  -- corrections). Phase 2 has no equivalent trigger for UPDATE, so this one is new, not an edit.
  create or replace function public.sync_profile_email()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
  begin
    update public.profiles set email = new.email where user_id = new.id;
    return new;
  end;
  $$;

  drop trigger if exists on_auth_user_email_updated on auth.users;
  create trigger on_auth_user_email_updated
    after update of email on auth.users
    for each row execute function public.sync_profile_email();

  -- Backfill rows created before this migration (every existing student, plus the Phase 1
  -- bootstrap admin row) whose email is still the '' column default.
  update public.profiles p
  set email = u.email
  from auth.users u
  where p.user_id = u.id and p.email = '';
  ```
- [ ] Apply and verify locally:
  ```bash
  npx supabase db reset
  ```
  Expected: every migration (Phases 1–5) applies cleanly from scratch.
- [ ] Apply to the live project:
  ```bash
  npx supabase db push
  ```
- [ ] Verify the backfill (`DB_URL` per Task 0's note):
  ```bash
  psql "$DB_URL" -c "select count(*) filter (where email = '') as still_blank, count(*) as total from public.profiles;"
  ```
  Expected: `still_blank` is `0` (unless a Supabase-internal system user with no email exists —
  investigate any nonzero count, don't wave it off).

**Manual verification:**
1. Sign up a brand-new test student account through the real signup flow. Confirm
   `select email from public.profiles where user_id = '<new-user-id>';` returns the email they
   signed up with, immediately (no delay, no manual step).
2. In the Supabase dashboard, edit that test user's email under Authentication → Users. Confirm
   `public.profiles.email` reflects the new value within a few seconds (trigger fires on save).

**Failure modes:**
- **Forgetting `on conflict (user_id) do update`:** if Phase 1's bootstrap-admin insert or a
  retried signup already created the row, a plain `insert` here raises a duplicate-key error and
  the whole signup fails. The `on conflict` clause is not optional.
- **Editing Phase 2's migration file instead of adding a new one:** never do this (master D1) —
  even though the net SQL effect is similar, `supabase db reset` replays migrations in order and
  editing history breaks anyone who already applied the old version.
- **`set search_path = public` instead of `''`** on `handle_new_user`: harmless functionally here
  since every reference is already schema-qualified, but it diverges from Phase 2's own file for
  no reason — keep it `''` to match what you're editing.

**Commit:**
```bash
git add supabase/migrations
git commit -m "phase-5: add profiles.email seam (backfill + signup/update sync triggers)"
```

---

## Task 2 — Admin route guard, left nav, bootstrap runbook

- [ ] Create `lib/admin/guard.ts`:
  ```ts
  import "server-only";
  import { redirect } from "next/navigation";
  import { createClient } from "@/lib/supabase/server";

  /**
   * Page/layout guard: redirects rather than throwing. This is the layout's UX guard — RLS
   * (is_admin()-gated policies, Phase 1) is the real barrier; a hand-crafted request that skips
   * this layout entirely still hits denied reads/writes at the database. See
   * 00-MASTER-PLAN.md D11 and node_modules/next/dist/docs/01-app/02-guides/data-security.md.
   */
  export async function requireAdminPage() {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/auth/sign-in?next=/admin");

    const { data: isAdmin, error } = await supabase.rpc("is_admin");
    if (error || !isAdmin) redirect("/");

    return { supabase, user };
  }

  /**
   * Server Action guard: throws instead of redirecting. Every Server Action in this phase calls
   * this FIRST, even though it is only ever wired up from an already-guarded /admin page —
   * Server Actions are reachable via direct POST requests regardless of which page rendered
   * them (see the data-security guide cited above, "Authentication and authorization"). This is
   * defense in depth alongside RLS, not a replacement for it.
   */
  export async function requireAdminAction() {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized: not signed in");

    const { data: isAdmin, error } = await supabase.rpc("is_admin");
    if (error || !isAdmin) throw new Error("Unauthorized: admin role required");

    return { supabase, user };
  }
  ```
- [ ] Create `components/admin/AdminNav.tsx`:
  ```tsx
  "use client";

  import Link from "next/link";
  import { usePathname } from "next/navigation";

  const ITEMS = [
    { href: "/admin", label: "Overview", exact: true },
    { href: "/admin/content", label: "Content" },
    { href: "/admin/catalog", label: "Catalog" },
    { href: "/admin/tiers", label: "Tiers" },
    { href: "/admin/users", label: "Users" },
    { href: "/admin/codes", label: "Codes" },
    { href: "/admin/payments", label: "Payments" }, // Phase 6 route — 404s until then, by design
    { href: "/admin/audit", label: "Audit log" },
  ] as const;

  export function AdminNav() {
    const pathname = usePathname() ?? "";

    return (
      <nav className="flex shrink-0 gap-1 overflow-x-auto sm:w-48 sm:flex-col sm:overflow-visible">
        {ITEMS.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-deniz text-white"
                  : "text-ink-soft hover:bg-wash hover:text-deniz-deep"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    );
  }
  ```
- [ ] Create `app/admin/layout.tsx`:
  ```tsx
  import type { ReactNode } from "react";
  import { requireAdminPage } from "@/lib/admin/guard";
  import { AdminNav } from "@/components/admin/AdminNav";

  export const metadata = {
    title: "cubad admin",
  };

  export default async function AdminLayout({ children }: { children: ReactNode }) {
    await requireAdminPage();

    return (
      <div className="-mx-4 flex min-h-[calc(100vh-8rem)] flex-col gap-6 sm:flex-row sm:items-start">
        <AdminNav />
        <div className="min-w-0 flex-1 rounded-xl border border-line bg-card p-4 sm:p-6">
          {children}
        </div>
      </div>
    );
  }
  ```
- [ ] Create a placeholder `app/admin/page.tsx` so the layout has something to guard end to end
      before Task 12 builds the real Overview page:
  ```tsx
  import { requireAdminPage } from "@/lib/admin/guard";

  export default async function AdminOverviewPage() {
    await requireAdminPage();
    return <p className="text-sm text-ink-soft">Overview KPIs land in Task 12.</p>;
  }
  ```
- [ ] `npm run build` — expect success. This is the first real compile of `/admin`; if it fails,
      fix it now before any later task adds more surface area on top of a broken guard.

### Admin bootstrap runbook

The very first admin has no admin to promote them — this is a one-time, human-run SQL step, not
application code.

- [ ] After `ahmedallycubad@gmail.com` has signed up and confirmed their email through the normal
      flow (Phase 2), run in the Supabase SQL editor (or `psql "$DB_URL"`, or MCP `execute_sql`):
  ```sql
  update public.profiles
  set role = 'admin'
  where user_id = (select id from auth.users where email = 'ahmedallycubad@gmail.com');
  ```
- [ ] Verify:
  ```sql
  select user_id, email, role from public.profiles where role = 'admin';
  ```
  Expected: exactly one row, `email` = `ahmedallycubad@gmail.com`, `role` = `admin`.
- [ ] Confirm end to end: sign in as that account in a browser, navigate to `/admin` — expect the
      placeholder Overview page, not a redirect to `/`.

**Manual verification:**
1. Sign in as a **different**, non-admin test student account, navigate to `/admin` — expect an
   immediate redirect to `/`.
2. Sign out entirely, navigate to `/admin` — expect a redirect to `/auth/sign-in?next=/admin`.

**Failure modes:**
- **`supabase.rpc("is_admin")` returns `{ data: null, error: {...} }`** for an anonymous session:
  this is expected (no JWT to read `auth.uid()` from) — the guard treats any error as "not admin"
  and redirects; do not change this to throw, an RPC error must fail closed.
- **Redirect loop between `/` and `/auth/sign-in`:** only happens if the public homepage itself
  requires auth (it shouldn't — master §2 "Unauthenticated visitors: catalog browsing only"). If
  you see this, the bug is in the homepage's guard, not this one.
- **Promoting the wrong row:** the bootstrap SQL's subquery returns zero rows (and thus updates
  zero rows, silently) if the email doesn't match exactly — always run the verify query
  immediately after, never assume the `update` succeeded from a lack of error alone.

**Commit:**
```bash
git add lib/admin/guard.ts components/admin/AdminNav.tsx app/admin/layout.tsx app/admin/page.tsx
git commit -m "phase-5: admin route guard, left nav, and bootstrap runbook"
```

---

## Task 3 — Shared admin infrastructure: audit helper, `AdminTable`, and the SQL mutation primitives

Every admin mutation in Tasks 5–11 follows one pattern: **one SECURITY DEFINER Postgres function
performs the write and calls a shared logging helper, in the same function invocation** — this is
how master §9 ("all admin mutations write `admin_audit_log` in the same transaction") is actually
satisfied, since a Postgres function body is atomic per call and Supabase-js has no client-side
multi-statement transaction API. Two generic functions (`admin_set_status`, `admin_revoke`) cover
every simple status-flag/revoke mutation across five tables; the rest (upserts, grants, code
generation) get one small dedicated function each in the task that needs them.

**Note on RLS reality, so the "why a function at all" question doesn't come up later:** some of
these tables already have an admin-all RLS policy (`04-catalog-tiers-access.md` Task 4 gives
`tiers` and `access_codes` `for all to authenticated using (public.is_admin())`), so an admin's
own session *could* write them directly. `entitlements` does **not** — that table has no
client-write policy at all, admin or not, by design ("Writes happen only inside SECURITY DEFINER
functions"). Routing every mutation through a function regardless of which case applies keeps one
pattern everywhere and gives the audit-log atomicity guarantee unconditionally.

**Action string convention** (restart of master §4's examples, applied consistently in this
phase — `entity.verb`, singular entity, lowercase):

| Action | Written by |
|---|---|
| `subject.create` / `subject.update` | `admin_upsert_subject` (Task 5) |
| `subject.publish` / `subject.unpublish` / `subject.archive` | `admin_set_status('subjects', ...)` (Task 5) |
| `unit.upsert` | `admin_upsert_unit` (Task 6) |
| `unit.publish` / `unit.unpublish` | `admin_set_status('units', ...)` (Task 6) |
| `unit.set_free` | `admin_set_unit_free` (Task 6) |
| `track.create` / `track.update` | `admin_upsert_track` (Task 8) |
| `track.publish` / `track.hide` | `admin_set_status('tracks', ...)` (Task 8) |
| `track.set_subjects` | `admin_set_track_subjects` (Task 8) |
| `tier.create` / `tier.update` | `admin_upsert_tier` (Task 9) |
| `tier.publish` / `tier.hide` | `admin_set_status('tiers', ...)` (Task 9) |
| `entitlement.grant` | `admin_grant_entitlement` (Task 10) |
| `entitlement.revoke` | `admin_revoke('entitlements', ...)` (Task 10) |
| `code.generate` | `admin_generate_codes` (Task 11) — matches master §4's own example verbatim |
| `code.revoke` | `admin_revoke('access_codes', ...)` (Task 11) |

- [ ] Create the migration:
  ```bash
  npx supabase migration new admin_audit_helpers
  ```
- [ ] Put this **complete** SQL in the generated file
      (`supabase/migrations/<ts>_admin_audit_helpers.sql`):
  ```sql
  -- Phase 5 Task 3: shared admin-mutation primitives. Every function below follows Phase 1's
  -- is_admin() convention exactly: `security definer`, `set search_path = public`, and
  -- schema-qualified names as belt-and-suspenders even though search_path already includes
  -- public (matches 01-foundation.md Task 6's style for is_admin()/protect_profile_role()).

  -- The single write path for admin_audit_log. There is no INSERT policy on that table for any
  -- role (Phase 1) — this function is the only way a row gets written, and it is the ONLY
  -- function in this migration that touches admin_audit_log directly; every other function
  -- below calls this one via `perform`, never inserts into the log table itself.
  create or replace function public.log_admin_action(
    p_action text,
    p_entity text,
    p_entity_id text,
    p_details jsonb default '{}'::jsonb
  )
  returns void
  language plpgsql
  security definer
  set search_path = public
  as $$
  begin
    if not public.is_admin() then
      raise exception 'not authorized';
    end if;

    insert into public.admin_audit_log (actor, action, entity, entity_id, details)
    values (auth.uid(), p_action, p_entity, p_entity_id, p_details);
  end;
  $$;

  -- Generic status-flag setter for the four tables whose lifecycle is just a `status` column
  -- (subjects/units/tracks/tiers). Table name is allow-listed via IF/ELSIF (never interpolated
  -- into dynamic SQL) — this is not a general-purpose "any table" function, it only knows these
  -- four, and an unknown table name raises rather than silently doing nothing.
  create or replace function public.admin_set_status(p_table text, p_id uuid, p_status text)
  returns void
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_entity text;
    v_verb text;
  begin
    if not public.is_admin() then
      raise exception 'not authorized';
    end if;

    if p_table = 'subjects' then
      update public.subjects set status = p_status, updated_at = now() where id = p_id;
      v_entity := 'subject';
    elsif p_table = 'units' then
      update public.units set status = p_status, updated_at = now() where id = p_id;
      v_entity := 'unit';
    elsif p_table = 'tracks' then
      update public.tracks set status = p_status where id = p_id;
      v_entity := 'track';
    elsif p_table = 'tiers' then
      update public.tiers set status = p_status where id = p_id;
      v_entity := 'tier';
    else
      raise exception 'admin_set_status: unsupported table %', p_table;
    end if;

    v_verb := case p_status
      when 'published' then 'publish'
      when 'draft' then 'unpublish'
      when 'archived' then 'archive'
      when 'hidden' then 'hide'
      else p_status
    end;

    perform public.log_admin_action(
      v_entity || '.' || v_verb, p_table, p_id::text, jsonb_build_object('status', p_status)
    );
  end;
  $$;

  -- Generic revoke setter for entitlements / access_codes (both use a nullable `revoked_at`
  -- timestamp). Accepts an array so the same function serves single-row and batch revoke —
  -- Task 11's codes-batch-revoke calls this with N ids, Task 10's single-entitlement-revoke
  -- calls it with a one-element array.
  create or replace function public.admin_revoke(p_table text, p_ids uuid[])
  returns void
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_entity text;
  begin
    if not public.is_admin() then
      raise exception 'not authorized';
    end if;

    if p_table = 'entitlements' then
      update public.entitlements set revoked_at = now() where id = any(p_ids) and revoked_at is null;
      v_entity := 'entitlement';
    elsif p_table = 'access_codes' then
      update public.access_codes set revoked_at = now() where id = any(p_ids) and revoked_at is null;
      v_entity := 'code';
    else
      raise exception 'admin_revoke: unsupported table %', p_table;
    end if;

    perform public.log_admin_action(
      v_entity || '.revoke', p_table, array_to_string(p_ids, ','),
      jsonb_build_object('count', coalesce(array_length(p_ids, 1), 0))
    );
  end;
  $$;

  grant execute on function public.log_admin_action(text, text, text, jsonb) to authenticated;
  grant execute on function public.admin_set_status(text, uuid, text) to authenticated;
  grant execute on function public.admin_revoke(text, uuid[]) to authenticated;
  ```
- [ ] Apply:
  ```bash
  npx supabase db reset
  npx supabase db push
  ```
- [ ] Smoke-test as the bootstrap admin (SQL editor, signed in as that user via `supabase.auth`,
      or via `psql "$DB_URL"` which runs as the postgres role and will pass the `is_admin()` check
      trivially — for a REAL negative-path check, see Task 14):
  ```sql
  select public.log_admin_action('subject.update', 'subjects', gen_random_uuid()::text, '{"test":true}'::jsonb);
  select action, entity, details from public.admin_audit_log order by created_at desc limit 1;
  ```
  Expected: the second query shows the row you just wrote.
- [ ] Create `lib/admin/audit.ts`:
  ```ts
  import "server-only";
  import type { SupabaseClient } from "@supabase/supabase-js";

  /**
   * Shared write path for public.admin_audit_log. Most mutations in this phase are implemented
   * as a single SECURITY DEFINER SQL function (admin_set_status, admin_upsert_unit, ...) that
   * performs the write AND calls public.log_admin_action(...) internally, in the SAME function
   * invocation — Postgres function bodies are atomic per call, so the mutation and its audit row
   * commit or roll back together (00-MASTER-PLAN.md §9: "All admin mutations write
   * admin_audit_log in the same transaction"). Two separate JS round trips (mutate, then log)
   * could not give that guarantee — a crash between them would leave a mutation with no audit
   * trail.
   *
   * This helper wraps the SAME public.log_admin_action RPC for the rare page action that isn't
   * wrapped in its own SQL function. Call it immediately after the mutation succeeds, inside the
   * same server action, and always propagate its error (never swallow it) — a write that
   * "succeeded" with no audit trail is a compliance bug, not a UX nicety.
   */
  export async function logAdminAction(
    supabase: SupabaseClient,
    action: string,
    entity: string,
    entityId: string | null,
    details: Record<string, unknown> = {}
  ): Promise<void> {
    const { error } = await supabase.rpc("log_admin_action", {
      p_action: action,
      p_entity: entity,
      p_entity_id: entityId,
      p_details: details,
    });
    if (error) throw new Error(`admin_audit_log write failed: ${error.message}`);
  }
  ```
- [ ] Create `components/admin/AdminTable.tsx` (a Server Component — no hooks, no `"use client"`;
      `render` callbacks may return `<form>`s calling Server Actions, which render fine from a
      Server Component):
  ```tsx
  import type { ReactNode } from "react";

  export interface AdminTableColumn<T> {
    key: string;
    header: string;
    render: (row: T) => ReactNode;
    className?: string;
  }

  export function AdminTable<T>({
    columns,
    rows,
    rowKey,
    emptyMessage = "Nothing here yet.",
  }: {
    columns: AdminTableColumn<T>[];
    rows: T[];
    rowKey: (row: T) => string;
    emptyMessage?: string;
  }) {
    if (rows.length === 0) {
      return (
        <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-ink-faint">
          {emptyMessage}
        </p>
      );
    }

    return (
      <div className="overflow-x-auto rounded-xl border border-line bg-card">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-line bg-wash/70">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`whitespace-nowrap px-3 py-2 text-left font-semibold text-deniz-deep ${col.className ?? ""}`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-line-soft last:border-0 hover:bg-wash/40">
                {columns.map((col) => (
                  <td key={col.key} className={`px-3 py-2 align-top ${col.className ?? ""}`}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  ```
  This is the ONE table component for the whole phase — every later task imports it from
  `@/components/admin/AdminTable` rather than redefining a table.
- [ ] `npm run build` — expect success (no consumers yet, but confirms the new files typecheck
      and bundle cleanly).

**Manual verification:** re-run the SQL smoke test above; also try calling
`select public.admin_set_status('users', gen_random_uuid(), 'x');` (an unsupported table name) —
expect the function to raise `admin_set_status: unsupported table users`, not silently no-op.

**Failure modes:**
- **`grant execute` forgotten:** without it, `authenticated` role users get
  `permission denied for function log_admin_action` even though the function's own `is_admin()`
  check would have let them through — RPC calls need both the Postgres `EXECUTE` grant AND the
  function's internal check; neither alone is sufficient.
- **Calling `admin_set_status`/`admin_revoke` with a table name typo:** fails loudly (`raise
  exception`), which is correct — resist the temptation to make the `else` branch a silent no-op,
  that would hide bugs in every later task that calls these.
- **Forgetting `perform` (vs `select`) when calling `log_admin_action` from inside another
  function:** `log_admin_action` returns `void`; PL/pgSQL requires `perform`, not a bare function
  call, when you discard the (nonexistent) return value.

**Commit:**
```bash
git add supabase/migrations lib/admin/audit.ts components/admin/AdminTable.tsx
git commit -m "phase-5: shared admin mutation primitives (log_admin_action, admin_set_status, admin_revoke) + AdminTable"
```

---

## Task 4 — Validation module extraction: `lib/content/validate.ts`

**Context on what already exists here, so this task doesn't look redundant with Phase 3's own
work:** Phase 3's Task 11 already pulled the `check*` functions out of the CLI-only tail of
`scripts/validate-content.mjs` and exported them (plus a `checkUnit(u, sectionOrder, where)`
dispatcher, `errors`/`warn` module-level arrays, and `resetDiagnostics()`) so its own interim
`scripts/upsert-unit.mjs` could reuse them. That was the right quick fix for Phase 3's scope, but
the logic still *lives in a script* — a `scripts/` file is the wrong home for something a Next.js
admin server action needs to import, and shared mutable module-level arrays (`errors`, `warn`)
are a real hazard if anything ever calls this from a long-running server process concurrently.
This task moves the actual logic into `lib/content/validate.ts` as **pure functions** (an explicit
accumulator object threaded through every call, no module-level state), and turns
`scripts/validate-content.mjs` into a thin wrapper around it — this is the "script becomes a thin
wrapper" the task brief asks for. Critically, `scripts/validate-content.mjs` keeps its **exact
existing exports** (`errors`, `warn`, `resetDiagnostics`, `checkUnit`, the ten `check*`/`isBi`
helpers) as adapters over the new module, so `scripts/upsert-unit.mjs` (Phase 3, not touched by
this task) keeps working byte-for-byte unchanged.

**Which functions move, concretely:** every function in `scripts/validate-content.mjs` except the
CLI-only tail (the `isMain` block that walks `content/` and calls `console.log`/`process.exit`)
moves to `lib/content/validate.ts`, rewritten to take an explicit `ctx: { errors: string[]; warn:
string[] }` parameter instead of closing over module-level `errors`/`warn` arrays: `isBi` (pure,
no ctx needed), `checkBi`, `checkMcq`, `checkControlChars`, `walkStrings` (pure, no ctx), `checkChart`,
`checkStory`, `checkWalkthroughQuestions`, `checkWalkthroughUnit`, `checkStudyUnit`, and a new
top-level export `validateUnit(sectionOrder, unit, where?)` that does the top-level checks
(`unit`/`slug`/`title`/`tagline`) the original CLI loop used to do inline, then branches on
`sectionOrder`, then runs `walkStrings` for control-char warnings — this is the single public
entry point everything else in this phase calls.

- [ ] Add the `tsx` dev dependency (lets a `node scripts/...mjs` process import a `.ts` file
      without changing the CLI invocation — see below):
  ```bash
  npm install -D tsx
  ```
- [ ] Create `lib/content/validate.ts`:
  ```ts
  import type { Bi } from "@/lib/types";

  export interface ValidationResult {
    errors: string[];
    warnings: string[];
  }

  interface Ctx {
    errors: string[];
    warn: string[];
  }

  function isBi(v: unknown): v is Bi {
    return (
      !!v &&
      typeof v === "object" &&
      typeof (v as Bi).tr === "string" &&
      (v as Bi).tr.trim().length > 0 &&
      typeof (v as Bi).en === "string" &&
      (v as Bi).en.trim().length > 0
    );
  }

  function checkBi(v: unknown, where: string, ctx: Ctx) {
    if (!isBi(v)) ctx.errors.push(`${where}: missing/empty tr+en pair`);
  }

  function checkMcq(m: any, where: string, ctx: Ctx) {
    checkBi(m?.q, `${where}.q`, ctx);
    if (!Array.isArray(m?.options) || m.options.length < 2) {
      ctx.errors.push(`${where}.options: need >=2`);
    } else {
      m.options.forEach((o: unknown, i: number) => checkBi(o, `${where}.options[${i}]`, ctx));
    }
    if (!Number.isInteger(m?.correct) || m.correct < 0 || m.correct >= (m?.options?.length ?? 0)) {
      ctx.errors.push(`${where}.correct: out of range`);
    }
    checkBi(m?.explain, `${where}.explain`, ctx);
  }

  // LaTeX sequences that JSON-decoded into control characters ("\t", "\n", "\f", "\b", "\r"
  // inside math like \frac -> \f + "rac") are the classic authoring bug — this is a WARNING, not
  // a hard error, matching the original script's behavior exactly (do not "upgrade" it to an
  // error; it's a heuristic, not a schema violation).
  function checkControlChars(s: unknown, where: string, ctx: Ctx) {
    if (typeof s !== "string") return;
    if (/[\t\f\b\r]|\n(?=[a-z]+\b)/.test(s.replace(/\n\n/g, ""))) {
      const m = s.match(/.{0,12}[\t\f\b].{0,12}/);
      if (m) {
        ctx.warn.push(`${where}: suspicious control char near "${m[0].replace(/[\t\f\b\r\n]/g, "⏎")}"`);
      }
    }
  }

  function walkStrings(obj: unknown, where: string, fn: (s: string, where: string) => void) {
    if (typeof obj === "string") fn(obj, where);
    else if (Array.isArray(obj)) obj.forEach((v, i) => walkStrings(v, `${where}[${i}]`, fn));
    else if (obj && typeof obj === "object") {
      Object.entries(obj as Record<string, unknown>).forEach(([k, v]) =>
        walkStrings(v, `${where}.${k}`, fn)
      );
    }
  }

  function checkChart(c: any, where: string, ctx: Ctx) {
    if (!["bar", "line"].includes(c?.type)) ctx.errors.push(`${where}.type`);
    if (!isBi(c?.title)) ctx.errors.push(`${where}.title`);
    (c?.series ?? []).forEach((s: any, si: number) => {
      if (
        !Array.isArray(s?.points) ||
        s.points.some(
          (p: unknown) =>
            !Array.isArray(p) || p.length !== 2 || p.some((n) => typeof n !== "number" || !isFinite(n))
        )
      ) {
        ctx.errors.push(`${where}.series[${si}].points: non-numeric`);
      }
    });
    if (c?.howToDraw && !isBi(c.howToDraw)) ctx.errors.push(`${where}.howToDraw`);
    if (c?.whatItShows && !isBi(c.whatItShows)) ctx.errors.push(`${where}.whatItShows`);
  }

  function checkStory(s: any, where: string, ctx: Ctx) {
    if (!isBi(s?.title)) ctx.errors.push(`${where}.title`);
    if (
      !Array.isArray(s?.xDomain) || s.xDomain.length !== 2 ||
      !Array.isArray(s?.yDomain) || s.yDomain.length !== 2
    ) {
      ctx.errors.push(`${where}: xDomain/yDomain must be [min,max]`);
    }
    if (!Array.isArray(s?.frames) || s.frames.length < 2) {
      ctx.errors.push(`${where}: needs >=2 frames`);
    }
    (s?.frames ?? []).forEach((fr: any, fi: number) => {
      if (!isBi(fr?.caption)) ctx.errors.push(`${where}.frames[${fi}].caption`);
      if (!Array.isArray(fr?.add)) ctx.errors.push(`${where}.frames[${fi}].add`);
      (fr?.add ?? []).forEach((el: any, ei: number) => {
        const EW = `${where}.frames[${fi}].add[${ei}]`;
        if (!["point", "line", "polyline", "polygon", "text", "arrow"].includes(el?.type)) {
          ctx.errors.push(`${EW}.type "${el?.type}"`);
        }
        if (el?.type === "point" && (typeof el.x !== "number" || typeof el.y !== "number")) {
          ctx.errors.push(`${EW}: point needs x,y`);
        }
        if (
          (el?.type === "line" || el?.type === "arrow") &&
          [el.x1, el.y1, el.x2, el.y2].some((n) => typeof n !== "number")
        ) {
          ctx.errors.push(`${EW}: needs x1,y1,x2,y2`);
        }
        if (
          (el?.type === "polyline" || el?.type === "polygon") &&
          (!Array.isArray(el.points) || el.points.some((p: unknown) => !Array.isArray(p) || p.length !== 2))
        ) {
          ctx.errors.push(`${EW}: needs points[][]`);
        }
        if (
          el?.type === "text" &&
          (typeof el.x !== "number" || typeof el.y !== "number" || !(isBi(el.text) || typeof el.label === "string"))
        ) {
          ctx.errors.push(`${EW}: text needs x,y,text`);
        }
        if (el?.color && !["ink", "deniz", "clay", "amber", "moss", "faint"].includes(el.color)) {
          ctx.errors.push(`${EW}.color "${el.color}"`);
        }
      });
    });
  }

  /** Shared by both kinds' optional `questions` (hydrology-style walkthrough Question rules). */
  function checkWalkthroughQuestions(u: any, W: string, ids: Set<string>, ctx: Ctx) {
    (u?.questions ?? []).forEach((q: any, qi: number) => {
      const QW = `${W}.q[${q?.id ?? qi}]`;
      if (typeof q?.id !== "string" || !/^\d+-\d+[a-z]?$/.test(q.id)) ctx.errors.push(`${QW}: bad id "${q?.id}"`);
      if (ids.has(q?.id)) ctx.errors.push(`${QW}: duplicate id`);
      ids.add(q?.id);
      if (typeof q?.code !== "string") ctx.errors.push(`${QW}: missing code`);
      checkBi(q?.title, `${QW}.title`, ctx);
      if (![1, 2, 3].includes(q?.difficulty)) ctx.errors.push(`${QW}: difficulty`);
      if (!["high", "medium", "low"].includes(q?.examLikelihood)) ctx.errors.push(`${QW}: examLikelihood`);
      checkBi(q?.statement, `${QW}.statement`, ctx);
      checkBi(q?.goal, `${QW}.goal`, ctx);
      (q?.given ?? []).forEach((g: any, i: number) => {
        if (typeof g?.symbol !== "string" || typeof g?.value !== "string") ctx.errors.push(`${QW}.given[${i}]`);
        checkBi(g?.label, `${QW}.given[${i}].label`, ctx);
      });
      (q?.tables ?? []).forEach((tb: any, i: number) => {
        if (!Array.isArray(tb?.headers) || !Array.isArray(tb?.rows)) {
          ctx.errors.push(`${QW}.tables[${i}]: headers/rows`);
        } else {
          tb.rows.forEach((r: unknown, ri: number) => {
            if (!Array.isArray(r)) ctx.errors.push(`${QW}.tables[${i}].rows[${ri}]`);
          });
        }
      });
      if (q?.chart) checkChart(q.chart, `${QW}.chart`, ctx);
      (q?.charts ?? []).forEach((c: any, ci: number) => checkChart(c, `${QW}.charts[${ci}]`, ctx));
      if (!Array.isArray(q?.steps) || q.steps.length < 2) ctx.errors.push(`${QW}: needs >=2 steps`);
      (q?.steps ?? []).forEach((s: any, si: number) => {
        const SW = `${QW}.steps[${si}]`;
        checkBi(s?.title, `${SW}.title`, ctx);
        checkBi(s?.guiding, `${SW}.guiding`, ctx);
        checkBi(s?.hint, `${SW}.hint`, ctx);
        checkBi(s?.work, `${SW}.work`, ctx);
        checkBi(s?.why, `${SW}.why`, ctx);
        if (s?.check) checkMcq(s.check, `${SW}.check`, ctx);
        if (s?.chart) checkChart(s.chart, `${SW}.chart`, ctx);
        if (s?.story) checkStory(s.story, `${SW}.story`, ctx);
      });
      checkBi(q?.finalAnswer, `${QW}.finalAnswer`, ctx);
      (q?.traps ?? []).forEach((tr: unknown, i: number) => checkBi(tr, `${QW}.traps[${i}]`, ctx));
      if (!Array.isArray(q?.whatIfs) || q.whatIfs.length < 1) ctx.warn.push(`${QW}: no whatIfs`);
      (q?.whatIfs ?? []).forEach((wi: any, i: number) => {
        checkBi(wi?.scenario, `${QW}.whatIfs[${i}].scenario`, ctx);
        checkBi(wi?.answer, `${QW}.whatIfs[${i}].answer`, ctx);
      });
    });
  }

  function checkWalkthroughUnit(u: any, W: string, ctx: Ctx): number {
    if (!Array.isArray(u?.questions) || u.questions.length === 0) ctx.errors.push(`${W}: no questions`);

    checkBi(u?.concept?.overview, `${W}.concept.overview`, ctx);
    (u?.concept?.keyFormulas ?? []).forEach((kf: any, i: number) => {
      checkBi(kf?.name, `${W}.keyFormulas[${i}].name`, ctx);
      if (typeof kf?.latex !== "string" || !kf.latex.trim()) ctx.errors.push(`${W}.keyFormulas[${i}].latex missing`);
      checkBi(kf?.meaning, `${W}.keyFormulas[${i}].meaning`, ctx);
      checkBi(kf?.whenToUse, `${W}.keyFormulas[${i}].whenToUse`, ctx);
    });
    (u?.concept?.traps ?? []).forEach((tr: unknown, i: number) => checkBi(tr, `${W}.concept.traps[${i}]`, ctx));

    const ids = new Set<string>();
    checkWalkthroughQuestions(u, W, ids, ctx);

    if (!Array.isArray(u?.quiz) || u.quiz.length < 4) ctx.warn.push(`${W}: quiz has <4 items`);
    (u?.quiz ?? []).forEach((m: any, i: number) => checkMcq(m, `${W}.quiz[${i}]`, ctx));

    return (u?.questions ?? []).length;
  }

  function checkStudyUnit(u: any, W: string, ctx: Ctx) {
    if (!u?.sources || typeof u.sources !== "object") {
      ctx.errors.push(`${W}.sources: missing`);
    } else {
      if (!Array.isArray(u.sources.videos)) ctx.errors.push(`${W}.sources.videos: must be array`);
      else {
        u.sources.videos.forEach((v: any, i: number) => {
          if (typeof v?.id !== "string" || !v.id.trim()) ctx.errors.push(`${W}.sources.videos[${i}].id`);
          if (typeof v?.title !== "string" || !v.title.trim()) ctx.errors.push(`${W}.sources.videos[${i}].title`);
          if (typeof v?.length !== "string" || !v.length.trim()) ctx.errors.push(`${W}.sources.videos[${i}].length`);
        });
      }
      if (!Array.isArray(u.sources.pdfs)) ctx.errors.push(`${W}.sources.pdfs: must be array`);
      else {
        u.sources.pdfs.forEach((p: unknown, i: number) => {
          if (typeof p !== "string" || !p.trim()) ctx.errors.push(`${W}.sources.pdfs[${i}]`);
        });
      }
    }

    const noteIds = new Set<string>();
    if (!Array.isArray(u?.notes) || u.notes.length < 4) ctx.errors.push(`${W}.notes: need >=4`);
    (u?.notes ?? []).forEach((n: any, i: number) => {
      const NW = `${W}.notes[${i}]`;
      if (typeof n?.id !== "string" || !/^n\d+$/.test(n.id)) ctx.errors.push(`${NW}.id: bad id "${n?.id}"`);
      if (noteIds.has(n?.id)) ctx.errors.push(`${NW}.id: duplicate`);
      noteIds.add(n?.id);
      checkBi(n?.title, `${NW}.title`, ctx);
      checkBi(n?.body, `${NW}.body`, ctx);
      if (n?.story) checkStory(n.story, `${NW}.story`, ctx);
    });

    const cardIds = new Set<string>();
    if (!Array.isArray(u?.flashcards) || u.flashcards.length < 20) ctx.errors.push(`${W}.flashcards: need >=20`);
    (u?.flashcards ?? []).forEach((c: any, i: number) => {
      const CW = `${W}.flashcards[${i}]`;
      if (typeof c?.id !== "string" || !c.id.trim()) ctx.errors.push(`${CW}.id`);
      if (cardIds.has(c?.id)) ctx.errors.push(`${CW}.id: duplicate`);
      cardIds.add(c?.id);
      checkBi(c?.front, `${CW}.front`, ctx);
      checkBi(c?.back, `${CW}.back`, ctx);
      if (typeof c?.en !== "string" || !c.en.trim()) ctx.errors.push(`${CW}.en: empty`);
      if (typeof c?.tag !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.tag)) {
        ctx.errors.push(`${CW}.tag: not kebab-case "${c?.tag}"`);
      }
    });

    const practiceIds = new Set<string>();
    const coversSeen = new Set<string>();
    if (!Array.isArray(u?.practice) || u.practice.length < 15) ctx.errors.push(`${W}.practice: need >=15`);
    (u?.practice ?? []).forEach((p: any, i: number) => {
      const PW = `${W}.practice[${i}]`;
      if (typeof p?.id !== "string" || !p.id.trim()) ctx.errors.push(`${PW}.id`);
      if (practiceIds.has(p?.id)) ctx.errors.push(`${PW}.id: duplicate`);
      practiceIds.add(p?.id);
      if (!["mcq", "open"].includes(p?.type)) ctx.errors.push(`${PW}.type`);
      checkBi(p?.q, `${PW}.q`, ctx);
      if (![1, 2, 3].includes(p?.difficulty)) ctx.errors.push(`${PW}.difficulty`);
      if (!Array.isArray(p?.covers) || p.covers.length === 0) {
        ctx.errors.push(`${PW}.covers: need >=1`);
      } else {
        p.covers.forEach((cid: string) => {
          if (!noteIds.has(cid)) ctx.errors.push(`${PW}.covers: "${cid}" not a note id`);
          coversSeen.add(cid);
        });
      }
      if (p?.type === "mcq") {
        if (!Array.isArray(p.options) || p.options.length !== 4) ctx.errors.push(`${PW}.options: need exactly 4`);
        else p.options.forEach((o: unknown, oi: number) => checkBi(o, `${PW}.options[${oi}]`, ctx));
        if (!Number.isInteger(p.correct) || p.correct < 0 || p.correct >= (p.options?.length ?? 0)) {
          ctx.errors.push(`${PW}.correct: out of range`);
        }
        checkBi(p.explain, `${PW}.explain`, ctx);
      } else if (p?.type === "open") {
        checkBi(p.answer, `${PW}.answer`, ctx);
      }
    });

    for (const nid of noteIds) {
      if (!coversSeen.has(nid)) ctx.warn.push(`${W}: note "${nid}" is never covered by any practice item`);
    }

    if (u?.questions) {
      const ids = new Set<string>();
      checkWalkthroughQuestions(u, W, ids, ctx);
    }
  }

  /**
   * The single public entry point. Validates one already-parsed unit object against its
   * subject's schema. Pure — no module-level state, safe to call concurrently from multiple
   * requests (each call gets its own `ctx`).
   */
  export function validateUnit(
    sectionOrder: "walkthrough" | "study",
    unit: unknown,
    where = "unit"
  ): ValidationResult & { questionCount: number } {
    const ctx: Ctx = { errors: [], warn: [] };
    const u = unit as any;

    if (!Number.isInteger(u?.unit)) ctx.errors.push(`${where}: unit must be int`);
    if (typeof u?.slug !== "string" || !/^[a-z0-9-]+$/.test(u.slug)) ctx.errors.push(`${where}: bad slug`);
    checkBi(u?.title, `${where}.title`, ctx);
    checkBi(u?.tagline, `${where}.tagline`, ctx);

    let questionCount = 0;
    if (sectionOrder === "walkthrough") {
      questionCount = checkWalkthroughUnit(u, where, ctx);
    } else if (sectionOrder === "study") {
      checkStudyUnit(u, where, ctx);
    } else {
      ctx.errors.push(`${where}: unknown section_order "${sectionOrder}"`);
    }

    walkStrings(u, where, (s, w) => checkControlChars(s, w, ctx));

    return { errors: ctx.errors, warnings: ctx.warn, questionCount };
  }
  ```
- [ ] Replace `scripts/validate-content.mjs` in full with this thin wrapper (preserves every
      existing export name `scripts/upsert-unit.mjs` depends on):
  ```js
  // Validates content/subjects.json and content/<subject>/unit-*.json against the app's schema.
  // Thin CLI wrapper: I/O + reporting only. The actual structural checks live in
  // lib/content/validate.ts (Phase 5 moved them out of this file so the admin upload UI —
  // 05-admin-dashboard.md Task 6 — can import the same checks a Next.js server action needs).
  // This file keeps its ORIGINAL exports (errors, warn, resetDiagnostics, checkUnit, and the ten
  // check*/isBi helpers) as thin adapters, because scripts/upsert-unit.mjs (Phase 3) already
  // imports them by these exact names — do not rename them without also updating that file.
  //
  // Node can't import a .ts file directly; registering tsx's ESM loader here keeps the CLI
  // invocation exactly `node scripts/validate-content.mjs` (00-MASTER-PLAN.md §8 names this
  // command verbatim — changing it would break every phase doc that references it).
  import { register } from "node:module";
  import { pathToFileURL } from "node:url";
  register("tsx/esm", pathToFileURL("./"));

  import fs from "node:fs";
  import path from "node:path";
  const V = await import("../lib/content/validate.ts");

  export const errors = [];
  export const warn = [];
  export function resetDiagnostics() {
    errors.length = 0;
    warn.length = 0;
  }
  /** Adapter: the new module is pure (returns {errors, warnings}); this file's existing
   *  consumer (scripts/upsert-unit.mjs) expects side effects on the shared errors/warn arrays
   *  instead — call resetDiagnostics() first, same as before. */
  export function checkUnit(u, sectionOrder, where) {
    const result = V.validateUnit(sectionOrder, u, where);
    errors.push(...result.errors);
    warn.push(...result.warnings);
  }
  export const isBi = V.isBi;
  export const checkBi = V.checkBi;
  export const checkMcq = V.checkMcq;
  export const checkControlChars = V.checkControlChars;
  export const walkStrings = V.walkStrings;
  export const checkChart = V.checkChart;
  export const checkStory = V.checkStory;
  export const checkWalkthroughQuestions = V.checkWalkthroughQuestions;
  export const checkWalkthroughUnit = V.checkWalkthroughUnit;
  export const checkStudyUnit = V.checkStudyUnit;

  const CONTENT_DIR = path.join(process.cwd(), "content");
  const SUBJECTS_FILE = path.join(CONTENT_DIR, "subjects.json");
  const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;

  if (isMain) {
    const subjects = fs.existsSync(SUBJECTS_FILE)
      ? JSON.parse(fs.readFileSync(SUBJECTS_FILE, "utf-8"))
      : [];

    if (subjects.length === 0) {
      console.error("no subjects found in content/subjects.json");
      process.exit(1);
    }

    let totalFiles = 0;
    let totalQuestions = 0;

    for (const subject of subjects) {
      const dir = path.join(CONTENT_DIR, subject.slug);
      if (!fs.existsSync(dir)) {
        errors.push(`content/${subject.slug}: directory missing`);
        continue;
      }
      const files = fs
        .readdirSync(dir)
        .filter((f) => /^unit-\d+\.json$/.test(f))
        .sort();

      if (files.length === 0) {
        errors.push(`content/${subject.slug}: no unit files found`);
        continue;
      }

      for (const f of files) {
        totalFiles++;
        let u;
        try {
          u = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
        } catch (e) {
          errors.push(`${subject.slug}/${f}: JSON parse error: ${e.message}`);
          continue;
        }
        const W = `${subject.slug}/${f.replace(".json", "")}`;
        checkUnit(u, subject.kind, W);
        if (subject.kind === "walkthrough") totalQuestions += (u.questions ?? []).length;
      }
    }

    console.log(`checked ${subjects.length} subjects, ${totalFiles} files, ${totalQuestions} walkthrough questions`);
    if (warn.length) {
      console.log(`\n${warn.length} warnings:`);
      warn.slice(0, 40).forEach((w) => console.log("  ⚠ " + w));
    }
    if (errors.length) {
      console.error(`\n${errors.length} ERRORS:`);
      errors.slice(0, 60).forEach((e) => console.error("  ✗ " + e));
      process.exit(1);
    }
    console.log("content OK");
  }
  ```
- [ ] `node scripts/validate-content.mjs` — expect **identical output** to before this edit (same
      "checked 2 subjects, N files, M walkthrough questions" summary, same warnings, exit 0).
      This is the regression check for the refactor.
- [ ] Create `lib/content/validate.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { validateUnit } from "./validate";

  const bi = (tr: string, en: string) => ({ tr, en });

  function validWalkthroughUnit() {
    return {
      unit: 1,
      slug: "test-unit",
      title: bi("Test Konu", "Test Unit"),
      tagline: bi("Kısa açıklama", "Short blurb"),
      concept: { overview: bi("Genel bakış", "Overview"), keyFormulas: [], traps: [] },
      questions: [
        {
          id: "1-1",
          code: "Q1",
          title: bi("Soru 1", "Question 1"),
          difficulty: 1,
          examLikelihood: "medium",
          statement: bi("İfade", "Statement"),
          given: [],
          goal: bi("Amaç", "Goal"),
          steps: [
            {
              title: bi("Adım 1", "Step 1"),
              guiding: bi("Yönlendirme", "Guiding"),
              hint: bi("İpucu", "Hint"),
              work: bi("İşlem", "Work"),
              why: bi("Neden", "Why"),
            },
            {
              title: bi("Adım 2", "Step 2"),
              guiding: bi("Yönlendirme 2", "Guiding 2"),
              hint: bi("İpucu 2", "Hint 2"),
              work: bi("İşlem 2", "Work 2"),
              why: bi("Neden 2", "Why 2"),
            },
          ],
          finalAnswer: bi("Sonuç", "Final answer"),
          traps: [],
          whatIfs: [{ scenario: bi("Senaryo", "Scenario"), answer: bi("Cevap", "Answer") }],
        },
      ],
      quiz: [],
    };
  }

  describe("validateUnit — valid fixture", () => {
    it("passes with zero errors (a <4-item quiz is only a warning)", () => {
      const result = validateUnit("walkthrough", validWalkthroughUnit());
      expect(result.errors).toEqual([]);
      expect(result.warnings.some((w) => w.includes("quiz has <4 items"))).toBe(true);
      expect(result.questionCount).toBe(1);
    });
  });

  describe("validateUnit — broken fixtures", () => {
    it("fails with a useful message when a Bi field is missing `en`", () => {
      const unit = validWalkthroughUnit();
      // @ts-expect-error deliberately malformed for the test
      unit.title = { tr: "Test Konu" };
      const result = validateUnit("walkthrough", unit);
      expect(result.errors).toContain("unit.title: missing/empty tr+en pair");
    });

    it("fails with a useful message when an MCQ's correct index is out of range", () => {
      const unit = validWalkthroughUnit();
      unit.quiz = [
        { q: bi("Soru?", "Question?"), options: [bi("A", "A"), bi("B", "B")], correct: 5, explain: bi("Açıklama", "Explain") },
      ];
      const result = validateUnit("walkthrough", unit);
      expect(result.errors).toContain("unit.quiz[0].correct: out of range");
    });

    it("warns (not hard-errors) on a malformed LaTeX escape (\\b decoded as backspace)", () => {
      const unit = validWalkthroughUnit();
      // "\beta" typed without escaping the backslash decodes to a real backspace char (0x08) —
      // the classic authoring bug this check exists for. Matches the ORIGINAL script's behavior:
      // this is a warning, not a blocking error (see checkControlChars in lib/content/validate.ts).
      unit.tagline = bi("Kısa açıklama", "\beta escaped wrong");
      const result = validateUnit("walkthrough", unit);
      expect(result.errors).toEqual([]);
      expect(result.warnings.some((w) => w.includes("suspicious control char"))).toBe(true);
    });
  });
  ```
- [ ] Run:
  ```bash
  npx vitest run lib/content/validate.test.ts
  ```
  Expected: 4 tests, all green.
- [ ] Full regression gate:
  ```bash
  npm run lint
  npx vitest run
  node scripts/validate-content.mjs
  npm run build
  ```
  Expected: all four succeed, identical to Task 0's baseline.

**Manual verification:**
1. Deliberately break `content/hidroloji/unit-1.json` (delete `finalAnswer` from one question),
   run `node scripts/validate-content.mjs` — expect a non-zero exit and a message naming the
   exact path (`hidroloji/unit-1.q[...].finalAnswer: missing/empty tr+en pair`). Revert the file.
2. Confirm `scripts/upsert-unit.mjs` still works unmodified: `node scripts/upsert-unit.mjs
   hidroloji ./content/hidroloji/unit-1.json` against a dev database — expect the same "content OK
   (0 errors, N warning(s))" output style as before this task.

**Failure modes:**
- **`tsx/esm` registration API differs from what's shown here:** `tsx`'s Node.js loader hook API
  is a small surface but this repo's exact `tsx` version at execution time may differ from what
  was current when this doc was written — if `register("tsx/esm", pathToFileURL("./"))` throws or
  isn't recognized, consult `tsx`'s current docs (web search or `context7`) rather than guessing;
  the fallback is invoking with `node --import tsx scripts/validate-content.mjs`, but that changes
  the command master §8 names verbatim — treat that as a last resort and record the deviation.
  Node version matters too: `node:module`'s `register()` hook needs Node ≥ 20.6 (this repo already
  requires a recent Node for Next.js 16, so this should not bite, but verify with `node -v`).
  Also confirm no other npm script or CI step still invokes `node scripts/validate-content.mjs`
  under an OLDER pinned Node version.
- **Windows path comparison in the `isMain` guard:** `process.argv[1]` is a raw OS path
  (backslashes, no scheme) while `import.meta.url` is a `file:///C:/...` URL — never compare them
  via string templating (`` `file://${...}` `` produces `file://C:/...`, missing the third slash,
  so `isMain` is always false on Windows and the CLI silently no-ops while exiting 0). The
  `pathToFileURL(process.argv[1]).href` comparison above handles drive letters, slashes, and
  percent-encoding correctly on every platform; `pathToFileURL` is already imported at the top of
  this file for the tsx loader registration. Verify with `node scripts/validate-content.mjs` —
  you must see the real "checked N subjects..." output, not silence.
- **Divergence between `lib/content/validate.ts` and the copy that was in `scripts/validate-
  content.mjs`:** this task is a faithful line-for-line port with `ctx` threaded through instead of
  module closures — if a future edit touches validation logic, it goes in `lib/content/validate.ts`
  ONLY; `scripts/validate-content.mjs`'s adapters must never grow their own logic again.

**Commit:**
```bash
git add lib/content/validate.ts lib/content/validate.test.ts scripts/validate-content.mjs package.json package-lock.json
git commit -m "phase-5: extract content validation into lib/content/validate.ts (script becomes a thin wrapper)"
```

---

## Task 5 — Content: subjects list page, new-subject form

- [ ] Create the migration:
  ```bash
  npx supabase migration new admin_content_subject_functions
  ```
- [ ] Put this **complete** SQL in the generated file
      (`supabase/migrations/<ts>_admin_content_subject_functions.sql`):
  ```sql
  -- Phase 5 Task 5: create/update a subject and (re)assign its tracks in one call.
  create or replace function public.admin_upsert_subject(
    p_id uuid,
    p_slug text,
    p_title jsonb,
    p_tagline jsonb,
    p_section_order text,
    p_sort int,
    p_track_ids uuid[]
  )
  returns uuid
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_id uuid;
  begin
    if not public.is_admin() then
      raise exception 'not authorized';
    end if;

    if p_id is null then
      insert into public.subjects (slug, title, tagline, section_order, sort)
      values (p_slug, p_title, p_tagline, p_section_order, p_sort)
      returning id into v_id;
    else
      update public.subjects
      set title = p_title, tagline = p_tagline, section_order = p_section_order, sort = p_sort,
          updated_at = now()
      where id = p_id
      returning id into v_id;
    end if;

    -- Replace the full assignment set every call — simpler and correct for a small admin form
    -- (a handful of tracks per subject), not a hot path.
    delete from public.track_subjects where subject_id = v_id;
    insert into public.track_subjects (track_id, subject_id)
    select t, v_id from unnest(p_track_ids) as t;

    perform public.log_admin_action(
      case when p_id is null then 'subject.create' else 'subject.update' end,
      'subjects', v_id::text, jsonb_build_object('slug', p_slug)
    );

    return v_id;
  end;
  $$;

  grant execute on function public.admin_upsert_subject(uuid, text, jsonb, jsonb, text, int, uuid[]) to authenticated;
  ```
- [ ] Apply:
  ```bash
  npx supabase db reset
  npx supabase db push
  ```
- [ ] Create `app/admin/content/actions.ts` (this file grows in Task 6 too — it is the ONE
      server-actions file for the whole Content section):
  ```ts
  "use server";

  import { redirect } from "next/navigation";
  import { requireAdminAction } from "@/lib/admin/guard";
  import type { Bi } from "@/lib/types";

  export async function setSubjectStatusAction(
    subjectId: string,
    status: "draft" | "published" | "archived"
  ) {
    const { supabase } = await requireAdminAction();
    const { error } = await supabase.rpc("admin_set_status", {
      p_table: "subjects",
      p_id: subjectId,
      p_status: status,
    });
    if (error) throw new Error(error.message);
  }

  export async function createSubjectAction(formData: FormData) {
    const { supabase } = await requireAdminAction();

    const slug = String(formData.get("slug") ?? "").trim();
    const titleTr = String(formData.get("title_tr") ?? "").trim();
    const titleEn = String(formData.get("title_en") ?? "").trim();
    const taglineTr = String(formData.get("tagline_tr") ?? "").trim();
    const taglineEn = String(formData.get("tagline_en") ?? "").trim();
    const sectionOrder = String(formData.get("section_order") ?? "study");
    const sort = Number(formData.get("sort") ?? 0);
    const trackIds = formData.getAll("track_ids").map(String);

    if (!/^[a-z0-9-]+$/.test(slug)) throw new Error("slug must be lowercase-kebab-case");
    if (!titleTr || !titleEn) throw new Error("title (tr + en) is required");
    if (!taglineTr || !taglineEn) throw new Error("tagline (tr + en) is required");
    if (!["walkthrough", "study"].includes(sectionOrder)) throw new Error("invalid section_order");

    const title: Bi = { tr: titleTr, en: titleEn };
    const tagline: Bi = { tr: taglineTr, en: taglineEn };

    const { error } = await supabase.rpc("admin_upsert_subject", {
      p_id: null,
      p_slug: slug,
      p_title: title,
      p_tagline: tagline,
      p_section_order: sectionOrder,
      p_sort: sort,
      p_track_ids: trackIds,
    });
    if (error) throw new Error(error.message);

    redirect("/admin/content");
  }
  ```
- [ ] Create `app/admin/content/page.tsx`:
  ```tsx
  import Link from "next/link";
  import { createClient } from "@/lib/supabase/server";
  import { requireAdminPage } from "@/lib/admin/guard";
  import { AdminTable, type AdminTableColumn } from "@/components/admin/AdminTable";
  import { setSubjectStatusAction, createSubjectAction } from "./actions";
  import type { Bi } from "@/lib/types";

  interface SubjectRow {
    id: string;
    slug: string;
    title: Bi;
    status: "draft" | "published" | "archived";
    sort: number;
    units: { count: number }[];
  }

  interface TrackOption {
    id: string;
    title: Bi;
  }

  export default async function AdminContentPage() {
    await requireAdminPage();
    const supabase = await createClient();

    const [{ data: subjectsData, error }, { data: tracksData }] = await Promise.all([
      supabase.from("subjects").select("id, slug, title, status, sort, units(count)").order("sort"),
      supabase.from("tracks").select("id, title").order("sort"),
    ]);
    if (error) throw new Error(error.message);

    const subjects = (subjectsData ?? []) as unknown as SubjectRow[];
    const tracks = (tracksData ?? []) as TrackOption[];

    const columns: AdminTableColumn<SubjectRow>[] = [
      { key: "title", header: "Title", render: (s) => <span className="font-medium">{s.title.en}</span> },
      { key: "slug", header: "Slug", render: (s) => <code className="text-xs">{s.slug}</code> },
      {
        key: "status",
        header: "Status",
        render: (s) => (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              s.status === "published"
                ? "bg-moss-soft text-moss"
                : s.status === "archived"
                  ? "bg-clay-soft text-clay"
                  : "bg-amber-soft text-amber"
            }`}
          >
            {s.status}
          </span>
        ),
      },
      { key: "units", header: "Units", render: (s) => s.units?.[0]?.count ?? 0 },
      { key: "sort", header: "Sort", render: (s) => s.sort },
      {
        key: "actions",
        header: "Actions",
        render: (s) => (
          <div className="flex flex-wrap gap-1">
            <Link
              href={`/admin/content/${s.id}`}
              className="rounded-md border border-line px-2 py-1 text-xs hover:bg-wash"
            >
              Open
            </Link>
            {s.status !== "published" && (
              <form action={setSubjectStatusAction.bind(null, s.id, "published")}>
                <button className="rounded-md border border-moss/40 px-2 py-1 text-xs text-moss hover:bg-moss-soft">
                  Publish
                </button>
              </form>
            )}
            {s.status === "published" && (
              <form action={setSubjectStatusAction.bind(null, s.id, "draft")}>
                <button className="rounded-md border border-amber/40 px-2 py-1 text-xs text-amber hover:bg-amber-soft">
                  Unpublish
                </button>
              </form>
            )}
            {s.status !== "archived" && (
              <form action={setSubjectStatusAction.bind(null, s.id, "archived")}>
                <button className="rounded-md border border-clay/40 px-2 py-1 text-xs text-clay hover:bg-clay-soft">
                  Archive
                </button>
              </form>
            )}
          </div>
        ),
      },
    ];

    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">Content</h1>
          <p className="text-sm text-ink-soft">Subjects, publish state, and unit counts.</p>
        </div>

        <AdminTable columns={columns} rows={subjects} rowKey={(s) => s.id} emptyMessage="No subjects yet." />

        <details className="rounded-xl border border-line bg-card p-4">
          <summary className="cursor-pointer text-sm font-semibold text-deniz-deep">New subject</summary>
          <form action={createSubjectAction} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Slug
              <input
                name="slug"
                required
                pattern="[a-z0-9-]+"
                placeholder="e.g. hidroloji"
                className="rounded-lg border border-line bg-paper px-3 py-1.5"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Section order
              <select name="section_order" className="rounded-lg border border-line bg-paper px-3 py-1.5">
                <option value="study">study</option>
                <option value="walkthrough">walkthrough</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Title (Turkish)
              <input name="title_tr" required className="rounded-lg border border-line bg-paper px-3 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Title (English)
              <input name="title_en" required className="rounded-lg border border-line bg-paper px-3 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Tagline (Turkish)
              <input name="tagline_tr" required className="rounded-lg border border-line bg-paper px-3 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Tagline (English)
              <input name="tagline_en" required className="rounded-lg border border-line bg-paper px-3 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Sort
              <input name="sort" type="number" defaultValue={0} className="rounded-lg border border-line bg-paper px-3 py-1.5" />
            </label>
            <fieldset className="col-span-full flex flex-col gap-1 text-sm">
              <legend className="mb-1 font-medium">Tracks</legend>
              <div className="flex flex-wrap gap-3">
                {tracks.map((t) => (
                  <label key={t.id} className="flex items-center gap-1.5">
                    <input type="checkbox" name="track_ids" value={t.id} />
                    {t.title.en}
                  </label>
                ))}
                {tracks.length === 0 && <p className="text-ink-faint">No tracks yet — create one in Catalog first.</p>}
              </div>
            </fieldset>
            <button
              type="submit"
              className="col-span-full w-fit rounded-lg bg-deniz px-4 py-2 text-sm font-semibold text-white hover:bg-deniz-deep"
            >
              Create subject (draft)
            </button>
          </form>
        </details>
      </div>
    );
  }
  ```
- [ ] `npm run build` — expect success.

**Manual verification:**
1. Open `/admin/content` — expect the two seeded subjects (`hidroloji`, `insaat-yonetimi`) listed
   with their real unit counts.
2. Create a new subject via the form with a fresh slug and one track checked. Confirm it appears
   in the list as `draft`, and `select * from track_subjects where subject_id = '<new-id>';`
   shows exactly the one row you checked.
3. Click Publish on a draft subject — expect its badge to flip to `published` and
   `select action from admin_audit_log order by created_at desc limit 1;` to show `subject.publish`.

**Failure modes:**
- **`units(count)` embed returns nothing:** PostgREST's embedded-resource count syntax requires
  the foreign key from `units.subject_id` to `subjects.id` to be discoverable (it is — Phase 1's
  schema migration declares it) — if this ever breaks after a schema change, check
  `select conname from pg_constraint where conrelid = 'public.units'::regclass;` for the FK.
- **Duplicate slug:** `subjects.slug` is `unique` (Phase 1) — a second subject with the same slug
  raises a Postgres unique-violation, surfaced as the RPC's `error.message`; the form has no
  client-side duplicate check by design (the DB is the single source of truth here, not a
  redundant client query that could race).
- **Forgetting to check any track for a new subject:** `p_track_ids` is `[]`, which is valid (a
  subject with zero track assignments simply doesn't show up in any track's catalog view yet) —
  not an error, but worth confirming that's really what the admin intended.

**Commit:**
```bash
git add supabase/migrations app/admin/content/actions.ts app/admin/content/page.tsx
git commit -m "phase-5: admin content — subjects list, publish/unpublish/archive, new-subject form"
```

---

## Task 6 — Content: subject detail page, unit upload/validate/publish

- [ ] Create the migration:
  ```bash
  npx supabase migration new admin_content_unit_functions
  ```
- [ ] Put this **complete** SQL in the generated file
      (`supabase/migrations/<ts>_admin_content_unit_functions.sql`):
  ```sql
  -- Phase 5 Task 6: insert-or-bump-version a unit's content, always landing as a DRAFT (a
  -- re-upload of a currently-published unit does NOT silently republish it — the admin must
  -- explicitly hit Publish again, same as a brand-new unit. This is intentional: an edited unit
  -- should get eyes-on (the preview link, Task 7) before going live again).
  create or replace function public.admin_upsert_unit(
    p_subject_id uuid,
    p_slug text,
    p_unit_number int,
    p_title jsonb,
    p_tagline jsonb,
    p_content jsonb,
    p_is_free boolean
  )
  returns table(id uuid, version int)
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_id uuid;
    v_version int;
  begin
    if not public.is_admin() then
      raise exception 'not authorized';
    end if;

    insert into public.units (subject_id, unit_number, slug, is_free, status, content, version, updated_by)
    values (p_subject_id, p_unit_number, p_slug, p_is_free, 'draft', p_content, 1, auth.uid())
    on conflict (subject_id, slug) do update
      set content = excluded.content,
          unit_number = excluded.unit_number,
          status = 'draft',
          version = public.units.version + 1,
          updated_by = auth.uid(),
          updated_at = now()
    returning units.id, units.version into v_id, v_version;

    perform public.log_admin_action(
      'unit.upsert', 'units', v_id::text,
      jsonb_build_object('subject_id', p_subject_id, 'slug', p_slug, 'version', v_version)
    );

    return query select v_id, v_version;
  end;
  $$;

  create or replace function public.admin_set_unit_free(p_unit_id uuid, p_is_free boolean)
  returns void
  language plpgsql
  security definer
  set search_path = public
  as $$
  begin
    if not public.is_admin() then
      raise exception 'not authorized';
    end if;

    update public.units set is_free = p_is_free, updated_at = now() where id = p_unit_id;

    perform public.log_admin_action('unit.set_free', 'units', p_unit_id::text, jsonb_build_object('is_free', p_is_free));
  end;
  $$;

  grant execute on function public.admin_upsert_unit(uuid, text, int, jsonb, jsonb, jsonb, boolean) to authenticated;
  grant execute on function public.admin_set_unit_free(uuid, boolean) to authenticated;
  ```
  Note the `unique (subject_id, unit_number)` constraint (Phase 1) is a SEPARATE constraint from
  the `on conflict (subject_id, slug)` target above — re-uploading a unit with a `unit_number`
  that collides with a *different* unit in the same subject raises its own unique-violation
  error, surfaced verbatim as the RPC's `error.message` (see Failure modes).
- [ ] Apply:
  ```bash
  npx supabase db reset
  npx supabase db push
  ```
- [ ] Append to `app/admin/content/actions.ts` (do not remove anything from Task 5 — add these
      two exports):
  ```ts
  import { validateUnit } from "@/lib/content/validate";
  import { revalidateContent } from "@/lib/content-db";

  export type UpsertUnitState =
    | { status: "idle" }
    | { status: "error"; errors: string[] }
    | { status: "ok"; version: number; warnings: string[]; subjectSlug: string; unitSlug: string };

  export async function upsertUnitAction(
    _prev: UpsertUnitState,
    formData: FormData
  ): Promise<UpsertUnitState> {
    const { supabase } = await requireAdminAction();

    const subjectId = String(formData.get("subject_id") ?? "");
    const sectionOrder = String(formData.get("section_order") ?? "") as "walkthrough" | "study";
    const jsonText = String(formData.get("json_text") ?? "");

    let unit: unknown;
    try {
      unit = JSON.parse(jsonText);
    } catch (e) {
      return { status: "error", errors: [`invalid JSON: ${(e as Error).message}`] };
    }

    const { errors, warnings } = validateUnit(sectionOrder, unit);
    if (errors.length > 0) return { status: "error", errors };

    const u = unit as { slug: string; unit: number; title: Bi; tagline: Bi };
    const { data, error } = await supabase.rpc("admin_upsert_unit", {
      p_subject_id: subjectId,
      p_slug: u.slug,
      p_unit_number: u.unit,
      p_title: u.title,
      p_tagline: u.tagline,
      p_content: unit,
      p_is_free: false,
    });
    if (error) return { status: "error", errors: [error.message] };

    const row = (data as { id: string; version: number }[] | null)?.[0];
    const { data: subjectRow } = await supabase.from("subjects").select("slug").eq("id", subjectId).single();

    return {
      status: "ok",
      version: row?.version ?? 1,
      warnings,
      subjectSlug: subjectRow?.slug ?? "",
      unitSlug: u.slug,
    };
  }

  export async function setUnitStatusAction(
    unitId: string,
    subjectSlug: string,
    status: "draft" | "published"
  ) {
    const { supabase } = await requireAdminAction();
    const { error } = await supabase.rpc("admin_set_status", {
      p_table: "units",
      p_id: unitId,
      p_status: status,
    });
    if (error) throw new Error(error.message);
    // Cache revalidation is a Next.js runtime effect, not a DB concern — it happens after the
    // audited DB write commits, matching D12/D10's "email/side-effects after commit" pattern.
    revalidateContent(subjectSlug);
  }

  export async function setUnitFreeAction(unitId: string, isFree: boolean) {
    const { supabase } = await requireAdminAction();
    const { error } = await supabase.rpc("admin_set_unit_free", { p_unit_id: unitId, p_is_free: isFree });
    if (error) throw new Error(error.message);
  }
  ```
- [ ] Create `components/admin/UploadUnitForm.tsx`:
  ```tsx
  "use client";

  import { useActionState } from "react";
  import { upsertUnitAction, type UpsertUnitState } from "@/app/admin/content/actions";

  const initialState: UpsertUnitState = { status: "idle" };

  export function UploadUnitForm({
    subjectId,
    sectionOrder,
  }: {
    subjectId: string;
    sectionOrder: "walkthrough" | "study";
  }) {
    const [state, formAction, pending] = useActionState(upsertUnitAction, initialState);

    return (
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="subject_id" value={subjectId} />
        <input type="hidden" name="section_order" value={sectionOrder} />
        <label className="flex flex-col gap-1 text-sm">
          Unit JSON (paste, or pick a file below)
          <textarea
            name="json_text"
            rows={10}
            placeholder='{"unit": 1, "slug": "...", ...}'
            className="rounded-lg border border-line bg-paper px-3 py-2 font-mono text-xs"
          />
        </label>
        <input
          type="file"
          accept="application/json"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const text = await file.text();
            const ta = e.target.form?.elements.namedItem("json_text") as HTMLTextAreaElement | null;
            if (ta) ta.value = text;
          }}
          className="text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="w-fit rounded-lg bg-deniz px-4 py-2 text-sm font-semibold text-white hover:bg-deniz-deep disabled:opacity-50"
        >
          {pending ? "Validating..." : "Validate & save as draft"}
        </button>

        {state.status === "error" && (
          <div className="rounded-lg border border-clay/30 bg-clay-soft p-3 text-sm text-clay">
            <p className="mb-1 font-semibold">{state.errors.length} error(s) — not saved</p>
            <ul className="list-disc pl-5">
              {state.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}
        {state.status === "ok" && (
          <div className="rounded-lg border border-moss/30 bg-moss-soft p-3 text-sm text-moss">
            <p className="font-semibold">Saved as draft (v{state.version}).</p>
            {state.warnings.length > 0 && (
              <>
                <p className="mt-2 font-semibold text-amber">{state.warnings.length} warning(s):</p>
                <ul className="list-disc pl-5 text-ink-soft">
                  {state.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </>
            )}
            <a
              href={`/admin/preview/${state.subjectSlug}/${state.unitSlug}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block font-semibold text-deniz-deep underline"
            >
              Open draft preview →
            </a>
          </div>
        )}
      </form>
    );
  }
  ```
- [ ] Create `app/admin/content/[subjectId]/page.tsx`:
  ```tsx
  import { notFound } from "next/navigation";
  import { createClient } from "@/lib/supabase/server";
  import { requireAdminPage } from "@/lib/admin/guard";
  import { AdminTable, type AdminTableColumn } from "@/components/admin/AdminTable";
  import { UploadUnitForm } from "@/components/admin/UploadUnitForm";
  import { setUnitStatusAction, setUnitFreeAction } from "../actions";
  import type { Bi } from "@/lib/types";

  interface UnitRow {
    id: string;
    unit_number: number;
    slug: string;
    title: Bi;
    status: "draft" | "published";
    is_free: boolean;
    version: number;
    updated_at: string;
  }

  export default async function AdminSubjectDetailPage({
    params,
  }: {
    params: Promise<{ subjectId: string }>;
  }) {
    await requireAdminPage();
    const { subjectId } = await params;
    const supabase = await createClient();

    const { data: subject } = await supabase
      .from("subjects")
      .select("id, slug, title, section_order")
      .eq("id", subjectId)
      .single();
    if (!subject) notFound();

    const { data: unitsData, error } = await supabase
      .from("units")
      .select("id, unit_number, slug, content, status, is_free, version, updated_at")
      .eq("subject_id", subjectId)
      .order("unit_number");
    if (error) throw new Error(error.message);

    const units: UnitRow[] = ((unitsData ?? []) as any[]).map((u) => ({
      id: u.id,
      unit_number: u.unit_number,
      slug: u.slug,
      title: u.content?.title ?? { tr: "", en: "(untitled)" },
      status: u.status,
      is_free: u.is_free,
      version: u.version,
      updated_at: u.updated_at,
    }));

    const columns: AdminTableColumn<UnitRow>[] = [
      { key: "number", header: "#", render: (u) => u.unit_number },
      { key: "slug", header: "Slug", render: (u) => <code className="text-xs">{u.slug}</code> },
      { key: "title", header: "Title", render: (u) => u.title.en },
      {
        key: "status",
        header: "Status",
        render: (u) => (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              u.status === "published" ? "bg-moss-soft text-moss" : "bg-amber-soft text-amber"
            }`}
          >
            {u.status}
          </span>
        ),
      },
      {
        key: "free",
        header: "Free preview",
        render: (u) => (
          <form action={setUnitFreeAction.bind(null, u.id, !u.is_free)}>
            <button
              className={`rounded-md border px-2 py-1 text-xs ${
                u.is_free ? "border-moss/40 text-moss hover:bg-moss-soft" : "border-line text-ink-soft hover:bg-wash"
              }`}
            >
              {u.is_free ? "Free" : "Locked"}
            </button>
          </form>
        ),
      },
      { key: "version", header: "Version", render: (u) => u.version },
      { key: "updated", header: "Updated", render: (u) => new Date(u.updated_at).toLocaleString() },
      {
        key: "actions",
        header: "Actions",
        render: (u) => (
          <div className="flex flex-wrap gap-1">
            <a
              href={`/admin/preview/${subject.slug}/${u.slug}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-line px-2 py-1 text-xs hover:bg-wash"
            >
              Preview
            </a>
            {u.status === "draft" ? (
              <form action={setUnitStatusAction.bind(null, u.id, subject.slug, "published")}>
                <button className="rounded-md border border-moss/40 px-2 py-1 text-xs text-moss hover:bg-moss-soft">
                  Publish
                </button>
              </form>
            ) : (
              <form action={setUnitStatusAction.bind(null, u.id, subject.slug, "draft")}>
                <button className="rounded-md border border-amber/40 px-2 py-1 text-xs text-amber hover:bg-amber-soft">
                  Unpublish
                </button>
              </form>
            )}
          </div>
        ),
      },
    ];

    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">{subject.title.en}</h1>
          <p className="text-sm text-ink-soft">
            <code>{subject.slug}</code> · section order: {subject.section_order}
          </p>
        </div>

        <AdminTable columns={columns} rows={units} rowKey={(u) => u.id} emptyMessage="No units yet." />

        <div className="rounded-xl border border-line bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-deniz-deep">Upload a unit</h2>
          <UploadUnitForm subjectId={subject.id} sectionOrder={subject.section_order} />
        </div>
      </div>
    );
  }
  ```
- [ ] `npm run build` — expect success.

**Manual verification:**
1. Open an existing subject's detail page — expect its real units listed with correct version
   numbers and statuses.
2. Paste a **valid** edited copy of `content/hidroloji/unit-1.json` (bump a trivial field) into
   the upload form, submit — expect "Saved as draft (v{N+1})" and a working preview link.
3. Click **Publish** on that draft — expect its status badge to flip and the change to be visible
   at `/s/hidroloji/unit/unit-1` immediately (no redeploy — this exercises `revalidateContent`).
4. Toggle the "Free preview" button on a unit — expect `is_free` to flip in the DB and an
   `unit.set_free` row in `admin_audit_log`.

**Failure modes:**
- **Re-uploading with a colliding `unit_number`:** the `on conflict (subject_id, slug)` clause
  only dedupes on slug; a `unit_number` that belongs to a *different* existing unit in the same
  subject raises a separate unique-violation (`duplicate key value violates unique constraint
  "units_subject_id_unit_number_key"`) — this surfaces as a plain error string in the upload
  form's error list; it is not a validation-layer error (the JSON was schema-valid), it's a data
  conflict the admin needs to resolve by renumbering.
- **Publishing without `revalidateContent`:** if this call is ever removed "to simplify," content
  changes will look "stuck" to students until the next unrelated cache miss — this is exactly the
  master §10 trap this line exists to close; do not remove it even though the DB write alone
  would appear to "work" in a quick manual test right after a fresh server restart (cache
  freshly empty masks the bug).
- **`data` from `admin_upsert_unit`'s RPC call is an array, not an object:** the function
  `returns table(...)`, so Supabase-js always wraps the result in an array even for one row —
  forgetting the `?.[0]` produces `undefined.version` at runtime, not a type error (the code
  above already guards this).

**Commit:**
```bash
git add supabase/migrations app/admin/content/actions.ts app/admin/content/[subjectId]/page.tsx components/admin/UploadUnitForm.tsx
git commit -m "phase-5: admin content — unit upload/validate/publish, free-preview toggle"
```

---

## Task 7 — Draft preview route

- [ ] Create `app/admin/preview/[subjectSlug]/[unitSlug]/page.tsx`:
  ```tsx
  import { notFound } from "next/navigation";
  import { requireAdminPage } from "@/lib/admin/guard";
  import { createServiceRoleClient } from "@/lib/supabase/server";
  import { toSubjectMeta, toUnit } from "@/lib/content-db";

  // Never cache a draft preview — see the note above the service-role client call below.
  export const dynamic = "force-dynamic";

  export default async function AdminPreviewPage({
    params,
  }: {
    params: Promise<{ subjectSlug: string; unitSlug: string }>;
  }) {
    await requireAdminPage();
    const { subjectSlug, unitSlug } = await params;

    // Deliberately bypasses lib/content-db.ts's tag-cached, published-only fetchers (Phase 3):
    // those are wired to serve only published rows to students, and are shared-cached by design
    // (D12). A draft preview must read straight from the table, unfiltered by publish status and
    // never cached, so the admin always sees the exact bytes that will go live on the next
    // Publish click. Service-role is used ONLY in this one file in the whole phase — every other
    // admin read/write in Phase 5 goes through the admin's own RLS-scoped session (defense in
    // depth: RLS would also allow an admin to read draft rows directly, but going around
    // lib/content-db.ts's cache layer specifically requires bypassing it, not bypassing RLS).
    const supabase = createServiceRoleClient();

    const { data: subjectRow } = await supabase
      .from("subjects")
      .select("slug, title, tagline, section_order")
      .eq("slug", subjectSlug)
      .single();
    if (!subjectRow) notFound();

    const { data: unitRow } = await supabase
      .from("units")
      .select("content, status, version")
      .eq("slug", unitSlug)
      .eq("subject_id", (await supabase.from("subjects").select("id").eq("slug", subjectSlug).single()).data?.id)
      .single();
    if (!unitRow) notFound();

    // Reuse Phase 3's exact row→app-shape converters so this preview renders byte-identically to
    // what students will see post-publish — no second, drifting conversion path.
    const subject = toSubjectMeta(subjectRow as Parameters<typeof toSubjectMeta>[0]);
    const unit = toUnit(unitRow as Parameters<typeof toUnit>[0]);

    const { UnitPage } = await import("@/components/UnitPage");

    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-amber/30 bg-amber-soft px-4 py-2 text-sm text-amber">
          Draft preview — status: <strong>{unitRow.status}</strong>, version {unitRow.version}.
          Not cached; not visible to students until you click Publish on the content page.
        </div>
        <UnitPage subject={subject} unit={unit} />
      </div>
    );
  }
  ```
  The nested `subjects.id` lookup above is deliberately spelled out inline rather than a second
  named query — if that reads awkwardly once you're editing this file for real, replace it with
  a single query that selects both subject and unit in one round trip once you know
  `toSubjectMeta`/`toUnit`'s exact row shapes from `lib/content-db.ts`; this version is written to
  be unambiguous about types, not maximally terse.
- [ ] `npm run build` — expect success.

**Manual verification:**
1. Upload a draft unit (Task 6), open its preview link — confirm the page renders through the
   SAME `UnitPage` component students see, with the draft content, and the amber "Draft preview"
   banner.
2. Confirm the preview updates **immediately** after re-uploading a further edit — no need to
   publish first, no need to wait (there is zero caching on this route by design).
3. Sign in as a non-admin student, navigate directly to a known preview URL — expect a redirect
   to `/` (the layout guard covers this route too, since it's nested under `app/admin/`).

**Failure modes:**
- **`toSubjectMeta`/`toUnit` expect a different row shape than the raw `.select()` above
  returns:** if Phase 3 named the row's columns differently than assumed here, TypeScript will
  flag the mismatch at `npm run build` — fix the `.select()` column list to match, do not change
  the converter functions (they are Phase 3's contract, used by the real student-facing pages
  too; drift here would mean the preview no longer matches production rendering, defeating the
  point of this route).
- **Forgetting `export const dynamic = "force-dynamic"`:** without it, Next.js may attempt to
  statically render or cache this dynamic-per-URL admin route at build time; the service-role
  client call would then run at build time with no real request context, which is both wrong and
  a build-time secret-usage smell — keep this line.
- **Service-role client accidentally reused elsewhere:** grep for `createServiceRoleClient` under
  `app/admin/` — it must appear in exactly this one file for this whole phase; any other admin
  page reading draft content should go through the admin's own RLS-scoped `createClient()`
  instead (RLS already allows it for admins).

**Commit:**
```bash
git add app/admin/preview
git commit -m "phase-5: admin draft preview route (uncached, service-role, renders UnitPage)"
```

---

## Task 8 — Catalog: tracks CRUD, per-track subject assignment

- [ ] Create the migration:
  ```bash
  npx supabase migration new admin_catalog_functions
  ```
- [ ] Put this **complete** SQL in the generated file
      (`supabase/migrations/<ts>_admin_catalog_functions.sql`):
  ```sql
  create or replace function public.admin_upsert_track(
    p_id uuid,
    p_country_code text,
    p_system text,
    p_level text,
    p_title jsonb,
    p_sort int
  )
  returns uuid
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_id uuid;
  begin
    if not public.is_admin() then
      raise exception 'not authorized';
    end if;

    if p_id is null then
      insert into public.tracks (country_code, system, level, title, sort)
      values (p_country_code, p_system, p_level, p_title, p_sort)
      returning id into v_id;
    else
      update public.tracks
      set country_code = p_country_code, system = p_system, level = p_level, title = p_title, sort = p_sort
      where id = p_id
      returning id into v_id;
    end if;

    perform public.log_admin_action(
      case when p_id is null then 'track.create' else 'track.update' end,
      'tracks', v_id::text, jsonb_build_object('country_code', p_country_code, 'system', p_system, 'level', p_level)
    );

    return v_id;
  end;
  $$;

  -- Replace the full subject-assignment set for ONE track (this is the per-track direction;
  -- admin_upsert_subject in Task 5 does the per-subject direction — both write the same
  -- track_subjects table, just anchored on the opposite column, and never conflict because each
  -- deletes only rows matching its own anchor before re-inserting).
  create or replace function public.admin_set_track_subjects(p_track_id uuid, p_subject_ids uuid[])
  returns void
  language plpgsql
  security definer
  set search_path = public
  as $$
  begin
    if not public.is_admin() then
      raise exception 'not authorized';
    end if;

    delete from public.track_subjects where track_id = p_track_id;
    insert into public.track_subjects (track_id, subject_id)
    select p_track_id, s from unnest(p_subject_ids) as s;

    perform public.log_admin_action(
      'track.set_subjects', 'tracks', p_track_id::text,
      jsonb_build_object('count', coalesce(array_length(p_subject_ids, 1), 0))
    );
  end;
  $$;

  grant execute on function public.admin_upsert_track(uuid, text, text, text, jsonb, int) to authenticated;
  grant execute on function public.admin_set_track_subjects(uuid, uuid[]) to authenticated;
  ```
- [ ] Apply:
  ```bash
  npx supabase db reset
  npx supabase db push
  ```
- [ ] Create `app/admin/catalog/actions.ts`:
  ```ts
  "use server";

  import { requireAdminAction } from "@/lib/admin/guard";
  import type { Bi } from "@/lib/types";

  export async function setTrackStatusAction(trackId: string, status: "published" | "hidden") {
    const { supabase } = await requireAdminAction();
    const { error } = await supabase.rpc("admin_set_status", { p_table: "tracks", p_id: trackId, p_status: status });
    if (error) throw new Error(error.message);
  }

  export async function createTrackAction(formData: FormData) {
    const { supabase } = await requireAdminAction();

    const countryCode = String(formData.get("country_code") ?? "").trim().toUpperCase();
    const system = String(formData.get("system") ?? "").trim();
    const level = String(formData.get("level") ?? "").trim();
    const titleTr = String(formData.get("title_tr") ?? "").trim();
    const titleEn = String(formData.get("title_en") ?? "").trim();
    const sort = Number(formData.get("sort") ?? 0);

    if (!/^[A-Z]{2}$/.test(countryCode)) throw new Error("country_code must be a 2-letter ISO code");
    if (!system || !level) throw new Error("system and level are required");
    if (!titleTr || !titleEn) throw new Error("title (tr + en) is required");

    const title: Bi = { tr: titleTr, en: titleEn };
    const { error } = await supabase.rpc("admin_upsert_track", {
      p_id: null,
      p_country_code: countryCode,
      p_system: system,
      p_level: level,
      p_title: title,
      p_sort: sort,
    });
    if (error) throw new Error(error.message);
  }

  export async function setTrackSubjectsAction(trackId: string, formData: FormData) {
    const { supabase } = await requireAdminAction();
    const subjectIds = formData.getAll("subject_ids").map(String);
    const { error } = await supabase.rpc("admin_set_track_subjects", {
      p_track_id: trackId,
      p_subject_ids: subjectIds,
    });
    if (error) throw new Error(error.message);
  }
  ```
- [ ] Create `app/admin/catalog/page.tsx`:
  ```tsx
  import { createClient } from "@/lib/supabase/server";
  import { requireAdminPage } from "@/lib/admin/guard";
  import { AdminTable, type AdminTableColumn } from "@/components/admin/AdminTable";
  import { setTrackStatusAction, createTrackAction, setTrackSubjectsAction } from "./actions";
  import type { Bi } from "@/lib/types";

  interface TrackRow {
    id: string;
    country_code: string;
    system: string;
    level: string;
    title: Bi;
    status: "published" | "hidden";
    sort: number;
  }

  interface SubjectOption {
    id: string;
    slug: string;
    title: Bi;
  }

  export default async function AdminCatalogPage() {
    await requireAdminPage();
    const supabase = await createClient();

    const [{ data: tracksData, error }, { data: subjectsData }, { data: assignmentsData }] = await Promise.all([
      supabase.from("tracks").select("id, country_code, system, level, title, status, sort").order("sort"),
      supabase.from("subjects").select("id, slug, title").order("sort"),
      supabase.from("track_subjects").select("track_id, subject_id"),
    ]);
    if (error) throw new Error(error.message);

    const tracks = (tracksData ?? []) as TrackRow[];
    const subjects = (subjectsData ?? []) as SubjectOption[];
    const assignedByTrack = new Map<string, Set<string>>();
    for (const row of (assignmentsData ?? []) as { track_id: string; subject_id: string }[]) {
      if (!assignedByTrack.has(row.track_id)) assignedByTrack.set(row.track_id, new Set());
      assignedByTrack.get(row.track_id)!.add(row.subject_id);
    }

    const columns: AdminTableColumn<TrackRow>[] = [
      { key: "title", header: "Title", render: (t) => t.title.en },
      { key: "country", header: "Country", render: (t) => t.country_code },
      { key: "system", header: "System", render: (t) => t.system },
      { key: "level", header: "Level", render: (t) => t.level },
      {
        key: "status",
        header: "Status",
        render: (t) => (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              t.status === "published" ? "bg-moss-soft text-moss" : "bg-amber-soft text-amber"
            }`}
          >
            {t.status}
          </span>
        ),
      },
      { key: "sort", header: "Sort", render: (t) => t.sort },
      {
        key: "actions",
        header: "Actions",
        render: (t) => (
          <form action={setTrackStatusAction.bind(null, t.id, t.status === "published" ? "hidden" : "published")}>
            <button className="rounded-md border border-line px-2 py-1 text-xs hover:bg-wash">
              {t.status === "published" ? "Hide" : "Publish"}
            </button>
          </form>
        ),
      },
    ];

    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">Catalog</h1>
          <p className="text-sm text-ink-soft">Tracks (country / system / level) and which subjects each one shows.</p>
        </div>

        <AdminTable columns={columns} rows={tracks} rowKey={(t) => t.id} emptyMessage="No tracks yet." />

        <details className="rounded-xl border border-line bg-card p-4">
          <summary className="cursor-pointer text-sm font-semibold text-deniz-deep">New track</summary>
          <form action={createTrackAction} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Country code (ISO 3166-1 alpha-2)
              <input name="country_code" required maxLength={2} placeholder="TZ" className="rounded-lg border border-line bg-paper px-3 py-1.5 uppercase" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              System
              <input name="system" required placeholder="NECTA CSEE" className="rounded-lg border border-line bg-paper px-3 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Level
              <input name="level" required placeholder="Form 4" className="rounded-lg border border-line bg-paper px-3 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Sort
              <input name="sort" type="number" defaultValue={0} className="rounded-lg border border-line bg-paper px-3 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Title (Turkish)
              <input name="title_tr" required className="rounded-lg border border-line bg-paper px-3 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Title (English)
              <input name="title_en" required className="rounded-lg border border-line bg-paper px-3 py-1.5" />
            </label>
            <button
              type="submit"
              className="col-span-full w-fit rounded-lg bg-deniz px-4 py-2 text-sm font-semibold text-white hover:bg-deniz-deep"
            >
              Create track (hidden)
            </button>
          </form>
        </details>

        <div className="flex flex-col gap-4">
          <h2 className="font-display text-lg font-semibold text-ink">Subject assignment per track</h2>
          {tracks.map((t) => {
            const assigned = assignedByTrack.get(t.id) ?? new Set<string>();
            return (
              <form
                key={t.id}
                action={setTrackSubjectsAction.bind(null, t.id)}
                className="rounded-xl border border-line bg-card p-4"
              >
                <p className="mb-2 text-sm font-semibold text-deniz-deep">{t.title.en}</p>
                <div className="flex flex-wrap gap-3 text-sm">
                  {subjects.map((s) => (
                    <label key={s.id} className="flex items-center gap-1.5">
                      <input type="checkbox" name="subject_ids" value={s.id} defaultChecked={assigned.has(s.id)} />
                      {s.title.en}
                    </label>
                  ))}
                  {subjects.length === 0 && <p className="text-ink-faint">No subjects yet.</p>}
                </div>
                <button
                  type="submit"
                  className="mt-3 rounded-md border border-deniz/40 px-3 py-1.5 text-xs font-semibold text-deniz-deep hover:bg-deniz-soft"
                >
                  Save assignment
                </button>
              </form>
            );
          })}
        </div>
      </div>
    );
  }
  ```
- [ ] `npm run build` — expect success.

**Manual verification:**
1. Create a track, confirm it lists as `hidden`. Publish it via the row action.
2. Check/uncheck subject boxes for a track and Save — confirm `track_subjects` reflects exactly
   the checked set (both additions and removals).
3. Confirm a student on that track (Phase 4's catalog surface) sees the assigned subjects and no
   others.

**Failure modes:**
- **Unchecking every subject and saving:** valid — deletes all assignments for that track (the
  track then shows an empty catalog to students on it). Not a bug; if this wasn't intended, the
  admin needs to re-check and re-save, there is no "are you sure" step by design (this is a
  low-stakes, instantly-reversible toggle, unlike code generation or entitlement grants).
- **Two admins editing the same track's assignment simultaneously:** last write wins (the
  function deletes-then-inserts the whole set) — acceptable for a single-admin-operator product;
  revisit only if multiple concurrent admins become real.

**Commit:**
```bash
git add supabase/migrations app/admin/catalog
git commit -m "phase-5: admin catalog — tracks CRUD, per-track subject assignment"
```

---

## Task 9 — Tiers CRUD

- [ ] Create the migration:
  ```bash
  npx supabase migration new admin_tier_functions
  ```
- [ ] Put this **complete** SQL in the generated file
      (`supabase/migrations/<ts>_admin_tier_functions.sql`):
  ```sql
  create or replace function public.admin_upsert_tier(
    p_id uuid,
    p_slug text,
    p_title jsonb,
    p_description jsonb,
    p_scope_type text,
    p_scope_id uuid,
    p_duration_days int,
    p_prices jsonb,
    p_sort int
  )
  returns uuid
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_id uuid;
  begin
    if not public.is_admin() then
      raise exception 'not authorized';
    end if;

    -- Mirrors the table's `tiers_scope_target` check constraint (master §4:
    -- `(scope_type = 'all') = (scope_id is null)`) so the admin gets a readable error from the
    -- function instead of a raw constraint-violation message.
    if (p_scope_type = 'all') <> (p_scope_id is null) then
      raise exception 'scope_id must be set for track/subject tiers and null for scope ''all'' (tiers_scope_target)';
    end if;

    if p_id is null then
      insert into public.tiers (slug, title, description, scope_type, scope_id, duration_days, prices, sort)
      values (p_slug, p_title, p_description, p_scope_type, p_scope_id, p_duration_days, p_prices, p_sort)
      returning id into v_id;
    else
      update public.tiers
      set title = p_title, description = p_description, scope_type = p_scope_type,
          scope_id = p_scope_id, duration_days = p_duration_days, prices = p_prices, sort = p_sort
      where id = p_id
      returning id into v_id;
    end if;

    perform public.log_admin_action(
      case when p_id is null then 'tier.create' else 'tier.update' end,
      'tiers', v_id::text, jsonb_build_object('slug', p_slug)
    );

    return v_id;
  end;
  $$;

  grant execute on function public.admin_upsert_tier(uuid, text, jsonb, jsonb, text, uuid, int, jsonb, int) to authenticated;
  ```
- [ ] Apply:
  ```bash
  npx supabase db reset
  npx supabase db push
  ```
- [ ] Create `components/admin/PricesEditor.tsx` (client component — repeatable rows, serializes
      to a hidden JSON input on every change so the surrounding `<form>` stays a plain Server
      Action form):
  ```tsx
  "use client";

  import { useState } from "react";

  interface PriceRow {
    currency: string;
    amount: number;
    country: string;
  }

  export function PricesEditor({ initial }: { initial: PriceRow[] }) {
    const [rows, setRows] = useState<PriceRow[]>(initial.length > 0 ? initial : [{ currency: "TZS", amount: 0, country: "TZ" }]);

    function update(i: number, patch: Partial<PriceRow>) {
      setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
    }

    return (
      <div className="flex flex-col gap-2">
        <input type="hidden" name="prices_json" value={JSON.stringify(rows)} />
        {rows.map((row, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input
              value={row.currency}
              onChange={(e) => update(i, { currency: e.target.value.toUpperCase() })}
              placeholder="TZS"
              maxLength={3}
              className="w-16 rounded-md border border-line bg-paper px-2 py-1 text-sm uppercase"
            />
            <input
              type="number"
              value={row.amount}
              onChange={(e) => update(i, { amount: Number(e.target.value) })}
              placeholder="15000"
              className="w-28 rounded-md border border-line bg-paper px-2 py-1 text-sm"
            />
            <input
              value={row.country}
              onChange={(e) => update(i, { country: e.target.value.toUpperCase() })}
              placeholder="TZ or *"
              maxLength={2}
              className="w-16 rounded-md border border-line bg-paper px-2 py-1 text-sm uppercase"
            />
            <button
              type="button"
              onClick={() => setRows((r) => r.filter((_, idx) => idx !== i))}
              className="text-xs text-clay hover:underline"
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setRows((r) => [...r, { currency: "USD", amount: 0, country: "*" }])}
          className="w-fit rounded-md border border-line px-2 py-1 text-xs hover:bg-wash"
        >
          + Add price row
        </button>
      </div>
    );
  }
  ```
- [ ] Create `app/admin/tiers/actions.ts`:
  ```ts
  "use server";

  import { requireAdminAction } from "@/lib/admin/guard";
  import type { Bi } from "@/lib/types";

  interface PriceRow {
    currency: string;
    amount: number;
    country: string;
  }

  function parsePrices(raw: string): PriceRow[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("prices: invalid JSON");
    }
    if (!Array.isArray(parsed)) throw new Error("prices: must be an array");
    return parsed.map((p, i) => {
      const row = p as Partial<PriceRow>;
      if (typeof row.currency !== "string" || !/^[A-Z]{3}$/.test(row.currency)) {
        throw new Error(`prices[${i}].currency: must be a 3-letter code`);
      }
      if (typeof row.amount !== "number" || row.amount < 0) {
        throw new Error(`prices[${i}].amount: must be a non-negative number`);
      }
      if (typeof row.country !== "string" || !(row.country === "*" || /^[A-Z]{2}$/.test(row.country))) {
        throw new Error(`prices[${i}].country: must be a 2-letter code or "*"`);
      }
      return { currency: row.currency, amount: row.amount, country: row.country };
    });
  }

  export async function setTierStatusAction(tierId: string, status: "published" | "hidden") {
    const { supabase } = await requireAdminAction();
    const { error } = await supabase.rpc("admin_set_status", { p_table: "tiers", p_id: tierId, p_status: status });
    if (error) throw new Error(error.message);
  }

  export async function upsertTierAction(formData: FormData) {
    const { supabase } = await requireAdminAction();

    const id = String(formData.get("id") ?? "") || null;
    const slug = String(formData.get("slug") ?? "").trim();
    const titleTr = String(formData.get("title_tr") ?? "").trim();
    const titleEn = String(formData.get("title_en") ?? "").trim();
    const descTr = String(formData.get("description_tr") ?? "").trim();
    const descEn = String(formData.get("description_en") ?? "").trim();
    const scopeType = String(formData.get("scope_type") ?? "all");
    // Master §4 `tiers_scope_target`: scope_id is null iff scope_type = 'all'.
    const scopeId = scopeType === "all" ? null : String(formData.get("scope_id") ?? "") || null;
    const durationDays = Number(formData.get("duration_days") ?? 30);
    const sort = Number(formData.get("sort") ?? 0);
    const prices = parsePrices(String(formData.get("prices_json") ?? "[]"));

    if (!/^[a-z0-9-]+$/.test(slug)) throw new Error("slug must be lowercase-kebab-case");
    if (!titleTr || !titleEn) throw new Error("title (tr + en) is required");
    if (!["all", "track", "subject"].includes(scopeType)) throw new Error("invalid scope_type");
    if (scopeType !== "all" && !scopeId) throw new Error("pick the track/subject this tier targets");
    if (!Number.isInteger(durationDays) || durationDays <= 0) throw new Error("duration_days must be a positive integer");

    const title: Bi = { tr: titleTr, en: titleEn };
    const description: Bi = { tr: descTr, en: descEn };

    const { error } = await supabase.rpc("admin_upsert_tier", {
      p_id: id,
      p_slug: slug,
      p_title: title,
      p_description: description,
      p_scope_type: scopeType,
      p_scope_id: scopeId,
      p_duration_days: durationDays,
      p_prices: prices,
      p_sort: sort,
    });
    if (error) throw new Error(error.message);
  }
  ```
- [ ] Create `components/admin/TierScopeFields.tsx` (client component — the scope_id picker only
      renders, and is only `required`, when scope_type is `track`/`subject`; for `all` no
      `scope_id` field is submitted at all, and the server action maps that to `null` — master
      §4's `tiers_scope_target` constraint):
  ```tsx
  "use client";

  import { useState } from "react";
  import type { Bi } from "@/lib/types";

  export function TierScopeFields({
    tracks,
    subjects,
  }: {
    tracks: { id: string; title: Bi }[];
    subjects: { id: string; title: Bi }[];
  }) {
    const [scopeType, setScopeType] = useState<"all" | "track" | "subject">("all");
    const options = scopeType === "track" ? tracks : scopeType === "subject" ? subjects : [];

    return (
      <>
        <label className="flex flex-col gap-1 text-sm">
          Scope
          <select
            name="scope_type"
            value={scopeType}
            onChange={(e) => setScopeType(e.target.value as "all" | "track" | "subject")}
            className="rounded-lg border border-line bg-paper px-3 py-1.5"
          >
            <option value="all">all</option>
            <option value="track">track</option>
            <option value="subject">subject</option>
          </select>
        </label>
        {scopeType !== "all" && (
          <label className="flex flex-col gap-1 text-sm">
            {scopeType === "track" ? "Target track" : "Target subject"}
            <select name="scope_id" required className="rounded-lg border border-line bg-paper px-3 py-1.5">
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title.en}
                </option>
              ))}
            </select>
          </label>
        )}
      </>
    );
  }
  ```
- [ ] Create `app/admin/tiers/page.tsx`:
  ```tsx
  import { createClient } from "@/lib/supabase/server";
  import { requireAdminPage } from "@/lib/admin/guard";
  import { AdminTable, type AdminTableColumn } from "@/components/admin/AdminTable";
  import { PricesEditor } from "@/components/admin/PricesEditor";
  import { TierScopeFields } from "@/components/admin/TierScopeFields";
  import { setTierStatusAction, upsertTierAction } from "./actions";
  import type { Bi } from "@/lib/types";

  interface TierRow {
    id: string;
    slug: string;
    title: Bi;
    scope_type: "all" | "track" | "subject";
    scope_id: string | null;
    duration_days: number;
    prices: { currency: string; amount: number; country: string }[];
    status: "published" | "hidden";
    sort: number;
  }

  export default async function AdminTiersPage() {
    await requireAdminPage();
    const supabase = await createClient();

    const [{ data, error }, { data: tracksData }, { data: subjectsData }] = await Promise.all([
      supabase
        .from("tiers")
        .select("id, slug, title, scope_type, scope_id, duration_days, prices, status, sort")
        .order("sort"),
      supabase.from("tracks").select("id, title").order("sort"),
      supabase.from("subjects").select("id, title").order("sort"),
    ]);
    if (error) throw new Error(error.message);
    const tiers = (data ?? []) as TierRow[];
    const tracks = (tracksData ?? []) as { id: string; title: Bi }[];
    const subjects = (subjectsData ?? []) as { id: string; title: Bi }[];
    const scopeTargetName = (t: TierRow) =>
      t.scope_type === "track"
        ? tracks.find((x) => x.id === t.scope_id)?.title.en ?? t.scope_id
        : subjects.find((x) => x.id === t.scope_id)?.title.en ?? t.scope_id;

    const columns: AdminTableColumn<TierRow>[] = [
      { key: "title", header: "Title", render: (t) => t.title.en },
      { key: "slug", header: "Slug", render: (t) => <code className="text-xs">{t.slug}</code> },
      {
        key: "scope",
        header: "Scope",
        render: (t) => (t.scope_type === "all" ? "all" : `${t.scope_type}: ${scopeTargetName(t)}`),
      },
      { key: "duration", header: "Days", render: (t) => t.duration_days },
      {
        key: "prices",
        header: "Prices",
        render: (t) => (
          <span className="text-xs">
            {t.prices.map((p) => `${p.amount} ${p.currency} (${p.country})`).join(", ") || "—"}
          </span>
        ),
      },
      {
        key: "status",
        header: "Status",
        render: (t) => (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              t.status === "published" ? "bg-moss-soft text-moss" : "bg-amber-soft text-amber"
            }`}
          >
            {t.status}
          </span>
        ),
      },
      {
        key: "actions",
        header: "Actions",
        render: (t) => (
          <form action={setTierStatusAction.bind(null, t.id, t.status === "published" ? "hidden" : "published")}>
            <button className="rounded-md border border-line px-2 py-1 text-xs hover:bg-wash">
              {t.status === "published" ? "Hide" : "Publish"}
            </button>
          </form>
        ),
      },
    ];

    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">Tiers</h1>
          <p className="text-sm text-ink-soft">Sellable access packages — scope, duration, and per-country prices.</p>
        </div>

        <AdminTable columns={columns} rows={tiers} rowKey={(t) => t.id} emptyMessage="No tiers yet." />

        <details className="rounded-xl border border-line bg-card p-4">
          <summary className="cursor-pointer text-sm font-semibold text-deniz-deep">New tier</summary>
          <form action={upsertTierAction} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Slug
              <input name="slug" required pattern="[a-z0-9-]+" placeholder="term-all" className="rounded-lg border border-line bg-paper px-3 py-1.5" />
            </label>
            <TierScopeFields tracks={tracks} subjects={subjects} />
            <label className="flex flex-col gap-1 text-sm">
              Title (Turkish)
              <input name="title_tr" required className="rounded-lg border border-line bg-paper px-3 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Title (English)
              <input name="title_en" required className="rounded-lg border border-line bg-paper px-3 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Description (Turkish)
              <input name="description_tr" className="rounded-lg border border-line bg-paper px-3 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Description (English)
              <input name="description_en" className="rounded-lg border border-line bg-paper px-3 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Duration (days)
              <input name="duration_days" type="number" defaultValue={30} className="rounded-lg border border-line bg-paper px-3 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Sort
              <input name="sort" type="number" defaultValue={0} className="rounded-lg border border-line bg-paper px-3 py-1.5" />
            </label>
            <div className="col-span-full">
              <p className="mb-1 text-sm font-medium">Prices</p>
              <PricesEditor initial={[]} />
            </div>
            <button
              type="submit"
              className="col-span-full w-fit rounded-lg bg-deniz px-4 py-2 text-sm font-semibold text-white hover:bg-deniz-deep"
            >
              Create tier (hidden)
            </button>
          </form>
        </details>
      </div>
    );
  }
  ```
- [ ] `npm run build` — expect success.

**Manual verification:**
1. Confirm the **already-seeded** canonical `term-all` tier (master §5 — Phase 4's seed migration
   created and published it; do NOT re-create it via the form, the unique `slug` would collide)
   is listed with scope `all`, 120 days, and both price rows; `select scope_type, scope_id,
   prices from tiers where slug='term-all';` shows `all`, `null`, and the §5 prices exactly.
2. Create a throwaway tier via the form with slug `test-tier-delete-me`, scope `subject` (pick
   any subject in the picker — this also exercises the `scope_id` field end to end), any prices.
   Confirm it lists as `hidden` with the subject's name in the Scope column and
   `select scope_type, scope_id from tiers where slug='test-tier-delete-me';` matches what you
   picked. Then clean up: `delete from public.tiers where slug='test-tier-delete-me';`.
3. Toggle `term-all` between Hide/Publish once (ending back on `published`) — confirm students
   still see it as an available tier (Phase 4's paywall/upgrade surface) and two `tier.hide`/
   `tier.publish` rows land in `admin_audit_log`.
4. Submit the form with a malformed price row (e.g. a 2-letter currency) — expect the action to
   throw a specific, readable error (`prices[0].currency: must be a 3-letter code`), not a
   generic 500.

**Failure modes:**
- **`prices_json` hidden input not updating:** the `PricesEditor` writes the hidden input's
  `value` on every render via React state — if you ever convert this to an uncontrolled input for
  "simplicity," the serialization breaks; keep it controlled.
- **`country: "*"` meaning "any country" (master §5's own canonical example uses this):** the
  validator explicitly allows `"*"` alongside real 2-letter codes — don't tighten the regex to
  reject it.
- **Editing an existing tier's `scope_type` after codes/entitlements already reference its
  `tier_id`:** allowed by this function (no defensive check) — changing scope on a tier with
  live entitlements does not retroactively change those entitlements' own `scope_type`/`scope_id`
  (those are copied at grant/redemption time, not looked up live) — this is expected, not a bug,
  but worth knowing before "fixing" a tier's scope after it's been sold.

**Commit:**
```bash
git add supabase/migrations app/admin/tiers components/admin/PricesEditor.tsx components/admin/TierScopeFields.tsx
git commit -m "phase-5: admin tiers CRUD with validated prices editor and scope_id picker"
```

---

## Task 10 — Users: search, keyset pagination, detail view, grant/revoke

**Implementation note on "detail drawer":** the task brief describes a drawer overlay. This plan
implements it as a dedicated route (`/admin/users/[userId]`) instead: all data fetching stays
server-side and RLS-respecting with zero extra client bundle, and it is trivially converted to a
true slide-over later (a CSS/routing polish, not a data-model change) — the queries and actions
below are identical either way. Flagged here as a deliberate simplification, not an oversight.

- [ ] Create the migration:
  ```bash
  npx supabase migration new admin_entitlement_functions
  ```
- [ ] Put this **complete** SQL in the generated file
      (`supabase/migrations/<ts>_admin_entitlement_functions.sql`):
  ```sql
  -- Thin admin wrapper around Phase 4's public.grant_entitlement — the ONLY implementation of
  -- the D8 stacking rule (master §4 contract; 04-catalog-tiers-access.md Task 3). Do NOT inline
  -- a raw `insert into entitlements ... now() + duration` here: an admin manual grant must stack
  -- exactly like a code redemption (new expires = max(now, current same-scope expiry) +
  -- duration), or an admin "add 30 days" for a user whose active same-scope entitlement runs
  -- longer would be silently redundant. This wrapper adds ONLY the is_admin() gate and the
  -- audit row; the expiry math and the insert live in grant_entitlement alone.
  create or replace function public.admin_grant_entitlement(
    p_user_id uuid,
    p_scope_type text,
    p_scope_id uuid,
    p_tier_id uuid,
    p_duration_days int
  )
  returns uuid
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_id uuid;
  begin
    if not public.is_admin() then
      raise exception 'not authorized';
    end if;

    -- source 'admin', no source_id: this grant originates from the dashboard, not a code/claim.
    v_id := public.grant_entitlement(
      p_user_id, p_scope_type, p_scope_id, p_tier_id, p_duration_days, 'admin', null
    );

    perform public.log_admin_action(
      'entitlement.grant', 'entitlements', v_id::text,
      jsonb_build_object('user_id', p_user_id, 'scope_type', p_scope_type, 'tier_id', p_tier_id, 'duration_days', p_duration_days)
    );

    return v_id;
  end;
  $$;

  grant execute on function public.admin_grant_entitlement(uuid, text, uuid, uuid, int) to authenticated;
  ```
- [ ] Apply:
  ```bash
  npx supabase db reset
  npx supabase db push
  ```
- [ ] Create `app/admin/users/actions.ts`:
  ```ts
  "use server";

  import { requireAdminAction } from "@/lib/admin/guard";

  export async function grantEntitlementAction(userId: string, formData: FormData) {
    const { supabase } = await requireAdminAction();

    const scopeType = String(formData.get("scope_type") ?? "all") as "all" | "track" | "subject";
    const scopeId = scopeType === "all" ? null : String(formData.get("scope_id") ?? "") || null;
    const tierId = String(formData.get("tier_id") ?? "");
    const durationDays = Number(formData.get("duration_days") ?? 30);

    if (!tierId) throw new Error("pick a tier");
    if (scopeType !== "all" && !scopeId) throw new Error("pick a scope");
    if (!Number.isInteger(durationDays) || durationDays <= 0) throw new Error("duration must be a positive integer");

    const { error } = await supabase.rpc("admin_grant_entitlement", {
      p_user_id: userId,
      p_scope_type: scopeType,
      p_scope_id: scopeId,
      p_tier_id: tierId,
      p_duration_days: durationDays,
    });
    if (error) throw new Error(error.message);
  }

  export async function revokeEntitlementAction(entitlementId: string) {
    const { supabase } = await requireAdminAction();
    const { error } = await supabase.rpc("admin_revoke", { p_table: "entitlements", p_ids: [entitlementId] });
    if (error) throw new Error(error.message);
  }
  ```
- [ ] Create `app/admin/users/page.tsx` (search + keyset pagination, 50/page):
  ```tsx
  import Link from "next/link";
  import { createClient } from "@/lib/supabase/server";
  import { requireAdminPage } from "@/lib/admin/guard";
  import { AdminTable, type AdminTableColumn } from "@/components/admin/AdminTable";

  const PAGE_SIZE = 50;

  interface ProfileRow {
    user_id: string;
    email: string;
    full_name: string;
    country_code: string;
    role: "student" | "admin";
    created_at: string;
  }

  // PostgREST's .or() filter string parses commas/parens as syntax; strip them so a search term
  // can't inject extra OR'd conditions. The caller is always an authenticated admin, but this
  // costs nothing and closes the hole outright rather than trusting the caller.
  function sanitizeSearchTerm(q: string): string {
    return q.replace(/[,()]/g, "").trim().slice(0, 100);
  }

  export default async function AdminUsersPage({
    searchParams,
  }: {
    searchParams: Promise<{ q?: string; cursor?: string }>;
  }) {
    await requireAdminPage();
    const { q: rawQ, cursor } = await searchParams;
    const supabase = await createClient();

    let query = supabase
      .from("profiles")
      .select("user_id, email, full_name, country_code, role, created_at")
      .order("created_at", { ascending: false })
      .order("user_id", { ascending: false })
      .limit(PAGE_SIZE);

    const q = rawQ ? sanitizeSearchTerm(rawQ) : "";
    if (q) {
      query = query.or(`email.ilike.%${q}%,full_name.ilike.%${q}%,phone.ilike.%${q}%`);
    }
    if (cursor) {
      const [cCreatedAt, cUserId] = cursor.split("|");
      query = query.or(`created_at.lt.${cCreatedAt},and(created_at.eq.${cCreatedAt},user_id.lt.${cUserId})`);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as ProfileRow[];
    const last = rows[rows.length - 1];
    const nextCursor = rows.length === PAGE_SIZE && last ? `${last.created_at}|${last.user_id}` : null;

    const columns: AdminTableColumn<ProfileRow>[] = [
      { key: "email", header: "Email", render: (p) => p.email || <span className="text-ink-faint">—</span> },
      { key: "name", header: "Name", render: (p) => p.full_name || <span className="text-ink-faint">—</span> },
      { key: "country", header: "Country", render: (p) => p.country_code || "—" },
      {
        key: "role",
        header: "Role",
        render: (p) => (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${p.role === "admin" ? "bg-deniz-soft text-deniz-deep" : "bg-wash text-ink-soft"}`}>
            {p.role}
          </span>
        ),
      },
      { key: "joined", header: "Joined", render: (p) => new Date(p.created_at).toLocaleDateString() },
      {
        key: "open",
        header: "",
        render: (p) => (
          <Link href={`/admin/users/${p.user_id}`} className="rounded-md border border-line px-2 py-1 text-xs hover:bg-wash">
            Open
          </Link>
        ),
      },
    ];

    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">Users</h1>
          <p className="text-sm text-ink-soft">{rows.length} shown this page (50/page, keyset-paginated).</p>
        </div>

        <form className="flex gap-2" action="/admin/users">
          <input
            name="q"
            defaultValue={rawQ ?? ""}
            placeholder="Search email, name, or phone"
            className="w-72 rounded-lg border border-line bg-paper px-3 py-1.5 text-sm"
          />
          <button type="submit" className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-wash">
            Search
          </button>
        </form>

        <AdminTable columns={columns} rows={rows} rowKey={(p) => p.user_id} emptyMessage="No users match." />

        {nextCursor && (
          <Link
            href={`/admin/users?${new URLSearchParams({ ...(rawQ ? { q: rawQ } : {}), cursor: nextCursor })}`}
            className="w-fit rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-wash"
          >
            Next page →
          </Link>
        )}
      </div>
    );
  }
  ```
- [ ] Create `app/admin/users/[userId]/page.tsx`:
  ```tsx
  import { notFound } from "next/navigation";
  import { createClient } from "@/lib/supabase/server";
  import { requireAdminPage } from "@/lib/admin/guard";
  import { AdminTable, type AdminTableColumn } from "@/components/admin/AdminTable";
  import { grantEntitlementAction, revokeEntitlementAction } from "../actions";
  import type { Bi } from "@/lib/types";

  interface EntitlementRow {
    id: string;
    scope_type: "all" | "track" | "subject";
    scope_id: string | null;
    tier_id: string | null;
    starts_at: string;
    expires_at: string;
    source: "code" | "admin" | "payment";
    revoked_at: string | null;
  }

  export default async function AdminUserDetailPage({
    params,
  }: {
    params: Promise<{ userId: string }>;
  }) {
    await requireAdminPage();
    const { userId } = await params;
    const supabase = await createClient();

    const { data: profile } = await supabase
      .from("profiles")
      .select("user_id, email, full_name, phone, country_code, preferred_lang, role, track_id, onboarded_at, created_at")
      .eq("user_id", userId)
      .single();
    if (!profile) notFound();

    const [{ data: entitlementsData }, { data: redemptionsData }, { data: tiersData }] = await Promise.all([
      supabase
        .from("entitlements")
        .select("id, scope_type, scope_id, tier_id, starts_at, expires_at, source, revoked_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      supabase
        .from("code_redemptions")
        .select("id, created_at, code_id")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      supabase.from("tiers").select("id, slug, title").order("sort"),
    ]);

    // Claims are Phase 6's table — queried here so this page needs no changes once Phase 6 ships
    // rows into it; an empty result on a pre-Phase-6 database is expected, not an error.
    const { data: claimsData } = await supabase
      .from("payment_claims")
      .select("id, status, amount, currency, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    const entitlements = (entitlementsData ?? []) as EntitlementRow[];
    const tiers = (tiersData ?? []) as { id: string; slug: string; title: Bi }[];
    const tierTitle = (id: string | null) => tiers.find((t) => t.id === id)?.title.en ?? "—";

    const entColumns: AdminTableColumn<EntitlementRow>[] = [
      { key: "scope", header: "Scope", render: (e) => e.scope_type },
      { key: "tier", header: "Tier", render: (e) => tierTitle(e.tier_id) },
      { key: "starts", header: "Starts", render: (e) => new Date(e.starts_at).toLocaleDateString() },
      { key: "expires", header: "Expires", render: (e) => new Date(e.expires_at).toLocaleDateString() },
      { key: "source", header: "Source", render: (e) => e.source },
      {
        key: "status",
        header: "Status",
        render: (e) => {
          const active = !e.revoked_at && new Date(e.expires_at) > new Date();
          return (
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${active ? "bg-moss-soft text-moss" : "bg-wash text-ink-soft"}`}>
              {e.revoked_at ? "revoked" : active ? "active" : "expired"}
            </span>
          );
        },
      },
      {
        key: "actions",
        header: "",
        render: (e) =>
          !e.revoked_at ? (
            <form action={revokeEntitlementAction.bind(null, e.id)}>
              <button className="rounded-md border border-clay/40 px-2 py-1 text-xs text-clay hover:bg-clay-soft">Revoke</button>
            </form>
          ) : null,
      },
    ];

    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">{profile.email}</h1>
          <p className="text-sm text-ink-soft">
            {profile.full_name || "(no name)"} · {profile.country_code || "—"} · role: {profile.role} ·
            {" "}{profile.onboarded_at ? "onboarded" : "not onboarded"}
          </p>
        </div>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-deniz-deep">Entitlements</h2>
          <AdminTable columns={entColumns} rows={entitlements} rowKey={(e) => e.id} emptyMessage="No entitlements." />
        </section>

        <section className="rounded-xl border border-line bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-deniz-deep">Grant entitlement</h2>
          <form action={grantEntitlementAction.bind(null, profile.user_id)} className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Scope
              <select name="scope_type" className="rounded-lg border border-line bg-paper px-3 py-1.5">
                <option value="all">all</option>
                <option value="track">track</option>
                <option value="subject">subject</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Scope id (leave blank for scope "all")
              <input name="scope_id" placeholder="track or subject uuid" className="rounded-lg border border-line bg-paper px-3 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Tier
              <select name="tier_id" required className="rounded-lg border border-line bg-paper px-3 py-1.5">
                {tiers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title.en} ({t.slug})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Duration (days)
              <input name="duration_days" type="number" defaultValue={30} className="rounded-lg border border-line bg-paper px-3 py-1.5" />
            </label>
            <button
              type="submit"
              className="col-span-full w-fit rounded-lg bg-deniz px-4 py-2 text-sm font-semibold text-white hover:bg-deniz-deep"
            >
              Grant
            </button>
          </form>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-deniz-deep">Redemptions</h2>
          <p className="text-sm text-ink-soft">{(redemptionsData ?? []).length} code(s) redeemed by this user.</p>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-deniz-deep">Payment claims</h2>
          <p className="text-sm text-ink-soft">
            {(claimsData ?? []).length === 0
              ? "None yet (Phase 6 extends this section with a full claim history)."
              : `${(claimsData ?? []).length} claim(s) — full review UI ships in Phase 6.`}
          </p>
        </section>
      </div>
    );
  }
  ```
- [ ] `npm run build` — expect success.

**Manual verification:**
1. Search for a known student by partial email — expect exactly the matching row(s).
2. Page through more than 50 users (seed test rows if needed) — confirm "Next page" advances
   without repeating or skipping a row across the boundary.
3. Open a user, grant an entitlement with scope `all` and duration 30 — confirm it appears
   `active` in the entitlements table and an `entitlement.grant` row lands in `admin_audit_log`.
4. Grant the same scope again (another 30 days) while the first is still active — confirm the D8
   stacking rule applied: the new row's `expires_at` is the FIRST grant's expiry + 30 days, not
   `now() + 30 days`. Admin manual grants go through the same `public.grant_entitlement`
   implementation as code redemptions (Phase 4) — there is no parallel expiry calculation.
5. Revoke both — confirm each now shows `revoked` and stays visible (revocation is a soft flag,
   not a delete, matching D7).

**Failure modes:**
- **A search term containing a comma or parenthesis:** `sanitizeSearchTerm` strips them before
  they ever reach `.or()` — verify by searching for something like `"a,role.eq.admin"` and
  confirming it's treated as the literal (harmless, probably zero-match) string `"arole.eq.admin"`
  rather than broadening the query.
- **Keyset cursor skipping a row when two profiles share the exact same `created_at`:** this is
  why the query orders by `created_at` **and** `user_id` and the cursor compares both — dropping
  the second `order()`/the `and(...)` clause reintroduces exactly this bug; do not "simplify" it.
- **`profile.email` empty for a pre-Task-1 user who never got backfilled:** shouldn't happen if
  Task 1 ran before this page ships, but if you see it, re-run Task 1's backfill query — do not
  add a fallback `auth.users` read here (that would require service-role on every Users page
  load, which this task specifically avoids).

**Commit:**
```bash
git add supabase/migrations app/admin/users
git commit -m "phase-5: admin users — search/pagination, detail view, grant/revoke entitlements"
```

---

## Task 11 — Codes: generate (single/batch), list/filter, revoke

- [ ] Create the migration:
  ```bash
  npx supabase migration new admin_code_functions
  ```
- [ ] Put this **complete** SQL in the generated file
      (`supabase/migrations/<ts>_admin_code_functions.sql`):
  ```sql
  -- Bulk-inserts pre-hashed codes (plaintext never reaches the database — it is generated and
  -- hashed in the server action below, shown to the admin once, then discarded from memory).
  -- `on conflict (code_hash) do nothing` + `returning` tells the caller exactly which hashes
  -- landed, so it can top up any that collided (astronomically unlikely, but the retry loop in
  -- the server action handles it rather than assuming zero collisions).
  create or replace function public.admin_generate_codes(
    p_tier_id uuid,
    p_scope_type text,
    p_scope_id uuid,
    p_duration_days int,
    p_max_redemptions int,
    p_valid_until timestamptz,
    p_note text,
    p_batch_id uuid,
    p_code_hashes text[]
  )
  returns table(code_hash text)
  language plpgsql
  security definer
  set search_path = public
  as $$
  begin
    if not public.is_admin() then
      raise exception 'not authorized';
    end if;

    return query
    insert into public.access_codes
      (code_hash, tier_id, scope_type, scope_id, duration_days, max_redemptions, valid_until, batch_id, note, created_by)
    select h, p_tier_id, p_scope_type, p_scope_id, p_duration_days, p_max_redemptions, p_valid_until, p_batch_id, p_note, auth.uid()
    from unnest(p_code_hashes) as h
    on conflict (code_hash) do nothing
    returning access_codes.code_hash;

    perform public.log_admin_action(
      'code.generate', 'access_codes', p_batch_id::text,
      jsonb_build_object('count', coalesce(array_length(p_code_hashes, 1), 0), 'tier_id', p_tier_id)
    );
  end;
  $$;

  grant execute on function public.admin_generate_codes(uuid, text, uuid, int, int, timestamptz, text, uuid, text[]) to authenticated;
  ```
- [ ] Apply:
  ```bash
  npx supabase db reset
  npx supabase db push
  ```
- [ ] Create `app/admin/codes/actions.ts`:
  ```ts
  "use server";

  import { requireAdminAction } from "@/lib/admin/guard";
  import { generateCode, normalizeCode, hashCode } from "@/lib/access/codes";

  // Defined once and exported so GenerateCodesForm.tsx can type downloadCsv() with it — do NOT
  // re-derive this shape from GenerateCodesState with a conditional type in the form component:
  // `GenerateCodesState extends { status: "ok"; codes: infer C } ? C : never` does not
  // distribute over a concrete union, resolves to `never`, and fails `npm run build` (TS2345).
  export type GeneratedCode = {
    code: string;
    tier: string;
    scope: string;
    durationDays: number;
    validUntil: string | null;
  };

  export type GenerateCodesState =
    | { status: "idle" }
    | { status: "error"; error: string }
    | { status: "ok"; codes: GeneratedCode[] };

  const MAX_BATCH = 500;
  const MAX_RETRY_ROUNDS = 5;

  export async function generateCodesAction(
    _prev: GenerateCodesState,
    formData: FormData
  ): Promise<GenerateCodesState> {
    const { supabase } = await requireAdminAction();

    const tierId = String(formData.get("tier_id") ?? "");
    const scopeType = String(formData.get("scope_type") ?? "all") as "all" | "track" | "subject";
    const scopeId = scopeType === "all" ? null : String(formData.get("scope_id") ?? "") || null;
    const count = Math.min(MAX_BATCH, Math.max(1, Number(formData.get("count") ?? 1)));
    const maxRedemptions = Math.max(1, Number(formData.get("max_redemptions") ?? 1));
    const validUntilRaw = String(formData.get("valid_until") ?? "");
    const validUntil = validUntilRaw ? new Date(validUntilRaw).toISOString() : null;
    const note = String(formData.get("note") ?? "");
    const durationOverrideRaw = formData.get("duration_days");
    const durationOverride = durationOverrideRaw ? Number(durationOverrideRaw) : null;

    if (!tierId) return { status: "error", error: "pick a tier" };
    if (scopeType !== "all" && !scopeId) return { status: "error", error: "pick a scope" };

    const { data: tier, error: tierError } = await supabase
      .from("tiers")
      .select("slug, duration_days")
      .eq("id", tierId)
      .single();
    if (tierError || !tier) return { status: "error", error: "tier not found" };

    const finalDuration = durationOverride ?? tier.duration_days;
    const batchId = crypto.randomUUID();

    const plaintextByHash = new Map<string, string>();
    const insertedHashes = new Set<string>();
    let remaining = count;
    let rounds = 0;

    while (remaining > 0 && rounds < MAX_RETRY_ROUNDS) {
      rounds++;
      const roundHashes: string[] = [];
      for (let i = 0; i < remaining; i++) {
        const plain = generateCode();
        const hash = hashCode(normalizeCode(plain));
        plaintextByHash.set(hash, plain);
        roundHashes.push(hash);
      }

      const { data: rows, error } = await supabase.rpc("admin_generate_codes", {
        p_tier_id: tierId,
        p_scope_type: scopeType,
        p_scope_id: scopeId,
        p_duration_days: finalDuration,
        p_max_redemptions: maxRedemptions,
        p_valid_until: validUntil,
        p_note: note,
        p_batch_id: batchId,
        p_code_hashes: roundHashes,
      });
      if (error) return { status: "error", error: error.message };

      for (const row of (rows as { code_hash: string }[]) ?? []) {
        insertedHashes.add(row.code_hash);
      }
      remaining = count - insertedHashes.size;
    }

    if (remaining > 0) {
      return {
        status: "error",
        error: `only generated ${count - remaining}/${count} codes after ${MAX_RETRY_ROUNDS} retry rounds — hash collisions this frequent are not expected, check lib/access/codes.ts's generateCode()`,
      };
    }

    const codes = Array.from(insertedHashes).map((hash) => ({
      code: plaintextByHash.get(hash)!,
      tier: tier.slug,
      scope: scopeType,
      durationDays: finalDuration,
      validUntil,
    }));

    return { status: "ok", codes };
  }

  export async function revokeCodesAction(codeIds: string[]) {
    const { supabase } = await requireAdminAction();
    const { error } = await supabase.rpc("admin_revoke", { p_table: "access_codes", p_ids: codeIds });
    if (error) throw new Error(error.message);
  }
  ```
- [ ] Create `components/admin/GenerateCodesForm.tsx`:
  ```tsx
  "use client";

  import { useActionState } from "react";
  import {
    generateCodesAction,
    type GenerateCodesState,
    type GeneratedCode,
  } from "@/app/admin/codes/actions";
  import type { Bi } from "@/lib/types";

  const initialState: GenerateCodesState = { status: "idle" };

  function downloadCsv(codes: GeneratedCode[]) {
    const header = "code,tier,scope,duration_days,valid_until";
    const rows = codes.map((c) => `${c.code},${c.tier},${c.scope},${c.durationDays},${c.validUntil ?? ""}`);
    const blob = new Blob([header + "\n" + rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cubad-codes-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  export function GenerateCodesForm({ tiers }: { tiers: { id: string; slug: string; title: Bi }[] }) {
    const [state, formAction, pending] = useActionState(generateCodesAction, initialState);

    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-amber/30 bg-amber-soft px-4 py-2 text-sm text-amber">
          Codes are shown in PLAINTEXT exactly once, right here, right after generation. Only a
          salted hash is ever stored — there is no "show code again" anywhere in this dashboard.
          Copy or download the CSV now.
        </div>
        <form action={formAction} className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Tier
            <select name="tier_id" required className="rounded-lg border border-line bg-paper px-3 py-1.5">
              {tiers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title.en} ({t.slug})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Scope
            <select name="scope_type" className="rounded-lg border border-line bg-paper px-3 py-1.5">
              <option value="all">all</option>
              <option value="track">track</option>
              <option value="subject">subject</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Scope id (blank for scope "all")
            <input name="scope_id" className="rounded-lg border border-line bg-paper px-3 py-1.5" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Duration override (days, blank = tier default)
            <input name="duration_days" type="number" className="rounded-lg border border-line bg-paper px-3 py-1.5" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Max redemptions per code
            <input name="max_redemptions" type="number" defaultValue={1} className="rounded-lg border border-line bg-paper px-3 py-1.5" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Valid until (optional deadline)
            <input name="valid_until" type="date" className="rounded-lg border border-line bg-paper px-3 py-1.5" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            How many (1–500)
            <input name="count" type="number" defaultValue={1} min={1} max={500} className="rounded-lg border border-line bg-paper px-3 py-1.5" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Note
            <input name="note" placeholder="e.g. offline sale at school fair" className="rounded-lg border border-line bg-paper px-3 py-1.5" />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="col-span-full w-fit rounded-lg bg-deniz px-4 py-2 text-sm font-semibold text-white hover:bg-deniz-deep disabled:opacity-50"
          >
            {pending ? "Generating..." : "Generate"}
          </button>
        </form>

        {state.status === "error" && (
          <p className="rounded-lg border border-clay/30 bg-clay-soft p-3 text-sm text-clay">{state.error}</p>
        )}
        {state.status === "ok" && (
          <div className="rounded-lg border border-moss/30 bg-moss-soft p-3 text-sm">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-semibold text-moss">{state.codes.length} code(s) generated</p>
              <button
                onClick={() => downloadCsv(state.codes)}
                className="rounded-md border border-moss/40 px-2 py-1 text-xs font-semibold text-moss hover:bg-white"
              >
                Download CSV
              </button>
            </div>
            <pre className="max-h-64 overflow-auto rounded-md bg-card p-2 font-mono text-xs">
              {state.codes.map((c) => c.code).join("\n")}
            </pre>
          </div>
        )}
      </div>
    );
  }
  ```
- [ ] Create `app/admin/codes/page.tsx`:
  ```tsx
  import { createClient } from "@/lib/supabase/server";
  import { requireAdminPage } from "@/lib/admin/guard";
  import { AdminTable, type AdminTableColumn } from "@/components/admin/AdminTable";
  import { GenerateCodesForm } from "@/components/admin/GenerateCodesForm";
  import { revokeCodesAction } from "./actions";
  import type { Bi } from "@/lib/types";

  interface CodeRow {
    id: string;
    tier_id: string;
    scope_type: string;
    max_redemptions: number;
    redeemed_count: number;
    valid_until: string | null;
    batch_id: string | null;
    note: string | null;
    revoked_at: string | null;
    created_at: string;
  }

  export default async function AdminCodesPage({
    searchParams,
  }: {
    searchParams: Promise<{ batch?: string; status?: string }>;
  }) {
    await requireAdminPage();
    const { batch, status } = await searchParams;
    const supabase = await createClient();

    const [{ data: tiersData }, codesQuery] = await Promise.all([
      supabase.from("tiers").select("id, slug, title").order("sort"),
      (() => {
        let q = supabase
          .from("access_codes")
          .select("id, tier_id, scope_type, max_redemptions, redeemed_count, valid_until, batch_id, note, revoked_at, created_at")
          .order("created_at", { ascending: false })
          .limit(200);
        if (batch) q = q.eq("batch_id", batch);
        if (status === "revoked") q = q.not("revoked_at", "is", null);
        if (status === "active") q = q.is("revoked_at", null);
        return q;
      })(),
    ]);
    const { data: codesData, error } = codesQuery;
    if (error) throw new Error(error.message);

    const tiers = (tiersData ?? []) as { id: string; slug: string; title: Bi }[];
    const codes = (codesData ?? []) as CodeRow[];
    const tierSlug = (id: string) => tiers.find((t) => t.id === id)?.slug ?? id;

    const columns: AdminTableColumn<CodeRow>[] = [
      { key: "tier", header: "Tier", render: (c) => tierSlug(c.tier_id) },
      { key: "scope", header: "Scope", render: (c) => c.scope_type },
      { key: "redeemed", header: "Redeemed", render: (c) => `${c.redeemed_count}/${c.max_redemptions}` },
      { key: "valid_until", header: "Valid until", render: (c) => (c.valid_until ? new Date(c.valid_until).toLocaleDateString() : "no deadline") },
      { key: "batch", header: "Batch", render: (c) => <code className="text-[10px]">{c.batch_id?.slice(0, 8) ?? "—"}</code> },
      { key: "note", header: "Note", render: (c) => c.note || "—" },
      {
        key: "status",
        header: "Status",
        render: (c) => (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.revoked_at ? "bg-clay-soft text-clay" : "bg-moss-soft text-moss"}`}>
            {c.revoked_at ? "revoked" : "active"}
          </span>
        ),
      },
      {
        key: "actions",
        header: "",
        render: (c) =>
          !c.revoked_at ? (
            <form action={revokeCodesAction.bind(null, [c.id])}>
              <button className="rounded-md border border-clay/40 px-2 py-1 text-xs text-clay hover:bg-clay-soft">Revoke</button>
            </form>
          ) : null,
      },
    ];

    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">Codes</h1>
          <p className="text-sm text-ink-soft">
            Plaintext codes are shown ONCE, at generation. This list only ever shows metadata —
            there is no way to retrieve a lost code's plaintext; revoke it and generate a new one.
          </p>
        </div>

        <GenerateCodesForm tiers={tiers} />

        <AdminTable columns={columns} rows={codes} rowKey={(c) => c.id} emptyMessage="No codes yet." />
      </div>
    );
  }
  ```
- [ ] `npm run build` — expect success.

**Manual verification:**
1. Generate 1 code — expect it shown once in the copyable block, CSV download works, and it
   appears in the list below with `redeemed 0/1`, `active`.
2. Generate a batch of 25 — expect 25 distinct codes, all inserted (verify
   `select count(*) from access_codes where batch_id = '<batch>';` = 25).
3. Revoke a code — expect its status to flip to `revoked` and the Revoke button to disappear for
   that row; confirm `select code_hash from access_codes where id='<id>';` still shows the hash
   (revoking never deletes the row) but a redemption attempt against it now fails (Phase 4's
   `redeem_code` already checks `revoked_at`).
4. Reload the Codes page after generating — confirm the plaintext is **nowhere** to be found
   (not in the list, not in a tooltip, not in page source) — only the hash exists in the DB and it
   is never rendered.

**Failure modes:**
- **`count` above 500:** clamped server-side (`Math.min(500, ...)`) regardless of what the form
  sends — never trust the client's `max` attribute alone (a direct POST bypasses it).
- **Retry loop exhausting `MAX_RETRY_ROUNDS`:** would only happen from a real bug in
  `generateCode()`'s entropy, not normal operation — the error message says so explicitly rather
  than a generic "try again," so whoever sees it knows to go check `lib/access/codes.ts`, not to
  just retry the same generate click.
- **Downloading the CSV twice:** harmless — `state.codes` is still in the component's React state
  from the last successful `generateCodesAction` call until the page is reloaded or another
  generate happens; there is no server round-trip needed to re-download.

**Commit:**
```bash
git add supabase/migrations app/admin/codes components/admin/GenerateCodesForm.tsx
git commit -m "phase-5: admin codes — generate (single/batch with retry), list/filter, revoke"
```

---

## Task 12 — Overview page: KPI cards

Every number below is a single SQL `count(*)`-style aggregate computed **inside** a SECURITY
DEFINER function, never fetched-rows-then-counted in JS — this is master §9's explicit
invariant ("PostgREST's 1000-row cap silently truncates — a JS `.length` on a capped result is a
silent undercount, and an undercount toward MORE apparent access/activity than reality is a
security-relevant bug, not just a cosmetic one"). Restated here because Task 12 is the one place
in this phase where the temptation to `select("*")` and `.length` in JS is highest — don't.

- [ ] Create the migration:
  ```bash
  npx supabase migration new admin_overview_stats
  ```
- [ ] Put this **complete** SQL in the generated file
      (`supabase/migrations/<ts>_admin_overview_stats.sql`):
  ```sql
  -- All six KPIs in one round trip, one function, all counts computed in SQL. `pending_claims`
  -- and `codes_redeemed_30d` both tolerate an empty/nonexistent-yet table gracefully: Phase 6
  -- (payment_claims rows) and any codes redemption history simply read as 0 before real traffic
  -- exists — count(*) on zero matching rows is 0, not an error, so this function needs no special
  -- casing for "before Phase 6 ships."
  create or replace function public.admin_overview_stats()
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    result jsonb;
  begin
    if not public.is_admin() then
      raise exception 'not authorized';
    end if;

    select jsonb_build_object(
      'total_users', (select count(*) from public.profiles),
      'onboarded_users', (select count(*) from public.profiles where onboarded_at is not null),
      'active_entitlements', (
        select count(*) from public.entitlements
        where revoked_at is null and now() between starts_at and expires_at
      ),
      'pending_claims', (
        select count(*) from public.payment_claims where status = 'pending'
      ),
      'codes_redeemed_30d', (
        select count(*) from public.code_redemptions where created_at > now() - interval '30 days'
      ),
      'dau_proxy', (
        select count(*) from public.user_state where updated_at > now() - interval '24 hours'
      )
    ) into result;

    return result;
  end;
  $$;

  grant execute on function public.admin_overview_stats() to authenticated;
  ```
- [ ] Apply:
  ```bash
  npx supabase db reset
  npx supabase db push
  ```
- [ ] Replace the placeholder `app/admin/page.tsx` from Task 2 with the real Overview:
  ```tsx
  import { createClient } from "@/lib/supabase/server";
  import { requireAdminPage } from "@/lib/admin/guard";

  interface OverviewStats {
    total_users: number;
    onboarded_users: number;
    active_entitlements: number;
    pending_claims: number;
    codes_redeemed_30d: number;
    dau_proxy: number;
  }

  const CARDS: { key: keyof OverviewStats; label: string; hint: string }[] = [
    { key: "total_users", label: "Total users", hint: "all signed-up accounts" },
    { key: "onboarded_users", label: "Onboarded", hint: "completed the onboarding wizard" },
    { key: "active_entitlements", label: "Active entitlements", hint: "unrevoked, within its date range, right now" },
    { key: "pending_claims", label: "Pending claims", hint: "awaiting review (Phase 6)" },
    { key: "codes_redeemed_30d", label: "Codes redeemed (30d)", hint: "code_redemptions in the last 30 days" },
    { key: "dau_proxy", label: "Active today (proxy)", hint: "user_state touched in the last 24h" },
  ];

  export default async function AdminOverviewPage() {
    await requireAdminPage();
    const supabase = await createClient();

    const { data, error } = await supabase.rpc("admin_overview_stats");
    if (error) throw new Error(error.message);
    const stats = data as OverviewStats;

    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">Overview</h1>
          <p className="text-sm text-ink-soft">All numbers below are single SQL aggregates — never estimated.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CARDS.map((c) => (
            <div key={c.key} className="rounded-xl border border-line bg-card p-4">
              <p className="text-2xl font-semibold text-deniz-deep">{stats[c.key]}</p>
              <p className="text-sm font-medium text-ink">{c.label}</p>
              <p className="text-xs text-ink-faint">{c.hint}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }
  ```
- [ ] `npm run build` — expect success.

**Manual verification:**
1. Confirm `total_users`/`onboarded_users` match `select count(*) from profiles;` /
   `... where onboarded_at is not null;` run directly in SQL.
2. Grant a test entitlement (Task 10), confirm `active_entitlements` increments by exactly 1;
   revoke it, confirm it decrements back.
3. Confirm the page loads without error on a database with **zero** `payment_claims` rows (the
   pre-Phase-6 state) — `pending_claims` should read `0`, not throw.

**Failure modes:**
- **Rewriting any of these as `supabase.from(...).select("*", {count: "exact"})` "for
  simplicity":** PostgREST's `count: "exact"` option DOES run a real SQL count server-side (it is
  not the JS-fetch-then-count anti-pattern) so it would actually be safe here too — but this
  phase standardizes on ONE function returning all six numbers in one round trip rather than six
  separate requests; keep it that way for the Overview page specifically, since it is the page
  most likely to get pasted-and-extended with a seventh number later.
- **`dau_proxy` reading zero right after a fresh deploy:** expected — it only counts rows written
  by `user_state` updates (Phase 2's server-side progress sync) within the last 24h; a database
  with only newly-onboarded, not-yet-studying users legitimately shows 0 here.

**Commit:**
```bash
git add supabase/migrations app/admin/page.tsx
git commit -m "phase-5: admin overview — KPI cards via single SQL aggregate function"
```

---

## Task 13 — Audit log viewer

- [ ] Create the migration granting admin read access to `admin_audit_log` (Phase 1 enabled RLS
      with zero policies on this table — this adds the one SELECT policy it needs):
  ```bash
  npx supabase migration new admin_audit_log_select_policy
  ```
- [ ] Put this **complete** SQL in the generated file
      (`supabase/migrations/<ts>_admin_audit_log_select_policy.sql`):
  ```sql
  drop policy if exists admin_audit_log_select_admin on public.admin_audit_log;
  create policy admin_audit_log_select_admin on public.admin_audit_log
    for select to authenticated
    using (public.is_admin());
  -- No insert/update/delete policy — writes stay definer-function-only (Task 3's log_admin_action).
  ```
- [ ] Apply:
  ```bash
  npx supabase db reset
  npx supabase db push
  ```
- [ ] Create `app/admin/audit/page.tsx`:
  ```tsx
  import { createClient } from "@/lib/supabase/server";
  import { requireAdminPage } from "@/lib/admin/guard";
  import { AdminTable, type AdminTableColumn } from "@/components/admin/AdminTable";

  const PAGE_SIZE = 50;

  interface AuditRow {
    id: number;
    actor: string | null;
    action: string;
    entity: string;
    entity_id: string | null;
    details: Record<string, unknown>;
    created_at: string;
  }

  export default async function AdminAuditPage({
    searchParams,
  }: {
    searchParams: Promise<{ action?: string; page?: string }>;
  }) {
    await requireAdminPage();
    const { action, page: pageRaw } = await searchParams;
    const page = Math.max(1, Number(pageRaw ?? 1));
    const supabase = await createClient();

    let query = supabase
      .from("admin_audit_log")
      .select("id, actor, action, entity, entity_id, details, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    if (action) query = query.ilike("action", `${action}%`);

    const { data, error, count } = await query;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as AuditRow[];

    // Small, single in-memory lookup for the current page only (≤50 rows) — this is NOT the
    // fetch-rows-then-count anti-pattern master §9 warns about (that's about aggregates/gating,
    // not joining a handful of display labels for a paginated view); admin_audit_log.actor
    // references auth.users, not profiles, so PostgREST can't auto-embed profiles.email here.
    const actorIds = [...new Set(rows.map((r) => r.actor).filter((a): a is string => !!a))];
    const { data: actorsData } = actorIds.length
      ? await supabase.from("profiles").select("user_id, email").in("user_id", actorIds)
      : { data: [] as { user_id: string; email: string }[] };
    const emailByActor = new Map((actorsData ?? []).map((a) => [a.user_id, a.email]));

    const columns: AdminTableColumn<AuditRow>[] = [
      { key: "when", header: "When", render: (r) => new Date(r.created_at).toLocaleString() },
      { key: "actor", header: "Actor", render: (r) => (r.actor ? emailByActor.get(r.actor) ?? r.actor : "—") },
      { key: "action", header: "Action", render: (r) => <code className="text-xs">{r.action}</code> },
      { key: "entity", header: "Entity", render: (r) => `${r.entity}${r.entity_id ? ` (${r.entity_id.slice(0, 8)})` : ""}` },
      {
        key: "details",
        header: "Details",
        render: (r) => (
          <details>
            <summary className="cursor-pointer text-xs text-deniz-deep">view</summary>
            <pre className="mt-1 max-w-xs overflow-auto rounded-md bg-wash p-2 text-[11px]">
              {JSON.stringify(r.details, null, 2)}
            </pre>
          </details>
        ),
      },
    ];

    const totalPages = count ? Math.ceil(count / PAGE_SIZE) : 1;

    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">Audit log</h1>
          <p className="text-sm text-ink-soft">{count ?? 0} total entries · page {page} of {totalPages}.</p>
        </div>

        <form className="flex gap-2" action="/admin/audit">
          <input
            name="action"
            defaultValue={action ?? ""}
            placeholder="Filter by action prefix, e.g. unit. or code."
            className="w-72 rounded-lg border border-line bg-paper px-3 py-1.5 text-sm"
          />
          <button type="submit" className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-wash">
            Filter
          </button>
        </form>

        <AdminTable columns={columns} rows={rows} rowKey={(r) => String(r.id)} emptyMessage="No audit entries match." />

        <div className="flex gap-2 text-sm">
          {page > 1 && (
            <a href={`/admin/audit?${new URLSearchParams({ ...(action ? { action } : {}), page: String(page - 1) })}`} className="rounded-md border border-line px-2 py-1 hover:bg-wash">
              ← Prev
            </a>
          )}
          {page < totalPages && (
            <a href={`/admin/audit?${new URLSearchParams({ ...(action ? { action } : {}), page: String(page + 1) })}`} className="rounded-md border border-line px-2 py-1 hover:bg-wash">
              Next →
            </a>
          )}
        </div>
      </div>
    );
  }
  ```
- [ ] `npm run build` — expect success.

**Manual verification:**
1. Perform any admin action from an earlier task (e.g. publish a unit) — confirm it appears at
   the top of `/admin/audit` within the same page load cycle, actor shown as your admin email.
2. Filter by `action=unit.` — confirm only unit-related rows show.
3. Expand a row's Details — confirm the JSON matches what the corresponding `log_admin_action`
   call passed as `p_details`.

**Failure modes:**
- **`{ count: "exact" }` on a large table is slower than `estimated`:** acceptable here — this is
  an admin-only, low-traffic page, not a gating check; do not "optimize" this into an estimate,
  the page number display depends on an exact count.
- **An audit row with `actor` null:** happens for rows written by a definer function invoked in a
  context with no `auth.uid()` (shouldn't occur in this phase — every function here checks
  `is_admin()` first, which itself requires `auth.uid()` to resolve to a real admin — but the UI
  renders `"—"` defensively rather than crashing on a null actor either way).

**Commit:**
```bash
git add supabase/migrations app/admin/audit
git commit -m "phase-5: admin audit log viewer with actor lookup and action-prefix filter"
```

---

## Task 14 — Verification battery

This task probes the two claims every earlier task's RLS/guard commentary made in passing: that
the layout guard is UX and RLS is the real barrier, and that a non-admin cannot reach any write
path this phase created, regardless of which page (if any) they came from.

- [ ] Create `scripts/probe-admin-write.mjs` (a standalone probe, run manually — not part of the
      Vitest suite, since it needs a real non-admin test user's credentials against a real/dev
      Supabase project, not mocked calls):
  ```js
  #!/usr/bin/env node
  // scripts/probe-admin-write.mjs
  //
  // Negative-path probe for Phase 5's admin RPCs. Signs in as a NON-ADMIN test student and
  // attempts every admin mutation RPC directly — every single call must be denied. This is the
  // concrete evidence for master §9's "layout guard is UX, RLS/definer checks are the real
  // barrier" claim: it bypasses the UI and the layout entirely, calling the RPCs the same way a
  // hand-crafted request would.
  //
  // Usage:
  //   STUDENT_EMAIL=... STUDENT_PASSWORD=... node scripts/probe-admin-write.mjs
  //
  // Expected output: every line ends "DENIED (expected)". Any line ending "SUCCEEDED (BUG)" means
  // a real, exploitable authorization hole — stop and fix before shipping this phase.

  import { createClient } from "@supabase/supabase-js";

  const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const EMAIL = process.env.STUDENT_EMAIL;
  const PASSWORD = process.env.STUDENT_PASSWORD;

  if (!URL || !ANON_KEY || !EMAIL || !PASSWORD) {
    console.error("missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / STUDENT_EMAIL / STUDENT_PASSWORD");
    process.exit(1);
  }

  const supabase = createClient(URL, ANON_KEY);

  async function report(label, promise) {
    const { error } = await promise;
    console.log(`${label}: ${error ? "DENIED (expected)" : "SUCCEEDED (BUG)"}${error ? ` — ${error.message}` : ""}`);
    return !error; // true = bug (call succeeded when it should not have)
  }

  async function main() {
    const { error: authError } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    if (authError) {
      console.error(`sign-in as ${EMAIL} failed: ${authError.message}`);
      process.exit(1);
    }

    const bugs = [];
    if (await report("admin_set_status(subjects)", supabase.rpc("admin_set_status", { p_table: "subjects", p_id: "00000000-0000-0000-0000-000000000000", p_status: "published" }))) bugs.push("admin_set_status");
    if (await report("admin_revoke(entitlements)", supabase.rpc("admin_revoke", { p_table: "entitlements", p_ids: ["00000000-0000-0000-0000-000000000000"] }))) bugs.push("admin_revoke");
    if (await report("admin_generate_codes", supabase.rpc("admin_generate_codes", { p_tier_id: "00000000-0000-0000-0000-000000000000", p_scope_type: "all", p_scope_id: null, p_duration_days: 30, p_max_redemptions: 1, p_valid_until: null, p_note: "probe", p_batch_id: "00000000-0000-0000-0000-000000000000", p_code_hashes: ["deadbeef"] }))) bugs.push("admin_generate_codes");
    if (await report("admin_grant_entitlement", supabase.rpc("admin_grant_entitlement", { p_user_id: "00000000-0000-0000-0000-000000000000", p_scope_type: "all", p_scope_id: null, p_tier_id: "00000000-0000-0000-0000-000000000000", p_duration_days: 30 }))) bugs.push("admin_grant_entitlement");
    if (await report("log_admin_action (direct call)", supabase.rpc("log_admin_action", { p_action: "probe.test", p_entity: "probe", p_entity_id: null, p_details: {} }))) bugs.push("log_admin_action");
    if (await report("direct table write: access_codes", supabase.from("access_codes").insert({ code_hash: "probe", tier_id: "00000000-0000-0000-0000-000000000000", scope_type: "all", duration_days: 30 }))) bugs.push("access_codes direct insert");
    if (await report("direct table write: admin_audit_log", supabase.from("admin_audit_log").insert({ action: "probe.test", entity: "probe" }))) bugs.push("admin_audit_log direct insert");

    console.log(bugs.length === 0 ? "\nALL PHASE-5 ADMIN-WRITE PROBES PASSED" : `\n${bugs.length} BUG(S): ${bugs.join(", ")}`);
    process.exit(bugs.length === 0 ? 0 : 1);
  }

  main();
  ```
- [ ] Create a throwaway non-admin test student (through the real signup flow, or reuse one
      already seeded by an earlier phase's Task 14/15), then run:
  ```bash
  STUDENT_EMAIL=test-student@example.com STUDENT_PASSWORD=... node scripts/probe-admin-write.mjs
  ```
  Expected: `ALL PHASE-5 ADMIN-WRITE PROBES PASSED`, exit 0.
- [ ] Confirm the layout-level (UX) guard separately, in a browser, signed in as that same
      non-admin student: navigate to `/admin` — expect redirect to `/`. Navigate to
      `/admin/content`, `/admin/users`, `/admin/codes` directly by URL — expect the same redirect
      for each (the layout guard applies to every nested route automatically, since
      `app/admin/layout.tsx` wraps all of them).
- [ ] Confirm signed-out entirely: navigate to `/admin` — expect redirect to
      `/auth/sign-in?next=/admin`.
- [ ] Confirm invalid-upload blocking (Task 4/6's fixtures, reused here as an end-to-end check,
      not just a unit test): in `/admin/content/<subjectId>`, paste a unit JSON missing a required
      field (e.g. delete `finalAnswer` from a question) — expect the upload form to show the
      specific error and the database `units` row's `version`/`updated_at` to be **unchanged**
      (verify with a `select` before/after).
- [ ] Confirm publish-without-redeploy end to end:
  1. Note a unit's current `tagline.en` at `/s/hidroloji/unit/unit-1` as a signed-in student with
     access.
  2. As admin, upload a trivially edited version of that unit (different `tagline.en`), leave it
     as `draft`.
  3. Reload `/s/hidroloji/unit/unit-1` as the student — expect the **old** tagline still shown
     (drafts are invisible to students).
  4. As admin, click Publish.
  5. Reload `/s/hidroloji/unit/unit-1` as the student, with **no redeploy, no restart** — expect
     the **new** tagline immediately.

**Manual verification:** the six checklist items above ARE the manual verification for this task
— there is no separate list; record the actual output of the probe script here (or in the PR
description) as evidence, not just "looks right."

**Failure modes:**
- **The probe script's `report()` treats a network/auth error the same as an RLS denial:** it
  doesn't distinguish `PGRST` authorization errors from other failures — if a probe line prints
  "DENIED (expected)" for the wrong reason (e.g. a typo'd table name raising before the
  authorization check even runs), that's a false negative in the probe, not proof of security;
  read the actual `error.message` printed alongside each line, don't just trust the DENIED/
  SUCCEEDED label blindly the first time you run this.
- **Testing with the bootstrap admin account by mistake:** every probe call will "SUCCEED" (
  correctly, since that account IS an admin) — always double-check `STUDENT_EMAIL` is a genuinely
  non-admin account before trusting a passing run.
- **Publish-without-redeploy check "failing" because of browser caching, not app caching:** hard-
  refresh (bypass browser HTTP cache) before concluding `revalidateContent` didn't work — Next.js
  cache tags and the browser's own HTTP cache are two different layers.

**Commit:**
```bash
git add scripts/probe-admin-write.mjs
git commit -m "phase-5: negative-path probe script for every admin-write RPC"
```

---

## Phase acceptance checklist (runnable)

Run from `cubad/` against a fresh dev/branch DB. Every line must pass.

- [ ] `npx supabase db reset` — all Phase 1–5 migrations apply cleanly from scratch.
- [ ] `npm run lint` — clean.
- [ ] `npx vitest run` — all green, including `lib/content/validate.test.ts`'s 4 tests.
- [ ] `node scripts/validate-content.mjs` — identical output to pre-Phase-5 baseline (Task 0).
- [ ] `npm run build` — succeeds.
- [ ] `select to_regprocedure('public.log_admin_action(text,text,text,jsonb)') is not null;` → `t`
      (and similarly for `admin_set_status`, `admin_revoke`, `admin_upsert_subject`,
      `admin_upsert_unit`, `admin_set_unit_free`, `admin_upsert_track`,
      `admin_set_track_subjects`, `admin_upsert_tier`, `admin_grant_entitlement`,
      `admin_generate_codes`, `admin_overview_stats`).
- [ ] `select count(*) from public.profiles where email = '';` → `0` (Task 1's backfill held).
- [ ] `select role from public.profiles where user_id = (select id from auth.users where email
      = 'ahmedallycubad@gmail.com');` → `admin` (bootstrap runbook complete).
- [ ] `STUDENT_EMAIL=... STUDENT_PASSWORD=... node scripts/probe-admin-write.mjs` →
      `ALL PHASE-5 ADMIN-WRITE PROBES PASSED`.
- [ ] Every nav item in `AdminNav` resolves: Overview, Content, Catalog, Tiers, Users, Codes,
      Audit log all render without error as the bootstrap admin (Payments is expected to 404
      until Phase 6 — that is not a bug in this phase).
- [ ] End-to-end publish-without-redeploy (Task 14, last checklist item) demonstrated and noted
      in the PR description.

## Rollback

This phase is additive (new functions, new policies, new files, one schema column). To revert
safely:

1. **Code:** `git revert` the phase merge commit (or close the PR unmerged). Every new file lives
   under `app/admin/`, `components/admin/`, `lib/admin/`, `lib/content/validate.ts` (+ its test),
   and `scripts/probe-admin-write.mjs`; `scripts/validate-content.mjs`'s edit is the only change
   to a pre-existing file, and reverting the commit restores Phase 3's interim version exactly.
2. **Database (never edit an applied migration — add a new reverting migration):**
   ```sql
   drop policy if exists admin_audit_log_select_admin on public.admin_audit_log;

   drop function if exists public.admin_overview_stats();
   drop function if exists public.admin_generate_codes(uuid, text, uuid, int, int, timestamptz, text, uuid, text[]);
   drop function if exists public.admin_grant_entitlement(uuid, text, uuid, uuid, int);
   drop function if exists public.admin_upsert_tier(uuid, text, jsonb, jsonb, text, uuid, int, jsonb, int);
   drop function if exists public.admin_set_track_subjects(uuid, uuid[]);
   drop function if exists public.admin_upsert_track(uuid, text, text, text, jsonb, int);
   drop function if exists public.admin_set_unit_free(uuid, boolean);
   drop function if exists public.admin_upsert_unit(uuid, text, int, jsonb, jsonb, jsonb, boolean);
   drop function if exists public.admin_upsert_subject(uuid, text, jsonb, jsonb, text, int, uuid[]);
   drop function if exists public.admin_revoke(text, uuid[]);
   drop function if exists public.admin_set_status(text, uuid, text);
   drop function if exists public.log_admin_action(text, text, text, jsonb);
   ```
   Dropping the `admin_audit_log` SELECT policy returns that table to deny-all-to-clients (safe,
   matches Phase 1's original state). **Do not** revert Task 1's `profiles.email` column/triggers
   even if reverting everything else — Phase 6 (`06-payments-v1.md`) depends on that column
   existing, and dropping it would break a phase that comes after this one in the dependency
   graph even if this phase's UI is rolled back. If a full revert is truly required, coordinate
   with whether Phase 6 has also been rolled back first.
3. **No data loss:** entitlements/access codes/audit log rows created through this phase's UI are
   historical rows; they remain valid and queryable via direct SQL even if the admin UI itself is
   rolled back — only the *dashboard* disappears, not the data it wrote.

## Changelog / deviations

- **2026-07-19 — Production-smoke Payments seam correction (execution):** the intentionally
  unimplemented Phase 6 Payments item was initially rendered as a live Next link, which prefetched
  the absent `/admin/payments` route and logged a 404 on every Production admin page. Follow-up
  PR #18 keeps the visible Payments / Phase 6 badge but renders it as an accessible disabled,
  non-navigable item. The final Production admin smoke confirmed no payments link and zero browser
  console errors or warnings; no Phase 6 payment behavior was added.

- **2026-07-19 — review hardening (execution):** the implementation review identified two
  missing boundaries. Subject publish/archive now invalidates both the subject cache and the
  shared published-subject list, preventing a stale home/catalog list after status changes.
  Migration `20260719191243_protect_profile_email_updates.sql` also replaces the authenticated
  role's table-wide profile UPDATE grant with column-level grants for the existing onboarding
  fields. The auth-trigger-maintained `profiles.email` projection is therefore not client-
  writable, while normal owner onboarding updates still pass RLS. Clean-stack SQL and disposable
  local/remote PostgREST probes cover the hardened behavior. The same review cycle also hardened
  every validator collection iteration against non-array uploads, checks every parallel user-
  detail query result, and corrected the SQL audit-atomicity assertion to match the logged
  `subject.create` action and slug detail.

- **2026-07-19 — Phase 4 preview-model reconciliation (execution):** Phase 4's merged
  first-chosen-preview architecture supersedes Task 6's stale static `is_free` control. Phase 5
  therefore does **not** create `admin_set_unit_free`, does not accept `p_is_free` in the unit
  upsert RPC, and does not render a per-unit Free/Locked toggle. New unit rows retain the
  schema-compatible `is_free = false` default; updates preserve any historical metadata value.
  No policy, RPC, Server Action, or page added by this phase treats `units.is_free` as an access
  bypass. A published unit is a preview *candidate* until a browser/account chooses its one
  immutable Phase 4 selection; `get_unit_content`, `get_current_preview_unit`, and
  `has_subject_access` remain the authoritative gate. Task 6 acceptance is correspondingly
  adapted to prove upload/draft/publish behavior plus `is_free` non-authority instead of toggling
  a globally fixed free lesson.

- **2026-07-19 — installed `tsx` API reconciliation (execution):** the plan's
  `node:module register("tsx/esm", ...)` loader path is rejected by the installed `tsx` on
  Node 22 because it maps to the deprecated loader hook. The wrapper uses the installed
  package's supported programmatic `tsImport()` API from `tsx/esm/api`, preserving the locked
  `node scripts/validate-content.mjs` invocation and identical CLI output.

- **2026-07-19 — published-revision preservation (execution):** browser acceptance exposed a
  contradiction in the original single-row draft workflow: replacing a published unit's
  `content` and setting `status = 'draft'` made the student route disappear, while Task 14
  explicitly requires the old live tagline to remain visible until Publish. Migration
  `20260719155117_preserve_published_unit_during_draft.sql` adds a nullable
  `units.published_content` snapshot. Admin upload preserves the prior live JSON there while the
  new `content` stays draft-only; `get_unit_content` returns the snapshot to an entitled/selected
  student and the draft to an admin; raw-table RLS continues to hide the row; the public catalog
  uses snapshot metadata; preview claiming treats the retained snapshot as a published candidate;
  and Publish promotes `content` then clears the snapshot. A never-published draft has no snapshot
  and stays invisible. SQL and two-session Playwright acceptance now prove old-live-while-draft,
  admin draft preview, and immediate no-redeploy promotion.

- **2026-07-16 — post-audit fixes (plan-authoring stage, before any execution):**
  1. Task 11: fixed a confirmed TS defect — `downloadCsv`'s parameter was typed with a
     non-distributing conditional (`GenerateCodesState extends { status: "ok"; codes: infer C }
     ? C : never`), which resolves to `never` on a concrete union and fails `npm run build`
     (TS2345). Replaced with an exported `GeneratedCode` type in `app/admin/codes/actions.ts`,
     used by both the ok-state variant and `downloadCsv(codes: GeneratedCode[])`.
  2. Task 1: reworded the `handle_new_user` step from "paste this complete SQL" to an explicit
     MERGE instruction (open Phase 2's current body in migration history, ADD the email column
     to its insert/on-conflict) — the shown SQL is now labeled as the expected RESULT for the
     Phase-2-as-written baseline, preventing a paste from silently dropping a richer body.
  3. Task 9: aligned with master §4's updated `tiers` schema (`scope_id uuid` +
     `tiers_scope_target` constraint, per master §14 registry): `admin_upsert_tier` gained a
     `p_scope_id` param + a validation raise mirroring the constraint; the tier form gained a
     conditional required scope picker (new `components/admin/TierScopeFields.tsx`); the tiers
     page select/row rendering, the server action, the Task 9 commit line, and the Rollback drop
     signature were updated to match.
  4. Task 9 manual verification: the published `term-all` tier is already seeded by Phase 4's
     migration — reworded the test to verify the seeded row and exercise the form via a
     throwaway `test-tier-delete-me` tier (deleted afterward) instead of re-creating `term-all`
     (unique-slug collision).
  5. Tasks 0/1/2/3: `supabase db execute` is not a real Supabase CLI subcommand (master §14) —
     replaced the inline-SQL invocations in Task 0 (prereq check) and Task 1 (backfill verify)
     with `psql "$DB_URL" -c "..."` (with a one-line note in Task 0 on getting `DB_URL` from the
     dashboard's Connect panel), and the runbook mentions in Task 2 (bootstrap) and Task 3
     (smoke-test prose) with "Supabase SQL editor / `psql "$DB_URL"` / MCP `execute_sql`".
  6. Task 10: `admin_grant_entitlement` no longer does a raw
     `insert into entitlements ... now() + duration` — it now delegates to Phase 4's
     `public.grant_entitlement(p_user, p_scope_type, p_scope_id, p_tier_id, p_duration_days,
     'admin', null)`, the single D8 stacking implementation (master §4 contract), keeping only
     the `is_admin()` gate and the `log_admin_action` audit row in the wrapper. Without this, an
     admin manual grant used a parallel expiry calculation and skipped stacking (an "add N days"
     for a user whose active same-scope entitlement ran longer would have been silently
     redundant). Manual verification gained a stacking check (grant twice → second expiry
     stacks on the first).

  7. Prerequisites: replaced the (now stale) "genuinely unresolved naming conflict" block about
     service-role client factory names with the single §14-registry fact —
     `createServiceRoleClient()` from `@/lib/supabase/server`; all sibling docs were reconciled
     to it and `lib/supabase/admin.ts` is never created.
  8. Prerequisites: dropped the stale premise that `06-payments-v1.md` mis-attributes
     `profiles.email` to Phase 2 (06 now attributes it to Phase 5); kept only the true statement
     that this doc's Task 1 adds the column + backfill + trigger update (master §14).
  9. Task 4: fixed the Windows-broken `isMain` guard in the `scripts/validate-content.mjs`
     wrapper — the template `file://${...replace(/\\/g, "/")}` yields `file://C:/...` (missing
     the third slash) vs Node's `file:///C:/...`, so `isMain` was always false on Windows and
     the CLI silently no-oped with exit 0. Now
     `import.meta.url === pathToFileURL(process.argv[1]).href` (`pathToFileURL` was already
     imported for the tsx loader registration); the Task 4 failure-mode note was updated to
     describe the correct pattern instead of prescribing the broken one.

_(executing agents record further deviations here per master §11)_

