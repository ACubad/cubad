# Phase 2 handoff — Auth, Profiles & Server-side Progress

**Status:** Closed — merged to `main` and deployed to the existing Vercel production project.

**Branch:** `feat/phase-2-auth-profiles` (created from updated `main`)

**Date:** 2026-07-18

## Delivered

- Existing Supabase project `cubad` (`qjcaangaxpkihxxzexpq`) configured for email/password auth,
  confirmation, token-hash templates, and Resend custom SMTP. No replacement Supabase or Vercel
  project was created.
- Signup profile trigger and hardened single role-guard trigger migrations.
- Root Next 16 `proxy.ts`, cookie refresh, protected-route guards, and a server-only auth DAL.
- Bilingual signup, sign-in, confirmation, recovery/reset, onboarding, account editing, and
  legacy-passcode import flows.
- Authenticated `/api/state` transport, account-aware sync/reset, `/api/me`, and the header
  account menu. The menu and `SyncManager` refresh after a server-action auth route transition.

## Commits on the branch

- `93068ec` `chore(auth): supabase email auth, Resend SMTP, token_hash templates`
- `9ace007` `feat(db): profile-creation trigger, extend role guard, verify service-role client`
- `0a502fb` `refactor(sync): extract pure merge; add passcode hash + auth DAL (with tests)`
- `ebb9012` `feat(auth): root proxy.ts session refresh + optimistic route guards`
- `0e60bb6` `feat(auth): sign-up/in/out, reset, confirm route + bilingual UI`
- `51fa84a` `feat(onboarding): wizard, country list, legacy passcode import`
- `a5bc91c` `feat(progress): /api/state transport; account-aware sync + reset`
- `0b8b54c` `feat(account): account page + header account menu`
- `7d9a800` `test(auth): full gate + RLS negative-path verification`
- `5b195b4` `fix(gate): restore content test and anonymous passcode sync`

## Validation evidence

| Check | Result |
| --- | --- |
| Resend SMTP | TLS authentication passed; a direct permitted-owner SMTP test and a real Supabase confirmation email were marked delivered by Resend. |
| Confirmation template | Delivered confirmation rendered the required token-hash `/auth/confirm` link. The route exchanged a generated confirmation token and landed at `/onboarding`. |
| Recovery flow | Recovery token exchange, password update, and subsequent sign-in passed. Invalid-token, wrong-password, unconfirmed-email, and rate-limit UI paths passed. |
| Profile/RLS | Signup trigger defaults, cross-user read/write denials, role-escalation denial, legacy-sync denial, and unauthenticated `/api/state` 401 passed. |
| Progress/import | Authenticated `/api/state` POST/GET/reset round trip passed; known and unknown passcode import feedback and server merge passed. |
| Legacy passcode regression | Arbitrary passcode POST/pull and cleanup passed; a different passcode returned no state. A prior direct REST probe confirmed a headerless table query returns no rows. |
| `npx vitest run` | Passed: 3 test files / 11 tests. |
| `npm run lint` | Passed with only the accepted ten Phase 1 React warnings. |
| `npm run build` | Passed; output includes `ƒ Proxy (Middleware)`, `/api/me`, `/api/state`, and all Phase 2 routes. |
| Content validation | Passed: 2 subjects, 19 files, 56 walkthrough questions. |
| `npx supabase db reset` | Passed from scratch with both Phase 2 migrations. |
| Security advisors | No new Phase 2 errors; no mutable-search-path warning for the Phase 2 functions. |

## Resolved gate findings

1. Vite could not import `scripts/seed-content.mjs` during `tests/seed-content.test.ts` because
   its leading shebang is not valid when Vite parses the file as an ESM module. The script is
   already invoked through `node` and is not executable in Git, so only that inert shebang was
   removed. `npx vitest run` now passes all 3 files / 11 tests.
2. The old Sprout `cubad_sync` policies were pinned to one stale row hash, producing a PostgREST
   42501 denial for every other passcode. The documented repair script was applied only to the
   existing Sprout project. `/api/sync` sends the derived row id in `x-cubad-sync-id`; each anon
   policy now permits only a row whose id exactly equals that request header. Verification proved
   an arbitrary passcode round trip, cross-passcode isolation, and zero rows from a headerless
   table query.

The legacy passcode remains a deliberately low-assurance compatibility capability (four or more
characters), not account authentication. It is retained solely for the pre-Phase-2 migration path;
authenticated progress uses `/api/state`. The exact-row policy prevents table listing and unrelated
row access but cannot make a user-selected passcode high entropy.

The complete task log and dashboard-only limitation notes are in
`docs/plans/productization/02-auth-profiles.md` under **Changelog / deviations**.

## Operational notes

- The unverified Resend `onboarding@resend.dev` sender accepted the exact owner address but
  rejected tested Gmail `+alias` recipients with SMTP 550. Use a verified sender domain before
  broader email delivery; this is a Phase 7 launch item.
- The Supabase managed reset sender retained a longer-lived rate limit during testing despite the
  configured 60-second interval. The UI handles that response; the recovery route/action was
  independently exercised with a generated token.
- Temporary exact-owner users created exclusively to test email delivery were deleted. Controlled
  alias test users for RLS/auth verification remain harmless in the existing project.
- The legacy RLS repair was applied through the existing Sprout dashboard SQL editor because no
  project-policy API was available in the configured tools. Its reproducible SQL is
  `scripts/repair-legacy-sync-rls.sql`; it is intentionally not a migration for the Phase 2
  `cubad` project.

## Merge/deployment evidence

- Ready PR: [#2](https://github.com/ACubad/cubad/pull/2), with the full validation and security
  rationale in its description. The required GitHub Actions CI run passed:
  [build-and-test](https://github.com/ACubad/cubad/actions/runs/29646851600).
- Merge: PR #2 merged into `main` on 2026-07-18 at `de72384073af9bae9b641db6fafb2d9bee2360da`.
- Deployment: the existing Vercel project's production deployment for that merge succeeded:
  [Vercel deployment](https://vercel.com/acubads-projects/cubad/7bncq62fZBRzLq5q3CHcT6ZrEnwg).
- Live production verification against `https://cubad.vercel.app` passed: root, subjects, unit,
  walkthrough, and valid card/practice/quiz routes returned 200; tutor and podcast endpoints
  returned 200; anonymous `/api/state` returned 401; and `/account` returned 307 to sign-in.

No Phase 3 work was started.
