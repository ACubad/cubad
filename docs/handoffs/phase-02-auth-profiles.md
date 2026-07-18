# Phase 2 handoff — Auth, Profiles & Server-side Progress

**Status:** Implementation complete; PR/merge/deployment pending the recorded inherited gate blockers.

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
- Current final validation commit: `test(auth): full gate + RLS negative-path verification`

## Validation evidence

| Check | Result |
| --- | --- |
| Resend SMTP | TLS authentication passed; a direct permitted-owner SMTP test and a real Supabase confirmation email were marked delivered by Resend. |
| Confirmation template | Delivered confirmation rendered the required token-hash `/auth/confirm` link. The route exchanged a generated confirmation token and landed at `/onboarding`. |
| Recovery flow | Recovery token exchange, password update, and subsequent sign-in passed. Invalid-token, wrong-password, unconfirmed-email, and rate-limit UI paths passed. |
| Profile/RLS | Signup trigger defaults, cross-user read/write denials, role-escalation denial, legacy-sync denial, and unauthenticated `/api/state` 401 passed. |
| Progress/import | Authenticated `/api/state` POST/GET/reset round trip passed; known and unknown passcode import feedback and server merge passed. |
| `npm run lint` | Passed with only the accepted ten Phase 1 React warnings. |
| `npm run build` | Passed; output includes `ƒ Proxy (Middleware)`, `/api/me`, `/api/state`, and all Phase 2 routes. |
| Content validation | Passed: 2 subjects, 19 files, 56 walkthrough questions. |
| `npx supabase db reset` | Passed from scratch with both Phase 2 migrations. |
| Security advisors | No new Phase 2 errors; no mutable-search-path warning for the Phase 2 functions. |

## Pending blockers — do not open the Phase 2 PR yet

1. `npx vitest run` executes all eight new Phase 2 tests successfully, but the inherited
   `tests/seed-content.test.ts` suite cannot import the unchanged BOM/shebang-bearing
   `scripts/seed-content.mjs`. Both files are identical to `origin/main`; this branch does not
   rewrite the unrelated Phase 1 artifact.
2. The unchanged anonymous legacy `/api/sync` route cannot write to the old sprout
   `cubad_sync` table: it returns 502 because the legacy anon key receives PostgREST 42501 (RLS
   write denial). Its replacement is explicitly Phase 3 scope, so no retargeting was done here.

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

## Merge/deployment evidence

Pending. Add PR, merge commit, CI, and existing-Vercel deployment evidence here only after the
two blockers above are resolved and Phase 2 closes. Do not begin Phase 3 as part of that work.
