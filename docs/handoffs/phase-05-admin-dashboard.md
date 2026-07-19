# Phase 5 handoff — Admin Dashboard

**Status:** Complete. Implementation PR #17 and the Production-smoke seam fix PR #18 are merged;
the final `main` deployment and complete Production smoke gate passed.

**Date started:** 2026-07-19
**Date completed:** 2026-07-19

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
| `20260719150200_admin_audit_helpers.sql` | atomic audit helper, guarded status changes, guarded entitlement/code revocation | pass | applied; ledger verified |
| `20260719150839_admin_content_subject_functions.sql` | guarded/audited subject create/update and track assignment | pass | applied; ledger verified |
| `20260719151244_admin_content_unit_functions.sql` | validated draft upsert with versioning and atomic audit | pass | applied; ledger verified |
| `20260719151456_admin_catalog_functions.sql` | guarded track CRUD and subject assignments | pass | applied; ledger verified |
| `20260719151633_admin_tier_functions.sql` | guarded bilingual tier CRUD with explicit scope | pass | applied; ledger verified |
| `20260719151843_admin_entitlement_functions.sql` | audited wrapper around Phase 4 canonical stacking | pass | applied; ledger verified |
| `20260719152047_admin_code_functions.sql` | one-time hash-only code batch generation | pass | applied; ledger verified |
| `20260719152544_admin_overview_stats.sql` | six SQL aggregate KPIs in one guarded RPC | pass | applied; ledger verified |
| `20260719152657_admin_audit_log_select_policy.sql` | read-only admin audit policy and SELECT privilege | pass | applied; ledger verified |
| `20260719155117_preserve_published_unit_during_draft.sql` | retain the last live revision while a newer draft is edited | pass | applied; ledger verified |
| `20260719191243_protect_profile_email_updates.sql` | restrict authenticated profile updates to onboarding-safe columns; keep auth-synced email server-owned | pass | applied; ledger verified |

Remote verification after the email migration: 6 profiles, 0 blank emails, exactly one owner auth
match, exactly one owner profile match, exactly one owner admin match, and exactly one admin profile
total. No user id or credential was recorded.

All Phase 5 SECURITY DEFINER functions use hardened search paths, perform their own
`public.is_admin()` check, receive minimal explicit EXECUTE grants, and write their mutation's
audit row in the same PostgreSQL function invocation.

## Application decisions delivered

- `/admin` remains inside the existing root layout and is English-only.
- The admin layout redirects signed-out users to `/auth/sign-in?next=/admin` and non-admin users
  to `/`; every Server Action separately re-authenticates and checks `is_admin()`.
- Navigation reserves the Phase 6 Payments seam while marking it as Phase 6.
- A single server-rendered `AdminTable` supplies the shared table treatment.
- Content validation is pure and request-safe in `lib/content/validate.ts`; the CLI retains the
  same command, output, and Phase 3 exports via a thin adapter. The installed `tsx` version uses
  `tsImport()` rather than the deprecated loader-registration path.
- Content, Catalog, Tiers, Users/Entitlements, Codes, Overview, and Audit are all implemented.
  Payments remains a visibly labeled Phase 6 seam.
- Unit uploads validate before any database call, increment versions, and land as drafts. A
  published unit's last live JSON is retained in `units.published_content` while a newer draft is
  edited, so students keep the live revision and raw-table RLS still hides the draft. Publish
  atomically promotes the draft and clears the temporary snapshot.
- Draft preview is dynamic and admin-only, and renders through the same `UnitPage` component as
  the student surface.
- Access-code plaintext is returned only in the successful action state for one-time display/CSV;
  the database, list view, and audit details contain only hashes or non-sensitive metadata.

## Security and audit decisions

- No service-role key is copied into this worktree or exposed. Existing local environment values
  are loaded only into individual process environments for builds/authorized server probes.
- Normal admin pages and actions use the cookie-bound RLS client. The guarded draft-preview route
  is the sole `app/admin` service-role consumer.
- No access-code plaintext is stored, logged, placed in an audit detail, committed, or included in
  this handoff. Generation will return plaintext once in the authorized response only.
- Unsupported status/revoke targets fail loudly; status changes validate per-table states and
  reject nonexistent ids instead of writing misleading audit rows.
- Subject status mutations invalidate both the subject-specific cache and the shared published
  subject-list cache, so publish/archive changes are visible without a redeploy.
- Authenticated owners retain updates to the onboarding profile fields, but PostgreSQL column
  privileges reject direct writes to the auth-synced `profiles.email` projection.
- Admin user-detail parallel reads now fail loudly on any query error, malformed collection
  fields return validation errors instead of throwing, and the audit-atomicity probe matches the
  action/details actually written by the subject RPC.

## Verification completed before PR

- `npx supabase db reset`: all 29 migrations replayed from zero.
- `supabase/tests/05-admin.sql`: signatures, email seam, every non-admin denial, audited CRUD,
  invalid-upload rollback, canonical stacking/revoke, hash-only codes, KPI aggregates, draft/live
  revision isolation, admin draft preview, and publish promotion all passed transactionally.
- Phase 4 authoritative access suite and two-session last-slot concurrency race both passed.
- `npx supabase db lint --local`: no schema errors.
- Strict local and Cubad-remote PostgREST probes created disposable genuine students, verified
  `profiles.role = student`, and received explicit `42501` authorization denials for every admin
  RPC, the profile-email projection, and each privileged direct table write. Both ended with
  `ALL PHASE-5 ADMIN-WRITE PROBES PASSED`; disposable remote users were deleted in `finally`.
