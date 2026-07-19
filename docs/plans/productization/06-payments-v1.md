# Phase 6 — Manual Payments: Claims, Proofs, Review, Emails, Code Issuance

> **For agentic workers:** This is phase plan `06` of the CUBAD productization program. Read
> `00-MASTER-PLAN.md` **fully** before this doc — it is the umbrella and its §3 (locked
> decisions, esp. **D8/D9/D10**), §4 (data model — column names are LAW), §5 (canonical
> examples), §9 (security invariants) and §12 (authoring rules) govern everything here. Execute
> tasks **in order**, top to bottom. Each task is bite-sized: do the steps, run the commands,
> confirm the expected output, tick the checkbox, then commit with the given message. Do not
> improvise around a locked decision — if reality contradicts one, record the smallest compliant
> deviation in `## Changelog / deviations` and surface it.

**Goal:** Let a student who paid externally (M-Pesa / bank) submit a **claim** with a proof
file, get it into an admin **review queue** (plus an email notification), let the admin verify
it manually against the bank statement and **approve** it in ONE atomic transaction that mints a
single-use access code, auto-redeems it into a time-boxed entitlement, and emails the plaintext
code to the student as a receipt — or **reject** it with a reason. This is Payments v1: the whole
mechanism is manual verification; Selcom/M-Pesa API automation is a future design (§08).

