# cubad ops runbooks

Living document — update in place as reality teaches you things.

## Supabase Auth rate limits

Verified against the existing Cubad project (`qjcaangaxpkihxxzexpq`) on 2026-07-20 through
both the Supabase dashboard and the authenticated Management API. Custom Resend SMTP is enabled,
so the email-send ceiling was raised from the built-in-provider default of 2 emails/hour to the
Phase 7 production baseline of 30 emails/hour. No other limit changed.

| Control | Confirmed value | Operating note |
| --- | ---: | --- |
| Email sends | 30/hour, project-wide | Requires the existing custom SMTP configuration. |
| Token refreshes | 150 requests per 5 minutes per IP | Leave at the Supabase default unless normal multi-tab sessions are throttled. |
| OTP/magic-link verifications | 30 requests per 5 minutes per IP | OTP/SMS auth is not used by Cubad today. |
| Sign-ups and sign-ins | 30 requests per 5 minutes per IP | Excludes anonymous users. |
| Anonymous sign-ins | Disabled | The dormant numeric ceiling is 30/hour per IP but cannot engage while the provider is disabled. |
| Web3 sign-ins | Disabled | The dormant numeric ceiling is 30 requests per 5 minutes per IP. |
| Email provider | Email/password enabled; confirmation required | Phone, Web3, SSO/social, and custom providers are disabled. |

The Supabase organization displayed the **Pro** plan during the same verification. Re-check these
dashboard-owned controls after any restore or project reconfiguration. The local
`supabase/config.toml` mirrors the 30/hour email baseline to avoid a later config push restoring
the obsolete 2/hour value.

## Rate-limit boundary probes

Run the stateful boundary probes against the local stack or a disposable Preview only, never
against Production. On 2026-07-20, the three active limiters were exercised against the local
Supabase and Next.js stack with disposable users and pre-seeded buckets:

| Transport | Pre-seeded bucket | Observed denial | Mutation boundary |
| --- | --- | --- | --- |
| `POST /api/tutor` | `tutor:user:<uid>` at 20/hour | `429`, `Retry-After: 3600`, `{"error":"rate-limited","retryAfterSeconds":3600}` | No Gemini request was made. |
| `POST /api/state` | `progress:user:<uid>` at 12/minute | `429`, `Retry-After: 60`, `{"error":"rate-limited"}` | No progress write was made. |
| `submitClaim` Server Action | `claims:user:<uid>` at 10/day | Localized English daily-limit message in the real claim form | Zero `payment_claims` rows and zero proof objects were created. |

After each bucket was deleted, a direct `check_rate_limit(...)` call returned `true`, proving the
keys were not permanently sticky. All disposable auth users, profiles, claims, proof objects, and
rate-limit rows were removed; the final exact check found zero remaining rate-limit events for the
test UUIDs. The temporary proof PDF and local development listener were also removed/stopped.

## Security probe battery

The consolidated battery lives at `supabase/tests/security-probes.md`. On 2026-07-20 it completed
78 sanitized assertions against the existing production Supabase project plus the Phase 4–6
transaction-scoped local SQL suites. RLS, cross-account isolation, storage prefixes, protected
RPC grants, redemption edge cases, approval idempotency, and private settings all passed. Cleanup
found zero disposable identities, rows, sentinels, or objects.

Both Supabase advisor classes reported zero `ERROR` findings. Leaked-password protection was
enabled on the existing Pro project and its warning cleared. Re-run the battery before launch and
after every change to RLS, storage policies, or security-definer functions.

## Vercel browser telemetry

Web Analytics was enabled for the existing `cubad` project on 2026-07-20 using the included Hobby
allowance. The Next.js root layout includes both the Analytics and Speed Insights components.
After initially choosing to leave Speed Insights on `rangeeli`, the owner explicitly approved
moving the Hobby team's single free slot to Cubad on 2026-07-20. Vercel now reports `rangeeli`
inactive with its historical data retained and `cubad` active; no paid upgrade was selected. A
follow-up production deployment completed and `/_vercel/speed-insights/script.js` returned `200`.
The dashboard may remain empty until real visitors generate the first data points.

## Sentry error tracking

Cubad reports to the Sentry project `cubad` in the existing Cubad organization. The older
`javascript-nextjs` project belongs to Contento and must not receive Cubad events, releases,
alerts, or source maps. `NEXT_PUBLIC_SENTRY_DSN` and `SENTRY_AUTH_TOKEN` are encrypted in Vercel
and scoped to Production, Preview, and Development; never paste either value into incident notes.

