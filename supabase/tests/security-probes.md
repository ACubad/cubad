# Security probe battery

Run before every deploy touching RLS, storage, or RPCs, and in full for Phase 7's pre-launch
re-run. Client-side probes use only the anon key and disposable-user JWTs. The service role is
used only to create/remove fixtures and to exercise the same server-only transports used by the
application; it must never be used to prove a client denial.

Last full run: **2026-07-20 against `qjcaangaxpkihxxzexpq` — PASS**. The live harness completed
78 sanitized assertions. The Phase 4, 5, and 6 transaction-scoped SQL suites also passed locally.
Cleanup verification found zero disposable Auth users, hidden probe tiers, private-setting
sentinels, or podcast probe objects. No credential value was printed or written to disk.

## 0. Setup

- [x] Use the existing project; never create a replacement project.
- [x] Create `STUDENT_A`, `STUDENT_B`, and `ADMIN` through Supabase Auth, not direct
      `auth.users` inserts.
- [x] Promote only the disposable admin and grant only `STUDENT_A` a disposable entitlement.
- [x] Remove every user, row, and storage object after the run.

For a scratch/local project, use the normal signup flow and then obtain each access token:

```bash
curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"studentA@test.cubad.dev","password":"<test password>"}'
```

The 2026-07-20 live run first attempted normal signup with a non-routable synthetic mailbox. The
live SMTP path returned a sanitized `500 unexpected_failure`. To avoid weakening confirmation or
sending mail to a real person, the run created confirmed disposable identities through the
Supabase Auth Admin API instead. This is not a direct database insert; all authorization probes
still used the resulting ordinary user JWTs.

## 1. Service-role key grep audit — OK 2026-07-20

```powershell
rg -n "SERVICE_ROLE" app components lib -g "*.ts" -g "*.tsx"
```

Expected: all raw environment-variable matches are confined to `lib/supabase/server.ts`.
The audit initially found a presence check in `app/api/podcast/route.ts`; it was moved behind
`isServiceRoleConfigured()` in the server-only module. The focused route tests and ESLint passed.

## 2. `NEXT_PUBLIC_` leak audit — OK 2026-07-20

```powershell
rg -o "NEXT_PUBLIC_[A-Z0-9_]+" app lib components -g "*.ts" -g "*.tsx" |
  Sort-Object -Unique
```

| Variable | Safe? | Reason |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Project URL is public. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Designed for clients; RLS is the data boundary. |
| `NEXT_PUBLIC_APP_URL` | Yes | Used for absolute application links. |
| `NEXT_PUBLIC_SENTRY_DSN` | Yes | Public ingestion endpoint identifier; Sentry auth remains server/CI-only. |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Yes, once approved | Human-approved public contact for `/privacy`; absent on this run. |

Any unlisted name is a new leak surface and must be reviewed before shipping.

## 3. Anon-key capability walk — OK 2026-07-20

- [x] `tracks`, `subjects`, `track_subjects`, and `tiers` returned published rows only.
- [x] `units` returned only published free rows. The live catalog currently has no non-free unit,
      so the non-free content denial was also exercised by `supabase/tests/04-access.sql`.
- [x] `app_settings` returned only `payment_instructions`.
- [x] A private sentinel setting was invisible to both anon and authenticated users, then removed.
- [x] `entitlements`, `access_codes`, `code_redemptions`, `redemption_attempts`,
      `payment_claims`, `admin_audit_log`, `profiles`, `user_state`, `legacy_sync`, and
      `rate_limit_events` revealed no rows. A coarse `401/403` is accepted where Phase 6
      intentionally revoked table privileges; it is stronger than an empty RLS result.

Use `Prefer: count=exact` for any count assertion; never infer a large-table count client-side.

## 4. Authenticated cross-account probes — OK 2026-07-20

- [x] `STUDENT_A` could read their own profile, state, entitlement, and pending claim.
- [x] `STUDENT_A` could not read `STUDENT_B`'s profile, state, entitlement, claim, or redemption.
- [x] A student could not read `admin_audit_log`.
- [x] A student could not directly set their pending claim to approved.
- [x] A student could not insert an access code.
- [x] `has_subject_access()` returned `true` for the entitled student and `false` for the other.
- [x] Authorized unit content was returned. Non-free denial passed in the local Phase 4 suite;
      the live catalog had no non-free unit to target without publishing a synthetic item.

## 5. Storage probes — OK 2026-07-20

- [x] Anon could read a known disposable object in the public `podcasts` bucket.
- [x] Anon and a student could not upload to `podcasts`; service-role write remains required.
- [x] `STUDENT_A` could neither read `STUDENT_B`'s proof nor upload under B's prefix.
- [x] The disposable admin could read B's proof.
- [x] Both disposable objects were removed and the public probe prefix listed zero objects.

## 6. RPC edge cases — OK 2026-07-20

- [x] `redeem_code('GARBAGE')` returned `invalid-code`.
- [x] A valid code redeemed once; replay returned `already-redeemed`.
- [x] Expired and exhausted fixtures returned `expired` and `exhausted`.
- [x] The sixth attempt in one hour returned `rate-limited`.
- [x] Student and admin JWTs could not call `approve_claim()`. This is intentionally stricter
      than the original draft checklist: Phase 6 exposes approval only through a server action
      using the service role, while the RPC independently validates the reviewer UUID.
- [x] The service transport approved once with an admin reviewer; a second call minted no extra
      entitlement.
- [x] Anon and student JWTs could not execute `check_rate_limit()` or
      `cleanup_rate_limit_events()`.
- [x] Anon, student, and admin JWTs could not execute `set_app_setting()`.

The following transaction-scoped suites provide deeper fixture coverage and must remain green:

```powershell
Get-Content -Raw supabase/tests/04-access.sql |
  docker exec -i supabase_db_cubad psql -v ON_ERROR_STOP=1 -U postgres -d postgres
Get-Content -Raw supabase/tests/05-admin.sql |
  docker exec -i supabase_db_cubad psql -v ON_ERROR_STOP=1 -U postgres -d postgres
Get-Content -Raw supabase/tests/06-payments.sql |
  docker exec -i supabase_db_cubad psql -v ON_ERROR_STOP=1 -U postgres -d postgres
```

## 7. Supabase advisors — OK 2026-07-20

- [x] Security advisor: **0 ERROR**, 30 WARN, 4 INFO after remediation.
- [x] Performance advisor: **0 ERROR**, 24 WARN, 17 INFO.
- [x] Enabled leaked-password protection on the existing Pro project; the corresponding warning
      disappeared on re-run. This did not add a paid service or change the plan.
- [x] `rate_limit_events`, `legacy_sync`, `redemption_attempts`, and
      `anonymous_preview_selections` report “RLS enabled, no policy” by design.
- [x] Public podcast listing is intentional; upload remains service-role-only.
- [x] Security-definer execute warnings were reconciled against the intended public content,
      preview, signup-trigger, redemption, and independently admin-gated RPC contracts.
- [x] No mutable-search-path or RLS-disabled finding was reported.

Performance warnings are inputs to Task 7.17's index/policy review, not silent failures. Re-run
both advisor classes after any migration and stop the release for an `ERROR`-level security
finding.
