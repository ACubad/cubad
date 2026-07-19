# Phase 6 handoff — Manual Payments v1

**Status:** Complete. Implementation PR #20 is merged, the final Production deployment is Ready,
the complete payment-claim approval/rejection flow passed with accepted Resend deliveries, and all
disposable Production fixtures were removed.

**Date started:** 2026-07-19  
**Date completed:** 2026-07-19

## Scope and infrastructure lock

- Repository: `ACubad/cubad`; implementation branch `feat/phase-6-payments-v1`.
- Existing Cubad Supabase only: `qjcaangaxpkihxxzexpq`.
- Existing Vercel project only: `cubad` (`prj_xj7q53z2BWaCYnyqlyenxd5KrVqQ`).
- Legacy Sprout remained out of scope and unchanged.
- This phase implements manual payment claims and review only. It does not start Phase 7 or add an
  automatic payment gateway.

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
- The merge deployment `dpl_9fwZ9r4KHFG6kVNHaYgiVrdxVpqk` became Ready before Production
  smoke began.
- The environment-corrected deployment is `dpl_8p5GpRX71yURZj8MCbkA22XRe5uf`, Ready at
  `https://cubad-c0z3s89vv-acubads-projects.vercel.app`; aliases include
  `https://cubad.vercel.app`, `https://cubad-acubads-projects.vercel.app`, and
  `https://cubad-git-main-acubads-projects.vercel.app`.

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

## Durable operating rule

Never use a pulled empty value to declare an encrypted Vercel variable absent or invalid. Use
`vercel env ls` for configuration metadata, compare local candidates without printing them, and use
the deployed runtime for value validity. A Preview variable scoped to one exact Git branch does not
apply to another branch; prefer a project-wide Preview entry when every feature preview needs it.

This rule is also recorded in the Phase 6 plan changelog so the same error is not repeated.