Client, Node, and Edge errors are captured with a 10% trace sample. Default PII and HTTP-body
collection are disabled. Browser ingestion uses the first-party `/monitoring` tunnel. On
2026-07-20, a disposable browser exception was wrapped by the Sentry client and a sanitized
verification event was accepted by Sentry ingestion. The production build uploaded source maps
to the `cubad` Sentry project, and an invalid-envelope request to the deployed `/monitoring`
rewrite reached Sentry (upstream `401` rather than a local `404`). The temporary probe route and
local Vercel environment copies were deleted immediately afterward.

## Supabase logs: symptom to search

| Symptom | Which log | What to search |
| --- | --- | --- |
| Sign-up or login broken | Logs → **Auth** | `error_code`: `email_exists`, `invalid_credentials`, `over_email_send_rate_limit` |
| Route returns 500 | Logs → **API Gateway**/**PostgREST** and Vercel function logs | Filter by route path and status `>=500`; cross-reference the timestamp. |
| Slow query | Logs → **Postgres** and Observability → **Query Performance** | `duration:` lines above roughly 200 ms; rank with `pg_stat_statements`. |
| Storage upload/download fails | Logs → **Storage** or **API Gateway**, path `/storage/v1/` | Distinguish `403` policy denial, `413` size rejection, and `5xx`. |
| RPC returns an unexpected error | Logs → **Postgres** | Search the function name; `raise exception` text appears verbatim. |
| Rate limiter appears incorrect | SQL editor | `select * from rate_limit_events where key='<key>' order by created_at desc limit 20;` |
| Cron did not run | Logs → **Cron** and **Postgres** | `select * from cron.job_run_details order by start_time desc limit 20;` |

Supabase log retention is finite. Copy relevant timestamps, request IDs, and sanitized errors into
incident notes while they remain available; never copy tokens, cookies, proof objects, or raw
provider payloads.

Dashboard labels were verified on 2026-07-20. Supabase's current unified Logs collections are
API Gateway, Postgres, PostgREST, Shared Pooler, Dedicated Pooler, Auth, Storage, Realtime, Edge
Functions, and Cron. Query Performance is under Observability rather than Logs.

## Uptime monitoring

UptimeRobot's free tier monitors the existing production deployment every five minutes. Both
monitors notify the `ADMIN_NOTIFY_EMAIL` contact; do not copy the underlying mailbox address into
logs, screenshots, or incident notes.

| Monitor | Target | Healthy result |
| --- | --- | --- |
| Production website | `https://cubad.vercel.app/` | HTTP `200` |
| Database health | `https://cubad.vercel.app/api/health` | HTTP `200` and response contains `"ok":true` |

The keyword monitor must start an incident when the keyword **does not exist**. Selecting “when
keyword exists” reverses the check and reports a healthy response as downtime. On 2026-07-20 both
monitors reported `Up`; an initial inverted keyword rule generated an alert email successfully,
then recovered after the rule was corrected. This verified the configured email-alert path. No
paid UptimeRobot plan is required at this stage; accept up to roughly five minutes before outage
detection. The retired `https://cubad.vercel.app/api/sync` route remains intentionally unmonitored
and returns `404`.

## Backups

**Current tier:** The existing Supabase organization displayed the **Pro** plan when verified in
Billing and through the authenticated Management API on 2026-07-20. No plan or billing change was
made during Phase 7. Confirm the project's actual backup list before depending on a particular
restore point; do not assume point-in-time recovery is enabled merely because the organization is
Pro.

**Supabase automated backups:** Free tier — one daily backup retained for one day. Pro tier — seven
daily backups, with point-in-time recovery available separately to restore within its configured
retention window.

**Upgrade to Pro when either is true:**

1. More than zero paying users exist (first approved claim with a live entitlement).
2. Daily active users exceed 50, measured from `admin_audit_log` growth or distinct users with
   `user_state.updated_at` activity for the day.

Changing the plan is a manual Billing action and requires explicit owner approval. The independent
nightly GitHub backup in Task 7.15 complements provider backups regardless of plan tier.

The `Nightly database backup` workflow runs at 02:17 UTC and stores a gzip-compressed tar archive
for 14 days. Its `SUPABASE_DB_URL` repository secret uses the IPv4-compatible session pooler on
port 5432 with SSL required; never print or pull that value into logs. The database password was
rotated on 2026-07-20 after confirming that Cubad had no existing password-based connection in the
repository, local environment, Vercel, or GitHub Actions.

Each archive contains `roles.sql`, `schema.sql`, `data.sql`, `history_schema.sql`, and
`history_data.sql`. The workflow pins Supabase CLI 2.109.1 so its provider-specific filtering does
not drift silently. The split format excludes hosted Supabase internals from the normal schema
dump, preserves Auth and Storage records in the data dump, and keeps CLI migration history in its
own files.

The initial raw-`pg_dump` smoke run `29766873055` succeeded and produced a valid gzip file, but the
restore drill proved that a raw dump also contains protected Supabase internals and is not directly
portable to a fresh hosted project. Commit `5343784` replaced it with the supported filtered
format. Manual run `29770143515` then completed in 2m1s and uploaded a 1,078,090-byte archive; a
downloaded copy passed archive integrity checks and contained exactly the five expected files.

## Restore drill (run once now, and after any real incident)

1. Download the latest artifact from GitHub → Actions → **Nightly database backup** → latest
   successful run → Artifacts, or run `gh run download <run-id>`.
2. Extract GitHub's downloaded wrapper, then run `tar -xzf cubad-backup-<stamp>.tar.gz`.
3. Create a temporary **scratch** Supabase project. Never restore into production or a shared
   development project, and delete the scratch project when the drill finishes.
4. Get the scratch project's session-pooler connection string on port 5432 with SSL required. Keep
   it in a local environment variable named `SCRATCH_DB_URL`; never commit or print it.
5. From the extracted archive, restore the supported logical dump and then its migration history:

   ```bash
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file roles.sql \
     --file schema.sql \
     --command 'SET session_replication_role = replica' \
     --file data.sql \
     --dbname "$SCRATCH_DB_URL"

   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file history_schema.sql \
     --file history_data.sql \
     --dbname "$SCRATCH_DB_URL"
   ```

6. Compare these counts with the same query run against production at backup time:

   ```sql
   select 'subjects' as t, count(*) from public.subjects
   union all select 'units', count(*) from public.units
   union all select 'profiles', count(*) from public.profiles
   union all select 'entitlements', count(*) from public.entitlements
   order by t;
   ```

7. Spot-check one non-null `units.content` value without printing its content. Confirm it is an
   object with `unit`, `slug`, and bilingual `title` keys, plus at least one renderable notes,
   questions, or flashcards section.
8. Delete the scratch project and verify it no longer appears in the project list. Move any local
   dump, log, connection, or temporary password files to the Recycle Bin or delete them securely.
9. Record the date, workflow run, counts, content check, and cleanup outcome below.

**Drill log:**

- **2026-07-20:** Captured production-at-backup baselines of 2 subjects, 19 units, 6 profiles, and
  0 entitlements. Raw artifact from run `29766873055` restored with `ON_ERROR_STOP=1` only after
  excluding provider-owned `pg_cron` objects, one restricted Realtime function setting, and an
  empty protected Vault data block; this exposed the raw workflow's portability defect. A
  Supabase-filtered five-file dump of the same snapshot then restored into the scratch project's
  default database with no SQL errors. All four counts matched exactly, the sampled unit met the
  app's JSON render contract, and migration history matched 37 of 37 rows. Corrected live run
  `29770143515` produced a valid archive with the same five-file shape. The temporary hosted
  project was deleted and verified absent; all local drill artifacts and encrypted temporary
  credential metadata were moved to the Windows Recycle Bin.

## Load-test baseline

Run k6 against `https://cubad.vercel.app`, never localhost. Authenticated Scenarios B and C must
use only a disposable student's cookie loaded from the ignored `scripts/load/.session-cookie`;
never paste the cookie into a command log, document, or chat.

**Scenario A — anonymous browse, 50 VUs, 2 minutes (2026-07-20):** The initial production run
found a real infrastructure issue. Its route p95 values were 10.24 s for home, 9.76 s for the
Hydrology subject, and 5.33 s for the free unit; 2 of 1,059 requests timed out (0.18% failure),
while no HTTP 5xx response was observed. Content cache tags were present and matched the publish
invalidation tags. `x-vercel-id` showed Frankfurt-edge requests executing in `iad1`, but Cubad's
Supabase project is in `eu-central-1`.

Commit `18df2aa` set the existing Vercel project's single function region to Frankfurt (`fra1`),
next to the database. The deployed header then showed `fra1::fra1`. The exact rerun passed with
3,036/3,036 checks, 0.00% failed requests, and overall p95 265.93 ms. Route p95 was 243.71 ms for
`/`, 270.41 ms for `/s/hidroloji`, and 274.28 ms for `/s/hidroloji/unit/giris`; all were below the
500 ms target. Maximum observed duration was 2.14 s during ramp/cold-start behavior.

**Scenario B — authenticated account/unit loop, 50 VUs, 2 minutes (2026-07-20):** The first run
returned 1,878/1,878 successful checks and 0.00% failed requests, but p95 was 2.34 s. A focused
probe isolated the slow route to `/account`, whose profile, static track catalog, and entitlement
expiry reads were serialized. Commit `924a33f` parallelized those independent reads without
changing authentication or access contracts. After deployment, the exact rerun passed with
2,584/2,584 checks, 0.00% failures, average 266.77 ms, p95 381 ms, and maximum 2.39 s.

**Scenario C — progress-save limiter, 1 VU, 15 writes (2026-07-20):** Before the run, the
disposable user's `progress:user:<uid>` bucket was cleared and `/api/state` returned 200. Writes
1–12 returned 200; writes 13–15 returned 429, confirming the 12/minute boundary exactly. Across
the paired GET/POST requests, duration p95 was 303.22 ms. The 10% k6 `http_req_failed` value is the
three intentional 429 responses, not an availability failure.

After both authenticated scenarios, the disposable Auth user was deleted and exact checks found
zero remaining profile, user-state, or limiter rows. The ignored cookie file was deleted. Never
retain or reuse a load-test session after the run.

## Supabase API-key incident response

On 2026-07-20, a Supabase CLI command returned usable JSON but exited during telemetry shutdown.
Node's synchronous child-process exception included its captured stdout in the tool log, exposing
Cubad's legacy service-role API key. The key was not committed or copied into a command, document,
or application log.

Containment was completed immediately:

1. All Cubad Vercel destinations—Production, Development, general Preview, and four historical
   branch-specific Preview overrides—were migrated to Supabase's new publishable/secret API keys.
2. GitHub Actions secrets `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` were
   migrated to the same new key types. The preserved Sprout variables were not changed.
3. Production was redeployed and both new keys passed direct public and privileged queries.
4. Cubad's legacy JWT-based anon/service-role API keys were disabled. With legacy access disabled,
   production health returned `{"ok":true}`, public home/subject routes returned 200, and a fresh
   authenticated account smoke returned 200.
5. GitHub CI rerun `29739510877` passed install, lint, content validation, tests, and build using
   the replacement repository secrets.
6. The smoke user and its profile/state/limiter rows were deleted. Temporary credential tooling
   and the environment download were moved to the Windows Recycle Bin.

The JWT signing secret was not rotated; existing user sessions were therefore not intentionally
signed out. For future secret-bearing CLI automation, never let a thrown child-process error
serialize captured stdout. Use a non-throwing process result, parse stdout in memory, and emit only
sanitized status text.

## Expiry reminder did not arrive or arrived twice

The Vercel cron calls `GET /api/cron/expiry-reminders` daily at 06:00 UTC. Hobby schedules may
start anywhere within that hour. Vercel supplies `Authorization: Bearer <CRON_SECRET>`; never put
the value in a ticket, command transcript, or runbook.

1. Vercel → Project → Settings → Cron Jobs: confirm the job is enabled and inspect its latest
   invocation. A `401` means the deployment and `CRON_SECRET` environment variable are out of
   sync; update the variable and redeploy rather than weakening the route check.
2. Vercel runtime logs: filter for `/api/cron/expiry-reminders`. A successful response reports
   only `checked`, `sent`, `failed`, and `skipped` counts.
3. Inspect the entitlement without exposing the recipient address:

   ```sql
   select id, user_id, expires_at, reminded_at, reminder_claimed_at, revoked_at
     from public.entitlements
    where id = '<ENTITLEMENT-UUID>';
   ```

4. `reminded_at` set means Cubad committed the durable success marker. `reminder_claimed_at` less
   than 15 minutes old is an active lease; do not race it. An older lease is eligible for automatic
   recovery on the next run.
5. If the provider rejected the message, `sendOne` releases the lease and records an
   `email.failed` row in `admin_audit_log`. Check Resend logs and quota, fix the provider problem,
   then invoke the protected route once or wait for the next daily run.
6. If a send succeeded but the durable marker failed, keep the lease for inspection. A retry uses
   `entitlement-expiry/<entitlement-id>` as Resend's stable idempotency key, preventing a duplicate
   provider send during its 24-hour retention window.
7. Never clear `reminded_at` merely to test delivery. Seed a disposable entitlement and remove it
   afterward, as in the Phase 7 verification procedure.

## Content update won't appear

Symptom: an admin published or edited a unit, but students still see the old version.

1. Confirm the publish action ran `revalidateTag('content:<subject-slug>')` (Phase 3).
2. Confirm the content fetcher requests the same tag string byte-for-byte and case-sensitively. A
   mismatch silently prevents revalidation.
3. This does not need a redeploy—content lives in Postgres (D4). Wanting to redeploy to fix stale
   content is a sign the defect is probably the tag mismatch.
4. Check for an unexpectedly long `Cache-Control` value if another CDN sits in front of the page.
5. Last resort: also call `revalidatePath('/s/<slug>')` and the unit path from the publish action.

## User says their code is invalid

```sql
-- Normalize exactly like redeem_code(): uppercase, strip non-alphanumerics, sha256 hex.
select ac.id, ac.max_redemptions, ac.redeemed_count, ac.valid_until, ac.revoked_at,
       ac.scope_type, ac.scope_id, ac.tier_id
  from public.access_codes ac
 where ac.code_hash = encode(
   digest(upper(regexp_replace('<CODE-AS-TYPED>', '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex');

-- If a row returns, check revoked, expired, exhausted, already-redeemed, then rate-limited.
select * from public.code_redemptions where code_id = '<CODE-UUID>';
select * from public.redemption_attempts
 where user_id = '<USER-UUID>' and created_at > now() - interval '1 hour';
```

No access-code row means the text was mistyped or never existed. Cubad's Crockford-style code
alphabet avoids `0/O/1/I/l` ambiguity, so suspect a copy/paste problem from the email.

## Payment email not arriving

1. In Resend Logs, search by recipient: did Resend accept an attempt?
2. Check `admin_audit_log` for `claim.approve`. Email failure never rolls back the grant, so inspect
   `entitlements` before assuming payment approval failed.
3. Ask the user to check spam. This is especially common for a cold sender domain or
   `onboarding@resend.dev` before Task 7.26 configures the approved sender.
4. For a custom sender, verify its SPF/DKIM records in Resend.
5. Check the existing Resend API key validity and quota if sends fail outright.

## Restore from backup

Follow the **Restore drill** above, but restore into a project intended to remain available rather
than a disposable scratch project. Verify counts and content first, then update Cubad's Vercel
environment variables using the Master §13 cutover pattern. Keep the old production project intact
until the restored application has passed authentication, content, storage, and entitlement checks.

## Rotate service role key

1. Supabase → Settings → API: create or rotate the project's server-side secret key.
2. Update `SUPABASE_SERVICE_ROLE_KEY` for Cubad's Vercel Production, Preview, Development, and any
   branch-specific Preview overrides. Update the GitHub Actions secret where used.
3. Redeploy Production; environment changes do not affect earlier deployments.
4. Verify the admin dashboard, public health endpoint, and a protected expiry-reminder invocation.
5. Disable the old key only after all consumers pass, then rerun the service-key repository scan.
6. Record who rotated it, when, and why (routine, suspected compromise, or offboarding).

**Rotation log:** (empty)

## Sprout decommission (60+ days after cutover, Master §13)

1. Confirm at least 60 days have elapsed with no passcode-sync support reports.
2. Export one final safety snapshot of Sprout's `cubad_sync` rows and `podcasts` bucket objects.
3. Delete the `cubad_sync` data from Sprout.
4. Delete all Sprout `podcasts` bucket objects.
5. Rotate or revoke Sprout's anon key, or pause/delete that project.
6. Remove only the retired Sprout Vercel variables identified by the D15 cutover evidence.
7. Record completion below.

**Decommission log:** (empty)