- `npm run lint`: zero errors and the same accepted pre-existing 8 warnings.
- `npx vitest run`: 9 files / 60 tests passed.
- content CLI: 2 subjects / 19 files / 56 walkthrough questions; `content OK`.
- Next 16.2.10 production build passed with all admin routes present.
- Cubad remote ledger matches local through `20260719191243` (29/29).
- Playwright browser verification passed for signed-out redirect, direct student redirects,
  all implemented admin nav routes, SQL KPI rendering, invalid JSON and missing-`finalAnswer`
  no-mutation errors, draft preview, old-live-while-draft behavior, publish without redeploy,
  and filtered audit display with the admin email plus `unit.publish`.

## Completion gates

- Implementation PR #17 passed GitHub CI, CodeRabbit, Vercel, Vercel Preview Comments, and a
  thread-aware audit of five resolved / zero unresolved review threads before merge.
- Production smoke found and corrected the disabled Phase 6 Payments seam through PR #18. Its
  GitHub CI, CodeRabbit, Vercel, Vercel Preview Comments, and zero-thread audit passed before merge.
- The final Production deployment is Ready and its complete public, signed-out, student-preview,
  and disposable-admin smoke gate passed with zero browser console errors.

## Credentials and human-only actions

- Existing owner role is already verified without recording identity ids.
- Non-admin checks used automatically created disposable local/remote fixtures. No fixture
  password, token, or user id is retained in Git or this handoff.
- Production admin smoke used a short-lived service-role-created admin because Chrome contained no
  existing Cubad session. It performed read-only route checks and was deleted in guaranteed cleanup;
  no credential was printed, retained, or written to disk.
- A production admin podcast-generation smoke remains owner-only and intentionally excluded unless
  explicitly approved. It is not a Phase 5 completion blocker because the scope expressly forbids
  generating a real Production podcast without that approval.

## PR, CI, review, Preview, merge, and Production

- Implementation PR: `https://github.com/ACubad/cubad/pull/17`.
  - Final head: `fcc0e985b87c8021b4647ae9fc76be49b93b773e`.
  - CI: `build-and-test` passed in 55 seconds; Vercel and Vercel Preview Comments passed.
  - Review: two Codex findings and three CodeRabbit actionable findings were fixed, replied to,
    and resolved. Final thread audit: 5 total, 0 unresolved. CodeRabbit's main review completed;
    its post-fix incremental run hit the plan review limit but returned a successful status after
    the fixes, while CI and the thread-aware audit independently passed.
  - Final Preview: `dpl_25GGAKBhP3ZsAaeKiozhNk17SR4H`, Ready at
    `https://cubad-imthgyg71-acubads-projects.vercel.app` with the branch alias protected by
    Vercel Authentication. Full browser acceptance therefore ran locally against linked Cubad;
    deployment inspection and GitHub's Vercel checks proved the protected Preview Ready.
  - Merge commit: `b1090e5aa0c3b28be1b2f520225ba1477b7f3ece` at 2026-07-19 16:32:01 UTC.
- Production-smoke fix PR: `https://github.com/ACubad/cubad/pull/18`.
  - Finding: the Phase 6 Payments badge was a live link to the intentionally absent route, causing
    a Next prefetch 404 on every admin page. It is now a visible, accessible, non-navigable seam.
  - CI passed in 55 seconds; CodeRabbit, Vercel, Vercel Preview Comments, and the zero-thread audit
    passed. Preview `dpl_3EXEWEnc56jE3EqKCZg7VohH8Vpt` was Ready.
  - Merge commit: `942ec083702ca1a651e072bf855d52860351b769` at 2026-07-19 16:46:29 UTC.
- Final Production: `dpl_3nd83KeJP1Wg3yarDRQXGLRAjGWB`, Ready at
  `https://cubad-e5b2a78rn-acubads-projects.vercel.app`; aliases include
  `https://cubad.vercel.app`, `https://cubad-acubads-projects.vercel.app`, and
  `https://cubad-git-main-acubads-projects.vercel.app`.
- Final Production browser smoke on `https://cubad.vercel.app`:
  - home rendered both subjects and the expected unit counts;
  - signed-out `/admin` redirected to `/auth/sign-in?next=/admin`;
  - `/s/hidroloji` rendered, the anonymous first lesson selection opened the complete `giris`
    lesson, and the second `yagis` lesson remained locked;
  - a short-lived genuine admin rendered Overview, Content, Catalog, Tiers, Users, Codes, and Audit;
  - the Payments Phase 6 item was `aria-disabled` with no `/admin/payments` link; browser console
    totals were 0 errors / 0 warnings;
  - the disposable admin was deleted, the Cubad migration ledger remained 29/29 through
    `20260719191243`, and no podcast was generated.

## Changelog / deviations

- See the five 2026-07-19 execution entries in
  `docs/plans/productization/05-admin-dashboard.md`: Phase 4 preview reconciliation and installed
  `tsx` programmatic-loader reconciliation, preservation of the live unit revision while an
  editor works on a draft, review hardening for cache invalidation/profile email ownership, and
  the Production-smoke correction of the disabled Phase 6 Payments seam.
