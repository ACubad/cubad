# Phase 3 handoff — Content in the Database, Unified UI & Sprout Cutover

**Status:** Pre-merge handoff. Implementation and every pre-merge gate are complete. Do not
mark Phase 3 complete until the PR is merged, the existing production deployment is verified,
and the post-merge evidence below is appended.

**Branch:** `feat/phase-3-content-db-unified-ui` (based on updated `origin/main` `d78e352`)

**Date:** 2026-07-18

## Delivered

- Added the server-only `lib/content-db.ts` read layer with Next 16 `unstable_cache`, per-content
  tags, `revalidateTag(tag, "max")`, DB catalogue fetchers, and subject/unit convenience helpers.
- Added remote Cubad migrations for catalogue read RLS, the `can_access_*` content RPCs, and the
  private `podcasts` storage bucket with creator-owner upload policy.
- Retargeted `/api/podcast` and legacy `/api/sync` to Cubad service-role storage. The Phase 2
  SHA-256 `cubad:<passcode>` compatibility behaviour and its 12-character minimum remain intact.
- Replaced subject-type UI forks with shared `SubjectHome` and `UnitPage` components and rewired
  all Phase 3 routes to DB-backed content without changing their subject-specific visible content.
- Added local-only `scripts/migrate-from-sprout.mjs`, interim `scripts/upsert-unit.mjs`, the
  authenticated `/api/revalidate` route, content validation, unit tests, and RLS/RPC probes.
- Documented the revalidation token in `.env.example` without any value.

## Logical commits

| Commit | Purpose |
| --- | --- |
| `a0e0903` | Add `section_order`; deprecate subject `kind` |
| `91f1d31` | Retire runtime `lib/content.ts` use and mirror ordering |
| `765ab2d` | Add DB-backed cached content read layer |
| `5be5cb8` | Add catalogue RLS/RPCs and podcast storage |
| `6e2a696` | Retarget podcast API to Cubad |
| `d2d4f8f` | Retarget legacy sync API to Cubad |
| `28a973f` | Add unified subject-home and unit-page components |
| `c3e6654` | Rewire routes and remove subject `kind` UI forks |
| `0838801` | Add local Sprout migration script |
| `0a072cb` | Add interim publish and revalidation flow |
| `7c82948` | Add content DB tests and RLS/RPC gate |

## Pre-merge validation evidence

| Gate | Evidence |
| --- | --- |
| Baseline/final lint | `npm run lint` has zero errors and the accepted Phase 1 waiver only: 10 React-hook warnings. |
| Typecheck and build | `npx tsc --noEmit` and `npm run build` passed. |
| Unit tests | `npm test` passed: 4 files, 19 tests. |
| Content validation | `node scripts/validate-content.mjs` passed: 2 subjects, 19 files, 56 walkthrough questions. |
| Invalid publish atomicity | Publishing an invalid `{}` fixture failed with six validation errors; remote `hidroloji/giris` version and timestamp were unchanged. |
| Revalidation auth negative path | Local `GET /api/revalidate?secret=wrong` returned HTTP 401 and `{ "revalidated": false, "error": "invalid secret" }`. |
| Cubad remote migration ledger | Existing project `qjcaangaxpkihxxzexpq` contains the Phase 1/2 migrations plus `20260718141450_content_read_policies` and `20260718141452_podcasts_storage`. |
| Local reset gate | After the documented local-only storage baseline repair, `supabase db reset` completed, all six migration IDs were present, and the content seed restored 2 subjects / 19 units. |
| RLS/RPC negative paths | `npx supabase db query --linked --file supabase/tests/probe-content-access.sql` returned `ALL PROBES PASSED`; the free `hidroloji/giris` access check returned `true`. |
| Sprout migration integrity | Existing Sprout `rywcdqpnwwumbpubkofc` had 3 `cubad_sync` rows and 34 podcast objects. Target Cubad has the exact 3 migrated source sync rows (plus one preserved pre-existing target row) and the exact 34 object paths. Three JSON byte/hash samples matched exactly. A second run copied 0 podcast objects, skipped 34, and reported no failures. |
| Route migration checks | No `app` runtime import remains from `@/lib/content`. The only `kind === "bar"` checks are unrelated chart-series rendering. |
| Local visual regression | Hydrology and Construction subject/unit pages, child quiz/cards/practice routes, correct quiz feedback, card flip/rating controls, and practice progress persistence all worked in a clean browser tab with no console errors. |

## Security and operational record

- Used only the existing Cubad project `qjcaangaxpkihxxzexpq`, existing Sprout project
  `rywcdqpnwwumbpubkofc`, and existing Vercel project `cubad`. No replacement project was
  created.
- Supabase service-role credentials were requested from the authenticated CLI only for transient
  local command environments. They were never printed, written, staged, or committed.
- `SPROUT_SERVICE_KEY` was available through that authenticated CLI access for Task 10 only and
  remains local-only. It was not added to Vercel.
- The migration has a 30-second request deadline and retries to avoid an indefinite blocking
  remote storage transfer. A WAV hash attempt exceeded that deadline, so exact object-path
  equality plus JSON byte/hash samples are the recorded integrity evidence.
- The old Sprout URL/anon variables stay in the environment template for rollback compatibility
  for at least 60 days. The Phase 2 Sprout RLS repair remains untouched because it was
  capability-scoped. `/api/sync` now targets Cubad `legacy_sync`; this is the recorded retargeting
  decision.
- A fresh `REVALIDATE_SECRET` was configured as sensitive in the existing Vercel project by the
  project owner and a deployment was triggered. Its value was never requested, displayed, or
  placed in the repository. The deployment was from `main` before this branch is merged and is
  therefore not Phase 3 production verification.
- One Vercel CLI link operation created a downloaded development `.env.local`. It was immediately
  removed without opening it; no value was exposed, staged, or committed.

## Required post-merge closeout

1. Open, review, and merge the Phase 3 PR after required CI passes. Use the existing Vercel
   project; do not create or relink a replacement project.
2. Verify Production environment names and values without displaying secrets:
   `NEXT_PUBLIC_SUPABASE_URL=https://qjcaangaxpkihxxzexpq.supabase.co`, the Cubad anon key,
   Cubad service-role key, `NEXT_PUBLIC_APP_URL=https://cubad.vercel.app`, unchanged Gemini key,
   retained legacy Sprout rollback variables, and the sensitive `REVALIDATE_SECRET`.
3. Confirm the deployment built from the merged `main` commit, then run production smoke tests:
   subject/unit routes for both subjects, quiz/practice/card persistence, tutor, podcast upload and
   playback, two-browser legacy-passcode sync, browser console, and an owner-performed valid
   `/api/revalidate` request. Do not expose the secret in a URL capture, logs, terminal output, or
   this document.
4. Append PR URL, CI result, merge SHA, migration confirmation, deployment URL/SHA, and each
   production smoke-test result to this handoff. Keep the old Sprout credentials until the 60-day
   rollback window ends.

**Do not begin Phase 4.**

