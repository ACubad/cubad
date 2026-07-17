# Phase 1 handoff — Foundation

**Status:** Fully validated; awaiting final PR merge

**Branch / PR:** `feat/phase-1-foundation` · [PR #1](https://github.com/ACubad/cubad/pull/1) (draft)

**Date:** 2026-07-17

## Delivered

- Dedicated paid Supabase project: `cubad`, ref `qjcaangaxpkihxxzexpq`, Frankfurt (`eu-central-1`), Micro compute.
- Existing Vercel project remains `cubad`; Production and Development variables are configured, with branch-scoped Preview variables for `feat/phase-1-foundation`.
- Supabase CLI scaffold and two linked migrations:
  `20260717170920_initial_schema.sql` and
  `20260717210404_service_role_grants.sql`.
- Complete target schema: 14 tables, RLS enabled on all tables, and exactly seven Phase 1 baseline policies (profiles ×3, user_state ×3, admin_audit_log ×1).
- Canonical browser, server, service-role, and session-refresh Supabase helpers in `lib/supabase/`.
- Idempotent seed script and initial data: 1 `TR / University / Undergraduate` track, 2 published subjects, 19 published/free units, 2 track-subject links.
- Vitest harness with the numeric unit-file sorting test; GitHub Actions workflow for lint, content validation, test, and build.

## Evidence

| Check | Result |
| --- | --- |
| Remote migration history | Local and remote both contain `20260717170920` |
| Remote seed run twice | Both runs: 2 subjects, 19 units |
| Remote counts | tracks=1, subjects=2, units=19, track_subjects=2, non-free units=0 |
| `npm test` | 1 file / 3 tests passing |
| `node scripts/validate-content.mjs` | passing |
| `npm run lint` | passing with 10 pre-existing React 19 advisory warnings |
| `npm run build` | passing |
| GitHub Actions CI run #4 | passing on commit `0396289` |
| Local reset | two clean `npx supabase db reset` cycles passed with both migrations |
| Local idempotent seed | two runs: 1 track, 2 subjects, 19 units, 2 track-subject links |
| Local schema assertions | 14 public tables, RLS enabled on all 14, exactly 7 policies |
| Production deployment | Vercel Ready; `https://cubad.vercel.app` returned HTTP 200 |
| Phase preview deployment | Vercel Ready for commit `0396289`; protected by Vercel SSO |

## Security and operational invariants

- `SUPABASE_SERVICE_ROLE_KEY` is used only by `createServiceRoleClient()` in `lib/supabase/server.ts`; no public variable exposes it.
- `service_role` has explicit SQL privileges in the new grant migration; it can seed/administer the RLS-protected schema through local and hosted PostgREST without exposing the key to a browser.
- Legacy `SUPABASE_URL` and `SUPABASE_ANON_KEY` stay in Vercel and continue powering sprout sync until Phase 3.
- Phase 1 did not change a user-facing route or cut production over to the new database.
- The Supabase database password and API keys exist only in ignored local secrets files; no secret was committed.

## Outstanding acceptance work

1. The ten pre-existing React 19 lint findings are intentionally warnings, not CI-blocking errors. They remain visible for a future component-refactor task; the Phase 1 configuration change is documented in `eslint.config.mjs`.
2. Confirm the final CI and Vercel preview for the grant-migration commit, then merge PR #1.

The local worktree also contains four unrelated, uncommitted user edits:
`app/api/tutor/route.ts`, `app/globals.css`, `components/Md.tsx`, and `components/TutorPanel.tsx`. They were not staged or included in Phase 1 commits.

Local validation note: `Perfect_Cloth_Match` was stopped with its Docker volume preserved to release Supabase's default local ports. The unrelated `tokadok` stack was left running.

## Audit commands

```powershell
npx supabase migration list
npm run seed:content
npm test
node scripts/validate-content.mjs
npm run build
npx supabase db reset
```

For remote data counts, use the service-role client locally or the Supabase SQL editor; never place the service-role key in a browser bundle.

## Rollback

- Before merge: close PR #1; production is unchanged.
- After merge: revert the Phase 1 PR. The new Supabase project is not yet on the live request path.
- Database: pause/delete the dedicated `cubad` project only if the product is abandoned; it contains the Phase 1 seeded content.

## Next phase start point

Phase 2 starts only after this PR is accepted and merged. Create `feat/phase-2-auth-profiles` from updated `main`, then follow `docs/plans/productization/02-auth-profiles.md` Task 2.0. Do not branch Phase 2 from this draft PR.
