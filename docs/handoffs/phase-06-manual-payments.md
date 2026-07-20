# Phase 6 handoff — Manual Payments v1

**Status:** Complete. Implementation PR #20 is merged, the final Production deployment is Ready,
the complete payment-claim approval/rejection flow passed, the synchronous approval receipt
reported sent, the asynchronous new-claim/rejection sends produced no failure audits, and all
disposable Production fixtures were removed.

**Date started:** 2026-07-19  
**Date completed:** 2026-07-19
**Continuation audit completed:** 2026-07-20

## Scope and infrastructure lock

- Repository: `ACubad/cubad`; implementation branch `feat/phase-6-payments-v1`.
- Existing Cubad Supabase only: `qjcaangaxpkihxxzexpq`.
- Existing Vercel project only: `cubad` (`prj_xj7q53z2BWaCYnyqlyenxd5KrVqQ`).
- Legacy Sprout remained out of scope and unchanged.
- This phase implements manual payment claims and review only. It does not start Phase 7 or add an
  automatic payment gateway.

## Authoritative continuation baseline

Use this order when two documents appear to disagree:

1. the current code and additive migration history on `origin/main`;
2. this merged handoff and the individual Phase 1–6 handoffs;
3. the master plan's §14 current contract registry;
4. unchecked task prose in an older phase plan.

The Phase 6 plan's many unchecked boxes are retained planning history, not evidence that the work
is incomplete. PR #20, PR #21, this handoff, the applied migration ledger, and the verification
evidence below are the completion record.

The continuation baseline before this handoff-completeness update is:

