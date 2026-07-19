# Phase 4 handoff - Catalog Gating, Tiers, Entitlements & Access Codes

**Status:** Complete. Implementation PR merged, Cubad migrations are ledger-verified, and
Production is Ready and smoke-tested.

**Date:** 2026-07-19

## Scope and infrastructure

- Existing Cubad Supabase only: `qjcaangaxpkihxxzexpq`.
- Existing Vercel project only: `cubad`.
- Legacy Sprout `rywcdqpnwwumbpubkofc` was not linked, queried, or changed.
- Payments and payment claims remain Phase 6. `/upgrade` is informational and the paywall says
  that online payment is not available yet.
- Podcast playback remains public; generation/regeneration authorization remains admin-only.
- `/api/state` remains the only progress-sync mechanism. No passcode or `/api/sync` path exists.

## Approved first-chosen preview design

The approved extension supersedes Master Plan D6/D7 only where they required an account for all
study and treated `units.is_free` as a global bypass:

- A visitor or unentitled student can select exactly one complete published unit.
- `has_subject_access(subject_id)` is entitlement-only. `units.is_free` remains catalog metadata,
  but does not independently authorize content.
- A signed-in choice is a strict-RLS, one-row-per-user durable fact that the student cannot
  update or delete. It survives browser clearing and device changes.
- An anonymous choice is bound to a random 32-byte HttpOnly, SameSite=Lax browser cookie. Only a
  SHA-256 digest is forwarded to/stored by the database, for 180 days. No identity, fingerprint,
  IP address, or progress is attached.
- Signup/sign-in promotes an anonymous choice only when the account has no durable choice. An
  existing account choice always wins.
- Clearing anonymous browser data creates a new unlinkable capability. Preventing that reset
  would require authentication; the UI states this limitation.
- Unit content is released only for the selected preview, a covering active entitlement, or an
  admin. The unit page, quiz, practice, cards, question, and formula routes share this gate.

## Prerequisite and migration evidence

Before implementation, the required functions, tables, and covering partial index were present;
RLS was enabled on all monetization tables; exactly one admin existed; and all 19 published units
were free under the Phase 3 baseline. The remote migration ledger matched local through
`20260718235500`.

All migrations reset cleanly locally and are applied to the Cubad ledger:

| Migration | Purpose |
| --- | --- |
| `20260719123141_phase4_pgcrypto.sql` | Guarantee `extensions.pgcrypto` for SHA-256 hashing |
| `20260719123440_phase4_has_subject_access.sql` | Entitlement-only subject access predicate |
| `20260719123642_phase4_preview_selections.sql` | Anonymous/durable first-choice storage and narrow RPCs |
| `20260719123926_phase4_get_unit_content_entitlement_gate.sql` | Stable content RPC plus raw `units` RLS gate |
| `20260719124119_phase4_redeem_code.sql` | Atomic rate-limited redemption and append-only stacking |
| `20260719124315_phase4_monetization_rls.sql` | Least-privilege grants and monetization RLS policies |
| `20260719130025_phase4_seed_term_all_tier.sql` | Canonical published 120-day all-access tier |
| `20260719130920_phase4_profile_client_privileges.sql` | Restore owner profile SELECT/UPDATE on a clean stack |
| `20260719135536_phase4_review_security_hardening.sql` | Trusted anonymous claims, admin RLS parity, and scheduled expiry purge |

The initial `supabase db push --linked --dry-run` listed only the first eight migrations. The
project reference was asserted as `qjcaangaxpkihxxzexpq` before push. The subsequent ledger shows
matching local and remote versions. The CLI reported a post-apply pg-delta cache-catalog certificate
warning, but did not roll back; the ledger and live PostgREST probes below confirm the applied
state.

## Database, RLS, and concurrency evidence

`supabase/tests/04-access.sql` runs transaction-scoped synthetic fixtures and reports:

- hash parity between application normalization and SQL;
- anonymous claim execute denied at the public API, with authenticated/service execution retained;
- an indexed daily purge job for expired anonymous capability rows;
- immutable one-unit anonymous selection and durable promotion;
- unentitled and second-unit denial;
- invalid, revoked, expired, exhausted, valid, and duplicate code branches;
- append-only entitlement stacking;
- expired/revoked entitlement denial;
- rate limiting on attempt six;
- admin draft access;
- owner-only profile reads/updates with role escalation denied;
- access-code secrecy, preview isolation, and entitlement write denial.

Result: `ALL PHASE-4 ACCESS PROBES PASSED`.

`supabase/tests/04-access-concurrency.ps1` used two independent psql sessions against the final
redemption slot. Result: exactly one success, one exhausted response, and matching 1:1 redeemed
and ledger counts.

