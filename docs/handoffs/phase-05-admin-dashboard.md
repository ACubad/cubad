# Phase 5 handoff — Admin Dashboard

**Status:** In progress on `feat/phase-5-admin-dashboard`. Do not treat this document as a
completion claim until the PR, merge, Production deployment, and Production smoke sections are
filled with final evidence.

**Date started:** 2026-07-19

## Scope and infrastructure lock

- Repository: `ACubad/cubad`; clean worktree `cubad-phase5` created from `origin/main`
  `9d4ea8f2eaeebdbfe34524d3c0e593bc1debfe84`.
- Existing Cubad Supabase only: `qjcaangaxpkihxxzexpq` (`cubad`, `eu-central-1`).
- Existing Vercel project only: `cubad`.
- Legacy Sprout `rywcdqpnwwumbpubkofc` is out of scope and must remain unchanged.
- Payments and claim review remain Phase 6. Phase 5 preserves only the English admin-navigation
  seam; it does not implement payment review.
- Podcast generation/regeneration remains admin-only. No production podcast will be generated as
  a smoke test without explicit owner approval.

## Phase 4 preview-model reconciliation

The merged Phase 4 handoff is authoritative. Visitors and unentitled students choose exactly one
complete published lesson; authenticated choices are durable, anonymous choices are capability-
bound and best-effort, and signup promotes a safe anonymous choice only when the account has no
durable choice.

The Phase 5 plan's old static-free-unit Task 6 is intentionally adapted:

- no `admin_set_unit_free` RPC is created;
- no `setUnitFreeAction` or per-unit Free/Locked control is exposed;
- the admin unit upsert RPC does not accept `p_is_free`;
- new rows receive the schema-compatible `is_free = false` default and updates preserve existing
  metadata;
- `units.is_free` never bypasses `get_unit_content`, the raw `units` RLS policy, or the one-choice
  selection functions;
- verification must prove that flipping legacy metadata cannot release a second lesson.

This keeps schema compatibility without restoring a globally owner-selected preview.

## Required reading and baseline

Read completely before editing: `AGENTS.md`, the master and Phase 5 plans, Phase 1–4 handoffs,
all 17 pre-Phase-5 migrations, `scripts/validate-content.mjs`, `scripts/upsert-unit.mjs`,
`lib/types.ts`, `components/ui.tsx`, `docs/DESIGN.md`, `lib/i18n.tsx`, `app/globals.css`,
`app/layout.tsx`, `lib/content-db.ts`, `lib/supabase/server.ts`, `lib/access/codes.ts`,
`components/UnitPage.tsx`, `components/SubjectHome.tsx`, `app/api/revalidate/route.ts`, and the
Next 16 mutating-data, forms, data-security, cookies, and route-groups guides named by the plan.

Untouched baseline evidence:

| Gate | Result |
| --- | --- |
| Supabase CLI | `2.109.1`; authenticated project list contains active Cubad and Sprout |
| Linked project | exactly `qjcaangaxpkihxxzexpq` |
| Remote ledger | all 17 pre-Phase-5 local/remote versions matched through `20260719135536` |
| Remote prerequisites | schema dump contained `is_admin()`, `has_subject_access(uuid)`, and `redeem_code(text)` |
| `npm run lint` | pass, zero errors and the accepted existing 8 warnings |
| `npx vitest run` | 8 files / 54 tests passed |
| content CLI | 2 subjects / 19 files / 56 walkthrough questions; content OK |
| `npm run build` | Next 16.2.10 production build passed |
| `npx supabase db reset` | all 17 migrations replayed successfully |
| clean worktree | clean before the first Phase 5 migration |

## Migrations and database functions

Applied migrations are additive; no historical migration is edited.

| Migration | Purpose | Local | Cubad remote |
| --- | --- | --- | --- |
| `20260719145853_profiles_email_seam.sql` | `profiles.email`, backfill, signup merge, auth email-update trigger | pass | applied; ledger verified |
| `20260719150200_admin_audit_helpers.sql` | atomic audit helper, guarded status changes, guarded entitlement/code revocation | pass | applied |
| `20260719150839_admin_content_subject_functions.sql` | guarded/audited subject create/update and track assignment | pending final reset | pending push |

Remote verification after the email migration: 6 profiles, 0 blank emails, exactly one owner auth
match, exactly one owner profile match, exactly one owner admin match, and exactly one admin profile
total. No user id or credential was recorded.

All Phase 5 SECURITY DEFINER functions use hardened search paths, perform their own
`public.is_admin()` check, receive minimal explicit EXECUTE grants, and write their mutation's
audit row in the same PostgreSQL function invocation.

## Application decisions delivered so far

- `/admin` remains inside the existing root layout and is English-only.
- The admin layout redirects signed-out users to `/auth/sign-in?next=/admin` and non-admin users
  to `/`; every Server Action separately re-authenticates and checks `is_admin()`.
- Navigation reserves the Phase 6 Payments seam while marking it as Phase 6.
- A single server-rendered `AdminTable` supplies the shared table treatment.
- Content validation is pure and request-safe in `lib/content/validate.ts`; the CLI retains the
  same command, output, and Phase 3 exports via a thin adapter. The installed `tsx` version uses
  `tsImport()` rather than the deprecated loader-registration path.

## Security and audit decisions

- No service-role key is copied into this worktree or exposed. Existing local environment values
  are loaded only into individual process environments for builds/authorized server probes.
- Normal admin pages and actions use the cookie-bound RLS client. The planned draft-preview route
  will be the sole `app/admin` service-role consumer.
- No access-code plaintext is stored, logged, placed in an audit detail, committed, or included in
  this handoff. Generation will return plaintext once in the authorized response only.
- Unsupported status/revoke targets fail loudly; status changes validate per-table states and
  reject nonexistent ids instead of writing misleading audit rows.

## Verification still required

- Complete remaining migrations/UI/tasks, local reset, full SQL probe suite, non-admin JWT probe,
  signed-out/student/admin browser checks, invalid-upload atomicity, draft invisibility,
  publish-without-redeploy, first-choice-preview non-regression, stacking, code generation and
  revocation, navigation, KPI, and audit checks.
- Run final lint, full Vitest, content CLI, TypeScript/build, and remote ledger verification.
- Open implementation PR only after the complete local gate; record CI, review findings,
  unresolved-thread audit, and Vercel Preview.
- Merge only after all required checks pass, then record merge SHA, Production deployment id/URL,
  and the complete Production smoke result. Use a docs-only closeout PR if final evidence cannot be
  committed before merge.

## Credentials and human-only actions

- Existing owner role is already verified without recording identity ids.
- A genuine non-admin credential is required for the real remote direct-RPC probe and authenticated
  browser boundary. If a safe disposable fixture cannot be created automatically without email or
  human confirmation, stop only at that check and provide exact instructions.
- A production admin podcast-generation smoke remains owner-only and intentionally excluded unless
  explicitly approved.

## PR, CI, review, Preview, merge, and Production

Pending. Populate every field before Phase 5 is declared complete.

## Changelog / deviations

- See the two 2026-07-19 execution entries in
  `docs/plans/productization/05-admin-dashboard.md`: Phase 4 preview reconciliation and installed
  `tsx` programmatic-loader reconciliation.