- `origin/main`: `0973c6395660a77d6b4803d8b198645732b027ef` (merged documentation PR #21).
- Phase 6 implementation merge: `2fb7e91b9d5b665abafa967fcbf97c0181282046` (PR #20).
- Phase 6 closeout documentation merge: `0973c6395660a77d6b4803d8b198645732b027ef`
  (PR #21, final head `9723e0e7476f2974ad3b5eb8ddc9582b66ce30f0`).
- No Phase 7 code, schema migration, external monitor, backup workflow, custom domain, or launch
  banner has started. A new agent must branch from the latest `origin/main`, never from an old
  Phase 6 feature branch.
- The canonical public URL remains `https://cubad.vercel.app`.

## Exact runtime seam registry

| Concern | Authoritative implementation | Contract to preserve |
| --- | --- | --- |
| Student claim create/cancel | `app/upgrade/actions.ts` | `submitClaim` and `cancelClaim` are Server Actions; there is no `/api/claims` route. |
| Claim form | `app/upgrade/pay/[tierSlug]/ClaimForm.tsx` | Receives structured action-state errors; later abuse limiting must add a bilingual `rate-limited` state, not an HTTP claim API. |
| Admin approve/reject/settings | `app/admin/payments/actions.ts` | Server Actions call service-role-only audited RPCs. |
| Approval RPC | `approve_claim(uuid,text,int,uuid)` | Locks the claim; mints a hash-only one-time code; grants with `source='code'`; records redemption, terminal claim state, and audit atomically; plaintext returns once. |
| Rejection RPC | `reject_claim(uuid,uuid,text)` | Locks the claim, requires a note up to 2,000 characters, changes only pending claims, and audits atomically. |
| Settings RPC | `set_app_setting(text,jsonb,uuid)` | Service-role-only, independently validates the admin, and audits the write. |
| Proof storage | private `payment-proofs` bucket | 10 MB maximum; JPEG/PNG/WEBP/PDF only; server-built `<user-id>/<claim-id>/<safe-name>` keys; admin signed URLs last 600 seconds. |
| Transactional email | `lib/email/send.ts` + `lib/email/templates.ts` | Server-only Resend REST client, no `resend` npm SDK. Approval is synchronous; new-claim/rejection are scheduled with `after(...)`. |
| Public settings | `public.app_settings` | Anonymous/authenticated SELECT is allow-listed to `payment_instructions` only; mutation is service-role-only through `set_app_setting`. |
| Progress sync | `lib/sync.ts` + `app/api/state/route.ts` | Authenticated `GET/POST /api/state` is the only runtime progress transport. Retired `/api/sync` must remain 404. |

The Phase 7 plan was reconciled against this registry on 2026-07-20. In particular, it must not
create `/api/claims`, recreate `/api/sync`, expose arbitrary rate-limit keys to client roles, or
replace the settings allow-list with `using (true)`.

## Product behavior delivered

- `/upgrade` lists published paid tiers with country-aware prices and links to a payment page.
- `/upgrade/pay/[tierSlug]` renders bilingual payment instructions, validates amount/currency and
  a JPG/PNG/WEBP/PDF proof up to 10 MB, uploads to private storage, and creates a pending claim.
- `/upgrade/claims` shows pending, approved, and rejected history; students can cancel their own
  untouched pending claim and resubmit rejected claims.
- The paywall now has a primary route to `/upgrade` instead of leaving locked students at a dead
  end.
- `/admin/payments` supplies a pending badge, status/method filters, a newest-first queue, and a
  private signed proof review page.
- Approval atomically creates a hash-only one-time code, immediately redeems it, grants access,
  records audit evidence, and returns the plaintext only once for display/email.
- Rejection requires a student-visible note and records the review transition atomically.
- `/admin/payments/settings` updates the bilingual public payment instructions through an audited
  database function.
- New-claim, approval, and rejection emails use bilingual Resend templates. Email failure never
  unwinds an already committed payment decision; it writes an `email.failed` audit row instead.

## Additive database work

No applied historical migration was edited.

| Migration | Purpose | Local | Cubad remote |
| --- | --- | --- | --- |
| `20260719202748_payments_proofs_bucket.sql` | private `payment-proofs` bucket and upload contract | pass | applied |
| `20260719202750_payments_claims_rls.sql` | owner/admin claim policies and three-open-claim enforcement | pass | applied |
| `20260719202752_app_settings.sql` | payment instructions, public read seam, audited writer | pass | applied |
| `20260719202754_payments_approve_functions.sql` | locked atomic approve/reject functions | pass | applied |
| `20260719205635_payments_privilege_hardening.sql` | deterministic table/function privilege hardening | pass | applied |
| `20260719213400_payments_review_hardening.sql` | race-safe review and queue hardening | pass | applied |
| `20260719215500_payments_public_settings_hardening.sql` | allow-list public settings reads | pass | applied |

The linked remote migration ledger matches local through `20260719215500`; remote database lint
reported no schema errors.

## Security invariants

- Students can read only their own claims, create only their own pending claims, cancel only their
  own untouched pending claims, and cannot forge status, review fields, proof paths, tier prices,
  or review RPC calls.
- Proof keys are server-built beneath the authenticated user prefix. Storage accepts only the
  supported canonical file types and size, and cross-user signed URL access is denied.
- Review RPCs use row locks, check the reviewer independently, expose EXECUTE only to
  `service_role`, and commit the terminal claim state, access artifacts, and audit row together.
- The code plaintext is never stored, logged, committed, included in a handoff, or captured during
  browser verification. `access_codes` retains only its hash.
- Public settings access is allow-listed to `payment_instructions`; a future private setting does
  not become anonymous-readable by reusing `app_settings`.
- Service-role credentials remain server-only and were used for disposable verification through
  process environment loading only.

## Decisions that later phases must not reinterpret

- **Entitlement provenance:** an approved manual payment has entitlement `source='code'`, not
  `source='payment'`, because approval deliberately auto-mints and auto-redeems the one-time code.
  `payment_claims`, `access_codes`, `code_redemptions`, `entitlements`, and `admin_audit_log`
  retain the complete evidence chain.
- **Plaintext lifetime:** the generated code plaintext is available only in the successful RPC
  response for immediate admin display/email. Database, logs, screenshots, tests, and handoffs
  must never retain it.
- **Price resolution:** a tier resolves an exact country price first, then wildcard country `*`,
  then the first configured price. The server re-resolves the published tier and price; it never
  trusts submitted amount/currency.
- **Claim validation:** claim IDs/tier IDs are UUIDs; payment methods are
  `mpesa|tigopesa|airtelmoney|bank|other`; payer reference is at most 200 characters; currency is
  uppercase `[A-Z]{3,8}`; amount is finite and within 0–1e12; proof magic bytes must match the
  declared supported type.
- **Open-claim ceiling:** the UI/action performs a friendly pending-count check, while the
  database trigger is the authoritative concurrency-safe maximum of three open claims.
- **Upload transaction shape:** insert the pending row with `proof_path = null`, upload through
  the service role to the server-built private path, then finalize `proof_path`. A failed upload or
  finalize uses guarded cleanup that cannot delete a claim already reviewed by an admin.
- **Review queue shape:** pending claims are fetched separately before terminal history; the
  combined view is capped at 200 rows. The pending badge is an exact count and fails soft if its
  query fails.
- **Review concurrency:** approve/reject controls disable each other during mutation. Database row
  locks and stable SQL error codes, not message-text matching, determine the one valid winner.
- **Email transaction semantics:** email never rolls back a committed money/access decision.
  Missing config, provider rejection, or network failure produces `admin_audit_log.action =
  'email.failed'` with non-secret diagnostics. Approval reports its synchronous result to the
  reviewer; asynchronous new-claim/rejection results are observable through audit/Resend logs.
- **Localization fallback:** tier titles prefer the requested language, then English, then
  Turkish. All new user-facing errors remain bilingual.
- **Schema history:** never edit an applied migration. Every correction or rollback is a new
  additive migration.

## Review ledger (all resolved before merge)

The final thread-aware audit found 12 actionable review threads and zero unresolved. The fixes
were:

1. constrained client claim inserts to validated fields and published tiers;
2. preserved already-reviewed claims during upload/finalization cleanup races;
3. fetched pending claims before applying the terminal-history queue cap;
4. made approve/reject UI states mutually disabling;
5. preserved already-committed plaintext display when an `expires_at` response was malformed;
6. replaced SQL message matching with stable error codes;
7. added English-to-Turkish tier-title fallback;
8. surfaced guarded claim cleanup failures;
9. made the pending badge count exact and fail-soft;
10. made the genuine-student probe cross-platform with isolated cleanup;
11. strengthened probe storage cleanup and terminal error handling; and
12. replaced generic public settings reads with the explicit `payment_instructions` allow-list.

Do not undo these as cosmetic refactors; each closes a correctness, race, privilege, or evidence
gap found during review.

## Verification before merge

- Fresh `npx supabase db reset` replayed the complete migration history through Phase 6.
- `supabase/tests/06-payments.sql` passed approval, rejection, privilege, audit, settings, and
  one-redemption assertions transactionally.
- `supabase/tests/payments_negative.sql` passed ownership, invalid-state, forged-proof, pricing,
  open-claim-limit, and unauthorized-RPC denials.
- The two-session approval race produced one winner, one `not-pending` loser, one code, one
  entitlement, and one redemption.
- The cross-platform genuine-student remote probe passed cross-user isolation, private storage,
  invalid MIME/size/prefix rejection, direct-write denials, and guaranteed cleanup.
- `npx vitest run`: 77 tests passed.
- `npm run lint`: zero errors; the accepted pre-existing eight warnings remained.
- `npm run build`: Next 16.2.10 Production build passed.
- `node scripts/validate-content.mjs`: content validation passed unchanged.
- Browser acceptance passed signed-out redirects, the TZS tier price, instruction rendering,
  invalid GIF and over-10-MB errors, valid proof submission, cancellation, queue/filter/badge,
  signed proof display, one-time approval, active entitlement, rejection/resubmit, and settings
  update/restore.

## PR, review, merge, and deployment

- Implementation PR: `https://github.com/ACubad/cubad/pull/20`.
- Final head: `6ef4eaa87870ea824daae48cae400ff52698b02e`.
- Final checks: `build-and-test`, CodeRabbit, Vercel, and Vercel Preview Comments all passed.
- Review findings: three Codex and nine CodeRabbit actionable findings were fixed. The final
  thread-aware audit found 12 total review threads and zero unresolved.
- Merge commit: `2fb7e91b9d5b665abafa967fcbf97c0181282046` at 2026-07-19 18:58:06 UTC.
- Closeout documentation PR: `https://github.com/ACubad/cubad/pull/21`; merged as
  `0973c6395660a77d6b4803d8b198645732b027ef` at 2026-07-19 19:32:20 UTC.
- The merge deployment `dpl_9fwZ9r4KHFG6kVNHaYgiVrdxVpqk` became Ready before Production
  smoke began.
- The environment-corrected deployment is `dpl_8p5GpRX71yURZj8MCbkA22XRe5uf`, Ready at
  `https://cubad-c0z3s89vv-acubads-projects.vercel.app`; aliases include
  `https://cubad.vercel.app`, `https://cubad-acubads-projects.vercel.app`, and
  `https://cubad-git-main-acubads-projects.vercel.app`.
- The final documentation-only Production deployment is
  `dpl_CrRam4gtb9jJ6CNsAM15GuuYdjDk`; `https://cubad.vercel.app` remained the canonical alias.

## Resend environment reconciliation

The Vercel project did have `RESEND_API_KEY`; the original closeout diagnosis incorrectly treated
an empty/unusable `vercel env pull` result as proof that the encrypted variable was absent. That is
not a valid inference.

The corrected audit used three separate authorities:

1. `vercel env ls` for configured variable name, target, and Git-branch scope;
2. a live Resend authorization check for candidate validity, without printing any candidate;
3. deployed Production send behavior for the final runtime verdict.

That audit found a valid already-configured candidate in the primary Cubad worktree and a different
invalid candidate in the Phase 6 worktree/Production configuration. The first merged Production
runtime therefore returned Resend HTTP 401 for one synthetic new-claim notification and one
synthetic approval receipt. This proved the variable was present but invalid; it did not prove the
variable was missing.

Closeout then:

- installed the validated key and a verified owner/test recipient for Production and Development;
- removed obsolete Preview email variables scoped only to `feat/phase-1-foundation` or
  `feat/phase-6-payments-v1`;
- created project-wide Preview entries for `RESEND_API_KEY`, `ADMIN_NOTIFY_EMAIL`, and
  `EMAIL_FROM`, so future feature branches inherit the complete matrix;
- redeployed Production so the corrected environment was captured by the runtime.

On 2026-07-20 the continuation audit also found `NEXT_PUBLIC_APP_URL` Preview scoped only to the
old `feat/phase-1-foundation` branch. That obsolete branch-scoped entry was replaced with a
project-wide Preview entry whose canonical value is `https://cubad.vercel.app`. Production and
Development already had that variable and were left unchanged.

The non-secret Vercel scope matrix at handoff is:

| Variable | Production | Development | Preview |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | configured | configured | configured project-wide |
| `RESEND_API_KEY` | configured and live-validated | configured | configured project-wide |
| `ADMIN_NOTIFY_EMAIL` | configured | configured | configured project-wide |
| `EMAIL_FROM` | configured | configured | configured project-wide |
| `NEXT_PUBLIC_SUPABASE_URL` | configured | configured | configured project-wide |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | configured | configured | configured project-wide |
| `SUPABASE_SERVICE_ROLE_KEY` | configured | configured | configured project-wide |
| `REVALIDATE_SECRET` | configured | not listed | configured project-wide |
| `GEMINI_API_KEY` | configured | configured | not listed |

Old branch-specific Supabase Preview entries still exist for some completed Phase 1/3 branches,
but project-wide Preview entries now exist for the three active Supabase variables, so a new Phase
7 branch does not depend on those overrides. `GEMINI_API_KEY` is not currently listed for Preview;
run shared-key tutor probes locally with a safely loaded key, or explicitly configure Preview
before choosing to test that path there. Do not test it by burning Production quota.

Inspect names and scopes with `vercel env ls`. Do not print encrypted values and do not treat an
empty `vercel env pull` result as proof of absence. A fresh worktree's ignored `.env.local` is not
guaranteed to contain any of these values; reconcile it safely from the primary project worktree
or the human-owned secret store without copying stale candidates.

No key, token, recipient identity, password, or one-time code is recorded in Git or this handoff.

## Final Production smoke

Production smoke used one disposable genuine student, one disposable admin, a 1×1 valid PNG, and
the existing owner/test recipient authorized for clearly marked email checks.

- Signed-out `/upgrade` redirected to `/auth/sign-in?next=/upgrade`.
- The student signed in, saw `Term — All access` at 15,000 TZS, submitted private proof claims,
  and saw the pending history state.
- The admin queue badge incremented, the newest claim appeared first, and its signed private proof
  rendered on the review page.
- After the corrected redeploy, a fresh new-claim notification produced no `email.failed` audit.
- A fresh rejection persisted the required note, showed the student Resubmit CTA, queued its email,
  and produced no `email.failed` audit.
- A fresh approval reported `Approved. Access is active.` and `Student email: sent`; the one-time
  code panel existed but its content was neither printed nor captured.
- Database evidence for the successful approval showed exactly one matching entitlement and one
  matching redemption, with code and entitlement references present.
- The student history showed the expected approved/rejected statuses and rejection note; the admin
  pending badge cleared after terminal review.

The two expected pre-correction 401 audit rows and every other disposable artifact were then
removed. Final cleanup verification reported zero fixture claims, profiles, auth users, and proof
objects. Both browser sessions were closed.

The 2026-07-20 continuation audit rechecked the public boundaries without creating data: `/`
returned 200, retired `/api/sync` returned 404, anonymous `/api/state` returned 401, and anonymous
`/upgrade` returned 307 to `/auth/sign-in?next=/upgrade`. The linked Supabase ledger again reported
all 36 local/remote migrations matched through `20260719215500`.
The same audit re-ran lint (zero errors, the same eight accepted warnings), all 77 tests, content
validation, and the Next 16.2.10 Production build successfully after the documentation
reconciliation.

## Known operating behavior and deferred work

These are explicit Phase 6 boundaries, not undisclosed completion failures:

- `cancelClaim` deletes the pending database row first and then removes its proof object on a
  best-effort basis. A storage-removal failure is not returned to the student. Phase 7 may add
  orphan detection/cleanup, but must not weaken the owner/pending-only database deletion guard.
- New-claim and rejection emails are asynchronous and have no retry queue. Failures are audited;
  an operator retries or contacts the recipient manually. The optional Phase 7 reminder work must
  reuse the same audited REST sender and mark a reminder sent only when `SendResult.ok` is true.
- `onboarding@resend.dev` remains the sender. Until a custom domain is selected, DNS-verified, and
  `EMAIL_FROM` is changed, Resend's testing sender can deliver only to the account-owner/test
  recipient. This is a Phase 7 human-owned launch gate, not a missing API-key problem.
- No custom public domain is configured; keep `https://cubad.vercel.app` working throughout any
  later domain cutover.
- The historical `app_settings_write_admin` RLS policy can remain present but is inert because
  anon/authenticated mutation table grants were revoked. Phase 7's new additive banner migration
  should drop it and extend the public read allow-list to exactly
  `payment_instructions, announcement_banner`; it must never use `using (true)`.
- Phase 7 future secrets `CRON_SECRET` and GitHub Actions `SUPABASE_DB_URL` are not configured yet.
  They are prerequisites only for the optional expiry cron and backup workflow respectively; they
  were not Phase 6 requirements.
- Phase 7 also needs a human-approved public privacy/support mailbox before configuring the
  intentionally public `NEXT_PUBLIC_SUPPORT_EMAIL`. Do not expose `ADMIN_NOTIFY_EMAIL` or invent a
  mailbox on an unconfigured domain.
- Sentry is optional and must be explicitly enabled or explicitly skipped in Phase 7. Uptime
  monitors, the backup/restore drill, load testing, Pro-tier decision, privacy page, custom domain,
  and launch banner are also Phase 7 work and have not been represented as complete.

## Phase 7 start contract

Phase 6 is ready for handoff and Phase 7 may begin. A new agent must:

1. fetch and branch `feat/phase-7-hardening-scale` from the latest `origin/main` after this
   handoff-completeness change is merged;
2. read `AGENTS.md`, this handoff, every earlier merged handoff, the full master plan, and the
   reconciled `07-hardening-scale.md` before editing;
3. confirm the working tree is clean, the Cubad Vercel link still points to project `cubad`, and
   Supabase is still linked to `qjcaangaxpkihxxzexpq`; never create replacement infrastructure;
4. verify all 36 local and remote migrations still match through `20260719215500` before creating
   the first additive Phase 7 migration;
5. preserve `/api/state` as the sole progress transport, `/api/sync` as 404, and claim/admin
   payments as the existing Server Actions;
6. keep `check_rate_limit` service-role-only. Client EXECUTE on an arbitrary-key rate-limit RPC
   would let an attacker exhaust another user's bucket and is prohibited;
7. use the Phase 7 plan's minimal `/api/health` dependency check for uptime rather than reviving
   `/api/sync`;
8. stop for human decisions only where the plan explicitly requires ownership or spend: custom
   domain/DNS, Supabase Pro upgrade, Sentry enable/skip, and any paid external service;
9. run tests, lint, build, content validation, local migration replay, remote security probes, and
   disposable E2E verification in proportion to each task; remove every fixture and secret-bearing
   artifact afterward; and
10. update the Phase 7 plan changelog and create `docs/handoffs/phase-07-hardening-scale.md` with
    exact commits, migrations, environment scopes, external configuration, verification evidence,
    unresolved risks, and cleanup proof before declaring Phase 7 complete.

No production claim, proof object, test user, test admin, plaintext code, or unresolved review
thread remains from Phase 6. This is the unambiguous go/no-go verdict: **GO for Phase 7**.

## Durable operating rule

Never use a pulled empty value to declare an encrypted Vercel variable absent or invalid. Use
`vercel env ls` for configuration metadata, compare local candidates without printing them, and use
the deployed runtime for value validity. A Preview variable scoped to one exact Git branch does not
apply to another branch; prefer a project-wide Preview entry when every feature preview needs it.

This rule is also recorded in the Phase 6 plan changelog so the same error is not repeated.
