# Phase 3 handoff — Content in the Database, Unified UI & Sprout Cutover

**Status:** Production cutover is complete and verified for all automated and public browser
gates. The obsolete passcode sync flow has been retired in favor of authenticated account sync.
Creator-authorized podcast upload, a signed-in two-device account merge, and a valid authenticated
revalidation request remain account/credential-holder-only checks. Do not begin Phase 4.

**Implementation branch:** `feat/phase-3-content-db-unified-ui` (based on updated `origin/main` `d78e352`)

**Date:** 2026-07-18

## Delivered

- Added the server-only `lib/content-db.ts` read layer with Next 16 `unstable_cache`, per-content
  tags, `revalidateTag(tag, "max")`, DB catalogue fetchers, and subject/unit convenience helpers.
- Added remote Cubad migrations for catalogue read RLS, the `can_access_*` content RPCs, and the
  public-read `podcasts` storage bucket with no client write policy; uploads use the server-only
  service-role path.
- Retargeted `/api/podcast` to Cubad service-role storage. The passcode-based `/api/sync` path
  was subsequently retired after migration integrity was verified; account-authenticated
  `/api/state` is the only active cross-device progress path.
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
| `15ededf` | Add Phase 3 pre-merge handoff evidence |
| `5762ffa` | Document the installed Windows GitHub CLI PATH fallback |
| `3c62c8f` | Supply masked Cubad build environment to CI |
| `4f98a49` | Show a persisted quiz result after a browser refresh |
| `d47f0e5` | Retire passcode sync in favor of authenticated account sync |
| `84a4797` | Harden account sync and make clean-stack RLS grants explicit |
| `6c4e31c` | Bind queued resets to their initiating account |

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
  capability-scoped. The migrated `legacy_sync` rows are preserved, but no runtime route or UI
  reads or writes them: authenticated `/api/state` is now the sole cross-device progress path.
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
   playback, account-based progress merge after signing in on a second device/browser, browser
   console, and an owner-performed valid `/api/revalidate` request. Do not expose the secret in a
   URL capture, logs, terminal output, or this document.
4. Append PR URL, CI result, merge SHA, migration confirmation, deployment URL/SHA, and each
   production smoke-test result to this handoff. Keep the old Sprout credentials until the 60-day
   rollback window ends.

**Do not begin Phase 4.**

## Post-merge, deployment, and production evidence

### Pull requests and CI