After the remote migrations, `scripts/verify-phase4-postgrest.mjs` created an ephemeral confirmed
student and exercised raw PostgREST with its real JWT. It passed anonymous one-unit isolation,
profile ownership/role protection, raw `units` filtering, empty student `access_codes`, rejected
student entitlement insertion, atomic code redemption, owner entitlement visibility, and catalog
unlock. Cleanup was verified with `temp_users=0` and `temp_codes=0`. The canonical tier count is
one and the published-unit count remains 19.

## Application and UI evidence

The Playwright browser verification used an arbitrary second Hydrology unit, proving the preview
is first-chosen rather than globally fixed:

1. Anonymous catalog offered all units as preview candidates.
2. Selecting unit 2 displayed the full lesson; the other eight units became locked.
3. Direct locked quiz and question URLs redirected to the locked unit page and did not expose
   question content. Aggregate formulas redirected to the subject page while unentitled.
4. Signup preserved the anonymous choice; onboarding completed on a clean database.
5. A second browser context, with the anonymous preview cookie removed, still showed unit 2 as
   the account preview and eight locked units.
6. The signed-in paywall showed the published 120-day tier and explicitly said payments are not
   available. Turkish paywall/redemption copy and invalid-code feedback rendered correctly.
7. A synthetic local code unlocked unit 1. The account displayed `Erisim bitisi 16 Kas 2026`
   (Access until 16 Nov 2026).
8. Browser console: zero errors.

## Local quality gate

| Gate | Result |
| --- | --- |
| `supabase db reset` plus content seed | Pass: 2 subjects, 19 units |
| Phase 4 SQL probes | Pass |
| Two-session concurrency race | Pass |
| Vitest | 8 files, 54 tests passed |
| TypeScript | `npx tsc --noEmit` passed |
| ESLint | 0 errors, unchanged baseline of 8 warnings |
| Content validation | 2 subjects, 19 files, 56 walkthrough questions; content OK |
| Production build | Next.js 16.2.10 passed; all gated routes are dynamic |

## Pull request, CI, Preview, merge, and Production

- PR: [#15 - Phase 4: catalog tiers entitlements and access codes](https://github.com/ACubad/cubad/pull/15)
- Final GitHub `build-and-test`: passed in 46 seconds.
- Final Vercel Preview `dpl_HfJFbjRAfcnyCczw9N1X6f9tYBbQ`: Ready. Protected smoke through the
  authenticated Vercel bypass confirmed home rendering, preview chooser/no full content for an
  unchosen unit, and the `/redeem` sign-in boundary.
- CodeRabbit completed with six inline threads. All were fixed and revalidated: raw anonymous
  claim escalation, backslash redirect normalization, admin draft metadata, date hydration,
  explicit profile ownership filtering, and shared redirect validation. Two useful review nits
  were also included: admin raw-table parity and scheduled expired-preview cleanup.
- The thread-aware GraphQL audit reported zero unresolved review threads before merge.
- The suggestion to change CHECK additions to `NOT VALID` was not applied because that migration
  was already ledger-applied before review; editing applied migration history is forbidden. The
  constraints were validated successfully on both environments when applied.
- A Vercel CLI protected-smoke attempt auto-created an empty `cubad-phase4` project before it was
  linked to the intended project. It had no deployment and was immediately deleted; Vercel then
  verified it no longer existed and that the existing `cubad` project remained.
- PR #15 merged to `main` at `7b5ba33d4cde68ed117575b88abfeb23f0d4dbbe` on
  2026-07-19 14:07:53 UTC.
- Vercel Production `dpl_D8AwE63jpQ4CVWm52kXxbBqGD1wN` reached Ready and serves
  `https://cubad.vercel.app`.
- Fresh-production smoke chose Hydrology unit 2 and received its full lesson; unit 1 remained
  locked with no concept content; `/redeem` redirected anonymous access to sign-in; browser
  console reported zero errors and zero warnings.

## Credential dependencies and human-only actions

- No real access-code plaintext, API key, JWT, or password is stored or committed. CLI/project
  credentials were held only in process memory for the remote probe.
- No payment credential is needed in Phase 4.
- A production administrator podcast-generation smoke test is intentionally excluded unless the
  owner authorizes publishing real audio.

## Deviations and remaining verification

- The approved first-chosen preview behavior above intentionally replaces the older static-free
  assumption. It is enforced consistently in SQL and application routes.
- Clean-stack onboarding exposed that the earlier owner policies on `profiles` lacked explicit
  `authenticated` table privileges. The additive repair grants only SELECT and UPDATE; owner RLS
  and `profiles_protect_role` continue to deny cross-user access and role escalation.
- The implementation follows the current Phase 3 function signature and repository route names
  where they differ from illustrative names in the original Phase 4 plan.