**Architecture:** Next.js 16 App Router (Server Components + Server Actions), the new dedicated
Supabase project (`cubad-app`, `eu-central-1`), Postgres + RLS + private Storage, and Resend for
transactional email **from the app** (Resend REST API — NEW in this phase; Phase 2 only wired
Resend as Supabase's SMTP provider for auth mails). All money/access mutations happen inside
`SECURITY DEFINER` SQL functions with row locks; email sends happen AFTER the DB commit and are
logged (never rolled back) on failure.

**Tech stack:** Next.js 16.2.x · React 19 · Tailwind 4 · TypeScript 5 ·
`@supabase/supabase-js` + `@supabase/ssr` · Resend (REST) · Vitest · `Bi` i18n from
`lib/i18n.tsx`.

⚠ **Next.js 16 is newer than your training data.** Before writing ANY Next.js code read the
relevant guide in `node_modules/next/dist/docs/` (repo policy — `AGENTS.md`). The APIs this phase
relies on and their Next-16 shapes: **Server Actions** (`'use server'`; every action is reachable
by a raw POST, so re-check auth inside each one), `after` from `next/server` (post-response work —
used for non-blocking emails), `revalidatePath` from `next/cache`, `redirect` from
`next/navigation`, and **async `params`/`searchParams`** in pages (they are Promises — `await`
them).

---

## Prerequisites

**Phase dependency:** Phases 1–5 are delivered and merged. This phase depends on their outputs.
Do NOT rebuild any of them — consume them.

**Assumed delivered before this phase (the contract you build on):**

| From | Artifact | What this phase assumes about it |
|---|---|---|
| Phase 1 | Supabase project `cubad-app`, CLI + `supabase/migrations/`, `lib/supabase/*` clients | `import { createClient } from "@/lib/supabase/server"` → **async**, returns a cookie-bound SSR client that runs **as the signed-in user (RLS applies)**: `const supabase = await createClient()`. `import { createServiceRoleClient } from "@/lib/supabase/server"` → **sync**, returns a **service-role** client that **bypasses RLS** (server-only, never imported into a client component; master §14 registry name — there is NO `createServiceClient`/`createAdminClient`). `import { createClient } from "@/lib/supabase/browser"` → browser client. |
| Phase 1 | Full schema migration (§4) | Tables `payment_claims`, `tiers`, `entitlements`, `access_codes`, `code_redemptions`, `profiles`, `admin_audit_log` **exist** with the §4 columns. RLS is enabled on them (policies were left to phase plans — this phase writes the `payment_claims` policies). |
| Phase 1 | Vitest | `npx vitest run` works; test files live next to sources (`*.test.ts`). |
| Phase 2 | Auth + profiles | Auth flows live under `/auth/*` (`/auth/sign-in`, `/auth/sign-up`, … — master §14; there is NO `/login` route); sign-in walls redirect to `/auth/sign-in?next=<path>`. `preferred_lang` ('tr'/'en'), `full_name`, `phone`, `country_code` are on `profiles`. |
| Phase 4 | `lib/access/codes.ts`, `redeem_code` RPC, entitlement model, `has_subject_access()`, paywall panel | `generateCode()` → plaintext `CBD-XXXX-XXXX`; `normalizeCode(raw)` → uppercased alphanumerics (`CBD7K3M9PXQ`); `hashCode(normalized)` → sha256 hex. The paywall panel ships with `redeemHref` only; **Task 6.10b (this phase) adds the `upgradeHref` CTA** so locked students can reach `/upgrade` (master §14 binds both props). |
| Phase 4 | `public.grant_entitlement(...)` | **Fact (master D8/§4):** Phase 4 defines the canonical `grant_entitlement(p_user uuid, p_scope_type text, p_scope_id uuid, p_tier_id uuid, p_duration_days int, p_source text, p_source_id uuid) returns uuid` — SECURITY DEFINER, **insert-new-row stacking** (`expires_at = greatest(now(), max expires_at of active unrevoked same-scope rows) + duration`; existing rows are never mutated — per-grant provenance/revocability). Phase 4's `redeem_code` routes through it. **This phase does NOT define it — `approve_claim` only calls it.** Verify it exists before Task 6.5. |
| Phase 5 | Admin dashboard shell (`/admin`, `app/admin/layout.tsx`), nav with a **"Payments"** slot, `is_admin()` SQL function, `logAdminAction` TS helper, audit-log viewer, **`profiles.email`** column (+ backfill + trigger update) | `public.is_admin()` (SECURITY DEFINER, reads `profiles.role`) exists and is safe to call in RLS. The admin layout server-side-gates on role. There is a nav slot labelled "Payments" to hang a badge on. **`email`** is on `profiles` (delivered by Phase 5, not Phase 2 — master §14). |

**Required reading (repo files) before you start:**
- `docs/plans/productization/00-MASTER-PLAN.md` — §3 (D8/D9/D10), §4, §5, §9, §12.
- `cubad/AGENTS.md` — the Next.js-16 warning applies to every code sample below.
- `cubad/components/ui.tsx` — reuse `Callout`, `DataTable` etc.; match the Tailwind palette
  (`deniz`, `clay`, `moss`, `amber`, `ink`, `wash`, `paper`, `card`, `line`).
- `cubad/lib/i18n.tsx` — the `Bi = {tr,en}` pattern and `useLang()` (`t`, `bi`). All new
  **student-facing** strings are bilingual; **admin** strings are English (per task brief).
- `cubad/components/Md.tsx` — markdown renderer used to render payment instructions.
- `cubad/docs/DESIGN.md` — "engineer's field notebook" visual language.
- Next.js 16 docs you will touch: `01-getting-started/07-mutating-data.md`,
  `03-api-reference/04-functions/after.md`, `01-getting-started/15-route-handlers.md`.

**Decisions locked in this phase (do not re-litigate downstream):**
- **D6.a — Claim insert client:** the claim row is inserted with the **user client (RLS)** so the
  insert `CHECK` (`user_id = auth.uid()` and `status = 'pending'`) is exercised as defense in
  depth. The **service client** is used only for the two privileged steps the user must not do
  directly: uploading the proof object and writing `proof_path`. This keeps owner `UPDATE` on
  `payment_claims` permanently closed (no policy grants it), so `proof_path` and `status` can
  never be tampered with by the claimant. (Task brief item 4; justified in Task 6.11.)
- **D6.b — Owner correction = cancel + resubmit:** the status enum is only
  `pending|approved|rejected` (§4), so there is no "cancelled" state. Cancellation is therefore
  an owner **DELETE of a pending claim only** (RLS policy in Task 6.3). Rejected/approved claims
  are immutable; the student resubmits a fresh claim.
- **D6.c — `approve_claim` carries a `p_reviewer uuid` 4th param.** This is now the master §4
  contract signature:
  `approve_claim(p_claim_id uuid, p_code_hash text, p_duration_days int, p_reviewer uuid)`.
  Because the function is executed via the **service-role client** (so `auth.uid()` is NULL inside
  it) but must set `reviewed_by` to the admin, the reviewer id is passed explicitly.

---

## Task 6.1 — Branch, env vars, and prerequisite verification

- [ ] From `cubad/`, create the phase branch (all mid-phase work stays here; merged via PR at
  phase end per master §8.7):
  ```bash
  git checkout -b feat/phase-6-payments-v1
  ```
- [ ] Add the new env vars to **`cubad/.env.local`** (gitignored — never commit) and to Vercel
  (Project → Settings → Environment Variables). Ask the human for the real Resend key; never
  invent it (master §11). `NEXT_PUBLIC_APP_URL` already exists from D15 — reuse it, do not add a
  second.
  ```bash
  # .env.local additions for Phase 6
  RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxx      # server-only; from resend.com dashboard
  ADMIN_NOTIFY_EMAIL=ahmedallycubad@gmail.com     # where new-claim notifications land (D15)
  EMAIL_FROM=onboarding@resend.dev                # D10: sender until a verified domain exists
  # already present (D15) — do NOT re-add, just confirm it is set:
  # NEXT_PUBLIC_APP_URL=https://cubad.vercel.app
  ```
  > **Why `onboarding@resend.dev`:** Resend allows sending from that shared address on any
  > account without domain verification. Real "from your domain" addresses 403 until the domain
  > is verified (see Task 6.7 failure modes). `EMAIL_FROM` is env-driven so the cutover to a real
  > domain is a one-line change, no redeploy of code.
- [ ] Confirm the prerequisites actually exist in the linked database (do not assume). The
  Supabase CLI has **no** `db execute` subcommand (master §14) — use `psql` against the project's
  connection string (Dashboard → Project Settings → Database → Connection string, URI form; store
  it as `DB_URL` in your shell, never in the repo), the dashboard SQL editor, or MCP `execute_sql`:
  ```bash
  psql "$DB_URL" -c "select proname from pg_proc where proname in ('is_admin','redeem_code','grant_entitlement');"
  ```
  Expected: ALL THREE are listed — `grant_entitlement` is defined by Phase 4 (master D8/§4) and
  `approve_claim` depends on it. If `is_admin` or `grant_entitlement` is missing, STOP: Phase 4/5
  is not really done; do not proceed.
- [ ] Confirm the money/access tables exist:
  ```bash
  psql "$DB_URL" -c "select table_name from information_schema.tables where table_schema='public' and table_name in ('payment_claims','tiers','entitlements','access_codes','code_redemptions','profiles','admin_audit_log') order by table_name;"
  ```
  Expected: all 7 rows.
- [ ] **Commit:**
  ```bash
  git add -A && git commit -m "phase6: branch + env matrix for manual payments (resend, admin notify, email from)"
  ```

**Failure modes:**
- `psql` connection refused / password prompt → you copied the pooled connection string without
  the password, or your IP is not allowed; re-copy the full URI from the dashboard (or use the
  SQL editor / MCP `execute_sql` instead — same SQL, no local psql needed). For a local stack,
  `supabase start` prints a local `DB_URL` (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`).
- `.env.local` values not picked up → Next only reads env at process start; restart `next dev`.

---

## Task 6.2 — Migration: private `payment-proofs` bucket + storage RLS

**Restating master §9 (LAW for this task):** *privileged reads/writes NEVER take a user-supplied
path.* Every object path in this bucket is `<auth.uid()>/<claim_id>/<filename>`, constructed
**server-side** from the session's `auth.uid()` and the freshly-created claim id (Task 6.11). The
storage policies below enforce that the first path segment equals the caller's uid, so even if an
attacker forged a request they could not read or plant an object under another user's folder. The
admin proof viewer (Task 6.14) derives the path from the **claim row** (`proof_path`, written
server-side) — never from anything the user typed.

- [ ] Create the migration file:
  ```bash
  supabase migration new payments_proofs_bucket
  ```
  Expected: `Created new migration at supabase/migrations/<timestamp>_payments_proofs_bucket.sql`
- [ ] Paste this SQL into that file:
  ```sql
  -- Phase 6.2 — private evidence bucket for payment proofs.
  -- Private (public=false); 10 MB cap; only image/jpeg,png,webp and application/pdf.
  -- Enforced at TWO layers: bucket config here AND a server-side check in the submit action.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'payment-proofs',
    'payment-proofs',
    false,
    10485760,  -- 10 * 1024 * 1024
    array['image/jpeg','image/png','image/webp','application/pdf']
  )
  on conflict (id) do update
    set public             = excluded.public,
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  -- storage.objects already has RLS enabled by Supabase. Add bucket-scoped policies.
  -- NOTE: storage.foldername(name) returns the directory segments as a 1-indexed text[].
  -- For 'uid/claim/receipt.jpg' it is {uid, claim}; [1] = 'uid'. An object written to the
  -- bucket root has foldername = {} and [1] IS NULL, so the policy correctly denies it.

  -- INSERT: an authenticated user may upload ONLY under a top-level folder equal to their uid.
  -- (Our server uses the service role to upload, which bypasses RLS; this policy is the backstop
  --  / documents intent / guards any future client-side upload path.)
  create policy "payment_proofs_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

  -- SELECT: the owner (path prefix) or an admin. Used by signed-URL creation for the reviewer.
  create policy "payment_proofs_select_own_or_admin"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'payment-proofs'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
    )
  );

  -- DELETE: admins only. Users get NO delete (immutable evidence). Cleanup of an orphaned upload
  -- and of proofs for a cancelled claim is done by the server via the service role, not by users.
  create policy "payment_proofs_delete_admin"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'payment-proofs'
    and public.is_admin()
  );

  -- Deliberately NO update policy: users and admins cannot mutate an object in place.
  ```
- [ ] **Commit:**
  ```bash
  git add supabase/migrations && git commit -m "phase6: private payment-proofs bucket + prefix-enforced storage RLS"
  ```

**Failure modes:**
- **`foldername()` off-by-one:** it is **1-indexed** and returns only *directory* segments (not
  the filename). If you accidentally test `[0]` the policy silently denies everything. Verify with
  `select (storage.foldername('u1/c1/x.jpg'))[1];` → `u1`.
- **Bucket already exists** (re-run): the `on conflict do update` handles it; do not add a second
  `insert`.
- **`allowed_mime_types` rejects a valid file** because the browser sent `image/jpg` (non-canonical)
  instead of `image/jpeg`. The server-side check in Task 6.11 uses the same canonical list, so a
  bad `type` is rejected there first with a friendly message before it ever hits storage.

---

## Task 6.3 — Migration: `payment_claims` RLS + open-claim-limit trigger

- [ ] Create the migration:
  ```bash
  supabase migration new payments_claims_rls
  ```
- [ ] Paste this SQL:
  ```sql
  -- Phase 6.3 — RLS for payment_claims + a hard cap of 3 open (pending) claims per user.

  alter table public.payment_claims enable row level security;  -- idempotent; safe if already on

  -- Owner may CREATE a claim, but only for themselves and only as 'pending'. This CHECK is the
  -- defense-in-depth reason we insert with the user client (D6.a): a student cannot self-approve
  -- by inserting status='approved'.
  create policy "claims_insert_own_pending"
  on public.payment_claims for insert to authenticated
  with check (
    user_id = auth.uid()
    and status = 'pending'
  );

  -- Owner may READ their own claims (any status) — powers the /upgrade/claims page.
  create policy "claims_select_own"
  on public.payment_claims for select to authenticated
  using (user_id = auth.uid());

  -- Owner may CANCEL = DELETE, but ONLY their own pending claim (D6.b). No approved/rejected
  -- deletion; no status update path exists for owners at all.
  create policy "claims_delete_own_pending"
  on public.payment_claims for delete to authenticated
  using (user_id = auth.uid() and status = 'pending');

  -- Admin may READ every claim (queue + detail).
  create policy "claims_select_admin"
  on public.payment_claims for select to authenticated
  using (public.is_admin());

  -- Admin may UPDATE any claim. Approve/Reject actually run through SECURITY DEFINER functions
  -- via the service role (Task 6.5), so this policy is a break-glass for manual corrections.
  create policy "claims_update_admin"
  on public.payment_claims for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

  -- There is intentionally NO "claims_update_own" policy: proof_path and status are server-owned.

  -- ---- Open-claim limit (max 3 pending per user), enforced in the DB as the authoritative guard.
  create or replace function public.enforce_open_claim_limit()
  returns trigger
  language plpgsql
  as $$
  declare
    v_open int;
  begin
    -- Serialize concurrent inserts for the SAME user so two racing submits cannot both pass the
    -- count check and land a 4th pending claim (closes the count-then-insert TOCTOU window).
    perform pg_advisory_xact_lock(hashtext('claim:' || new.user_id::text));

    select count(*) into v_open
    from public.payment_claims
    where user_id = new.user_id
      and status = 'pending';

    if v_open >= 3 then
      raise exception 'open-claim-limit'
        using errcode = 'check_violation',
              hint = 'A user may hold at most 3 pending payment claims.';
    end if;

    return new;
  end;
  $$;

  drop trigger if exists trg_enforce_open_claim_limit on public.payment_claims;
  create trigger trg_enforce_open_claim_limit
  before insert on public.payment_claims
  for each row execute function public.enforce_open_claim_limit();
  ```
- [ ] **Commit:**
  ```bash
  git add supabase/migrations && git commit -m "phase6: payment_claims RLS (owner insert/select/delete-pending, admin all) + 3-open trigger"
  ```

**Why the limit is enforced twice (task requirement):** the **server action** (Task 6.11)
pre-checks the count with a SQL `count(*)` and, if it is already 3, returns a friendly bilingual
message **before** asking the student to upload a file — good UX, and it avoids a wasted upload.
But that check is advisory: a determined client could POST straight to PostgREST bypassing our
action. The **trigger** is the real barrier — it runs inside the DB transaction under a per-user
advisory lock, so it holds even against direct API calls and concurrent races. The count is done
**in SQL** (never a JS `reduce` over fetched rows) per master §9 — a JS count would silently
undercount past PostgREST's 1000-row cap and let extra claims through.

**Failure modes:**
- **Trigger error text vs client error:** the raised message is `open-claim-limit`; PostgREST
  surfaces it inside the error body. Task 6.11 matches on the substring `open-claim-limit` — keep
  the string stable if you edit it.
- **`enable row level security` "already enabled"** is not an error in Postgres (it is a no-op),
  so re-running the migration on a DB where Phase 1 already enabled RLS is fine.

---

## Task 6.4 — Migration: `app_settings` table + RLS + seed + `set_app_setting`

`app_settings` is a tiny key→jsonb store. This phase uses the `payment_instructions` key; **Phase 7
will reuse the same table for the announcement banner** (key `announcement`) — that is the seam.
Writes go through an atomic, audited `set_app_setting` function so the mutation and its
`admin_audit_log` row are one transaction (master §9).

- [ ] Create the migration:
  ```bash
  supabase migration new app_settings
  ```
- [ ] Paste this SQL:
  ```sql
  -- Phase 6.4 — generic app settings (Bi rich text etc.). Phase 7 announcement banner reuses this.
  create table if not exists public.app_settings (
    key        text primary key,
    value      jsonb not null default '{}'::jsonb,
    updated_by uuid references auth.users(id),
    updated_at timestamptz not null default now()
  );

  alter table public.app_settings enable row level security;

  -- ANYONE may READ settings — no role restriction (master §14): payment instructions and
  -- Phase 7's announcement banner (read anonymously on public pages) are both public-safe.
  create policy "app_settings_public_read"
  on public.app_settings for select
  using (true);

  -- Only admins may WRITE (the admin settings form also routes through set_app_setting).
  create policy "app_settings_write_admin"
  on public.app_settings for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

  -- Seed the payment-instructions row. Bi rich text (markdown) per method. Values are single-line
  -- to avoid SQL newline escaping; the admin form can add markdown line breaks later.
  insert into public.app_settings (key, value) values
  ('payment_instructions', jsonb_build_object(
    'mpesa', jsonb_build_object(
      'tr', 'M-Pesa Lipa Namba: **123456** (CUBAD). Ödedikten sonra işlem numarasını (ör. SFC8KL29XY) forma girin.',
      'en', 'M-Pesa Lipa Namba: **123456** (CUBAD). After paying, enter the transaction ID (e.g. SFC8KL29XY) in the form.'
    ),
    'bank', jsonb_build_object(
      'tr', 'Banka: CRDB Bank · Hesap adı: CUBAD · Hesap no: **0150XXXXXXXXX**',
      'en', 'Bank: CRDB Bank · Account name: CUBAD · Account no: **0150XXXXXXXXX**'
    ),
    'whatsapp', jsonb_build_object(
      'tr', 'Sorular için WhatsApp: **+255 7XX XXX XXX**',
      'en', 'Questions? WhatsApp: **+255 7XX XXX XXX**'
    )
  ))
  on conflict (key) do nothing;

  -- Atomic + audited setter (SECURITY DEFINER). Called by the admin settings form via service role.
  create or replace function public.set_app_setting(p_key text, p_value jsonb, p_actor uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
  as $$
  begin
    insert into public.app_settings (key, value, updated_by, updated_at)
    values (p_key, p_value, p_actor, now())
    on conflict (key) do update
      set value = excluded.value,
          updated_by = excluded.updated_by,
          updated_at = now();

    insert into public.admin_audit_log (actor, action, entity, entity_id, details)
    values (p_actor, 'settings.update', 'app_settings', p_key, jsonb_build_object('key', p_key));
  end;
  $$;

  revoke all on function public.set_app_setting(text, jsonb, uuid) from public, anon, authenticated;
  ```
- [ ] **Commit:**
  ```bash
  git add supabase/migrations && git commit -m "phase6: app_settings table + RLS + seed payment_instructions + atomic set_app_setting"
  ```

**Failure modes:**
- **Markdown newlines in seed values:** plain SQL string literals treat `\n` as literal
  backslash-n. If you need real newlines in a seed value, use an `E'...\n...'` escape string.
  Kept single-line here on purpose.
- **`set_app_setting` "permission denied" at call time:** it is `revoke`d from `authenticated`, so
  it must be called with the **service role** (Task 6.15). If you call it with the user client you
  get permission-denied — that is by design.

---

## Task 6.5 — Migration: `approve_claim` + `reject_claim` (calls Phase 4's `grant_entitlement`)

This is the heart of the phase: the atomic approve/reject transactions. The entitlement
create/stack logic is NOT defined here — it lives in Phase 4.

> **Prerequisite (master D8/§4):** `grant_entitlement` exists from Phase 4 — verify with
> `\df public.grant_entitlement` (in psql) before proceeding. Its contract signature is
> `grant_entitlement(p_user uuid, p_scope_type text, p_scope_id uuid, p_tier_id uuid, p_duration_days int, p_source text, p_source_id uuid) returns uuid`
> — SECURITY DEFINER, and **insert-new-row stacking**: when an active unrevoked same-scope
> entitlement exists it inserts a NEW row with
> `expires_at = greatest(now(), max expires_at of active unrevoked same-scope rows) + make_interval(days => p_duration_days)`
> (scope matched with `is not distinct from`; existing rows are NEVER updated — per-grant
> provenance and revocability are preserved). Phase 4's `redeem_code` routes through this same
> function, so approve-and-redeem share ONE stacking implementation by construction.
> `approve_claim` below relies on those insert-new-row semantics: the uuid it returns is the id of
> the freshly-inserted entitlement row, which we read `expires_at` from and link in
> `code_redemptions`. Do NOT re-implement or `create or replace` this function here — never
> duplicate the stacking arithmetic (master D8).

- [ ] Verify the Phase 4 helper is present before writing the migration (its absence would make
  `approve_claim` fail at first call, not at `create function` time — Postgres resolves the inner
  call lazily):
  ```bash
  psql "$DB_URL" -c "\df public.grant_entitlement"
  ```
  Expected: one row — `public | grant_entitlement | uuid | p_user uuid, p_scope_type text, p_scope_id uuid, p_tier_id uuid, p_duration_days integer, p_source text, p_source_id uuid | func`.
  If it is missing, STOP: Phase 4 is not really done (master D8/§4); do not define it yourself.
- [ ] Create the migration:
  ```bash
  supabase migration new payments_approve_functions
  ```
- [ ] Paste this SQL:
  ```sql
  -- Phase 6.5 — atomic approve/reject. Entitlement stacking lives in Phase 4's
  -- grant_entitlement (insert-new-row semantics, master D8) — called, never redefined, here.

  -- ---------- approve_claim: ONE transaction, claim -> code -> redemption -> entitlement -> audit
  create or replace function public.approve_claim(
    p_claim_id      uuid,
    p_code_hash     text,
    p_duration_days int,
    p_reviewer      uuid    -- D6.c: passed explicitly because the service role has no auth.uid()
  ) returns jsonb
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_claim   public.payment_claims%rowtype;
    v_tier    public.tiers%rowtype;
    v_code_id uuid;
    v_ent_id  uuid;
    v_expires timestamptz;
  begin
    -- Lock the claim so two admins approving at once serialize; the loser trips 'not-pending'.
    select * into v_claim from public.payment_claims where id = p_claim_id for update;
    if not found then
      raise exception 'claim-not-found' using errcode = 'no_data_found';
    end if;
    if v_claim.status <> 'pending' then
      raise exception 'not-pending' using errcode = 'check_violation';
    end if;

    select * into v_tier from public.tiers where id = v_claim.tier_id;
    if not found then
      raise exception 'tier-not-found' using errcode = 'no_data_found';
    end if;

    -- 1) mint the single-use code. Only the HASH reaches the DB; plaintext is generated in the
    --    server action and never passed here or logged (master §9, D8).
    -- v_tier.scope_id is a real tiers column (master §4); the tiers_scope_target constraint
    -- guarantees it is NULL exactly for scope_type='all' tiers, and Phase 5's tier CRUD sets it
    -- for track/subject tiers — so it can be copied into access_codes/entitlements verbatim.
    insert into public.access_codes
      (code_hash, tier_id, scope_type, scope_id, duration_days,
       max_redemptions, redeemed_count, note, created_by)
    values
      (p_code_hash, v_tier.id, v_tier.scope_type, v_tier.scope_id, p_duration_days,
       1, 1, 'payment-claim:' || p_claim_id::text, p_reviewer)
    returning id into v_code_id;

    -- 2) grant the entitlement via Phase 4's SHARED helper (same insert-new-row stacking as
    --    redeem_code, master D8). Argument order matches its 7-arg contract exactly:
    --    (p_user, p_scope_type, p_scope_id, p_tier_id, p_duration_days, p_source, p_source_id).
    --    It returns the id of the freshly-INSERTED entitlement row (existing rows are never
    --    mutated), which we read expires_at from and link in code_redemptions below.
    v_ent_id := public.grant_entitlement(
      v_claim.user_id, v_tier.scope_type, v_tier.scope_id, v_tier.id, p_duration_days,
      'code', v_code_id
    );
    select expires_at into v_expires from public.entitlements where id = v_ent_id;

    -- 3) record the redemption. unique(code_id, user_id) is the replay guard.
    insert into public.code_redemptions (code_id, user_id, entitlement_id)
    values (v_code_id, v_claim.user_id, v_ent_id);

    -- 4) flip the claim to approved.
    update public.payment_claims
      set status = 'approved', reviewed_by = p_reviewer, reviewed_at = now()
    where id = p_claim_id;

    -- 5) audit in the SAME transaction (master §9). Plaintext code is NEVER stored here.
    insert into public.admin_audit_log (actor, action, entity, entity_id, details)
    values (p_reviewer, 'claim.approve', 'payment_claim', p_claim_id::text,
      jsonb_build_object('code_id', v_code_id, 'entitlement_id', v_ent_id,
        'tier_id', v_tier.id, 'expires_at', v_expires));

    return jsonb_build_object(
      'ok', true, 'entitlement_id', v_ent_id, 'code_id', v_code_id,
      'expires_at', v_expires, 'scope_type', v_tier.scope_type, 'tier_slug', v_tier.slug);
  end;
  $$;

  revoke all on function public.approve_claim(uuid, text, int, uuid)
    from public, anon, authenticated;

  -- ---------- reject_claim: guarded update + audit + (email fired by the action) ----------
  create or replace function public.reject_claim(
    p_claim_id uuid,
    p_reviewer uuid,
    p_note     text
  ) returns jsonb
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_status text;
    v_user   uuid;
  begin
    select status, user_id into v_status, v_user
    from public.payment_claims where id = p_claim_id for update;

    if not found then
      raise exception 'claim-not-found' using errcode = 'no_data_found';
    end if;
    if v_status <> 'pending' then
      raise exception 'not-pending' using errcode = 'check_violation';
    end if;
    if coalesce(btrim(p_note), '') = '' then
      raise exception 'note-required' using errcode = 'check_violation';  -- rejections must explain
    end if;

    update public.payment_claims
      set status = 'rejected', reviewed_by = p_reviewer, reviewed_at = now(), review_note = p_note
    where id = p_claim_id;

    insert into public.admin_audit_log (actor, action, entity, entity_id, details)
    values (p_reviewer, 'claim.reject', 'payment_claim', p_claim_id::text,
      jsonb_build_object('note', p_note));

    return jsonb_build_object('ok', true, 'user_id', v_user);
  end;
  $$;

  revoke all on function public.reject_claim(uuid, uuid, text)
    from public, anon, authenticated;
  ```
- [ ] After applying (Task 6.6 does the push; you can run this check then), verify `service_role`
  still holds EXECUTE on the revoked-from-public functions (it does by default privileges — the
  `revoke ... from public, anon, authenticated` above does not touch it; this check proves it):
  ```bash
  psql "$DB_URL" -c "select has_function_privilege('service_role','public.approve_claim(uuid,text,int,uuid)','execute') as approve_ok, has_function_privilege('service_role','public.reject_claim(uuid,uuid,text)','execute') as reject_ok, has_function_privilege('service_role','public.set_app_setting(text,jsonb,uuid)','execute') as settings_ok;"
  ```
  Expected: `approve_ok = t`, `reject_ok = t`, `settings_ok = t`.
- [ ] **Commit:**
  ```bash
  git add supabase/migrations && git commit -m "phase6: atomic approve_claim/reject_claim (stacking via Phase 4 grant_entitlement)"
  ```

**Failure modes:**
- **`function public.grant_entitlement(...) does not exist` at approve time** — Phase 4's helper
  is missing or its signature drifted. Do NOT define it here; re-run the `\df` prerequisite check,
  fix Phase 4, and record it in the Changelog (master §11).
- **`redeemed_count` set to 1 at insert** is intentional (the code is minted already-redeemed). Do
  not also increment it — that would over-count.
- **`make_interval(days => n)`** requires `n` to be an integer; `tiers.duration_days` is `int`, so
  fine. Do not pass a float.

---

## Task 6.6 — Apply migrations, regenerate types, verify a clean reset

- [ ] Verify all four Phase-6 migrations apply cleanly on a **fresh** database (master §8.5 — this
  is the authority that migrations are not drifted):
  ```bash
  supabase db reset
  ```
  Expected tail: `Finished supabase db reset.` with no errors; the new migrations listed as
  applied. If a local stack is not available, apply to a Supabase **branch** instead
  (`supabase branches create phase6-check`) — never test-apply straight to production.
- [ ] Apply to the linked dev project (or use MCP `apply_migration` for each file, master D1):
  ```bash
  supabase db push
  ```
- [ ] Regenerate the typed schema so the new table/functions are visible to TS (Phase 1 set this
  up; adjust the path if Phase 1 chose a different one):
  ```bash
  supabase gen types typescript --linked > lib/database.types.ts
  ```
- [ ] Sanity-check the functions exist with the expected signatures (psql / SQL editor / MCP
  `execute_sql` — the CLI has no `db execute`, master §14):
  ```bash
  psql "$DB_URL" -c "select p.proname, pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('grant_entitlement','approve_claim','reject_claim','set_app_setting') order by 1;"
  ```
  Expected (args order matters; `grant_entitlement` is Phase 4's — listed to confirm presence):
  ```
  approve_claim      | p_claim_id uuid, p_code_hash text, p_duration_days integer, p_reviewer uuid
  grant_entitlement  | p_user uuid, p_scope_type text, p_scope_id uuid, p_tier_id uuid, p_duration_days integer, p_source text, p_source_id uuid
  reject_claim       | p_claim_id uuid, p_reviewer uuid, p_note text
  set_app_setting    | p_key text, p_value jsonb, p_actor uuid
  ```
- [ ] Run the Supabase advisors (security lints) and confirm no new ERROR-level findings for the
  objects you added:
  ```bash
  # via MCP: get_advisors { type: "security" }  — check for RLS-disabled / policy warnings
  ```
- [ ] **Commit:**
  ```bash
  git add lib/database.types.ts && git commit -m "phase6: apply migrations, regenerate database types, verify clean reset"
  ```

**Failure modes:**
- **`supabase db reset` fails on an earlier phase's migration** → a prior phase drifted; do not
  edit their file. Report per master §11 and stop.
- **`gen types` overwrites hand-edits** → the file is generated; never hand-edit it.
- Advisor flags `payment_claims`/`app_settings` "RLS enabled but no policy" if you somehow skipped
  Task 6.3/6.4 — go back and add the policies.

---

## Task 6.7 — Email layer: `lib/email/templates.ts` (pure) + `lib/email/send.ts` (Resend REST)

Split into a **pure** templates module (snapshot-testable with Vitest, no server-only imports) and
a **server-only** sender that calls Resend and logs failures. Errors are logged to
`admin_audit_log` (action `'email.failed'`) and **never thrown into the user flow** (D10).

- [ ] Create `cubad/lib/email/templates.ts`:
  ```ts
  import type { Lang } from "@/lib/types";

  export interface EmailContent {
    subject: string;
    html: string;
    text: string;
  }

  /** Escape user-controlled values before interpolating into HTML email bodies. */
  export function escapeHtml(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * Format an ISO instant as a date in a FIXED timezone (UTC) with an explicit label. We do NOT
   * use toLocaleDateString without a timeZone: Vercel functions run in UTC but relying on the
   * host TZ is a latent bug, and the student may be in TZ (Africa/Dar_es_Salaam) or TR
   * (Europe/Istanbul). A stable "(UTC)" date is unambiguous and deterministic for snapshots.
   */
  export function formatExpiry(iso: string, lang: Lang): string {
    const d = new Date(iso);
    const fmt = new Intl.DateTimeFormat(lang === "tr" ? "tr-TR" : "en-GB", {
      dateStyle: "long",
      timeZone: "UTC",
    });
    return `${fmt.format(d)} (UTC)`;
  }

  function layout(title: string, bodyHtml: string): string {
    return (
      `<div style="font-family:system-ui,-apple-system,Arial,sans-serif;color:#1c2b33;` +
      `background:#f6f3eb;padding:24px">` +
      `<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e6e0d4;` +
      `border-radius:12px;padding:24px">` +
      `<h1 style="font-size:18px;margin:0 0 12px 0">${escapeHtml(title)}</h1>` +
      bodyHtml +
      `<p style="font-size:12px;color:#7b8a90;margin-top:24px">cubad · Pass by understanding.</p>` +
      `</div></div>`
    );
  }

  /* ---------------- admin: new claim (English — admin-facing) ---------------- */
  export function tmplAdminNewClaim(p: {
    studentName: string;
    studentEmail: string;
    tierTitle: string;
    amount: string;
    currency: string;
    method: string;
    payerRef: string;
    dashboardUrl: string;
  }): EmailContent {
    const rows: [string, string][] = [
      ["Student", `${p.studentName} <${p.studentEmail}>`],
      ["Tier", p.tierTitle],
      ["Amount", `${p.amount} ${p.currency}`.trim()],
      ["Method", p.method],
      ["Payer ref", p.payerRef || "—"],
    ];
    const subject = `New payment claim — ${p.studentName} (${p.tierTitle})`;
    const html = layout(
      "New payment claim",
      `<table style="width:100%;border-collapse:collapse;font-size:14px">` +
        rows
          .map(
            ([k, v]) =>
              `<tr><td style="padding:4px 8px 4px 0;color:#7b8a90;vertical-align:top">${escapeHtml(
                k
              )}</td><td style="padding:4px 0">${escapeHtml(v)}</td></tr>`
          )
          .join("") +
        `</table>` +
        `<p style="margin-top:16px"><a href="${escapeHtml(
          p.dashboardUrl
        )}" style="background:#0e5a6d;color:#fff;padding:10px 16px;border-radius:8px;` +
        `text-decoration:none;display:inline-block">Review claim</a></p>` +
        `<p style="font-size:13px;color:#7b8a90;margin-top:12px">Before approving: check the ` +
        `bank / M-Pesa statement for this payer ref and amount.</p>`
    );
    const text =
      `New payment claim\n` +
      rows.map(([k, v]) => `${k}: ${v}`).join("\n") +
      `\n\nReview: ${p.dashboardUrl}\n\n` +
      `Before approving: check the bank / M-Pesa statement for this payer ref and amount.`;
    return { subject, html, text };
  }

  /* ---------------- student: approved (bilingual) ---------------- */
  export function tmplClaimApproved(
    lang: Lang,
    p: { code: string; tierTitle: string; expiresIso: string; appUrl: string }
  ): EmailContent {
    const expiry = formatExpiry(p.expiresIso, lang);
    const S = {
      tr: {
        subject: "Ödemeniz onaylandı — erişim kodunuz",
        title: "Ödemeniz onaylandı",
        intro: `Teşekkürler! <strong>${escapeHtml(p.tierTitle)}</strong> erişiminiz etkinleştirildi.`,
        codeLabel: "Erişim kodunuz (makbuz olarak saklayın):",
        noRedeem:
          "Erişiminiz zaten açık — bu kodu tekrar girmenize gerek yok. Kaydınız için saklayın.",
        expiryLabel: "Erişim bitiş tarihi:",
        cta: "Çalışmaya başla",
      },
      en: {
        subject: "Payment approved — your access code",
        title: "Payment approved",
        intro: `Thank you! Your <strong>${escapeHtml(p.tierTitle)}</strong> access is now active.`,
        codeLabel: "Your access code (keep as your receipt):",
        noRedeem:
          "Your access is already on — you do NOT need to redeem this code. Keep it for your records.",
        expiryLabel: "Access valid until:",
        cta: "Start studying",
      },
    }[lang];
    const html = layout(
      S.title,
      `<p style="font-size:14px;line-height:1.5">${S.intro}</p>` +
        `<p style="font-size:13px;color:#7b8a90;margin:16px 0 4px">${escapeHtml(S.codeLabel)}</p>` +
        `<p style="font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:24px;font-weight:700;` +
        `letter-spacing:2px;background:#e6f0f2;color:#0e5a6d;padding:12px 16px;border-radius:10px;` +
        `text-align:center;margin:0 0 16px">${escapeHtml(p.code)}</p>` +
        `<p style="font-size:13px;line-height:1.5;background:#eef6ee;border-radius:8px;padding:10px 12px">` +
        `${escapeHtml(S.noRedeem)}</p>` +
        `<p style="font-size:14px;margin-top:12px">${escapeHtml(S.expiryLabel)} <strong>${escapeHtml(
          expiry
        )}</strong></p>` +
        `<p style="margin-top:16px"><a href="${escapeHtml(
          p.appUrl
        )}" style="background:#0e5a6d;color:#fff;padding:10px 16px;border-radius:8px;` +
        `text-decoration:none;display:inline-block">${escapeHtml(S.cta)}</a></p>`
    );
    const text =
      `${S.title}\n\n${S.codeLabel}\n${p.code}\n\n${S.noRedeem}\n\n${S.expiryLabel} ${expiry}\n\n${p.appUrl}`;
    return { subject: S.subject, html, text };
  }

  /* ---------------- student: rejected (bilingual) ---------------- */
  export function tmplClaimRejected(
    lang: Lang,
    p: { reason: string; appUrl: string }
  ): EmailContent {
    const S = {
      tr: {
        subject: "Ödeme bildiriminiz onaylanmadı",
        title: "Ödeme bildiriminiz onaylanmadı",
        intro: "Ödeme bildiriminizi doğrulayamadık. Neden:",
        cta: "Yeniden gönder",
      },
      en: {
        subject: "Your payment claim was not approved",
        title: "Your payment claim was not approved",
        intro: "We could not verify your payment claim. Reason:",
        cta: "Resubmit",
      },
    }[lang];
    const html = layout(
      S.title,
      `<p style="font-size:14px;line-height:1.5">${escapeHtml(S.intro)}</p>` +
        `<p style="font-size:14px;line-height:1.5;background:#f7eaea;border-left:3px solid #b4462f;` +
        `padding:10px 12px;border-radius:6px">${escapeHtml(p.reason)}</p>` +
        `<p style="margin-top:16px"><a href="${escapeHtml(
          p.appUrl
        )}/upgrade" style="background:#0e5a6d;color:#fff;padding:10px 16px;border-radius:8px;` +
        `text-decoration:none;display:inline-block">${escapeHtml(S.cta)}</a></p>`
    );
    const text = `${S.title}\n\n${S.intro}\n${p.reason}\n\n${S.cta}: ${p.appUrl}/upgrade`;
    return { subject: S.subject, html, text };
  }
  ```
- [ ] Create `cubad/lib/email/send.ts` (server-only; calls Resend, logs failures, never throws):
  ```ts
  import "server-only";
  import type { Lang } from "@/lib/types";
  import { createServiceRoleClient } from "@/lib/supabase/server";
  import {
    tmplAdminNewClaim,
    tmplClaimApproved,
    tmplClaimRejected,
    type EmailContent,
  } from "./templates";

  const RESEND_ENDPOINT = "https://api.resend.com/emails";
  const FROM_EMAIL = process.env.EMAIL_FROM || "onboarding@resend.dev";

  export interface SendResult {
    ok: boolean;
    id?: string;
    error?: string;
  }

  async function recordFailure(kind: string, to: string, error: string): Promise<void> {
    try {
      const svc = createServiceRoleClient();
      await svc.from("admin_audit_log").insert({
        actor: null,
        action: "email.failed",
        entity: "email",
        entity_id: kind,
        details: { kind, to, error: error.slice(0, 500) },
      });
    } catch {
      // If even the audit insert fails, we still must not throw into the user flow.
      console.error("email.failed audit insert failed", kind, error);
    }
  }

  async function sendOne(kind: string, to: string, content: EmailContent): Promise<SendResult> {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      await recordFailure(kind, to, "missing-api-key");
      return { ok: false, error: "missing-api-key" };
    }
    if (!to) {
      await recordFailure(kind, to, "missing-recipient");
      return { ok: false, error: "missing-recipient" };
    }
    try {
      const res = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: [to],
          subject: content.subject,
          html: content.html,
          text: content.text,
        }),
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        const error = `resend-${res.status}: ${detail}`;
        await recordFailure(kind, to, error);
        return { ok: false, error };
      }
      const data = (await res.json()) as { id?: string };
      return { ok: true, id: data.id };
    } catch (e) {
      const error = `network: ${(e as Error).message}`;
      await recordFailure(kind, to, error);
      return { ok: false, error };
    }
  }

  export function sendAdminNewClaim(p: Parameters<typeof tmplAdminNewClaim>[0]): Promise<SendResult> {
    const to = process.env.ADMIN_NOTIFY_EMAIL || "";
    return sendOne("admin.new_claim", to, tmplAdminNewClaim(p));
  }

  export function sendClaimApproved(
    to: string,
    lang: Lang,
    p: Parameters<typeof tmplClaimApproved>[1]
  ): Promise<SendResult> {
    return sendOne("claim.approved", to, tmplClaimApproved(lang, p));
  }

  export function sendClaimRejected(
    to: string,
    lang: Lang,
    p: Parameters<typeof tmplClaimRejected>[1]
  ): Promise<SendResult> {
    return sendOne("claim.rejected", to, tmplClaimRejected(lang, p));
  }
  ```
- [ ] **Commit:**
  ```bash
  git add lib/email && git commit -m "phase6: email layer — Resend REST sender + bilingual templates, failures audited not thrown"
  ```

**Failure modes:**
- **Resend 403 `You can only send testing emails to your own email address`** — happens on a fresh
  account until a domain is verified: with `onboarding@resend.dev` you can only deliver to the
  account owner's address. For the demo/E2E, set `ADMIN_NOTIFY_EMAIL` and the test student to the
  Resend account owner's email, or verify a domain and set `EMAIL_FROM` to it. This is a config
  issue, not a code bug — the send is logged as `email.failed` and the flow continues.
- **Resend 422** — usually a malformed `from` or missing `to`. `to` is validated above.
- **Do not put the plaintext code in `console.log` or in the `email.failed` details** — master §9.
  `recordFailure` only stores `kind`/`to`/`error`, never the body.

---

## Task 6.8 — Filename sanitation + pricing helpers (+ Vitest)

- [ ] Create `cubad/lib/payments/filename.ts`:
  ```ts
  // Extension is derived from the TRUSTED mime type, never from the client-supplied name.
  const MIME_EXT: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
  };

  export const ALLOWED_MIME = Object.keys(MIME_EXT);
  export const MAX_PROOF_BYTES = 10 * 1024 * 1024; // 10 MB — matches the bucket file_size_limit

  /**
   * Produce a safe object filename from an untrusted upload.
   * - drops any directory components a client might inject (../, absolute paths, backslashes)
   * - lowercases, strips to [a-z0-9._-], collapses runs, trims, caps length
   * - re-derives the extension from the mime type (ignores the client's claimed extension)
   * Returns "" when the mime type is not allowed (caller treats "" as invalid).
   */
  export function sanitizeFilename(rawName: string, mime: string): string {
    const ext = MIME_EXT[mime];
    if (!ext) return "";
    const base = (rawName ?? "").split(/[\\/]/).pop() ?? "";
    const stem = base.replace(/\.[^.]+$/, ""); // strip claimed extension
    const cleaned = stem
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 60);
    const safeStem = cleaned || "proof";
    return `${safeStem}.${ext}`;
  }
  ```
- [ ] Create `cubad/lib/payments/pricing.ts`:
  ```ts
  export interface TierPrice {
    currency: string;
    amount: number;
    country: string; // ISO alpha-2, or "*" for the default
  }

  /** Pick the price for the user's country, falling back to "*", then to the first entry. */
  export function priceForCountry(
    prices: TierPrice[] | null | undefined,
    countryCode: string
  ): TierPrice | null {
    if (!Array.isArray(prices) || prices.length === 0) return null;
    return (
      prices.find((p) => p.country === countryCode) ??
      prices.find((p) => p.country === "*") ??
      prices[0]
    );
  }
  ```
- [ ] Create `cubad/lib/payments/filename.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { sanitizeFilename, ALLOWED_MIME, MAX_PROOF_BYTES } from "./filename";

  describe("sanitizeFilename", () => {
    it("re-derives the extension from the mime, not the client name", () => {
      expect(sanitizeFilename("receipt.exe", "image/jpeg")).toBe("receipt.jpg");
      expect(sanitizeFilename("scan.PDF", "application/pdf")).toBe("scan.pdf");
    });
    it("drops directory traversal and path separators", () => {
      expect(sanitizeFilename("../../etc/passwd", "image/png")).toBe("passwd.png");
      expect(sanitizeFilename("C:\\Users\\a\\proof.jpg", "image/webp")).toBe("proof.webp");
    });
    it("lowercases, collapses unsafe runs, trims dashes/dots", () => {
      expect(sanitizeFilename("  My Receipt (2026)!!.jpg ", "image/jpeg")).toBe("my-receipt-2026.jpg");
    });
    it("falls back to 'proof' when the stem is empty after cleaning", () => {
      expect(sanitizeFilename("😀😀😀.png", "image/png")).toBe("proof.png");
      expect(sanitizeFilename("", "application/pdf")).toBe("proof.pdf");
    });
    it("caps the stem length", () => {
      const long = "a".repeat(200) + ".png";
      const out = sanitizeFilename(long, "image/png");
      expect(out.endsWith(".png")).toBe(true);
      expect(out.length).toBeLessThanOrEqual(64);
    });
    it("returns '' for a disallowed mime type", () => {
      expect(sanitizeFilename("x.gif", "image/gif")).toBe("");
      expect(sanitizeFilename("x.jpg", "image/jpg")).toBe(""); // non-canonical mime rejected
    });
    it("exposes the allow-list constants", () => {
      expect(ALLOWED_MIME).toContain("application/pdf");
      expect(MAX_PROOF_BYTES).toBe(10485760);
    });
  });
  ```
- [ ] Run the tests:
  ```bash
  npx vitest run lib/payments/filename.test.ts
  ```
  Expected: `Test Files 1 passed`, `Tests 7 passed`.
- [ ] **Commit:**
  ```bash
  git add lib/payments && git commit -m "phase6: filename sanitation + country pricing helper + vitest"
  ```

**Failure modes:**
- **`normalize` not available** — it is standard `String.prototype.normalize`; no import needed.
- If Phase 1 configured Vitest with a `jsdom`/`node` environment split, these pure tests run in
  either; no environment pragma needed.

---

## Task 6.9 — Server helper to read payment instructions

- [ ] Create `cubad/lib/payments/settings.ts`:
  ```ts
  import "server-only";
  import { createClient } from "@/lib/supabase/server";
  import type { Bi } from "@/lib/types";

  export interface PaymentInstructions {
    mpesa: Bi;
    bank: Bi;
    whatsapp: Bi;
  }

  const EMPTY: Bi = { tr: "", en: "" };

  export async function getPaymentInstructions(): Promise<PaymentInstructions> {
    const supabase = await createClient();
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "payment_instructions")
      .maybeSingle();
    const v = (data?.value ?? {}) as Partial<PaymentInstructions>;
    return {
      mpesa: v.mpesa ?? EMPTY,
      bank: v.bank ?? EMPTY,
      whatsapp: v.whatsapp ?? EMPTY,
    };
  }
  ```
- [ ] **Commit:**
  ```bash
  git add lib/payments/settings.ts && git commit -m "phase6: server helper to read payment_instructions from app_settings"
  ```

**Failure modes:** the `app_settings_public_read` policy is anon-readable (master §14 — Phase 7's
announcement banner is read anonymously through the same policy), so this works with the user
client. If it returns empty, the seed row (Task 6.4) did not apply — re-check `db push`.

---

## Task 6.10 — Student page: `/upgrade` (tier list)

The Phase-4 paywall links here. Lists **published** tiers with the price for the student's country.

- [ ] Create `cubad/app/upgrade/page.tsx` (Server Component). Note: this file delegates all
  rendering (including `Link`s) to the `UpgradeList` client component, so it imports no `Link`
  itself — keep imports to exactly what is used or `npm run lint` will fail on the unused import:
  ```tsx
  import { redirect } from "next/navigation";
  import { createClient } from "@/lib/supabase/server";
  import { priceForCountry, type TierPrice } from "@/lib/payments/pricing";
  import { UpgradeList } from "./UpgradeList";

  export default async function UpgradePage() {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/auth/sign-in?next=/upgrade");

    const { data: profile } = await supabase
      .from("profiles")
      .select("country_code")
      .eq("user_id", user.id)
      .maybeSingle();
    const country = profile?.country_code || "";

    const { data: tiers } = await supabase
      .from("tiers")
      .select("id,slug,title,description,scope_type,duration_days,prices")
      .eq("status", "published")
      .order("sort", { ascending: true });

    const items = (tiers ?? []).map((t) => ({
      slug: t.slug as string,
      title: t.title as { tr: string; en: string },
      description: t.description as { tr: string; en: string },
      scopeType: t.scope_type as string,
      durationDays: t.duration_days as number,
      price: priceForCountry(t.prices as TierPrice[], country),
    }));

    return <UpgradeList items={items} />;
  }
  ```
- [ ] Create `cubad/app/upgrade/UpgradeList.tsx` (Client Component — uses `useLang`):
  ```tsx
  "use client";

  import Link from "next/link";
  import { useLang } from "@/lib/i18n";
  import type { Bi } from "@/lib/types";
  import type { TierPrice } from "@/lib/payments/pricing";

  interface Item {
    slug: string;
    title: Bi;
    description: Bi;
    scopeType: string;
    durationDays: number;
    price: TierPrice | null;
  }

  const COPY = {
    heading: { tr: "Erişimini yükselt", en: "Upgrade your access" } as Bi,
    intro: {
      tr: "Bir paket seç, öde ve ödeme bildirimini gönder. Onaydan sonra erişimin açılır.",
      en: "Pick a plan, pay, and submit your payment claim. Access opens once we approve it.",
    } as Bi,
    days: { tr: "gün", en: "days" } as Bi,
    choose: { tr: "Bu paketi seç", en: "Choose this plan" } as Bi,
    noPrice: { tr: "Fiyat yakında", en: "Price coming soon" } as Bi,
    empty: { tr: "Şu anda satışta paket yok.", en: "No plans are on sale right now." } as Bi,
  };

  export function UpgradeList({ items }: { items: Item[] }) {
    const { bi } = useLang();
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="font-display text-2xl text-ink">{bi(COPY.heading)}</h1>
        <p className="mt-1 text-sm text-ink-soft">{bi(COPY.intro)}</p>

        {items.length === 0 ? (
          <p className="mt-8 rounded-xl border border-line bg-card p-6 text-center text-ink-soft">
            {bi(COPY.empty)}
          </p>
        ) : (
          <ul className="mt-6 grid gap-4">
            {items.map((it) => (
              <li key={it.slug} className="rounded-xl border border-line bg-card p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-display text-lg text-ink">{bi(it.title)}</h2>
                    <p className="mt-1 text-sm text-ink-soft">{bi(it.description)}</p>
                    <p className="mt-2 text-xs text-ink-faint">
                      {it.durationDays} {bi(COPY.days)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {it.price ? (
                      <p className="font-mono text-lg font-semibold text-deniz-deep">
                        {it.price.amount.toLocaleString()} {it.price.currency}
                      </p>
                    ) : (
                      <p className="text-xs text-ink-faint">{bi(COPY.noPrice)}</p>
                    )}
                  </div>
                </div>
                <Link
                  href={`/upgrade/pay/${it.slug}`}
                  className="mt-4 inline-block rounded-lg bg-deniz px-4 py-2 text-sm font-semibold text-white hover:bg-deniz-deep"
                >
                  {bi(COPY.choose)}
                </Link>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-6 text-center text-sm">
          <Link href="/upgrade/claims" className="text-deniz underline">
            {bi({ tr: "Bildirimlerimi gör", en: "View my claims" })}
          </Link>
        </p>
      </main>
    );
  }
  ```
- [ ] Build check and commit:
  ```bash
  npm run lint && npm run build
  git add app/upgrade && git commit -m "phase6: /upgrade tier list with country pricing"
  ```

**Manual verification checklist:**
- [ ] Signed out, visiting `/upgrade` redirects to `/auth/sign-in?next=/upgrade`.
- [ ] Signed in with a `TR` profile and the seeded `term-all` tier, the card shows `6 USD`
  (country `*`) or `15,000 TZS` for a `TZ` profile (canonical §5 tier).
- [ ] "Choose this plan" navigates to `/upgrade/pay/term-all`.

**Failure modes:** `tiers.prices` stored as `[]` → `priceForCountry` returns `null` and the card
shows "Price coming soon". Ensure Phase 4 seeded prices, or the demo shows no amount.

---

## Task 6.10b — Paywall "Upgrade" CTA (extends a Phase 4-owned file)

Phase 4's paywall panel ships with only `redeemHref` ("I have a code" → `/redeem?next=…`) — a
locked student has **no in-app path** to the `/upgrade` flow this phase builds. Master §14 binds
the contract: the paywall panel carries BOTH `redeemHref` AND `upgradeHref`
(`/upgrade?next=<current path>`). This task adds the missing prop + primary CTA.

> **Ownership note:** the paywall component is a **Phase 4-owned file** (per §14 registry:
> `PaywallPanel` with its `PaywallCopy` strings — locate it with
> `grep -rn "redeemHref" components app`). Phase 6 is where this change LANDS in execution order;
> do not also patch it in the Phase 4 doc — record the cross-phase touch in this doc's Changelog
> when executing. Apply the diff below surgically; keep everything else in the file unchanged.

- [ ] Open the Phase 4 paywall component (expected `cubad/components/PaywallPanel.tsx`; confirm
  with the grep above) and apply this diff:
  1. **Extend the copy object** — add one key to the existing `PaywallCopy` strings (bilingual,
     student-facing):
  ```tsx
  // inside the existing PaywallCopy (or PAYWALL_COPY) strings object, add:
  upgradeCta: { tr: "Yükselt", en: "Upgrade" } as Bi,
  ```
  2. **Extend the props type** — add the new prop alongside the existing `redeemHref`:
  ```tsx
  // in the PaywallPanel props interface/type, alongside redeemHref: string;
  /** Where the primary upgrade CTA points, e.g. `/upgrade?next=${encodeURIComponent(path)}` */
  upgradeHref: string;
  ```
  3. **Render the primary CTA** — immediately BEFORE the existing redeem link JSX, add (uses the
     same `bi` from the component's existing `useLang()` call and `Link` from `next/link`, both
     already imported by the Phase 4 component):
  ```tsx
  <Link
    href={upgradeHref}
    className="rounded-lg bg-deniz px-4 py-2 text-sm font-semibold text-white hover:bg-deniz-deep"
  >
    {bi(PAYWALL_COPY.upgradeCta)}
  </Link>
  ```
  (Match the actual copy-object identifier used in the file — `PaywallCopy` vs `PAYWALL_COPY`.
  The upgrade CTA is the filled/primary button; the existing redeem link stays as the secondary
  action next to it.)
- [ ] Update every call site of `<PaywallPanel …>` (Phase 4 renders it from the gated unit/subject
  pages) to pass the new prop, built from the **current path** so the student can come back:
  ```tsx
  upgradeHref={`/upgrade?next=${encodeURIComponent(currentPath)}`}
  ```
  where `currentPath` is the page's own route string the caller already knows (e.g.
  `/s/${subjectSlug}/unit/${unitSlug}`). The `next` param is carried per the §14 contract for
  post-purchase return; `/upgrade` v1 does not need to consume it (claims are reviewed
  asynchronously), and preserving it costs nothing.
- [ ] Build check and commit:
  ```bash
  npm run lint && npm run build
  git add components app && git commit -m "phase6: paywall upgradeHref CTA -> /upgrade (closes locked-student dead end)"
  ```

**Manual verification checklist:**
- [ ] As a student with NO entitlement, open a locked (non-free) unit → the paywall shows a
  primary "Upgrade / Yükselt" button AND the existing "I have a code" link.
- [ ] The Upgrade button lands on `/upgrade` with `?next=` set to the unit path you came from.
- [ ] Language toggle flips the CTA label between "Upgrade" and "Yükselt".

**Failure modes:**
- **TypeScript error at call sites** after adding the required prop — that is the point: the
  compiler enumerates every render of the panel so none is missed. Fix each by passing
  `upgradeHref`; do not make the prop optional (an optional prop silently recreates the dead end).
- **Wrong copy-object name** — the snippet says `PAYWALL_COPY`; if Phase 4 named it `PaywallCopy`
  (or inlined strings), adapt the identifier only, not the `Bi` values.

---

## Task 6.11 — Student page: `/upgrade/pay/[tierSlug]` + submit action

Shows instructions + a claim form (method, payer_ref, amount+currency prefilled/editable, proof
file). The **submit action** implements decision **D6.a**: insert with the user client (RLS CHECK),
upload + `proof_path` with the service client, then fire the admin email post-response.

- [ ] Create the submit + cancel actions in `cubad/app/upgrade/actions.ts`:
  ```ts
  "use server";

  import { redirect } from "next/navigation";
  import { revalidatePath } from "next/cache";
  import { after } from "next/server";
  import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
  import {
    sanitizeFilename,
    ALLOWED_MIME,
    MAX_PROOF_BYTES,
  } from "@/lib/payments/filename";
  import { sendAdminNewClaim } from "@/lib/email/send";

  const VALID_METHODS = ["mpesa", "tigopesa", "airtelmoney", "bank", "other"];

  export interface SubmitState {
    error?: string;
  }

  export async function submitClaim(
    _prev: SubmitState,
    formData: FormData
  ): Promise<SubmitState> {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/auth/sign-in?next=/upgrade"); // re-check auth: actions are raw-POST reachable

    const tierId = String(formData.get("tierId") ?? "");
    const method = String(formData.get("method") ?? "");
    const payerRef = String(formData.get("payerRef") ?? "").slice(0, 200);
    const currency = String(formData.get("currency") ?? "").slice(0, 8);
    const amountRaw = String(formData.get("amount") ?? "").trim();
    const amount = amountRaw ? Number(amountRaw) : null;
    const file = formData.get("proof");

    // ---- validate inputs ----
    if (!tierId || !VALID_METHODS.includes(method)) return { error: "bad-input" };
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) return { error: "bad-amount" };
    if (!(file instanceof File) || file.size === 0) return { error: "proof-required" };
    if (file.size > MAX_PROOF_BYTES) return { error: "too-large" };
    if (!ALLOWED_MIME.includes(file.type)) return { error: "bad-type" };
    const safeName = sanitizeFilename(file.name, file.type);
    if (!safeName) return { error: "bad-type" };

    // ---- friendly pre-check of the open-claim limit (SQL count; the trigger is authoritative) ----
    const { count } = await supabase
      .from("payment_claims")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "pending");
    if ((count ?? 0) >= 3) return { error: "too-many-open" };

    // ---- 1) insert the claim with the USER client so the RLS CHECK is exercised (D6.a) ----
    const { data: claim, error: insErr } = await supabase
      .from("payment_claims")
      .insert({
        user_id: user.id,
        tier_id: tierId,
        method,
        payer_ref: payerRef,
        amount,
        currency: currency || null,
        status: "pending",
      })
      .select("id")
      .single();
    if (insErr || !claim) {
      // the trigger raises 'open-claim-limit' if a race slipped past the pre-check
      if (insErr?.message?.includes("open-claim-limit")) return { error: "too-many-open" };
      return { error: "insert-failed" };
    }

    // ---- 2) upload proof with the SERVICE client to the enforced path (users never write here) ----
    const svc = createServiceRoleClient();
    const path = `${user.id}/${claim.id}/${safeName}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: upErr } = await svc.storage
      .from("payment-proofs")
      .upload(path, bytes, { contentType: file.type, upsert: false });
    if (upErr) {
      await svc.from("payment_claims").delete().eq("id", claim.id); // remove the orphan
      return { error: "upload-failed" };
    }

    // ---- 3) write proof_path with the SERVICE client (owner UPDATE is closed by RLS) ----
    const { error: pErr } = await svc
      .from("payment_claims")
      .update({ proof_path: path })
      .eq("id", claim.id);
    if (pErr) {
      await svc.storage.from("payment-proofs").remove([path]);
      await svc.from("payment_claims").delete().eq("id", claim.id);
      return { error: "finalize-failed" };
    }

    // ---- 4) notify admin AFTER the response — email failure never blocks the claim (D10) ----
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    const { data: prof } = await svc
      .from("profiles")
      .select("full_name,email")
      .eq("user_id", user.id)
      .maybeSingle();
    const { data: tier } = await svc
      .from("tiers")
      .select("title")
      .eq("id", tierId)
      .maybeSingle();
    const tierTitle = (tier?.title as { en?: string } | null)?.en ?? "(tier)";
    after(async () => {
      await sendAdminNewClaim({
        studentName: prof?.full_name || "(no name)",
        studentEmail: prof?.email || user.email || "",
        tierTitle,
        amount: amount != null ? String(amount) : "—",
        currency: currency || "",
        method,
        payerRef,
        dashboardUrl: `${appUrl}/admin/payments/${claim.id}`,
      });
    });

    revalidatePath("/upgrade/claims");
    redirect("/upgrade/claims?submitted=1");
  }

  export async function cancelClaim(formData: FormData): Promise<void> {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/auth/sign-in");
    const id = String(formData.get("claimId") ?? "");
    if (!id) return;

    // Look up the proof path (own SELECT) so we can also purge the storage object.
    const { data: claim } = await supabase
      .from("payment_claims")
      .select("proof_path,status")
      .eq("id", id)
      .maybeSingle();

    // Owner DELETE is allowed by RLS only for own pending claims; the extra .eq is belt-and-braces.
    const { error } = await supabase
      .from("payment_claims")
      .delete()
      .eq("id", id)
      .eq("status", "pending");
    if (!error && claim?.proof_path) {
      const svc = createServiceRoleClient();
      await svc.storage.from("payment-proofs").remove([claim.proof_path]);
    }
    revalidatePath("/upgrade/claims");
  }
  ```
- [ ] Create `cubad/app/upgrade/pay/[tierSlug]/page.tsx` (Server Component; async `params`):
  ```tsx
  import { notFound, redirect } from "next/navigation";
  import { createClient } from "@/lib/supabase/server";
  import { getPaymentInstructions } from "@/lib/payments/settings";
  import { priceForCountry, type TierPrice } from "@/lib/payments/pricing";
  import { ClaimForm } from "./ClaimForm";

  export default async function PayPage({
    params,
  }: {
    params: Promise<{ tierSlug: string }>;
  }) {
    const { tierSlug } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect(`/auth/sign-in?next=/upgrade/pay/${tierSlug}`);

    const { data: tier } = await supabase
      .from("tiers")
      .select("id,slug,title,description,scope_type,duration_days,prices")
      .eq("slug", tierSlug)
      .eq("status", "published")
      .maybeSingle();
    if (!tier) notFound();

    const { data: profile } = await supabase
      .from("profiles")
      .select("country_code")
      .eq("user_id", user.id)
      .maybeSingle();
    const country = profile?.country_code || "";
    const price = priceForCountry(tier.prices as TierPrice[], country);
    const instructions = await getPaymentInstructions();

    return (
      <ClaimForm
        tierId={tier.id as string}
        tierTitle={tier.title as { tr: string; en: string }}
        defaultAmount={price?.amount ?? null}
        defaultCurrency={price?.currency ?? ""}
        instructions={instructions}
      />
    );
  }
  ```
- [ ] Create `cubad/app/upgrade/pay/[tierSlug]/ClaimForm.tsx` (Client Component):
  ```tsx
  "use client";

  import { useActionState } from "react";
  import { useLang } from "@/lib/i18n";
  import { Md } from "@/components/Md";
  import type { Bi } from "@/lib/types";
  import type { PaymentInstructions } from "@/lib/payments/settings";
  import { submitClaim, type SubmitState } from "../../actions";

  const COPY = {
    pay: { tr: "Ödeme yap", en: "Make your payment" } as Bi,
    instr: { tr: "Ödeme talimatları", en: "Payment instructions" } as Bi,
    mpesa: { tr: "M-Pesa", en: "M-Pesa" } as Bi,
    bank: { tr: "Banka havalesi", en: "Bank transfer" } as Bi,
    whatsapp: { tr: "WhatsApp", en: "WhatsApp" } as Bi,
    formTitle: { tr: "Ödeme bildirimi gönder", en: "Submit your payment claim" } as Bi,
    method: { tr: "Ödeme yöntemi", en: "Payment method" } as Bi,
    payerRef: {
      tr: "İşlem no / gönderen (ör. SFC8KL29XY)",
      en: "Transaction ID / sender (e.g. SFC8KL29XY)",
    } as Bi,
    amount: { tr: "Tutar", en: "Amount" } as Bi,
    currency: { tr: "Para birimi", en: "Currency" } as Bi,
    proof: { tr: "Dekont (resim veya PDF, en fazla 10 MB)", en: "Proof (image or PDF, max 10 MB)" } as Bi,
    submit: { tr: "Bildirimi gönder", en: "Submit claim" } as Bi,
    submitting: { tr: "Gönderiliyor...", en: "Submitting..." } as Bi,
  };

  const METHODS: { value: string; label: Bi }[] = [
    { value: "mpesa", label: { tr: "M-Pesa", en: "M-Pesa" } },
    { value: "tigopesa", label: { tr: "Tigo Pesa", en: "Tigo Pesa" } },
    { value: "airtelmoney", label: { tr: "Airtel Money", en: "Airtel Money" } },
    { value: "bank", label: { tr: "Banka", en: "Bank" } },
    { value: "other", label: { tr: "Diğer", en: "Other" } },
  ];

  const ERRORS: Record<string, Bi> = {
    "bad-input": { tr: "Eksik veya geçersiz bilgi.", en: "Missing or invalid information." },
    "bad-amount": { tr: "Tutar geçersiz.", en: "The amount is invalid." },
    "proof-required": { tr: "Lütfen bir dekont ekleyin.", en: "Please attach a proof file." },
    "too-large": { tr: "Dosya 10 MB sınırını aşıyor.", en: "The file exceeds the 10 MB limit." },
    "bad-type": {
      tr: "Sadece JPG, PNG, WEBP veya PDF kabul edilir.",
      en: "Only JPG, PNG, WEBP or PDF are accepted.",
    },
    "too-many-open": {
      tr: "En fazla 3 bekleyen bildirimin olabilir. Önce birini iptal et.",
      en: "You can have at most 3 pending claims. Cancel one first.",
    },
    "insert-failed": { tr: "Bildirim kaydedilemedi.", en: "Could not save the claim." },
    "upload-failed": { tr: "Dekont yüklenemedi.", en: "Could not upload the proof." },
    "finalize-failed": { tr: "Bildirim tamamlanamadı.", en: "Could not finalize the claim." },
  };

  export function ClaimForm({
    tierId,
    tierTitle,
    defaultAmount,
    defaultCurrency,
    instructions,
  }: {
    tierId: string;
    tierTitle: Bi;
    defaultAmount: number | null;
    defaultCurrency: string;
    instructions: PaymentInstructions;
  }) {
    const { bi } = useLang();
    const [state, formAction, pending] = useActionState<SubmitState, FormData>(submitClaim, {});

    const block = (label: Bi, body: Bi) =>
      bi(body).trim() ? (
        <div className="rounded-lg border border-line bg-paper p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-deniz-deep">
            {bi(label)}
          </p>
          <Md className="text-sm">{bi(body)}</Md>
        </div>
      ) : null;

    return (
      <main className="mx-auto max-w-xl px-4 py-8">
        <h1 className="font-display text-2xl text-ink">{bi(COPY.pay)}</h1>
        <p className="mt-1 text-sm text-ink-soft">{bi(tierTitle)}</p>

        <section className="mt-5">
          <h2 className="mb-2 text-sm font-semibold text-ink">{bi(COPY.instr)}</h2>
          <div className="grid gap-2">
            {block(COPY.mpesa, instructions.mpesa)}
            {block(COPY.bank, instructions.bank)}
            {block(COPY.whatsapp, instructions.whatsapp)}
          </div>
        </section>

        <form action={formAction} className="mt-6 grid gap-4">
          <input type="hidden" name="tierId" value={tierId} />

          <label className="grid gap-1 text-sm">
            <span className="font-medium text-ink">{bi(COPY.method)}</span>
            <select
              name="method"
              required
              defaultValue="mpesa"
              className="rounded-lg border border-line bg-card px-3 py-2"
            >
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {bi(m.label)}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-sm">
            <span className="font-medium text-ink">{bi(COPY.payerRef)}</span>
            <input
              name="payerRef"
              type="text"
              className="rounded-lg border border-line bg-card px-3 py-2 font-mono"
              maxLength={200}
            />
          </label>

          <div className="grid grid-cols-[2fr_1fr] gap-3">
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-ink">{bi(COPY.amount)}</span>
              <input
                name="amount"
                type="number"
                step="0.01"
                min="0"
                defaultValue={defaultAmount ?? ""}
                className="rounded-lg border border-line bg-card px-3 py-2 font-mono"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-ink">{bi(COPY.currency)}</span>
              <input
                name="currency"
                type="text"
                defaultValue={defaultCurrency}
                className="rounded-lg border border-line bg-card px-3 py-2 font-mono uppercase"
                maxLength={8}
              />
            </label>
          </div>

          <label className="grid gap-1 text-sm">
            <span className="font-medium text-ink">{bi(COPY.proof)}</span>
            <input
              name="proof"
              type="file"
              required
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="rounded-lg border border-line bg-card px-3 py-2 text-sm"
            />
          </label>

          {state.error && (
            <p className="rounded-lg border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">
              {bi(ERRORS[state.error] ?? { tr: "Bir hata oluştu.", en: "Something went wrong." })}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-deniz px-4 py-2.5 text-sm font-semibold text-white hover:bg-deniz-deep disabled:opacity-60"
          >
            {pending ? bi(COPY.submitting) : bi(COPY.submit)}
          </button>
        </form>
      </main>
    );
  }
  ```
- [ ] Build check and commit:
  ```bash
  npm run lint && npm run build
  git add app/upgrade && git commit -m "phase6: /upgrade/pay claim form + submit action (user-client insert, service-client upload/proof_path, post-commit admin email)"
  ```

**Why this client split (D6.a, restated for the executor):** the row is inserted by the **user**
client so the `payment_claims` insert `CHECK` (`user_id = auth.uid()` and `status = 'pending'`)
runs — a student literally cannot POST `status:'approved'`. The **only** privileged operations are
(1) writing the object into the private bucket and (2) setting `proof_path`; both go through the
**service** client because we deliberately never grant owners `UPDATE` on `payment_claims` (that
would open `status`/`proof_path` tampering). If the upload or the `proof_path` write fails, we
delete the just-created claim so no proof-less orphan lingers.

**Manual verification checklist:**
- [ ] Submit a valid JPG < 10 MB → redirected to `/upgrade/claims?submitted=1`; a `payment_claims`
  row exists with `status='pending'` and `proof_path='<uid>/<claimId>/<name>.jpg'`.
- [ ] The object exists at that path in the `payment-proofs` bucket (Storage UI).
- [ ] Submitting a 12 MB file → inline "exceeds the 10 MB limit" (server rejects before upload).
- [ ] Submitting a `.gif` → "Only JPG, PNG, WEBP or PDF are accepted."
- [ ] With `RESEND_API_KEY` set and `ADMIN_NOTIFY_EMAIL` = the Resend account owner, the admin
  notification email arrives; with it unset, the claim still succeeds and an `email.failed` audit
  row appears.

**Failure modes:**
- **`after` not firing locally** — `after` runs after the response; in `next dev` it runs but
  logging/network may lag. Verify via the audit log or Resend dashboard, not console timing.
- **File `type` empty** — some browsers send an empty `type` for unusual files; the `ALLOWED_MIME`
  check rejects it with `bad-type`. Expected.
- **Redirect throws inside the action** — that is normal Next control-flow; do not wrap it in
  try/catch (it would swallow the redirect).

---

## Task 6.12 — Student page: `/upgrade/claims` (history, cancel, resubmit)

- [ ] Create `cubad/app/upgrade/claims/page.tsx` (Server Component):
  ```tsx
  import { redirect } from "next/navigation";
  import { createClient } from "@/lib/supabase/server";
  import { ClaimsList } from "./ClaimsList";

  export default async function ClaimsPage() {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/auth/sign-in?next=/upgrade/claims");

    const { data: claims } = await supabase
      .from("payment_claims")
      .select("id,tier_id,amount,currency,method,status,review_note,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    // Resolve tier slugs+titles for display and the resubmit link.
    const tierIds = [...new Set((claims ?? []).map((c) => c.tier_id as string))];
    const { data: tiers } = tierIds.length
      ? await supabase.from("tiers").select("id,slug,title").in("id", tierIds)
      : { data: [] as { id: string; slug: string; title: unknown }[] };
    const tierMap = new Map((tiers ?? []).map((t) => [t.id as string, t]));

    const items = (claims ?? []).map((c) => {
      const t = tierMap.get(c.tier_id as string);
      return {
        id: c.id as string,
        tierSlug: (t?.slug as string) ?? "",
        tierTitle: (t?.title as { tr: string; en: string }) ?? { tr: "", en: "" },
        amount: c.amount as number | null,
        currency: (c.currency as string | null) ?? "",
        method: c.method as string,
        status: c.status as "pending" | "approved" | "rejected",
        reviewNote: (c.review_note as string | null) ?? "",
        createdAt: c.created_at as string,
      };
    });

    return <ClaimsList items={items} />;
  }
  ```
- [ ] Create `cubad/app/upgrade/claims/ClaimsList.tsx` (Client Component):
  ```tsx
  "use client";

  import Link from "next/link";
  import { useLang } from "@/lib/i18n";
  import type { Bi } from "@/lib/types";
  import { cancelClaim } from "../actions";

  const COPY = {
    heading: { tr: "Ödeme bildirimlerim", en: "My payment claims" } as Bi,
    empty: { tr: "Henüz bildirimin yok.", en: "You have no claims yet." } as Bi,
    submitted: {
      tr: "Bildirimin alındı. İnceleme sonrası e-posta ile bilgilendirileceksin.",
      en: "Your claim was received. We'll email you after review.",
    } as Bi,
    cancel: { tr: "İptal et", en: "Cancel" } as Bi,
    resubmit: { tr: "Yeniden gönder", en: "Resubmit" } as Bi,
    note: { tr: "İnceleme notu", en: "Review note" } as Bi,
    browse: { tr: "Paketlere göz at", en: "Browse plans" } as Bi,
  };

  const STATUS: Record<string, { label: Bi; cls: string }> = {
    pending: {
      label: { tr: "Bekliyor", en: "Pending" },
      cls: "bg-amber-soft text-amber",
    },
    approved: {
      label: { tr: "Onaylandı", en: "Approved" },
      cls: "bg-moss-soft text-moss",
    },
    rejected: {
      label: { tr: "Reddedildi", en: "Rejected" },
      cls: "bg-clay-soft text-clay",
    },
  };

  export function ClaimsList({
    items,
  }: {
    items: {
      id: string;
      tierSlug: string;
      tierTitle: Bi;
      amount: number | null;
      currency: string;
      method: string;
      status: "pending" | "approved" | "rejected";
      reviewNote: string;
      createdAt: string;
    }[];
  }) {
    const { bi } = useLang();
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="font-display text-2xl text-ink">{bi(COPY.heading)}</h1>

        {items.length === 0 ? (
          <div className="mt-6 rounded-xl border border-line bg-card p-6 text-center">
            <p className="text-ink-soft">{bi(COPY.empty)}</p>
            <Link href="/upgrade" className="mt-3 inline-block text-deniz underline">
              {bi(COPY.browse)}
            </Link>
          </div>
        ) : (
          <ul className="mt-6 grid gap-4">
            {items.map((c) => {
              const st = STATUS[c.status];
              return (
                <li key={c.id} className="rounded-xl border border-line bg-card p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-ink">{bi(c.tierTitle)}</p>
                      <p className="mt-0.5 font-mono text-xs text-ink-faint">
                        {c.amount != null ? `${c.amount.toLocaleString()} ${c.currency}` : "—"} ·{" "}
                        {c.method}
                      </p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${st.cls}`}>
                      {bi(st.label)}
                    </span>
                  </div>

                  {c.status === "rejected" && c.reviewNote && (
                    <div className="mt-3 rounded-lg border border-clay/25 bg-clay-soft px-3 py-2 text-sm text-clay">
                      <span className="font-semibold">{bi(COPY.note)}: </span>
                      {c.reviewNote}
                    </div>
                  )}

                  <div className="mt-3 flex gap-3">
                    {c.status === "pending" && (
                      <form action={cancelClaim}>
                        <input type="hidden" name="claimId" value={c.id} />
                        <button
                          type="submit"
                          className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-soft hover:border-clay hover:text-clay"
                        >
                          {bi(COPY.cancel)}
                        </button>
                      </form>
                    )}
                    {c.status === "rejected" && c.tierSlug && (
                      <Link
                        href={`/upgrade/pay/${c.tierSlug}`}
                        className="rounded-lg bg-deniz px-3 py-1.5 text-sm font-semibold text-white hover:bg-deniz-deep"
                      >
                        {bi(COPY.resubmit)}
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    );
  }
  ```
- [ ] Build check and commit:
  ```bash
  npm run lint && npm run build
  git add app/upgrade/claims && git commit -m "phase6: /upgrade/claims history with cancel (pending) + resubmit (rejected)"
  ```

**Manual verification checklist:**
- [ ] A pending claim shows a "Cancel" button; clicking it removes the row and the proof object.
- [ ] After cancel, the pending count drops (you can submit again up to 3).
- [ ] A rejected claim shows the review note and a "Resubmit" button linking to the tier's pay page.
- [ ] Approved claims show the green badge and no actions.

**Failure modes:** cancelling relies on RLS `claims_delete_own_pending`; if a claim is not pending
the delete is a no-op (RLS filters it out) and the list simply re-renders unchanged.

---

## Task 6.13 — Admin queue: `/admin/payments` + nav badge count

- [ ] Create `cubad/lib/payments/queue.ts` (server-only helper for the count):
  ```ts
  import "server-only";
  import { createClient } from "@/lib/supabase/server";

  /** Pending-claim count via a SQL count (never a JS reduce — master §9). Admin RLS applies. */
  export async function getPendingClaimCount(): Promise<number> {
    const supabase = await createClient();
    const { count } = await supabase
      .from("payment_claims")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending");
    return count ?? 0;
  }
  ```
- [ ] Create `cubad/app/admin/payments/page.tsx` (Server Component; async `searchParams`):
  ```tsx
  import Link from "next/link";
  import { createClient } from "@/lib/supabase/server";

  const STATUSES = ["pending", "approved", "rejected"] as const;
  const METHODS = ["mpesa", "tigopesa", "airtelmoney", "bank", "other"] as const;

  export default async function AdminPaymentsPage({
    searchParams,
  }: {
    searchParams: Promise<{ status?: string; method?: string }>;
  }) {
    const sp = await searchParams;
    const status = STATUSES.includes(sp.status as (typeof STATUSES)[number])
      ? (sp.status as string)
      : "";
    const method = METHODS.includes(sp.method as (typeof METHODS)[number])
      ? (sp.method as string)
      : "";

    const supabase = await createClient(); // admin RLS: claims_select_admin

    let query = supabase
      .from("payment_claims")
      .select("id,user_id,tier_id,amount,currency,method,status,created_at")
      // pending first, then newest — ordering by status text puts 'approved','pending','rejected'
      // alphabetically, so we sort pending-first in JS after a stable newest-first DB order.
      .order("created_at", { ascending: false })
      .limit(200);
    if (status) query = query.eq("status", status);
    if (method) query = query.eq("method", method);
    const { data: claims } = await query;

    const rows = [...(claims ?? [])].sort((a, b) => {
      const ap = a.status === "pending" ? 0 : 1;
      const bp = b.status === "pending" ? 0 : 1;
      return ap - bp; // stable: keeps newest-first within each group
    });

    // Resolve tier titles for display.
    const tierIds = [...new Set(rows.map((r) => r.tier_id as string))];
    const { data: tiers } = tierIds.length
      ? await supabase.from("tiers").select("id,title").in("id", tierIds)
      : { data: [] as { id: string; title: unknown }[] };
    const tierMap = new Map((tiers ?? []).map((t) => [t.id as string, t.title as { en?: string }]));

    const link = (patch: Record<string, string>) => {
      const p = new URLSearchParams();
      const s = patch.status ?? status;
      const m = patch.method ?? method;
      if (s) p.set("status", s);
      if (m) p.set("method", m);
      const qs = p.toString();
      return qs ? `/admin/payments?${qs}` : "/admin/payments";
    };

    return (
      <main className="mx-auto max-w-4xl px-4 py-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-ink">Payments</h1>
          <Link href="/admin/payments/settings" className="text-sm text-deniz underline">
            Payment instructions
          </Link>
        </div>

        {/* filters */}
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <span className="text-ink-faint">Status:</span>
          <Link href={link({ status: "" })} className={!status ? "font-semibold text-deniz" : "text-ink-soft"}>
            all
          </Link>
          {STATUSES.map((s) => (
            <Link key={s} href={link({ status: s })} className={status === s ? "font-semibold text-deniz" : "text-ink-soft"}>
              {s}
            </Link>
          ))}
          <span className="ml-4 text-ink-faint">Method:</span>
          <Link href={link({ method: "" })} className={!method ? "font-semibold text-deniz" : "text-ink-soft"}>
            all
          </Link>
          {METHODS.map((m) => (
            <Link key={m} href={link({ method: m })} className={method === m ? "font-semibold text-deniz" : "text-ink-soft"}>
              {m}
            </Link>
          ))}
        </div>

        <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-card">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="border-b border-line bg-wash/70 text-left">
                <th className="px-3 py-2 font-semibold">Created</th>
                <th className="px-3 py-2 font-semibold">Tier</th>
                <th className="px-3 py-2 font-semibold">Amount</th>
                <th className="px-3 py-2 font-semibold">Method</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-ink-faint">
                    No claims.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id as string} className="border-b border-line/60">
                    <td className="px-3 py-2 font-mono text-xs text-ink-faint">
                      {new Date(r.created_at as string).toISOString().slice(0, 16).replace("T", " ")}
                    </td>
                    <td className="px-3 py-2">{tierMap.get(r.tier_id as string)?.en ?? "—"}</td>
                    <td className="px-3 py-2 font-mono">
                      {r.amount != null ? `${(r.amount as number).toLocaleString()} ${r.currency ?? ""}` : "—"}
                    </td>
                    <td className="px-3 py-2">{r.method as string}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          "rounded-full px-2 py-0.5 text-xs font-semibold " +
                          (r.status === "pending"
                            ? "bg-amber-soft text-amber"
                            : r.status === "approved"
                            ? "bg-moss-soft text-moss"
                            : "bg-clay-soft text-clay")
                        }
                      >
                        {r.status as string}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`/admin/payments/${r.id}`} className="text-deniz underline">
                        review
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    );
  }
  ```
- [ ] Wire the **badge count** into the admin nav. Phase 5 owns the nav component; add the count in
  the admin layout and render it on the "Payments" slot. In `cubad/app/admin/layout.tsx` (adjust to
  the actual Phase-5 shell), compute and pass the count:
  ```tsx
  // inside the admin layout server component, near the other nav data:
  import { getPendingClaimCount } from "@/lib/payments/queue";
  // ...
  const pendingClaims = await getPendingClaimCount();
  // pass `pendingClaims` to the nav and render next to the "Payments" link, e.g.:
  //   {pendingClaims > 0 && (
  //     <span className="ml-2 rounded-full bg-clay px-1.5 py-0.5 text-[11px] font-semibold text-white">
  //       {pendingClaims}
  //     </span>
  //   )}
  ```
  > If Phase 5's nav is a separate client component, pass `pendingClaims` down as a prop from the
  > layout (a server component) — do not fetch inside a client component.
- [ ] Build check and commit:
  ```bash
  npm run lint && npm run build
  git add lib/payments/queue.ts app/admin/payments/page.tsx app/admin/layout.tsx && git commit -m "phase6: /admin/payments queue (pending-first, status/method filters) + nav pending badge"
  ```

**Manual verification checklist:**
- [ ] As an admin, `/admin/payments` lists claims with pending ones on top.
- [ ] `?status=pending` and `?method=mpesa` filters work and combine.
- [ ] The "Payments" nav item shows a red badge equal to the pending count; it disappears at 0.
- [ ] As a non-admin, `/admin/*` is blocked by the Phase-5 layout gate (and RLS returns no rows
  anyway).

**Failure modes:**
- **Ordering:** Postgres cannot express "pending first then newest" with a single `order` on the
  text column (alphabetical would misorder). We fetch newest-first and re-group in JS — this is a
  presentation sort over ≤200 rows, not a security aggregate, so it does not violate §9.
- **>200 pending** at launch is implausible for manual payments; if it happens, add pagination
  (out of scope for v1).

---

## Task 6.14 — Admin claim detail + proof viewer + Approve/Reject

- [ ] Create the admin actions in `cubad/app/admin/payments/actions.ts`:
  ```ts
  "use server";

  import { revalidatePath } from "next/cache";
  import { after } from "next/server";
  import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
  import { generateCode, normalizeCode, hashCode } from "@/lib/access/codes";
  import { sendClaimApproved, sendClaimRejected } from "@/lib/email/send";

  export interface ApproveState {
    ok?: boolean;
    error?: string;
    code?: string; // rendered ONCE to the admin as a fallback; never persisted
    expiresIso?: string;
    emailOk?: boolean;
    emailError?: string;
  }

  export interface RejectState {
    ok?: boolean;
    error?: string;
  }

  async function requireAdmin() {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { user: null as null, admin: false };
    const { data: me } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    return { user, admin: me?.role === "admin" };
  }

  export async function approveClaim(_prev: ApproveState, formData: FormData): Promise<ApproveState> {
    const { user, admin } = await requireAdmin();
    if (!user) return { error: "unauthorized" };
    if (!admin) return { error: "forbidden" };

    const claimId = String(formData.get("claimId") ?? "");
    if (!claimId) return { error: "bad-input" };

    const svc = createServiceRoleClient();

    // Read claim + tier (service client) for duration + email context.
    const { data: claim } = await svc
      .from("payment_claims")
      .select("id,user_id,tier_id,status")
      .eq("id", claimId)
      .maybeSingle();
    if (!claim) return { error: "not-found" };
    if (claim.status !== "pending") return { error: "not-pending" };

    const { data: tier } = await svc
      .from("tiers")
      .select("id,slug,title,scope_type,duration_days")
      .eq("id", claim.tier_id)
      .maybeSingle();
    if (!tier) return { error: "tier-missing" };

    // Generate the plaintext ONCE. Only its hash reaches the DB (master §9, D8).
    const plaintext = generateCode(); // e.g. 'CBD-7K3M-9PXQ'
    const codeHash = hashCode(normalizeCode(plaintext));

    const { data: result, error: rpcErr } = await svc.rpc("approve_claim", {
      p_claim_id: claimId,
      p_code_hash: codeHash,
      p_duration_days: tier.duration_days as number,
      p_reviewer: user.id,
    });
    if (rpcErr) {
      // Concurrency: another admin approved first → the FOR UPDATE + status guard raised this.
      if (rpcErr.message?.includes("not-pending")) return { error: "not-pending" };
      return { error: "approve-failed" };
    }
    const expiresIso = (result as { expires_at: string }).expires_at;

    // Email the plaintext code to the student — the ONLY place plaintext exists post-generation.
    const { data: prof } = await svc
      .from("profiles")
      .select("email,preferred_lang")
      .eq("user_id", claim.user_id)
      .maybeSingle();
    const lang = prof?.preferred_lang === "en" ? "en" : "tr";
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    const title = tier.title as { tr?: string; en?: string };
    const emailRes = prof?.email
      ? await sendClaimApproved(prof.email, lang, {
          code: plaintext,
          tierTitle: title?.[lang] || title?.en || (tier.slug as string),
          expiresIso,
          appUrl,
        })
      : { ok: false, error: "no-email" as const };

    revalidatePath("/admin/payments");
    revalidatePath(`/admin/payments/${claimId}`);

    // Return the code so the admin sees it ONCE (fallback if email failed). Not persisted anywhere.
    return {
      ok: true,
      code: plaintext,
      expiresIso,
      emailOk: emailRes.ok,
      emailError: emailRes.ok ? undefined : emailRes.error,
    };
  }

  export async function rejectClaim(_prev: RejectState, formData: FormData): Promise<RejectState> {
    const { user, admin } = await requireAdmin();
    if (!user) return { error: "unauthorized" };
    if (!admin) return { error: "forbidden" };

    const claimId = String(formData.get("claimId") ?? "");
    const note = String(formData.get("note") ?? "").trim();
    if (!claimId) return { error: "bad-input" };
    if (!note) return { error: "note-required" };

    const svc = createServiceRoleClient();
    const { data: result, error } = await svc.rpc("reject_claim", {
      p_claim_id: claimId,
      p_reviewer: user.id,
      p_note: note,
    });
    if (error) {
      if (error.message?.includes("not-pending")) return { error: "not-pending" };
      if (error.message?.includes("note-required")) return { error: "note-required" };
      return { error: "reject-failed" };
    }

    const { data: prof } = await svc
      .from("profiles")
      .select("email,preferred_lang")
      .eq("user_id", (result as { user_id: string }).user_id)
      .maybeSingle();
    const lang = prof?.preferred_lang === "en" ? "en" : "tr";
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    after(async () => {
      if (prof?.email) await sendClaimRejected(prof.email, lang, { reason: note, appUrl });
    });

    revalidatePath("/admin/payments");
    revalidatePath(`/admin/payments/${claimId}`);
    return { ok: true };
  }
  ```
- [ ] Create `cubad/app/admin/payments/[claimId]/page.tsx` (Server Component; signed-URL proof
  viewer — the path comes from the **claim row**, never from user input, master §9):
  ```tsx
  import Link from "next/link";
  import { notFound } from "next/navigation";
  import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
  import { ReviewPanel } from "./ReviewPanel";

  export default async function ClaimDetailPage({
    params,
  }: {
    params: Promise<{ claimId: string }>;
  }) {
    const { claimId } = await params;
    const supabase = await createClient(); // admin RLS

    const { data: claim } = await supabase
      .from("payment_claims")
      .select(
        "id,user_id,tier_id,amount,currency,method,payer_ref,proof_path,status,review_note,reviewed_at,created_at"
      )
      .eq("id", claimId)
      .maybeSingle();
    if (!claim) notFound();

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name,email,phone,country_code")
      .eq("user_id", claim.user_id)
      .maybeSingle();
    const { data: tier } = await supabase
      .from("tiers")
      .select("slug,title,scope_type,duration_days")
      .eq("id", claim.tier_id)
      .maybeSingle();

    // Signed URL (service role) from the server-written path. 10-minute TTL.
    let proofUrl: string | null = null;
    if (claim.proof_path) {
      const svc = createServiceRoleClient();
      const { data: signed } = await svc.storage
        .from("payment-proofs")
        .createSignedUrl(claim.proof_path as string, 600);
      proofUrl = signed?.signedUrl ?? null;
    }
    const isPdf = (claim.proof_path as string | null)?.toLowerCase().endsWith(".pdf") ?? false;
    const title = (tier?.title as { en?: string } | null)?.en ?? (tier?.slug as string) ?? "—";

    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <Link href="/admin/payments" className="text-sm text-deniz underline">
          ← Back to queue
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-ink">Claim review</h1>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <section className="rounded-xl border border-line bg-card p-4 text-sm">
            <h2 className="mb-2 font-semibold text-ink">Student</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-ink-faint">Name</dt>
              <dd>{profile?.full_name || "—"}</dd>
              <dt className="text-ink-faint">Email</dt>
              <dd className="font-mono">{profile?.email || "—"}</dd>
              <dt className="text-ink-faint">Phone</dt>
              <dd className="font-mono">{profile?.phone || "—"}</dd>
              <dt className="text-ink-faint">Country</dt>
              <dd>{profile?.country_code || "—"}</dd>
            </dl>
          </section>

          <section className="rounded-xl border border-line bg-card p-4 text-sm">
            <h2 className="mb-2 font-semibold text-ink">Payment</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-ink-faint">Tier</dt>
              <dd>
                {title} ({tier?.scope_type} · {tier?.duration_days}d)
              </dd>
              <dt className="text-ink-faint">Amount</dt>
              <dd className="font-mono">
                {claim.amount != null
                  ? `${(claim.amount as number).toLocaleString()} ${claim.currency ?? ""}`
                  : "—"}
              </dd>
              <dt className="text-ink-faint">Method</dt>
              <dd>{claim.method as string}</dd>
              <dt className="text-ink-faint">Payer ref</dt>
              <dd className="font-mono">{(claim.payer_ref as string) || "—"}</dd>
              <dt className="text-ink-faint">Status</dt>
              <dd>{claim.status as string}</dd>
            </dl>
          </section>
        </div>

        {/* proof viewer */}
        <section className="mt-4 rounded-xl border border-line bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold text-ink">Proof</h2>
          {!claim.proof_path ? (
            <p className="text-sm text-ink-faint">No proof uploaded.</p>
          ) : !proofUrl ? (
            <p className="text-sm text-clay">Could not sign the proof URL — reload to retry.</p>
          ) : isPdf ? (
            <a href={proofUrl} target="_blank" rel="noreferrer" className="text-deniz underline">
              Open proof (PDF) — link valid ~10 min
            </a>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={proofUrl}
              alt="payment proof"
              className="max-h-[600px] w-auto rounded-lg border border-line"
            />
          )}
        </section>

        {/* manual verification checklist — the human step the product owner demanded */}
        <section className="mt-4 rounded-xl border border-amber/30 bg-amber-soft p-4 text-sm text-ink">
          <h2 className="mb-2 font-semibold">Before you approve — verify manually</h2>
          <ul className="list-disc pl-5">
            <li>
              Open your bank / M-Pesa statement and find the transaction matching payer ref{" "}
              <span className="font-mono">{(claim.payer_ref as string) || "(none)"}</span>.
            </li>
            <li>
              Confirm the received amount equals{" "}
              <span className="font-mono">
                {claim.amount != null ? `${(claim.amount as number).toLocaleString()} ${claim.currency ?? ""}` : "the tier price"}
              </span>
              .
            </li>
            <li>Confirm the sender / timing is consistent with this student.</li>
            <li>Only then approve. Approving mints a code and activates access immediately.</li>
          </ul>
        </section>

        <ReviewPanel claimId={claim.id as string} status={claim.status as string} reviewNote={(claim.review_note as string) ?? ""} />
      </main>
    );
  }
  ```
- [ ] Create `cubad/app/admin/payments/[claimId]/ReviewPanel.tsx` (Client Component — Approve shows
  the code once; Reject requires a note):
  ```tsx
  "use client";

  import { useActionState } from "react";
  import {
    approveClaim,
    rejectClaim,
    type ApproveState,
    type RejectState,
  } from "../actions";

  export function ReviewPanel({
    claimId,
    status,
    reviewNote,
  }: {
    claimId: string;
    status: string;
    reviewNote: string;
  }) {
    const [appState, approveAction, approving] = useActionState<ApproveState, FormData>(
      approveClaim,
      {}
    );
    const [rejState, rejectAction, rejecting] = useActionState<RejectState, FormData>(
      rejectClaim,
      {}
    );

    if (status !== "pending" || appState.ok || rejState.ok) {
      return (
        <section className="mt-4 rounded-xl border border-line bg-card p-4 text-sm">
          {appState.ok ? (
            <div>
              <p className="font-semibold text-moss">Approved. Access is active.</p>
              <p className="mt-2 text-ink-faint">
                Access code (shown once — copy it if the email failed):
              </p>
              <p className="mt-1 rounded-lg bg-deniz-soft px-3 py-2 text-center font-mono text-xl font-bold tracking-widest text-deniz-deep">
                {appState.code}
              </p>
              <p className="mt-2 text-xs text-ink-faint">
                Email to student:{" "}
                {appState.emailOk ? "sent ✓" : `FAILED (${appState.emailError}) — copy the code above and send it manually`}
              </p>
            </div>
          ) : rejState.ok ? (
            <p className="font-semibold text-clay">Rejected. The student was emailed the reason.</p>
          ) : (
            <p className="text-ink-soft">
              This claim is <strong>{status}</strong>.{reviewNote ? ` Note: ${reviewNote}` : ""}
            </p>
          )}
        </section>
      );
    }

    return (
      <section className="mt-4 grid gap-4 md:grid-cols-2">
        {/* Approve */}
        <form action={approveAction} className="rounded-xl border border-moss/30 bg-moss-soft p-4">
          <input type="hidden" name="claimId" value={claimId} />
          <h3 className="mb-2 text-sm font-semibold text-moss">Approve</h3>
          <p className="mb-3 text-xs text-ink-soft">
            Mints a single-use code, activates access, emails the code as a receipt.
          </p>
          {appState.error && (
            <p className="mb-2 text-xs text-clay">
              {appState.error === "not-pending"
                ? "Already handled by another admin."
                : `Error: ${appState.error}`}
            </p>
          )}
          <button
            type="submit"
            disabled={approving}
            className="rounded-lg bg-moss px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {approving ? "Approving..." : "Approve & issue code"}
          </button>
        </form>

        {/* Reject */}
        <form action={rejectAction} className="rounded-xl border border-clay/30 bg-clay-soft p-4">
          <input type="hidden" name="claimId" value={claimId} />
          <h3 className="mb-2 text-sm font-semibold text-clay">Reject</h3>
          <label className="mb-2 block text-xs text-ink-soft">
            Reason (required — the student sees this)
            <textarea
              name="note"
              required
              rows={3}
              className="mt-1 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink"
              placeholder="e.g. No matching transaction found for this payer ref."
            />
          </label>
          {rejState.error && (
            <p className="mb-2 text-xs text-clay">
              {rejState.error === "note-required"
                ? "A reason is required."
                : rejState.error === "not-pending"
                ? "Already handled by another admin."
                : `Error: ${rejState.error}`}
            </p>
          )}
          <button
            type="submit"
            disabled={rejecting}
            className="rounded-lg bg-clay px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {rejecting ? "Rejecting..." : "Reject claim"}
          </button>
        </form>
      </section>
    );
  }
  ```
- [ ] Build check and commit:
  ```bash
  npm run lint && npm run build
  git add app/admin/payments && git commit -m "phase6: admin claim detail — signed-URL proof viewer, manual-verify checklist, approve (code once) + reject actions"
  ```

**Manual verification checklist:**
- [ ] Detail page shows student name/email/phone/country, tier, amount/currency, payer ref.
- [ ] An image proof renders inline; a PDF proof shows an "Open proof (PDF)" link that opens.
- [ ] The amber "verify manually" checklist is visible and quotes the payer ref + amount.
- [ ] Approving a pending claim: an `access_codes` row, a `code_redemptions` row, and an active
  `entitlements` row appear; the claim flips to `approved`; the code is shown once in the panel;
  the student receives the approval email (or the panel shows the email-failed fallback).
- [ ] Rejecting requires a note; the claim flips to `rejected` with `review_note`; the student is
  emailed the reason.

**Failure modes:**
- **Signed URL expired during review** — the URL is valid ~10 min; if the reviewer lingers, the
  image 403s. Fix: reload the page (a fresh URL is minted each render). Do not raise the TTL much —
  short-lived links are the point of a private bucket.
- **`<img>` lint** — the repo renders charts as bespoke SVG and has no `next/image` setup for
  arbitrary Supabase hosts; the inline `eslint-disable-next-line @next/next/no-img-element` keeps
  the build green. If Phase 3 configured `images.remotePatterns` for the Supabase host, switch to
  `next/image` instead.
- **Approve returns `not-pending`** — expected under a double-approve race; the panel says "Already
  handled by another admin." (See Task 6.17 for the two-session proof.)

---

## Task 6.15 — Admin settings: payment instructions editor

- [ ] Add the settings action to `cubad/app/admin/payments/actions.ts` (append to the existing
  file):
  ```ts
  export interface SettingsState {
    ok?: boolean;
    error?: string;
  }

  export async function updatePaymentInstructions(
    _prev: SettingsState,
    formData: FormData
  ): Promise<SettingsState> {
    const { user, admin } = await requireAdmin();
    if (!user) return { error: "unauthorized" };
    if (!admin) return { error: "forbidden" };

    const g = (k: string) => String(formData.get(k) ?? "");
    const value = {
      mpesa: { tr: g("mpesa_tr"), en: g("mpesa_en") },
      bank: { tr: g("bank_tr"), en: g("bank_en") },
      whatsapp: { tr: g("whatsapp_tr"), en: g("whatsapp_en") },
    };

    const svc = createServiceRoleClient();
    const { error } = await svc.rpc("set_app_setting", {
      p_key: "payment_instructions",
      p_value: value,
      p_actor: user.id,
    });
    if (error) return { error: "save-failed" };

    revalidatePath("/admin/payments/settings");
    return { ok: true };
  }
  ```
- [ ] Create `cubad/app/admin/payments/settings/page.tsx` (Server Component loads current values):
  ```tsx
  import { getPaymentInstructions } from "@/lib/payments/settings";
  import { SettingsForm } from "./SettingsForm";

  export default async function PaymentSettingsPage() {
    const instr = await getPaymentInstructions();
    return <SettingsForm initial={instr} />;
  }
  ```
- [ ] Create `cubad/app/admin/payments/settings/SettingsForm.tsx` (Client Component):
  ```tsx
  "use client";

  import Link from "next/link";
  import { useActionState } from "react";
  import type { PaymentInstructions } from "@/lib/payments/settings";
  import { updatePaymentInstructions, type SettingsState } from "../actions";

  function Field({
    name,
    label,
    value,
  }: {
    name: string;
    label: string;
    value: string;
  }) {
    return (
      <label className="grid gap-1 text-sm">
        <span className="text-ink-faint">{label}</span>
        <textarea
          name={name}
          defaultValue={value}
          rows={2}
          className="rounded-lg border border-line bg-card px-3 py-2 text-ink"
        />
      </label>
    );
  }

  export function SettingsForm({ initial }: { initial: PaymentInstructions }) {
    const [state, action, saving] = useActionState<SettingsState, FormData>(
      updatePaymentInstructions,
      {}
    );
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <Link href="/admin/payments" className="text-sm text-deniz underline">
          ← Back to payments
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-ink">Payment instructions</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Markdown supported. Shown to students on the pay page. TR + EN both required.
        </p>

        <form action={action} className="mt-6 grid gap-5">
          <fieldset className="grid gap-2">
            <legend className="text-sm font-semibold text-ink">M-Pesa</legend>
            <Field name="mpesa_tr" label="TR" value={initial.mpesa.tr} />
            <Field name="mpesa_en" label="EN" value={initial.mpesa.en} />
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-semibold text-ink">Bank</legend>
            <Field name="bank_tr" label="TR" value={initial.bank.tr} />
            <Field name="bank_en" label="EN" value={initial.bank.en} />
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-semibold text-ink">WhatsApp</legend>
            <Field name="whatsapp_tr" label="TR" value={initial.whatsapp.tr} />
            <Field name="whatsapp_en" label="EN" value={initial.whatsapp.en} />
          </fieldset>

          {state.error && <p className="text-sm text-clay">Error: {state.error}</p>}
          {state.ok && <p className="text-sm text-moss">Saved ✓</p>}

          <button
            type="submit"
            disabled={saving}
            className="justify-self-start rounded-lg bg-deniz px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save instructions"}
          </button>
        </form>
      </main>
    );
  }
  ```
- [ ] Build check and commit:
  ```bash
  npm run lint && npm run build
  git add app/admin/payments && git commit -m "phase6: admin payment-instructions editor (atomic audited set_app_setting)"
  ```

**Manual verification checklist:**
- [ ] Editing M-Pesa EN → Save → the pay page (`/upgrade/pay/term-all`) reflects the new text.
- [ ] An `admin_audit_log` row `settings.update` / `app_settings` / `payment_instructions` exists.

**Failure modes:** if Phase 5 already ships an `/admin/settings` hub, this page can be merged into
it later; it lives under `/admin/payments/settings` now to avoid colliding with Phase-5-owned files.

---

## Task 6.16 — Negative-path battery (RLS + storage probes)

These are the required adversarial checks (master §12.6). Run them against the dev/branch database.
The SQL probes use `set local role authenticated` + a forged `request.jwt.claims` to impersonate a
user inside a transaction — the standard Supabase RLS test technique. Substitute two real user
UUIDs (`:A` and `:B`) and a real pending claim id owned by A (`:CLAIM_A`).

- [ ] Create `cubad/supabase/tests/payments_negative.sql`:
  ```sql
  -- Run with: psql "$DB_URL" -f supabase/tests/payments_negative.sql
  -- (\set is a psql meta-command — this file MUST run through psql, not the SQL editor or MCP
  --  execute_sql; for those, inline the three UUIDs by hand first. Master §14.)
  -- Replace the UUIDs before running.
  \set A  '00000000-0000-0000-0000-00000000000a'
  \set B  '00000000-0000-0000-0000-00000000000b'
  \set CLAIM_A '00000000-0000-0000-0000-0000000000c1'

  -- 1) Student B cannot READ student A's claim.
  begin;
    set local role authenticated;
    set local request.jwt.claims = json_build_object('sub', :'B', 'role', 'authenticated')::text;
    select count(*) as should_be_zero
    from public.payment_claims where id = :'CLAIM_A';
  rollback;
  -- EXPECT: should_be_zero = 0 (RLS claims_select_own hides A's row from B).

  -- 2) Student cannot INSERT a claim with status='approved' (self-grant attempt).
  begin;
    set local role authenticated;
    set local request.jwt.claims = json_build_object('sub', :'B', 'role', 'authenticated')::text;
    -- This must FAIL the insert CHECK (claims_insert_own_pending requires status='pending').
    insert into public.payment_claims (user_id, tier_id, method, status)
    select :'B', id, 'mpesa', 'approved' from public.tiers limit 1;
  rollback;
  -- EXPECT: ERROR: new row violates row-level security policy for table "payment_claims".

  -- 3) Student cannot INSERT a claim for ANOTHER user (user_id spoof).
  begin;
    set local role authenticated;
    set local request.jwt.claims = json_build_object('sub', :'B', 'role', 'authenticated')::text;
    insert into public.payment_claims (user_id, tier_id, method, status)
    select :'A', id, 'mpesa', 'pending' from public.tiers limit 1;
  rollback;
  -- EXPECT: ERROR: violates row-level security (user_id != auth.uid()).

  -- 4) Student cannot UPDATE a claim's status (no owner UPDATE policy exists at all).
  begin;
    set local role authenticated;
    set local request.jwt.claims = json_build_object('sub', :'A', 'role', 'authenticated')::text;
    update public.payment_claims set status = 'approved' where id = :'CLAIM_A';
    -- Returns 0 rows updated (RLS filters the row out of the UPDATE) rather than granting access.
    select count(*) as rows_still_pending
    from public.payment_claims where id = :'CLAIM_A' and status = 'pending';
  rollback;
  -- EXPECT: rows_still_pending = 1 (status unchanged).

  -- 5) Student cannot DELETE a NON-pending claim (only pending is cancellable).
  --    Prep: assume :CLAIM_A is pending; approve it as service role first if you want to test this.
  --    With a pending claim, delete SUCCEEDS for the owner; for an approved one it deletes 0 rows.
  ```
- [ ] Run it and confirm each `EXPECT` (`DB_URL` = the project connection string, as in Task 6.1):
  ```bash
  psql "$DB_URL" -f supabase/tests/payments_negative.sql
  ```
- [ ] **Storage probe (student cannot read another student's proof object).** This hits the Storage
  REST API with user B's access token trying to sign/download an object under user A's folder.
  Obtain B's token from a signed-in session (`supabase.auth.getSession()` in the browser console,
  or the CLI). Then:
  ```bash
  # B tries to create a signed URL for A's proof object → expect 400/403, NOT a URL.
  curl -i -X POST \
    "$NEXT_PUBLIC_SUPABASE_URL/storage/v1/object/sign/payment-proofs/<A_uid>/<claimId>/receipt.jpg" \
    -H "Authorization: Bearer <B_ACCESS_TOKEN>" \
    -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
    -H "Content-Type: application/json" \
    -d '{"expiresIn":600}'
  # EXPECT: HTTP/1.1 400 (or 403) with {"statusCode":"...","error":"...","message":"..."} —
  #         B is denied because payment_proofs_select_own_or_admin requires foldername[1]=B.
  ```
- [ ] **Oversized / wrong-mime proof (server-side).** In the UI, attempt a 12 MB file and a `.gif`;
  both are rejected by the action before upload (Task 6.11). The bucket config is the second layer:
  a direct upload of a `.gif` via the API returns `mime type not allowed`.
- [ ] **4th open claim blocked.** As one user, create 3 pending claims, then attempt a 4th:
  ```sql
  -- as service role or through the UI; the 4th insert raises:
  -- ERROR: open-claim-limit  (from trg_enforce_open_claim_limit)
  ```
  In the UI the 4th attempt shows "You can have at most 3 pending claims."
- [ ] Record the observed results as comments at the bottom of `payments_negative.sql`, then commit:
  ```bash
  git add supabase/tests/payments_negative.sql && git commit -m "phase6: negative-path battery — RLS/storage/limit probes with expected outputs"
  ```

**Failure modes:**
- **`set local request.jwt.claims` ignored** — RLS helpers read `auth.uid()` which reads
  `request.jwt.claim.sub` / `request.jwt.claims`. Ensure `set local role authenticated` is set too;
  as the DB owner/service role, RLS is bypassed and every probe would wrongly "pass".
- **Storage probe returns 200** — means the select policy is wrong (check `foldername` indexing) —
  a real security bug; fix before proceeding.

---

## Task 6.17 — Concurrency probes for `approve_claim`

Prove the atomic guarantees with two psql sessions.

- [ ] Create `cubad/supabase/tests/payments_concurrency.md` documenting the exact two-session test
  (a markdown runbook, not executed by CI):
  ````markdown
  # approve_claim concurrency probes

  Setup: one pending claim `:CLAIM` owned by a user, tier with duration_days = 120.
  Open TWO psql sessions to the same database (service role).

  ## A. Double-approve race (two admins) — second must get 'not-pending'
  Session 1:
  ```sql
  begin;
  select public.approve_claim('CLAIM'::uuid, 'hash_aaa', 120, 'ADMIN1'::uuid);  -- holds FOR UPDATE lock
  -- do NOT commit yet
  ```
  Session 2 (blocks on the row lock):
  ```sql
  begin;
  select public.approve_claim('CLAIM'::uuid, 'hash_bbb', 120, 'ADMIN2'::uuid);
  -- stays blocked until session 1 commits...
  ```
  Session 1:
  ```sql
  commit;   -- releases the lock
  ```
  Session 2 now unblocks and MUST raise:
  ```
  ERROR:  not-pending
  ```
  because session 1 already flipped status to 'approved'. Result: exactly ONE code minted, ONE
  entitlement, ONE redemption. Verify:
  ```sql
  select count(*) from public.access_codes    where note = 'payment-claim:CLAIM';   -- 1
  select count(*) from public.code_redemptions where code_id in
    (select id from public.access_codes where note = 'payment-claim:CLAIM');          -- 1
  ```

  ## B. Approve-after-cancel — approving a deleted claim fails cleanly
  ```sql
  -- delete (cancel) the pending claim first, then:
  select public.approve_claim('CLAIM'::uuid, 'hash_ccc', 120, 'ADMIN1'::uuid);
  -- ERROR: claim-not-found
  ```

  ## C. Approve idempotency (retry after a client timeout does NOT double-grant)
  Because the status guard is checked under FOR UPDATE, a SECOND call for the same claim after a
  successful first call raises 'not-pending'. The server action maps this to error 'not-pending'
  and shows "Already handled" — no second code, no second entitlement. Verify counts stay at 1.
  ````
- [ ] Execute runbook section A manually with two `psql` sessions (or two SQL-editor tabs) and
  confirm the second call errors `not-pending` and the counts are exactly 1.
- [ ] Commit:
  ```bash
  git add supabase/tests/payments_concurrency.md && git commit -m "phase6: two-session concurrency runbook for approve_claim (race, cancel, idempotency)"
  ```

**Why this holds (for the executor's understanding):** `approve_claim` does
`select ... for update` on the claim row as its first step, so a second concurrent call cannot read
the row until the first transaction commits or rolls back. Once the first commits `status='approved'`,
the second re-reads the now-committed row, sees `<> 'pending'`, and raises. There is no window where
two codes could be minted for one claim — this is the D8/§10 "check-then-write races" rule enforced
in SQL, not JS.

---

## Task 6.18 — Email template snapshot tests + full E2E, then push

- [ ] Create `cubad/lib/email/templates.test.ts` (snapshot both languages; pure — no network):
  ```ts
  import { describe, it, expect } from "vitest";
  import {
    tmplAdminNewClaim,
    tmplClaimApproved,
    tmplClaimRejected,
    formatExpiry,
  } from "./templates";

  const EXPIRY = "2026-11-09T00:00:00.000Z";

  describe("email templates", () => {
    it("formats expiry in UTC, per language", () => {
      expect(formatExpiry(EXPIRY, "en")).toBe("9 November 2026 (UTC)");
      expect(formatExpiry(EXPIRY, "tr")).toBe("9 Kasım 2026 (UTC)");
    });

    it("admin new-claim (English) snapshot", () => {
      const c = tmplAdminNewClaim({
        studentName: "Amina H.",
        studentEmail: "amina@example.com",
        tierTitle: "Term — All access",
        amount: "15000",
        currency: "TZS",
        method: "mpesa",
        payerRef: "SFC8KL29XY",
        dashboardUrl: "https://cubad.vercel.app/admin/payments/abc",
      });
      expect(c.subject).toMatchSnapshot();
      expect(c.html).toMatchSnapshot();
      expect(c.text).toMatchSnapshot();
    });

    it("escapes HTML in student-controlled fields", () => {
      const c = tmplAdminNewClaim({
        studentName: "<script>x</script>",
        studentEmail: "a@b.c",
        tierTitle: "T",
        amount: "1",
        currency: "USD",
        method: "bank",
        payerRef: "<img>",
        dashboardUrl: "https://x/y",
      });
      expect(c.html).not.toContain("<script>");
      expect(c.html).toContain("&lt;script&gt;");
    });

    it("claim-approved snapshot (tr + en) contains the code and no-redeem note", () => {
      for (const lang of ["tr", "en"] as const) {
        const c = tmplClaimApproved(lang, {
          code: "CBD-7K3M-9PXQ",
          tierTitle: "Term — All access",
          expiresIso: EXPIRY,
          appUrl: "https://cubad.vercel.app",
        });
        expect(c.html).toContain("CBD-7K3M-9PXQ");
        expect(c.subject).toMatchSnapshot(`approved-subject-${lang}`);
        expect(c.html).toMatchSnapshot(`approved-html-${lang}`);
        expect(c.text).toMatchSnapshot(`approved-text-${lang}`);
      }
    });

    it("claim-rejected snapshot (tr + en) contains the reason", () => {
      for (const lang of ["tr", "en"] as const) {
        const c = tmplClaimRejected(lang, {
          reason: "No matching transaction.",
          appUrl: "https://cubad.vercel.app",
        });
        expect(c.text).toContain("No matching transaction.");
        expect(c.subject).toMatchSnapshot(`rejected-subject-${lang}`);
        expect(c.html).toMatchSnapshot(`rejected-html-${lang}`);
      }
    });
  });
  ```
- [ ] Run and write the snapshots:
  ```bash
  npx vitest run lib/email/templates.test.ts
  ```
  Expected: passes; a `__snapshots__/templates.test.ts.snap` file is created. Inspect it to confirm
  both languages look right, then re-run to confirm stability.
- [ ] Run the whole suite + lint + build one last time:
  ```bash
  npx vitest run && npm run lint && npm run build
  ```
  Expected: all green.
- [ ] **Full manual E2E (the happy path the product owner cares about):**
  - [ ] As a student, hit a paywalled unit → click upgrade → `/upgrade` → choose `term-all` →
    `/upgrade/pay/term-all` shows the seeded M-Pesa/bank/WhatsApp instructions and a prefilled
    amount.
  - [ ] Submit a real JPG proof → redirected to `/upgrade/claims` (pending).
  - [ ] Admin receives the "New payment claim" email; `/admin/payments` shows it on top with the
    nav badge incremented.
  - [ ] Open the claim, view the proof, read the verify checklist, click **Approve**.
  - [ ] The panel shows the code once; the student receives the approval email with the plaintext
    code, the "no need to redeem" note, and the expiry date rendered in their language.
  - [ ] The student now has access to the previously-paywalled unit; `/upgrade/claims` shows
    `approved`; the entitlement's `expires_at` matches the emailed date.
  - [ ] Reject flow: submit another claim, **Reject** with a note → student gets the rejection
    email and sees the note + Resubmit CTA in `/upgrade/claims`.
- [ ] Commit and open the PR (do NOT merge to `main` yourself unless the human says so — pushing to
  `main` auto-deploys production, master §8.7):
  ```bash
  git add -A && git commit -m "phase6: email template snapshots + full E2E verification"
  git push -u origin feat/phase-6-payments-v1
  gh pr create --base main --head feat/phase-6-payments-v1 \
    --title "Phase 6 — Manual payments v1 (claims, proofs, review, emails, code issuance)" \
    --body "Implements docs/plans/productization/06-payments-v1.md. Manual-verification payment claims, private proof bucket, Resend transactional email, atomic approve_claim, admin review queue."
  ```

**Failure modes:**
- **Snapshot churn** — `formatExpiry` uses `Intl` with a fixed UTC timezone, so snapshots are
  stable across machines. If a snapshot diff appears only in CI, the CI Node lacks the `tr-TR`
  ICU data — ensure full-ICU Node (Node 20+ ships full ICU by default).
- **E2E email 403** — see Task 6.7: with `onboarding@resend.dev` you can only deliver to the Resend
  account owner. Point both `ADMIN_NOTIFY_EMAIL` and the test student's email at that address for
  the E2E, or verify a domain.

---

## Phase acceptance checklist (runnable)

Run from `cubad/`. Everything must pass before the phase is "done" (master §8):

- [ ] `supabase db reset` applies all migrations cleanly on a fresh DB (§8.5).
- [ ] `npm run lint` — no errors.
- [ ] `npm run build` — succeeds (the authority over `tsc`; RSC boundary + `server-only` checked).
- [ ] `npx vitest run` — filename + email-template suites pass.
- [ ] `node scripts/validate-content.mjs` — still passes (untouched by this phase, but part of the
  standard gate).
- [ ] `supabase/tests/payments_negative.sql` — every `EXPECT` observed (probes 1–5).
- [ ] Storage probe: cross-user signed-URL request returns 400/403.
- [ ] Concurrency runbook section A: second `approve_claim` errors `not-pending`; exactly one code,
  one entitlement, one redemption.
- [ ] Full E2E happy path + reject path verified with real emails.
- [ ] Supabase security advisors show no new ERROR findings for `payment_claims`, `app_settings`,
  the bucket, or the new functions.
- [ ] Security invariants (§9) hold: service role only in server paths; every new table has RLS +
  policies; proof paths built server-side from `auth.uid()`; counts done in SQL; plaintext code
  never stored/logged; approve/reject audited in-transaction; the open-claim limit + redemption go
  through locked SQL functions.

---

## Rollback

This phase is additive (new tables/functions/policies/routes/env); nothing in Phases 1–5 is
modified except the one-line nav badge wiring in `app/admin/layout.tsx`.

**Fast rollback (feature off, keep data):**
1. Revert the branch merge / redeploy the previous commit — the `/upgrade` and `/admin/payments`
   routes disappear; existing data is untouched.
2. Remove the nav-badge lines from `app/admin/layout.tsx` if they were merged separately.

**Full rollback (drop the phase's DB objects) — write a NEW down-migration (never edit applied
ones, master §10). Order matters (dependencies):**
```sql
-- new migration created with: supabase migration new rollback_phase6  (master §14: never
-- hand-write sequence-numbered filenames)
drop trigger if exists trg_enforce_open_claim_limit on public.payment_claims;
drop function if exists public.enforce_open_claim_limit();
drop function if exists public.approve_claim(uuid, text, int, uuid);
drop function if exists public.reject_claim(uuid, uuid, text);
drop function if exists public.set_app_setting(text, jsonb, uuid);
-- grant_entitlement is Phase 4's function (master D8/§4) — this phase never defined it and this
-- rollback MUST NOT drop it (redeem_code depends on it).
drop policy if exists "claims_insert_own_pending"  on public.payment_claims;
drop policy if exists "claims_select_own"          on public.payment_claims;
drop policy if exists "claims_delete_own_pending"  on public.payment_claims;
drop policy if exists "claims_select_admin"        on public.payment_claims;
drop policy if exists "claims_update_admin"        on public.payment_claims;
drop policy if exists "app_settings_public_read" on public.app_settings;
drop policy if exists "app_settings_write_admin"         on public.app_settings;
drop table if exists public.app_settings;
drop policy if exists "payment_proofs_insert_own"           on storage.objects;
drop policy if exists "payment_proofs_select_own_or_admin"  on storage.objects;
drop policy if exists "payment_proofs_delete_admin"         on storage.objects;
-- Optionally empty + delete the bucket (irreversible for stored proofs):
-- delete from storage.objects where bucket_id = 'payment-proofs';
-- delete from storage.buckets where id = 'payment-proofs';
```
**Do NOT** `drop grant_entitlement` — it is Phase 4's function and `redeem_code` calls it; dropping
it would break code redemption. `payment_claims` itself is a Phase-1 table; leave it (only Phase-6
policies/trigger are dropped). Env vars can stay; they are inert without the code.

---

## Changelog / deviations

<!-- Executing agents: record here any deviation from this plan (with the exact error + the
     smallest compliant fix), per master §11. Start empty of EXECUTION deviations. -->

- **2026-07-16 (plan authoring, post-audit reconciliation — no execution yet):** doc updated to
  the revised master (tiers `scope_id` + `tiers_scope_target`, D8 insert-new-row stacking, new
  §14 contract registry): (1) `v_tier.scope_id` reads confirmed legitimate — note added at the
  `access_codes` insert; (2) `grant_entitlement` definition REMOVED from Task 6.5 — it is Phase
  4's function (canonical 7-arg signature, insert-new-row stacking; `redeem_code` routes through
  it as fact); `approve_claim` only calls it, and a `\df` prerequisite check was added;
  (3) nonexistent `supabase db execute` commands replaced with `psql "$DB_URL" -c/-f` (SQL
  editor / MCP `execute_sql` as alternatives; `\set` probes are psql-only) in Tasks 6.1, 6.5,
  6.6, 6.16; (4) `/login` → `/auth/sign-in` everywhere (no `/login` route exists — §14);
  (5) `createServiceClient` → `createServiceRoleClient` everywhere (§14 factory name);
  (6) `profiles.email` attribution corrected to Phase 5 (column + backfill + trigger update);
  (7) NEW Task 6.10b adds the paywall `upgradeHref` primary CTA (Phase 4-owned file, change
  lands in Phase 6 — closes the locked-student dead end to `/upgrade`); (8) `app_settings`
  SELECT policy renamed `app_settings_public_read` and made anon-readable (§14; Phase 7 banner
  reads it anonymously), plus a `has_function_privilege('service_role', …)` EXECUTE verification
  added in Task 6.5; rollback SQL comment aligned with §14 (no hand-numbered migration
  filenames) and its policy/function notes updated to match (2) and (8).

- **2026-07-19 (execution — encrypted Vercel environment verification):** an empty or unusable
  value produced by `vercel env pull` is not evidence that an encrypted variable is absent or
  invalid. Verify configured names and their target/branch scopes with `vercel env ls`, and verify
  the value itself only through deployed runtime behavior without printing it. Branch-scoped
  Preview variables apply only to the exact Git branch and do not carry to later feature branches.
  During Phase 6, `RESEND_API_KEY` was confirmed configured for Production and Development, while
  its Preview entry was scoped to `feat/phase-1-foundation` rather than
  `feat/phase-6-payments-v1`; this distinction must be preserved in future environment audits.