| Change | Evidence |
| --- | --- |
| Phase 3 implementation | [PR #4](https://github.com/ACubad/cubad/pull/4) merged after CI run `29651539795`, Vercel Preview, and CodeRabbit passed. Merge commit: `d6bb0d081e9ea7527a9421a8b48a1507ef0db8ec`. |
| Corrective production-smoke fix | [PR #5](https://github.com/ACubad/cubad/pull/5) merged after CI, Vercel Preview, and CodeRabbit passed. Merge commit: `74c9a3e747955c7f91e1b6425885d051a99a072f`. GitHub Actions CI run `29652023402` passed. |
| Preview verification | The #5 Vercel Preview deployment `dpl_9TMBePTLcKvifnVfsKKQ6frprsQX` (`https://cubad-120q2adjr-acubads-projects.vercel.app`) was Ready. A completed quiz displayed `Saved result: 8/8` after a hard refresh. |
| Authenticated-sync follow-up | [PR #9](https://github.com/ACubad/cubad/pull/9) merged as `ce6ba9988da367782bcd914c6916fb782324e3b7`. GitHub Actions CI run `29659643707` passed all lint, content-validation, test, and build steps. CodeRabbit passed after the PR was marked ready. |
| Account-sync audit | [PR #11](https://github.com/ACubad/cubad/pull/11) merged as `664fbabaddbcfc9f469adf771b6f00fb1177d5f1`. The final GitHub Actions CI run `29661024385` passed lint, content validation, tests, and build. An automated P1 review finding on the earlier head was corrected by `6c4e31c` and covered by a queue-specific regression test before the final CI run. |

### Cutover decision and environment record

- The existing Vercel project `cubad` was retained. Production now uses Cubad's public URL,
  anon key, and sensitive service-role key, plus `NEXT_PUBLIC_APP_URL=https://cubad.vercel.app`.
  The existing Gemini value, sensitive `REVALIDATE_SECRET`, and legacy Sprout rollback variables
  were retained; no value was printed, committed, or added to a document.
- The same three Cubad build variables were configured for the two Phase 3 Preview branches and
  each affected Preview was explicitly redeployed after configuration. This avoids preview builds
  silently compiling against the legacy project while leaving the global sensitive revalidation
  value untouched.
- GitHub Actions received the corresponding Cubad build variables as repository secrets. The
  first Windows PowerShell stdin submission included a byte-order mark and caused a CI
  `ByteString` failure. It was replaced through the installed GitHub CLI's direct secret-body
  path after trimming the BOM; values were never displayed.
- The old Sprout variables and its Phase 2 capability-scoped RLS repair remain untouched for the
  60-day rollback window. The migrated `legacy_sync` data remains intact, but the passcode route,
  UI, and one-time import action are retired. After the verified migration integrity rerun, the
  account-authenticated `/api/state` merge became the only progress-sync mechanism.

### Migration confirmation

- The existing Cubad project has all Phase 3 migrations plus
  `20260718235000_content_read_privileges` and `20260718235500_user_state_client_privileges`
  applied. Local and remote transactional content and account-state RLS probes passed; the free
  Hydrology `giris` unit remained readable after its negative-path check.
- The local-only Sprout migration transferred the three source `cubad_sync` records and all 34
  podcast object paths. Its idempotency rerun copied zero objects, skipped 34, upserted the three
  sync rows, and reported no failures. Exact JSON byte/hash samples and the source/target path
  manifest are recorded above; the target's separate pre-existing `legacy_sync` row was preserved.

### Production deployment and smoke tests

The initial Phase 3 production deployment from `d6bb0d0` exposed a user-visible quiz-refresh
gap: the saved score persisted but a fresh quiz did not show it. Per the plan's rollback rule,
that deployment was rolled back immediately to `dpl_yPpjFAJXhPLy6EPPae2L5YCxwV48`. PR #5 added
the saved-result status, passed Preview refresh verification, and was then merged.

The final production deployment is `dpl_An5MP4UjAyHksE7WNKz2KnoVzCh3`
(`https://cubad-ncwpvzuk7-acubads-projects.vercel.app`), built from `main` commit `74c9a3e` and
Ready. It was explicitly promoted so `https://cubad.vercel.app` resolves to that exact deployment;
the promotion was needed because the rollback had left the public alias on the earlier build.

| Production gate | Result |
| --- | --- |
| Home and subject homes | Passed. The public site rendered both Hydrology and Construction; their homes showed 9 and 10 unit links respectively. |
| Unit pages | Passed. Hydrology `giris` rendered its introduction, formulas, and questions; Construction `giris` rendered its content, notes, and podcast controls. |
| Quiz persistence | Passed. A completed 8/8 Hydrology quiz showed `Saved result: 8/8` after a production hard refresh. |
| Flashcard persistence | Passed. A `Good (2)` rating advanced the deck from 1/107 to 2/107 and changed box 2 from 2 to 3; the box-2 count remained 3 after reopening the route. |
| Practice persistence | Passed. Correctly answering the first Construction question showed `1/56` and `Score: 1/33`; both values remained after reopening the route. |
| Podcast playback readiness | Passed for migrated content. The English audio control loaded the Cubad Storage public object `podcasts/insaat-yonetimi/giris/en.wav` with `readyState: 4`. |
| Tutor | Passed. The production tutor dialog reported its configured Gemini server key, accepted a course question, and returned a streamed answer. |
| Client error sweep | No Cubad application error or failed response was observed. Chrome reported only its known extension listener-channel closure message on prior route navigations; it has no Cubad stack/location and was treated as browser-extension noise. |
| Creator-authorized upload | Pending owner-only test; no creator/admin credential was invented or used. The RLS policy and secure upload path were exercised by the migration/RLS gates. |
| Legacy-passcode sync | Retired by the account-authenticated sync follow-up. No passcode is collected, stored, or sent by runtime code. |
| Valid `/api/revalidate` | Pending owner-only test using the existing sensitive secret without exposing it in a URL capture, logs, shell history, or this document. The invalid-secret 401 gate passed locally. |

### Authenticated-sync follow-up (2026-07-18)

- The user requested that identity be the sole cross-device mechanism now that accounts exist.
  The passcode `SyncCard`, import form, `/api/sync` endpoint, and hash helper were removed.
  Existing migrated `legacy_sync` rows were deliberately not deleted.
- `SyncManager` now pulls, union-merges, applies, and writes account state through `/api/state`
  after a `SIGNED_IN` event, on route load, and after a debounced local state change. Obsolete
  locally stored passcodes are cleared without being read or transmitted.
- Regression coverage confirms unauthenticated sessions issue no sync request and authenticated
  sessions call only `/api/state`. `npm test` passed 4 files / 18 tests; content validation passed.
  `npm run lint` had zero errors and only the accepted legacy React warnings (9 after removing the
  passcode UI). A clean `npm run build` compiled and type-checked; prerendering could not continue
  in this secret-free worktree because no local Supabase build variables are present. No secret was
  generated, displayed, downloaded, or committed for that check.
- The existing-project Preview for the new branch failed only while pre-rendering `/` because that
  branch has no `NEXT_PUBLIC_SUPABASE_URL` configured. Its log still showed successful compile and
  type-check. No Vercel environment value was read, printed, created, or changed; the PR merged
  after CI passed using the documented administrative override for this known branch-scoped Preview
  limitation.
- The existing Vercel project deployed merged `main` commit `ce6ba99` as
  `dpl_555msjYLh7wRBMig2YabQAW8oJmR`
  (`https://cubad-67et9um96-acubads-projects.vercel.app`), Ready. The production alias
  `https://cubad.vercel.app` resolves to that deployment.
- Production public smoke passed: `/`, both subject homes, and both `giris` unit pages returned
  HTTP 200. The unauthenticated `/api/state` boundary returned HTTP 401, and retired `/api/sync`
  returned HTTP 404. A visible production browser tab was anonymous (it showed “Sign in”), so no
  login was attempted and no user data was changed to force the signed-in merge check.

### Account-sync and clean-stack audit (2026-07-18)

- Two additive Cubad migrations were applied to the existing project: explicit `SELECT` grants for
  the Phase 3 catalogue tables, and `SELECT`/`INSERT`/`UPDATE` grants for authenticated
  `user_state` access. They do not add anonymous writes, user-state deletion, or any policy that
  weakens the existing RLS predicates. The remote migration ledger and both content and
  owner-vs-other-user transactional probes passed after application.
- A fresh local `supabase db reset` replayed all eight migrations. The content seed restored 2
  subjects / 19 units; local PostgreSQL probes passed for catalogue negative paths and for an
  automatically rolled-back, temporary auth-user `user_state` fixture. The revised user-state
  probe is self-contained and leaves no real account or study data behind.
- The authenticated sync now isolates browser-local progress by account, clears that projection on
  sign-out, serializes sync/reset operations, prevents a reset from crossing an auth switch, and
  resolves concurrent-device writes with `updated_at` compare-and-swap plus a bounded 409
  merge/retry. The legacy passcode/API path remains retired; no Sprout data, credentials, or Phase
  2 capability-scoped RLS repair was changed.
- Automated audit gates passed: 31 Vitest tests, TypeScript, content validation (2 subjects, 19
  files, 56 walkthrough questions), a production Next build against temporary process-only local
  Supabase values, local and remote RLS probes, and the anonymous storage-upload negative path.
  Lint had zero errors and the existing accepted 9 React warnings only. The local Storage API
  returned an HTTP 400 wrapper containing its internal 403 RLS denial; no podcast object was
  created.
- No human dashboard action, Vercel environment operation, sensitive credential, revalidation
  secret, production user state, or Sprout project access was needed for this audit. The Supabase
  CLI emitted its known post-apply certificate-cache warning after each successful migration; the
  remote ledger confirmed both migrations.

### Audit deployment closeout (2026-07-18)

- The existing Vercel project `cubad` deployed merged `main` as
  `dpl_EvDaWow4Y5BGpFfy9UATpSZo1ujt`
  (`https://cubad-87dqdfyvk-acubads-projects.vercel.app`), Ready. Its aliases include
  `https://cubad.vercel.app`; no replacement project or production environment value was created.
- Production smoke passed: home, both subject homes, both `giris` unit pages, and the migrated
  Cubad podcast object returned HTTP 200. Unauthenticated GET and POST requests to `/api/state`
  returned HTTP 401; retired `/api/sync` returned HTTP 404. No signed-in account was used, so no
  production study state was created or altered.
- The final PR Preview compiled and type-checked but failed while prerendering `/` because this
  new branch had no `NEXT_PUBLIC_SUPABASE_URL` Preview value. This was the previously documented
  branch-scoped Vercel configuration limitation, not a code failure; GitHub CI and the production
  deployment both passed. The merge used the existing documented administrative override.

The production code/data cutover is therefore live and verified. Keep Sprout available and do not
remove its rollback variables until the two remaining owner-only checks above are recorded and the
60-day rollback window has elapsed.

### Preview environment repair and account/content-control follow-up (2026-07-19; deployed)

- The project owner added the existing Cubad URL, anon key, and service-role key to the global
  **Preview** environment in the existing `cubad` Vercel project, without branch restrictions.
  Production values were retained. The sensitive values were never displayed, copied into the
  repository, or requested in chat. A newly redeployed Preview build reported **Ready**, resolving
  the historical branch-scoped `supabaseUrl is required` build failures.
- A real account test confirmed remote state reaches a second signed-in browser. It also exposed
  that the prior server-only sign-out left the browser's auth client and local projection active.
  The follow-up branch `fix/phase-3-account-isolation-admin-podcasts` fixes that by signing out
  through the browser client, clearing all local study state and locally stored user API keys, then
  replacing the route with `/auth/sign-in`. Guests can study during the current page session, but
  their progress, flashcard boxes, practice drafts, and tutor history are no longer durable.
- Podcast playback remains public. Podcast creation and regeneration are now server-authorized for
  `profiles.role = 'admin'` only; anonymous callers receive 401 and signed-in students receive
  403 before content, Gemini, or Storage are touched. The public generation buttons and browser
  Gemini-key path were removed. An administrator uses the server-only configured Gemini key and
  retains the quality-control responsibility for published audio.
- The Phase 4 product decision is now explicit: signing up grants identity and cross-device
  progress only, never content access. The provisional preview rule is one **full lesson/unit**:
  the visitor's first lesson choice becomes their free preview, and all other units are locked for
  both anonymous and ordinary signed-in students. Phase 4 must define how that first choice is
  persisted across anonymous and authenticated devices and protected from resets before coding the
  gate. Anonymous visitors see a sign-in/create-account prompt; signed-in students without an
  entitlement see the redeem/upgrade paywall. Payments are still Phase 6. This is a working product
  direction to sharpen in Phase 4, not a Phase 3 gating implementation.
- Automated follow-up evidence: 35 Vitest tests passed, including anonymous and student podcast
  generation negative paths; TypeScript, content validation (2 subjects / 19 files / 56 questions),
  and the production build passed. Lint had zero errors and the accepted existing React warnings.
- With explicit owner authorization, the newly created owner profile was granted `admin` in the
  existing Cubad Supabase project through the capability-scoped service-role path. Verification
  returned exactly one matching authentication account, one profile, and one admin role. No account
  identifier or credential is recorded here.
- Follow-up PR [#13](https://github.com/ACubad/cubad/pull/13) passed GitHub
  `build-and-test` (Actions run `29684730972`) and the Vercel Preview checks, then merged to `main`
  as `7dbac7a0cb81ba12e16d85231e038d8bee7f5ebe`. CodeRabbit remained in its optional review state
  after the required checks passed; repository protection did not require that bot, and GitHub
  reported the exact reviewed head as mergeable. This timing decision did not bypass a required
  build, test, or deployment gate.
- The existing `cubad` Vercel project deployed that merge to Production as
  `dpl_8JBH7jtPDMgnHnd1ZEwEm5cDRpjF`; the deployment reported **Ready** and retained the canonical
  `https://cubad.vercel.app` alias. Live smoke results were: home 200, sign-in 200, unauthenticated
  `/account` 307 to authentication, unauthenticated `/api/state` 401, configured Gemini and podcast
  Storage reported present, anonymous `canGenerate = false`, and anonymous podcast POST 401.
- The automated suite covers the signed-in student podcast POST 403 path. A production
  administrator-generation call was deliberately not used as a smoke test because it would create
  and publish a real audio object; the owner remains the quality-control gate. The remaining
  human-only checks are a fresh signed-in browser refresh (admin controls visible), sign-out redirect,
  account-switch isolation, deliberate administrator generation, and playback. Record those owner
  observations before treating the rollback window as fully closed; they do not authorize Phase 4
  work in this follow-up.
