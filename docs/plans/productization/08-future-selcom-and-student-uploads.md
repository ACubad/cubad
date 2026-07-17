# 08 — FUTURE: Selcom/M-Pesa Payment Automation & Student Self-Upload Pipeline

> **What this document is:** a **design document**, not an executable phase plan. It is the
> only doc in the productization suite (`01`–`08`) that does not carry `- [ ]` checkbox tasks.
> Its job is to be **decision-complete enough** that a future agent can turn either half of it
> into a real phase plan (`09-selcom-automation.md`, `10-student-uploads-8a.md`, …) using the
> same authoring rules as master §12 — without re-doing the research below. Read
> `00-MASTER-PLAN.md` FULLY before this document; every schema/decision here extends §3–§7 of
> that plan and must not contradict it. Both features described here are explicitly **out of
> scope for Phases 1–7** (see master §2 items 5/7 and the Phase map row for doc `08`).

**Owner of this file:** this document only. Docs `01`–`07` are written by other agents in
parallel; nothing here should assume they exist yet, but everything here assumes their
locked decisions (§3, §4 of the master plan) as ground truth.

---

## 0. Why two unrelated-looking features share one doc

Both are explicitly deferred in the master plan (§2.5, §2.7, phase-map row `08`) because both
need real-world groundwork (a payment aggregator contract; an AI-authoring quality bar) that
the core productization work doesn't block on. They share one doc because they share one
audience (a future planning agent) and one integration surface: **Part A plugs into the
entitlement model (D7) exactly like the manual claims flow (D9/Phase 6)**, and **Part B plugs
into the content model (D4) and the admin publish path (Phase 5) exactly like admin-authored
content**. Neither invents new primitives; both are new *front doors* onto machinery Phases
1–7 already built.

---

# PART A — Selcom / M-Pesa Payment Automation

## A.1 Goal

Today (Phase 6): student pays a human-verified channel (bank transfer, M-Pesa to a personal/
business number) → uploads a proof → admin manually checks a bank/wallet statement → approves
→ system mints and auto-redeems an access code → entitlement granted. This works but has
latency (minutes to days, whenever admin is online) and manual toil that scales badly.

**Future goal:** student picks a tier → in-app checkout → **USSD push** to their phone
(M-Pesa, TigoPesa, or AirtelMoney, all via one Selcom integration) → student enters their
mobile-money PIN on their own phone → Selcom's webhook confirms payment to our server →
entitlement is granted **automatically**, same shape of grant as the manual path, no human in
the loop. Latency: seconds, not days.

**What does NOT change:**
- The **manual claims flow (Phase 6) stays forever** as the fallback — for bank transfers,
  for disputed/failed automated payments, for any country/currency Selcom doesn't cover
  (everything except TZS/Tanzania — see A.10), and as a safety net if Selcom itself is down.
- The **entitlement model (D7)** is untouched. Automated payments create rows in
  `public.entitlements` exactly like manual claims do — `source = 'payment'` (already in the
  master's check constraint, master §4, `entitlements.source`), not a new source type.
- Access codes (D8) are NOT required for this path. The master's phrasing "access code becomes
  optional receipt" means: the entitlement is granted directly (no redemption step needed),
  but the design here optionally mints an already-redeemed code purely so support/admin
  tooling has one consistent "receipt reference" format across both payment paths. Treat code
  minting on this path as a nice-to-have, not a dependency — do not block automation on it.

## A.2 Research summary — what's confirmed vs. uncertain

All of the below was fetched **2026-07-12**. Selcom does not publish a single canonical PDF
spec; the picture below is assembled from their live developer portal (a single-page reference
site) plus community SDKs (which exist because the portal itself is thin). Where a claim could
not be verified from a primary Selcom source, it is flagged **[UNVERIFIED]** — a future
executing agent MUST confirm these directly with Selcom (`info@selcom.net`, or their sandbox
once access is granted) before writing production code.

**Sources reached (fetched content, not just search snippets):**
- `https://developers.selcommobile.com/` — Selcom's own API reference portal. Reached
  directly; this is the strongest primary source we have. It described:
  - Auth headers on every request: `Authorization: SELCOM <Base64(API_KEY)>`,
    `Timestamp` (ISO-8601, e.g. `2019-02-26T09:30:46+03:00`), `Digest-Method` (`HS256` or
    `RS256`), `Digest` (Base64 signature), `Signed-Fields` (comma-separated field-name list).
  - Digest construction (HS256): build a signing string
    `"timestamp=<ts>&field1=value1&field2=value2..."` with fields ordered as listed in
    `Signed-Fields`, then `Base64(HMAC_SHA256(signing_string, API_SECRET))`.
    **[UNVERIFIED — exact string-join details]**: the fetch tool paraphrased this rather than
    quoting the literal doc HTML; the precise delimiter/escaping rules (is `timestamp=` really
    unkeyed at the front? are values URL-encoded?) must be confirmed against the live portal
    or a working SDK before coding the digest function.
  - `POST /v1/checkout/create-order` — full order creation. Fields seen: `vendor` (float/
    settlement account identifier), `order_id` (our unique id), `amount`, `currency` (ISO,
    e.g. `TZS`), `buyer_phone`, `webhook_url`.
  - A **"minimal" order-creation variant** is referenced (`create-order — Minimal`) for
    streamlined USSD-push-only integrations (no card/redirect fields needed).
  - `GET /v1/checkout/order-status` — query by `order_id` (mandatory) and/or `transid`.
  - Result codes: `resultcode: "000"` + `result: "SUCCESS"` = paid. `resultcode: "999"` =
    ambiguous/pending — the docs' own guidance is to re-query after ~3 minutes rather than
    treat it as failure.
- `https://selcom-developers.github.io/node-selcom/webhook-callback` — reached directly.
  Confirms the **webhook uses the identical header scheme** as outbound requests
  (`Authorization`, `Digest-Method`, `Digest`, `Timestamp` — but note the timestamp format
  shown here is `yyyy-dd-mm H:i:s`, NOT the ISO-8601 form shown on the main portal —
  **[UNVERIFIED] format inconsistency between the two pages, confirm empirically**), and
  `Signed-Fields: transid,order_id,reference,result,resultcode,payment_status`. Example
  payload body:
  ```json
  { "transid": "T123442", "reference": "028912121", "order_id": "123",
    "result": "SUCCESS", "resulcode": "000", "payment_status": "COMPLETED" }
  ```
  (Note: `resulcode` — missing a `t` — appears to be a genuine typo in Selcom's own field name
  in this example; **[UNVERIFIED]**, code defensively for both `resultcode` and `resulcode`
  until confirmed against a live webhook payload.) The page does not state what HTTP status
  the merchant must return to acknowledge — **[UNVERIFIED]**, assume `200 OK` with an empty
  or `{"result":"SUCCESS"}` body is safe (this is the universal webhook-ack convention and
  matches what community SDKs imply), confirm during sandbox testing.
- `https://www.bryceandy.com/posts/how-to-integrate-mobile-money-and-card-payments-in-laravel-using-selcom-tanzania`
  and `https://github.com/bryceandy/laravel-selcom` — a third-party Laravel package's docs,
  reached directly. Useful because it shows a *working* integration's field names in
  practice: `name`, `email`, `phone` (MSISDN like `255756334000`), `amount`, `transaction_id`,
  `no_redirection: true` (the flag that "automatically pulls your user's USSD payment menu"
  for AirtelMoney/TigoPesa), `currency` (default `TZS`), `items`. Confirms three env-style
  credentials are the whole trust anchor: `SELCOM_VENDOR_ID`, `SELCOM_API_KEY`,
  `SELCOM_API_SECRET`. Order status is a single call: `orderStatus($orderId)` returning
  `payment_status`, `transid`, `channel`, `reference`, `msisdn`.
- `https://selcom-developers.github.io/node-selcom/checkout-api.html` and
  `https://github.com/selcom-developers/node-selcom` — reached, but both pages render mostly
  as thin shells (README/body not present in the fetched HTML); confirmed only that the
  Checkout API "supports Masterpass, Debit/Credit cards … Mobile Money pull payments and
  others" and that a Node SDK exists. **Designed blind beyond that** — do not rely on this
  source for field-level detail.
- `https://www.selcom.net/business` and `https://www.selcom.net/agent` — reached. Selcom's
  own marketing pages give almost no onboarding specifics (contact `info@selcom.net`,
  `0800 714 888`, WhatsApp `0699 077 988`; mentions a "Developer Academy" coming soon). The
  **Agent** (not Merchant/API) onboarding page listed KYC docs (valid business license, TIN
  certificate, NIDA ID copy, business address, 2 passport photos) — this is a **proxy, not a
  confirmed merchant/API checklist** — flagged in A.10.
- General web search (not a single page fetch) surfaced: **no sandbox is publicly advertised
  for Selcom** — **[UNVERIFIED but treat as likely and important]**; if true, integration
  testing requires either requesting test credentials directly from Selcom support or testing
  with small real-money transactions. This materially affects the effort estimate (A.11) and
  the go-live checklist (A.10).
- Fee percentages: **not found** on any public page. Only marketing language ("up to 60%
  cheaper than other providers" on Selcom Pesa's P2P product, which is a different product
  from merchant Checkout fees). **[UNVERIFIED]** — get exact merchant fee schedule directly
  from Selcom during onboarding; do not guess a number into a phase plan.

**Alternative payment rails surveyed (per task, one short paragraph each):**

- **Vodacom M-Pesa Tanzania Open API (direct, no aggregator)** —
  `https://business.m-pesa.com/vodacom-tanzania/business-onboarding-tanzania/` (reached
  2026-07-12). Vodacom offers a **direct** integration path: register as an "M-Pesa
  organisation" (KYC, signed M-Pesa Services Agreement, get a 6–7 digit shortcode + linked
  bank account), then self-register on their Open API portal, build against a sandbox
  ("payments, refunds, account reconciliation, clearing, transaction inquiries" are all
  testable pre-launch — a real sandbox, unlike what we could confirm for Selcom), then flip to
  Go-Live. **Pros:** only covers M-Pesa (no TigoPesa/AirtelMoney), removes the aggregator's
  cut, has a genuine sandbox. **Cons:** you'd need a SEPARATE direct integration per operator
  to match Selcom's one-integration-covers-three-operators convenience (TigoPesa and
  AirtelMoney would need their own direct deals) — for a small product, doing three bilateral
  integrations instead of one aggregator is almost certainly worse effort-for-coverage than
  Selcom, so this is **not recommended as the primary path**, but is worth keeping in mind if
  Selcom's fees or reliability disappoint later and M-Pesa alone dominates the user base.
- **ClickPesa** — `https://docs.clickpesa.com/payment-api/payment-api-overview` (reached
  2026-07-12, thin content). A Tanzania-licensed gateway explicitly positioned as a modern
  alternative: "Payment API" supports USSD-PUSH collection across M-Pesa, TigoPesa (branded
  "Mixx by Yas"), AirtelMoney, and HaloPesa, with real-time webhooks and an API Explorer.
  **Pros:** appears to have better/newer developer tooling than Selcom based on how the docs
  are structured (has a real docs site under `docs.clickpesa.com`, not just a marketing page);
  covers HaloPesa too (a operator Selcom's public docs didn't mention). **Cons:** smaller/
  newer company, less community tooling (no equivalent to the `laravel-selcom` package found
  for Selcom), so first-hand integration reports are scarcer; would need its own from-scratch
  research pass before being trusted for money-handling code. Worth a bake-off if Selcom
  onboarding stalls.
- **DPO Group / Flutterwave** — `https://developer.flutterwave.com/v3.0/docs/tanzania`
  (reached 2026-07-12) for Flutterwave: a single documented call,
  `POST /v3/charges?type=mobile_money_tanzania` with `amount`, `currency`, `email`, `tx_ref`;
  customer authorizes via a push from their own mobile money app; test mode auto-completes.
  DPO Group is present in Tanzania but is positioned mainly for travel/hospitality/card
  payments, not mobile-money-first collection. **Pros (Flutterwave):** pan-African reach (30+
  countries) is attractive if cubad ever sells outside TZ/TR with local rails, clean documented
  REST call, real test mode. **Cons:** mobile-money-in-Tanzania is a secondary feature of a
  broad pan-African platform rather than its specialty (unlike Selcom/ClickPesa, which are
  Tanzania-native); DPO specifically skews away from mobile-money-first flows entirely. Both
  are reasonable **fallback aggregators** to keep on a shortlist, not primary recommendations.

**Recommendation stands: Selcom is the primary integration target** — it is the
Tanzania-native aggregator with the most third-party integration evidence (two independent
community SDKs found, one with a real production blog write-up), covers all three relevant
operators (M-Pesa, TigoPesa, AirtelMoney) through one integration, and is the rail the master
plan's canonical example (`payer_ref`, `method in ('mpesa','tigopesa','airtelmoney',...)`) is
already shaped around from Phase 6.

## A.3 Data model — `payment_orders`

New table, additive only — no changes to any Phase 1–7 table. Follows the master §4 style
exactly (column names below are what a phase-plan migration should use verbatim).

```sql
create table public.payment_orders (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  tier_id           uuid not null references public.tiers(id),
  amount            numeric not null,
  currency          text not null,                     -- 'TZS' only in v1 (see A.10)
  provider          text not null default 'selcom' check (provider in ('selcom')),
  provider_order_id text not null,                      -- OUR order_id, sent to Selcom
  provider_transid  text,                                -- Selcom's transid, filled by webhook
  buyer_phone       text not null,                      -- MSISDN used for the USSD push
  status            text not null default 'pending'
                      check (status in ('pending','paid','failed','expired','cancelled')),
  raw_webhook       jsonb,                                -- last webhook payload, verbatim, for audit/debug
  entitlement_id    uuid references public.entitlements(id), -- set once granted
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (provider, provider_order_id)
);
create index payment_orders_status_created on public.payment_orders (status, created_at);
create index payment_orders_user on public.payment_orders (user_id);
alter table public.payment_orders enable row level security;
```

**RLS:** owner **select only** (a student can see their own order's status to drive the
checkout UI's polling). **No client insert/update/delete at all** — every write to this table
happens server-side: the checkout server action inserts the `pending` row (using the
server-side Supabase client / service role, mirroring how `lib/supabase/server.ts` is used
elsewhere per D15), and the webhook route + reconciliation cron are the only writers of
`status`/`raw_webhook`/`entitlement_id`. This is stricter than `payment_claims` (D9, which
allows owner insert) precisely because a payment order's `amount`/`currency` must always come
from a server-side tier lookup, never a client-supplied value — a user must never be able to
insert their own "pending, amount: 1" row.

**New SECURITY DEFINER function** (mirrors `redeem_code`/`approve_claim` from master §4):

```sql
create or replace function public.grant_entitlement_from_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public   -- required on every definer fn (see Phase 7 advisor probe)
as $$
declare
  v_order  public.payment_orders%rowtype;
  v_tier   public.tiers%rowtype;
  v_ent_id uuid;
begin
  select * into v_order from public.payment_orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'order-not-found');
  end if;
  if v_order.status = 'paid' then
    -- idempotent: webhook retried or reconciliation cron raced the webhook. No-op, same success shape.
    return jsonb_build_object('ok', true, 'entitlement_id', v_order.entitlement_id, 'already', true);
  end if;
  if v_order.status not in ('pending') then
    return jsonb_build_object('ok', false, 'error', 'bad-status', 'status', v_order.status);
  end if;

  select * into v_tier from public.tiers where id = v_order.tier_id;

  -- Grant via the SHARED grant path (Phase 4's public.grant_entitlement — the ONLY
  -- implementation of the D8 stacking rule). NEVER inline an entitlements insert here:
  -- duplicating the stacking arithmetic is how the two payment paths silently diverge.
  v_ent_id := public.grant_entitlement(
    v_order.user_id,
    v_tier.scope_type,
    v_tier.scope_id,        -- null iff scope_type='all' (tiers_scope_target constraint, master §4)
    v_tier.id,
    v_tier.duration_days,
    'payment',
    v_order.id
  );

  update public.payment_orders
    set status = 'paid', entitlement_id = v_ent_id, updated_at = now()
    where id = p_order_id;

  return jsonb_build_object('ok', true, 'entitlement_id', v_ent_id);
end;
$$;
```

> **Note for the executing agent:** no tier→scope resolution logic is needed here —
> `tiers.scope_id uuid` EXISTS as a column per master §4 (null iff `scope_type = 'all'`,
> enforced by the `tiers_scope_target` check constraint; Phase 5's tier CRUD is what sets
> it). Pass `v_tier.scope_id` through to `grant_entitlement` verbatim, exactly as
> `approve_claim` (Phase 6) does — do not re-derive or special-case it, to avoid the two
> grant paths silently diverging.

This function is intentionally almost a twin of Phase 6's `approve_claim` — same row-lock,
same idempotent-status-guard pattern (master §9: "check-then-write races... row locks"), same
`entitlements` insert shape. **Stacking rule (D8) applies identically**: if the user already
holds an active same-scope entitlement, this should extend it rather than create a second
overlapping row — copy whatever stacking helper Phase 6/4 already wrote for `redeem_code`
rather than re-implementing it a third time.

**Access-code-as-receipt (optional, per A.1):** if a future agent wants the "receipt" framing
literally (a `CBD-XXXX-XXXX` code shown in the email even though access is already granted),
extend the function to also insert a single-redemption `access_codes` row with
`max_redemptions = 1`, immediately insert a matching `code_redemptions` row pointing at the
same `v_ent_id`, and put the plaintext in the receipt email only (never re-derivable after).
This is pure sugar — **do not block shipping automation on it**.

## A.4 Checkout flow — server action design

```
createSelcomCheckout(tierId: string, buyerPhone: string): Promise<{ orderId: string } | { error: string }>
```

1. Require an authenticated session (same middleware/session pattern as every other
   authenticated server action from Phase 2).
2. Load the tier (`tiers` table); find the price row where `country === profile.country_code`
   (or the student's selected country at checkout time). **Reject if the matched price's
   `currency !== 'TZS'`** — this action ONLY exists for the Selcom/TZS path; every other
   country renders the manual-claim CTA instead (see A.10, this is the single most important
   business-logic gate in this whole feature).
3. Validate `buyerPhone` looks like a Tanzanian MSISDN (`2557XXXXXXXX` / `2556XXXXXXXX` /
   `2557...` — Selcom examples use `255756334000`; a phase plan should pull the actual
   operator-prefix table from Selcom's docs or a validation library rather than hand-rolling
   regex from memory).
4. Generate `provider_order_id` — a short unique string, e.g. `cbd_${crypto.randomUUID().replace(/-/g,'').slice(0,20)}`.
   **[UNVERIFIED]** Selcom's max length/charset for `order_id` was not confirmed from the
   research above — confirm before finalizing the generator (community examples used short
   numeric-ish ids like `"123"`, suggesting a conservative ASCII-alnum, ≤32-char id is safe).
5. Insert a `payment_orders` row, `status='pending'`.
6. Call Selcom `POST /v1/checkout/create-order` (minimal variant) with:
   `vendor` (our `SELCOM_VENDOR_ID`), `order_id` (from step 4), `buyer_phone`, `amount`
   (tier's TZS price), `currency: 'TZS'`, `webhook_url: \`${NEXT_PUBLIC_APP_URL}/api/webhooks/selcom\``,
   `no_redirection: true` (per A.2's community-SDK evidence — this is the flag that triggers
   the USSD push instead of a hosted redirect page).
7. Build the Selcom auth headers per A.5.
8. On a 2xx response, return `{ orderId: provider_order_id }` to the client so it can start
   polling `GET /api/payment-orders/:id/status` (a thin read-only route backed by the RLS
   owner-select policy — or simply a server action re-selecting the row) every ~3s for up to
   ~90s, showing "Check your phone — enter your PIN to confirm" the whole time.
9. On a non-2xx response (Selcom rejects the order outright — bad vendor id, malformed
   phone, etc.), mark the row `status='failed'` and surface a friendly error + the manual
   claim CTA as a fallback.

## A.5 Digest signing — pseudocode (request + webhook verification)

```ts
// lib/selcom/digest.ts — PURE function, Vitest-testable without any network/DB (D14).
function buildDigest(
  fields: Record<string, string>,   // e.g. { vendor, order_id, buyer_phone, amount, currency }
  signedFieldOrder: string[],       // the exact field names/order Selcom expects in Signed-Fields
  apiSecret: string,
  timestamp: string,                // caller supplies so tests are deterministic
): { digest: string; signedFields: string } {
  const parts = [`timestamp=${timestamp}`, ...signedFieldOrder.map(f => `${f}=${fields[f]}`)];
  const signingString = parts.join("&");
  const digest = base64(hmacSha256(signingString, apiSecret)); // Node: crypto.createHmac('sha256', apiSecret)
  return { digest, signedFields: signedFieldOrder.join(",") };
}
```

Outbound request headers:
```
Authorization: SELCOM <base64(SELCOM_API_KEY)>
Digest-Method: HS256
Digest: <digest from buildDigest(...)>
Timestamp: <same timestamp used above, ISO-8601>
Signed-Fields: <signedFields>
```

**Webhook verification** (in the route handler, A.6) mirrors this exactly in reverse: read
`Signed-Fields` from the incoming request header, pull those field values out of the JSON
body, read `Timestamp` from the header, recompute `buildDigest(...)` with the SAME
`SELCOM_API_SECRET`, and compare to the incoming `Digest` header using a constant-time
comparison (`crypto.timingSafeEqual`, never `===`, to avoid a timing side-channel — this is
the same class of rule as D8's code-hash comparisons). **Mismatch → reject with 401 before
touching the database.** This is the entire trust boundary for "did Selcom really send this
webhook" — treat it with the same seriousness as `redeem_code`'s rate limiting (master §9).

> Flag again: the exact signing-string format (§A.2's **[UNVERIFIED — exact string-join
> details]**) MUST be confirmed against Selcom's live behavior (or a working SDK's source,
> e.g. actually reading `node-selcom`'s compiled/published package rather than its doc site)
> before this ships. Getting this subtly wrong means EVERY webhook silently fails
> verification — a phase plan must include a step where a real test payment is round-tripped
> end-to-end before calling this task done.

## A.6 Webhook route — `/api/webhooks/selcom`

```
POST /api/webhooks/selcom
```

1. Read raw body (needed for exact-bytes digest reconstruction — do NOT let a JSON body
   parser reformat/reorder the body before you've captured the raw bytes, a classic
   webhook-signature bug).
2. Verify the Selcom `Digest` per A.5. Reject (401) on failure. Log rejected attempts (they're
   either a config bug on our side or an actual forgery attempt — either way, worth an
   `admin_audit_log` entry with `action: 'webhook.selcom.rejected'`).
3. Parse `order_id`, `transid`, `result`, `resultcode` (defensively also check `resulcode`,
   see A.2), `payment_status`.
4. Look up `payment_orders` by `(provider='selcom', provider_order_id=order_id)`. If not
   found: 200 OK anyway (ack so Selcom stops retrying) but log an anomaly — a webhook for an
   order we never created is either a stale/duplicate delivery from a previous deploy or
   something worth investigating, never a reason to 500/retry-loop.
5. **Idempotency / replay-safety** (the whole design hinges on this row already being locked
   by `grant_entitlement_from_order`'s `for update`, so multiple concurrent callers — a
   real webhook racing a reconciliation-cron poll racing a retried webhook — cannot double
   grant):
   - If `resultcode == '000'` (or `result == 'SUCCESS'`): verify `amount`/`currency` on the
     row match what we expect (defense against a tampered/mismatched webhook even after
     signature verification passes, e.g. a bug on Selcom's side sending the wrong order's
     amount) — if mismatch, do NOT grant; mark `admin_audit_log` anomaly, leave `status`
     unchanged, return 200 (ack receipt, but do not act on it) so a human can look at it.
   - Else call `select public.grant_entitlement_from_order(p_order_id)`.
   - Always store the raw payload into `raw_webhook` (append-or-replace with the latest,
     whichever the phase plan prefers — latest-wins is simplest and sufficient for audit).
   - On success, AFTER the transaction commits (D10's rule: email never blocks/rolls back a
     grant), send the Resend receipt email.
   - If `resultcode == '999'` or `result == 'PENDING'`: leave `status='pending'`, do nothing
     else — the reconciliation cron (A.8) will catch it.
   - Else (an explicit failure code): `update payment_orders set status='failed', raw_webhook=... where id=...`.
6. Return `200 OK` (or whatever the confirmed ack contract turns out to be —
   **[UNVERIFIED]**, see A.2) regardless of the above outcome, UNLESS signature verification
   failed (that's the one case that should be a real 401, since acking a forged request is
   its own bug).

## A.7 Sequence diagram

```
 Student            Next.js server           Selcom               Mobile-money operator
   |                     |                      |                        |
   |--pick tier, phone-->|                      |                        |
   |                     |--insert payment_orders(pending)-->[DB]        |
   |                     |--POST /v1/checkout/create-order-->|           |
   |                     |     (Digest-signed, no_redirection=true)      |
   |                     |<--{order_id, ...}------------------|          |
   |<--"check your phone"|                      |--push USSD prompt---->|
   |                     |                      |                        |
   | (polls status every |                      |                        |--student enters PIN
   |  ~3s up to ~90s)    |                      |                        |
   |--GET /api/payment-orders/:id/status------->|                        |
   |                     |                      |<--debit confirmed------|
   |                     |<===== POST /api/webhooks/selcom (Digest header, order_id, transid,
   |                     |                        result=SUCCESS, resultcode=000) ============|
   |                     |--verify digest------>|                        |
   |                     |--lock payment_orders row FOR UPDATE           |
   |                     |--grant_entitlement_from_order() [one tx]      |
   |                     |--send Resend receipt email (after commit)     |
   |--poll returns "paid"|                      |                        |
   |--redirected to /account, entitlement active|                        |
```

If the webhook never arrives (see A.9), the reconciliation cron (A.8) plays the same "verify
→ grant" role by actively calling `GET /v1/checkout/order-status` instead of waiting to be
called.

## A.8 Reconciliation — order-status poll (cron)

Webhooks can be lost (network blip on Selcom's side, our endpoint briefly down during a
deploy, etc.) — never trust a webhook-only design for money. Add a scheduled job:

```
GET /api/cron/reconcile-selcom-orders     (Vercel Cron, e.g. every 5 minutes)
Header: Authorization: Bearer <CRON_SECRET>   (never publicly callable)
```

Logic:
```
select * from payment_orders
where status = 'pending'
  and created_at < now() - interval '5 minutes'   -- give the USSD prompt+webhook time to land normally
  and created_at > now() - interval '24 hours'     -- don't poll ancient rows forever
order by created_at asc
limit 100;                                          -- batch size guard

for each order:
  call GET /v1/checkout/order-status?order_id=<provider_order_id>   (Digest-signed GET)
  if resultcode == '000': call grant_entitlement_from_order(order.id)   -- same idempotent path as the webhook
  if resultcode indicates a hard failure: mark status='failed'
  else: leave pending, try again next run

-- separately, a cheap sweep:
update payment_orders set status = 'expired'
where status = 'pending' and created_at < now() - interval '24 hours';
```

This job is what makes "webhook never arrives" a non-issue in practice — the student's
experience (client-side polling of OUR `payment_orders.status`, not Selcom's) is identical
whether the row got updated by the webhook route or by this cron a few minutes later.

## A.9 Failure modes

| Failure mode | Detection | Handling |
|---|---|---|
| Webhook never arrives | Order stuck `pending` past ~5 min | Reconciliation cron (A.8) polls order-status and grants |
| Duplicate webhook (Selcom retries) | Row already `status='paid'` when webhook lands | `grant_entitlement_from_order` is idempotent — returns `{ok:true, already:true}`, no second entitlement created |
| Webhook + cron race (both fire near-simultaneously) | Two callers hit the same order id | `select … for update` row lock in the grant function serializes them; second caller sees `status='paid'` already and no-ops |
| Amount/currency mismatch in webhook vs. our row | Compare before granting | Do NOT grant; log `admin_audit_log` anomaly; leave `pending`; surface in admin dashboard for manual look (falls back to the human-in-the-loop safety net) |
| Invalid/forged webhook signature | Digest recompute mismatch | 401, log, never touch DB |
| Student cancels the USSD prompt / lets it time out | Selcom eventually reports a failure result, or nothing at all within the operator's own prompt timeout (typically ~60–120s, operator-controlled, not ours) | Client polling UI shows a "didn't get a response — try again or use manual payment" state after ~90s local timeout; order eventually reconciles to `failed`/`expired` server-side |
| Selcom order-creation call itself fails (4xx/5xx) | Non-2xx from `create-order` | Mark `payment_orders.status='failed'` immediately, surface the manual-claim CTA — never leave the student stuck on a spinner |
| User is on a currency/country Selcom doesn't cover | Checkout server action's price-row check (A.4 step 2) | Selcom button never renders; manual claim flow is the only option shown |
| Selcom API outage | Timeouts/5xx on all calls | Circuit-break to the manual-claim CTA after N consecutive failures; alert admin (reuse whatever monitoring Phase 7 sets up) |
| Vendor/settlement account misconfigured or suspended | Selcom rejects orders with an auth/account error | Same as API outage — degrade to manual path, alert admin immediately (this is a business-critical alert, not just a log line) |
| No sandbox to test against **[UNVERIFIED, see A.2]** | N/A — a process risk, not a runtime one | Plan testing as either (a) small real-money transactions against production credentials in a controlled window, or (b) request test credentials directly from Selcom support before writing the phase plan's test steps |

## A.10 Ops & compliance notes

**Onboarding (get these BEFORE writing the executable phase plan for this feature):**
- Business registration certificate / Certificate of Incorporation.
- TIN (Tax Identification Number) certificate.
- VAT Certificate of Registration (optional, per general Tanzania PSP requirements found in
  research — confirm if Selcom specifically requires it).
- A director's NIDA (national ID) or driving license.
- A settlement bank account in Tanzania (where Selcom pays out collected funds after their
  cut) — Selcom's own agent-onboarding page and general Tanzania PSP guidance both confirm a
  local settlement account is required; this is very likely required for merchant/API
  accounts too but **[UNVERIFIED]** at the exact document-checklist level for the *Checkout
  API* product specifically (the checklist above is assembled from Selcom's Agent program +
  general Tanzania PSP requirements as a reasonable proxy, not a confirmed merchant/API
  requirements page).
- A signed merchant/API agreement with Selcom (standard for any PSP; exact terms
  **[UNVERIFIED]** — get from Selcom directly).
- Practical next step for the actual site owner: email `info@selcom.net` (or call
  `0800 714 888` / WhatsApp `0699 077 988`) asking specifically for the **Checkout API /
  Selcom Pay merchant** requirements (not the Agent/Huduma program, which is a different,
  cash-in/cash-out-agent product) and sandbox/test credentials.

**Sandbox:** research turned up an explicit claim that **no public sandbox exists** for
Selcom's Checkout API [UNVERIFIED but treat as the working assumption]. If confirmed true,
this changes the shape of the testing task in any future phase plan — it can't be "run the
integration tests against sandbox," it has to be "request test credentials from Selcom
directly" or "test with a small real transaction using the owner's own phone in production."
Flag this prominently in whatever phase plan gets written; it is the single biggest
uncertainty blocking a clean "write tests first" flow for this feature (contrast with M-Pesa's
direct Open API, A.2, which DOES document a real sandbox).

**Go-live checklist (draft, to be refined once onboarding info above is confirmed):**
1. Signed merchant agreement + settlement account active.
2. `SELCOM_VENDOR_ID` / `SELCOM_API_KEY` / `SELCOM_API_SECRET` obtained, stored as
   Vercel env vars (server-only, never `NEXT_PUBLIC_*` — same rule as `SUPABASE_SERVICE_ROLE_KEY`
   in master §9).
3. Webhook URL (`${NEXT_PUBLIC_APP_URL}/api/webhooks/selcom`) registered with Selcom (however
   their portal/support requires — confirm the mechanism, likely either a dashboard field or
   told to support).
4. At least one real end-to-end payment completed successfully in whatever the least-risky
   test mode turns out to be (A.9's "no sandbox" row).
5. Reconciliation cron (A.8) verified to actually run on the deployed schedule (Vercel Cron
   dashboard shows recent successful invocations).
6. Manual-claims fallback (Phase 6) verified still fully functional and clearly presented as
   an alternative on the checkout screen (never remove it).
7. Admin dashboard surfaces `payment_orders` (at minimum: list + status + a manual "re-check
   with Selcom" button that just calls the same order-status endpoint on demand) — this
   reuses Phase 5's admin-dashboard shell.

**Fees:** no public percentage found (A.2). Treat as unknown until Selcom provides a fee
schedule during onboarding; do not hardcode an assumed margin into tier pricing until then.

**TZS-only caveat — how `tiers.prices` interacts:** Selcom's rails (M-Pesa/TigoPesa/
AirtelMoney) are Tanzania-specific mobile money operators; Selcom Checkout only makes sense
for a `tiers.prices` row where `country = 'TZ'` and `currency = 'TZS'`. Using the master's own
canonical tier example (§5):
```json
"prices": [
  {"currency":"TZS","amount":15000,"country":"TZ"},
  {"currency":"USD","amount":6,"country":"*"}
]
```
— a TZ student resolves to the `TZS/TZ` row and sees the Selcom "Pay by mobile money" button;
every other student (resolves to the `USD/*` row, or any other country/currency the admin adds
later, e.g. a hypothetical `TRY/TR` row) sees ONLY the manual-claim CTA (Phase 6), forever,
until/unless a future non-Tanzania aggregator is separately designed. This single
country/currency check (A.4 step 2) is the entire routing logic between the two payment
UIs — keep it that simple; resist the temptation to build a generic "payment provider
resolver" abstraction for a one-provider, one-country feature (YAGNI, consistent with D13's
Swahili-deferral reasoning elsewhere in the master plan).

## A.11 Effort estimate & task stubs

**Estimate:** roughly **4–6 developer/agent-days** of code (migration, digest lib + tests,
checkout action, webhook route, cron, admin surfacing, email template, manual+negative-path
verification) ON TOP OF an **external, non-dev lead time** for Selcom onboarding (business
docs + contract + account activation) that is realistically **1–4 calendar weeks** and fully
outside engineering's control — a phase plan should sequence engineering work to start in
parallel with onboarding (build against the digest spec and mocked responses first, swap in
real credentials once onboarding completes), not block on it serially.

**Task stubs** (a future planner expands each into a full master-§12-style task):
1. Add `SELCOM_VENDOR_ID` / `SELCOM_API_KEY` / `SELCOM_API_SECRET` / `SELCOM_WEBHOOK_SECRET`
   (if a separate webhook-specific secret exists — confirm) to the env matrix (extends
   Phase 1's env checklist).
2. Migration: `payment_orders` table + RLS + indexes (A.3).
3. Migration: `grant_entitlement_from_order()` SECURITY DEFINER function (A.3), reusing
   Phase 4/6's stacking-rule helper rather than reimplementing it.
4. `lib/selcom/digest.ts` — pure signing/verification functions + Vitest unit tests (D14) —
   write these against the **[UNVERIFIED]** spec first, then correct against a real
   round-tripped request/webhook once credentials exist.
5. `lib/selcom/client.ts` — `createOrder()` / `getOrderStatus()` thin wrappers.
6. Checkout server action (A.4) with the TZ/TZS routing gate (A.10).
7. Checkout UI: phone input + "Pay by mobile money" button + polling status component +
   fallback-to-manual-claim CTA.
8. `app/api/webhooks/selcom/route.ts` (A.6) — signature verification, idempotent status
   transition, calls the grant function.
9. `app/api/cron/reconcile-selcom-orders/route.ts` (A.8) + Vercel Cron schedule config.
10. Admin dashboard: payment-orders table view + manual "re-check with Selcom" action
    (extends Phase 5's admin shell).
11. Resend email template: automated-payment receipt (extends Phase 6's email patterns).
12. Manual verification checklist + required negative-path tests (master §12.6): replayed
    webhook, tampered digest, amount mismatch, expired/abandoned order, concurrent
    webhook+cron race.
13. (Non-code, external) Selcom business onboarding: gather documents (A.10), request
    merchant/API access + test credentials, confirm fee schedule, register webhook URL.

---

# PART B — Student Self-Upload Content Pipeline

## B.1 Goal, restated, and the quality bar that governs everything below

Master §2.5 defers this explicitly: admin-uploaded content ships without redeploys in Phase 5;
**student-uploaded** content is this future design. The idea: a student uploads their own
notes/scans/past-paper material for a subject (or proposes a brand-new subject), and the
system turns it into a cubad-quality unit — same shape as `hidroloji`/`insaat-yonetimi` today
— which an admin reviews before it goes live.

**The quality bar is non-negotiable and is fully already written down** — it's exactly
`docs/authoring/content-schema.md` + `docs/authoring/fidelity-addendum.md`, restated here so a
future agent doesn't have to go hunting for what "cubad-quality" means:

1. **Every number is verified by actual computation** (content-schema.md rule 1) — not
   eyeballed, not trusted from the source blindly; recompute in code and reconcile
   discrepancies explicitly.
2. **Both languages, always** — every `Bi = {tr, en}` field genuinely filled in both, correct
   domain terminology, not a lazy machine-translation pass (content-schema.md rule 2).
3. **Pedagogical, not just correct** — the `why`/`guiding`/`whatItShows` fields must state the
   actual reasoning cue a student needs in an exam, never a generic restatement
   (content-schema.md rule 3).
4. **Every figure/table the source contains must appear**, with `howToDraw`/`whatItShows` on
   every chart, per the fidelity-addendum's "PDFs are the source of truth" mandate — and
   nothing invented that isn't in the source.
5. **Passes `scripts/validate-content.mjs`** (or its future importable-function form, see
   B.4c) with zero errors.

This is a genuinely hard bar — hard enough that today it's met by a human (the site owner)
personally directing an agent through an iterative, multi-pass process (the very existence of
`fidelity-addendum.md` as a SECOND pass fixing gaps the first pass missed is itself proof this
isn't a "fire and forget" task yet). Every design choice in Part B is downstream of taking that
fact seriously rather than assuming a first LLM pass will hit this bar unsupervised.

## B.2 Data model — `submissions` table + `submissions` storage bucket

```sql
create table public.submissions (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  subject_id             uuid references public.subjects(id) on delete set null, -- null = proposing a NEW subject
  proposed_subject_title jsonb,                          -- Bi, required when subject_id is null
  title                  jsonb not null,                 -- Bi, e.g. "Yeraltı suyu notlarım" / "My groundwater notes"
  description            jsonb not null default '{}'::jsonb, -- Bi, student's own summary of what they're sharing
  status                 text not null default 'uploaded'
                           check (status in ('uploaded','processing','generated','needs_review','approved','rejected','published')),
  source_files           jsonb not null default '[]'::jsonb,
                           -- [{"path":"submissions/<uid>/<id>/scan1.pdf","mime":"application/pdf","bytes":2345671}]
  generated_unit_ids     jsonb not null default '[]'::jsonb, -- [uuid, ...] draft `units` rows the pipeline created
  auto_qa_report         jsonb,                            -- structured output of stage (d), see B.4
  review_note            text,                             -- admin's note (visible to student, mirrors D9's claim rejection UX)
  reviewed_by            uuid references auth.users(id),
  reviewed_at            timestamptz,
  copyright_ack          boolean not null default false check (copyright_ack), -- must be true; see B.5
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index submissions_status_created on public.submissions (status, created_at);
create index submissions_user on public.submissions (user_id);
alter table public.submissions enable row level security;
```

**RLS:** owner select/insert own (insert only with `copyright_ack = true`, enforced by the
check constraint above, not trusted client JS); owner may update only while `status='uploaded'`
(e.g. to add a file before the pipeline picks it up) — once `status` moves past `uploaded`,
only server-side code (service role) or admin (for `review_note`/`reviewed_by`/`status`
transitions) may write. Admin: select/update all.

**Storage bucket `submissions`** — private, same prefix-enforcement pattern as
`payment-proofs` (D9): object path MUST be `submissions/<auth.uid()>/<submission_id>/<filename>`,
enforced by the storage RLS policy checking the path prefix against `auth.uid()`, never trusted
from a client-supplied path column (master §9's "storage object paths constructed server-side"
invariant applies identically here). Extracted derivatives (page images, text) live alongside
under a `extracted/` sub-prefix: `submissions/<uid>/<id>/extracted/p03.png`,
`submissions/<uid>/<id>/extracted/text.txt` — written by server-side code only (never a client
upload target).

## B.3 Student UI flow

A new authenticated (non-admin) surface, e.g. `/account/submissions` or a "Share your notes"
entry point from the subject catalog:

1. **Upload form:** subject picker (existing subjects) OR "propose a new subject" (free-text
   title, both languages required — `proposed_subject_title`); title + description for the
   submission itself; file picker — accepts PDF/PNG/JPG/plain text; client-side limits (a
   phase plan should pick concrete numbers, e.g. **max 5 files, 20 MB each, PDF page count
   soft-warning above ~60 pages** since huge scans blow up both storage and later LLM context);
   a **copyright acknowledgment checkbox** (mandatory, see B.5) with the exact language "I own
   this material or have the right to share it; I understand cubad may adapt it into study
   content, and that I can request removal at any time" (both languages).
2. **Progress states**, mapped 1:1 to `submissions.status`: `uploaded` ("received, waiting to
   be processed") → `processing` ("extracting your files") → `generated` ("draft content
   created, waiting for admin review") → `needs_review` (used if a stage needs a human
   decision mid-pipeline, e.g. auto-QA flags something ambiguous) → `approved` ("looks good,
   about to go live") / `rejected` (shows `review_note`) → `published` ("live! see it here" +
   a link to the resulting unit(s)).
3. **"My submissions" list** — a simple status timeline per submission, read-only from the
   student's side beyond the initial upload.
4. No in-place "edit and resubmit" in v1 — a rejected submission's `review_note` explains why,
   and the student creates a **new** submission if they want another attempt (keeps the audit
   trail trivial; an edit/version-chain feature is an explicit YAGNI deferral, not an
   oversight — note it as an open question in B.7 if a future agent wants to revisit).

## B.4 Processing pipeline stages

**(a) Extraction** — normalize whatever was uploaded into a form the authoring step (b) can
work with, mirroring exactly what the site owner already does by hand today (per
`content-schema.md`'s own described source-prep: "text extraction" + "page images (PNG,
~100dpi)" because "text extraction MANGLES equations… prefer images for anything with
fractions/subscripts"):
- PDF → render each page to a PNG (~100dpi, matching the existing convention) AND pull a raw
  text layer (for fast, cheap structure detection — headings/section breaks — NOT as the
  authoring source of truth, exactly like today's workflow treats `soru.txt` as a rough guide
  and the page PNGs as ground truth for anything visual).
- Image uploads (PNG/JPG) pass through unchanged — the authoring step reads them directly via
  a multimodal model, no separate OCR step needed (this matches current practice: the
  authoring agent already reads page images directly rather than OCR-ing them first).
- Plain-text uploads pass through unchanged.
- Write all derivatives to `submissions/<uid>/<id>/extracted/…` (B.2).
- Flip `status: uploaded → processing` when this starts, and once extraction finishes, the
  submission sits ready for stage (b) — whether that's queued automatically (8c) or picked up
  by an operator (8a/8b), see B.5.

**(b) AI authoring against `docs/authoring/content-schema.md`** — the actual hard part (B.1).
Restated hard requirements for whoever/whatever performs this stage:
- **Coverage-matrix rule** (new, explicit for uploads — content-schema.md doesn't need this
  rule for curated course PDFs because the site owner manually ensures full coverage; an
  unsupervised/automated pipeline needs it spelled out): every section detected in the source
  (from stage (a)'s heading/structure pass) must map to **≥1 note + ≥1 flashcard + ≥1
  practice/question item** in the output. This is a literal, checkable matrix — build it as a
  structured intermediate artifact (`{"sourceSection": "...", "coveredBy": {"notes": [...],
  "flashcards": [...], "practice": [...]}}`) so stage (c)/(d) can mechanically verify nothing
  was dropped, rather than trusting the model's own claim of completeness.
- **Bilingual TR/EN** on every `Bi` field, full stop (content-schema.md rule 2).
- **All numerics recomputed programmatically** — the authoring step must actually execute
  code (Python/JS) to verify every number it writes, exactly as content-schema.md rule 1
  demands of the human-directed process today; this does not get relaxed for an automated
  pipeline, if anything it matters MORE because there's less human sanity-checking downstream.
- **Figure/table fidelity** per `fidelity-addendum.md` — every graph/table the source shows
  must appear with `howToDraw`/`whatItShows`; nothing invented that isn't in the source.
- Default `section_order`/`kind` choice: student uploads default to the **`study`** shape
  (`notes`/`flashcards`/`practice` — the richer generic format per master D5) unless the
  material is clearly a solved-problem sheet (then `walkthrough` — `questions`/`quiz`), a
  judgment call left to whoever runs stage (b).

**(c) `validate-content` schema gate** — run the validator (today `scripts/validate-content.mjs`,
scanning `content/<subject>/unit-*.json` files on disk) against the freshly generated draft
unit JSON before it becomes an insertable `units` row. **Dependency note for the future
planner:** Phase 3 (`03-content-db-unified-ui.md`) moves content into Postgres; Phase 5's admin
upload UI will already need to validate a single pasted/uploaded unit JSON object
programmatically (not just scan a directory) — that refactor (extracting the validator's
per-unit checks into an importable `lib/content-validator.ts` function, e.g.
`validateUnit(subjectSectionOrder, unitJson): {errors: string[], warnings: string[]}`) should
happen once, in Phase 5, and get reused here verbatim rather than being re-invented for the
submissions pipeline. Zero errors required before a generated unit can even reach `needs_review`
in stage (d)/(e) below — a submission whose stage (b) output fails validation loops back
(automatically, if 8c; manually, if 8a/8b) rather than ever reaching an admin's review queue in
a broken state.

**(d) Auto-QA pass** — a second, independent model call (ideally not just a second call to the
same model/prompt that just authored the content — ask a different model or at minimum a
fresh, differently-framed prompt, to reduce correlated blind spots) given the ORIGINAL source
images/text plus the generated unit JSON, tasked with:
- Re-verifying every recomputed number against its own independent recomputation.
- Checking the coverage matrix from (b) is actually honored (spot-check, not just trust the
  matrix's own bookkeeping).
- Flagging any statement in the generated content NOT traceable to the source (hallucination
  check) — this is the pipeline's main defense against confidently-wrong invented content.
- Flagging incomplete bilingual fields, PII leakage (B.5), and missing figures/tables per
  fidelity-addendum's fidelity mandate.
Output is a structured report written to `submissions.auto_qa_report` (jsonb): a per-item
pass/fail plus a free-text list of discrepancies. This report is surfaced prominently in the
admin review UI (stage (e)) — think of it as a pre-filled first draft of what the admin should
scrutinize, not a gate that blocks on its own (a human still makes the final call).

**(e) Admin review UI** — reuses Phase 5's draft-preview machinery (the same mechanism admin
uses to preview admin-authored content before publishing): render the generated unit(s) through
the REAL `UnitView`/`StudyUnitView` components against the draft JSON, so admin reviews exactly
what students will see, not a raw JSON diff. Additively, for submissions specifically, show a
**diff-style side-by-side**: source page images/text on one side, the rendered draft on the
other, with `auto_qa_report` discrepancies highlighted inline next to the relevant
note/question. Admin actions: edit the generated JSON directly (reuse Phase 5's editor),
**Approve & Publish** (the common case — sets `submissions.status='published'` and the
underlying `units.status='published'` in one action, reusing Phase 5's existing publish
function so cache tag-revalidation (D12) happens automatically, no new publish code), or
**Reject** (sets `status='rejected'` + `review_note`, emails the student, mirrors D9's claim
rejection UX exactly).

**(f) Publish** — deliberately NOT a new code path. "Approve & Publish" in (e) calls the exact
same publish server action Phase 5 built for admin-authored units. This is the payoff of
building on D4's content model from day one: a unit is a unit regardless of who or what wrote
its JSON.

## B.5 Where does the AI pipeline run? Three options, honestly compared

This is the one real open architecture decision in Part B — everything else above is fairly
mechanical once this is picked.

**(i) Operator-run agent sessions** (Claude Code / Codex, today's actual modus operandi for
ALL existing content — see `content-schema.md`/`fidelity-addendum.md`, which are literally
written as prompts for a human-directed agent session). **Cost:** $0 marginal API spend to the
product (runs on the operator's own tooling/subscription); zero new infrastructure. **Quality:**
highest — a human is in the loop by construction, exactly matching how `hidroloji`/
`insaat-yonetimi` were built and iteratively fixed (fidelity-addendum's whole existence).
**Con:** does not scale past what one operator can personally turn around; turnaround is
hours-to-days, not minutes; becomes the bottleneck as submission volume grows.

**(ii) Queued server-side jobs calling LLM APIs directly** — a Supabase Edge Function
(triggered by a DB webhook/cron on new `'uploaded'` rows) or an external worker (small Node
process on Railway/Fly.io polling the queue) runs stages (a)–(d) fully unattended, calling
Gemini/Claude APIs directly, writing the draft, flipping status to `'needs_review'` with zero
human involvement until stage (e). **Cost:** real, ongoing $ paid by the product, not the
operator — rough order of magnitude **[UNVERIFIED estimate, confirm real pricing before
committing to this]**: a full unit's worth of context (dozens of source page images + text) in,
and ~15+ flashcards/practice items + notes + a coverage matrix + an auto-QA pass out, is
plausibly 50–150K input+output tokens per submission — at current-generation frontier model
pricing this is roughly **$0.50–$3 per submission**, but this number MUST be re-verified
against actual current API pricing at implementation time, not trusted from this document.
Needs real infrastructure (a queue/worker, retries, dead-letter handling for stuck jobs,
monitoring so a silently-bad generation doesn't just waste tokens unnoticed), and needs
per-user/per-month cost caps tied to the abuse-quota design (B.6) since unattended generation
turns "submit a file" into "spend our money," a very different trust model than a claim/proof
upload (Phase 6) which costs nothing to receive.

**(iii) Hybrid — automate extraction (a) + validation (c), keep authoring (b) operator-run.**
Stages (a) and (c) are deterministic-ish and low-risk (no creative/pedagogical judgment
involved — "turn a PDF into page images" and "does this JSON match the schema" are exactly the
kind of task that's safe to fully automate on day one). Stage (b) — the actual hard,
judgment-heavy work described in B.1 — stays a human-operator-run agent session using
**the same playbook as today**: an agent reads the now-ALREADY-extracted text+images straight
from the `submissions` bucket (removing the operator's current biggest manual-prep step —
today's `content-schema.md` workflow explicitly starts from "Full worked solutions: …soru.txt…
Page images…" that someone had to produce by hand first), follows `content-schema.md` +
`fidelity-addendum.md` exactly as it does for admin-authored content today, writes the output,
and the system runs stage (c)'s validator automatically as a gate before the submission can
even reach the admin queue. Stage (d)'s auto-QA is CHEAP relative to full authoring (one
extra "does this match the source" API call, not a from-scratch generation) so it's worth
automating even while (b) stays human-run — cheap insurance, high signal for the admin
reviewing in (e).

**Recommendation: ship (iii) first (this is 8b, see B.7), evolve toward (ii) later (8c) — NOT
before.**

**Justification:** `content-schema.md`'s bar (verify every number by executing code, write
pedagogically rich `why`/`guiding` fields calibrated to "explain like a friendly tutor... never
generic," full bilingual fidelity, faithful figure/table reproduction) is currently met by a
skilled human directing an agent interactively, with real iteration — `fidelity-addendum.md`
existing at all is direct evidence that even the CURRENT human-supervised process needed a
second pass to catch gaps the first pass missed. Jumping straight to option (ii) — fully
unattended generation from day one — risks shipping confidently-wrong content at scale (a
wrong number stated with total confidence, a thin generic "why" field, a missing required
figure) before the pipeline has any of the guardrails (a battle-tested auto-QA prompt, a
coverage-matrix check with real track record, PII/moderation scanning per B.6) that would make
unattended output trustworthy. Option (iii) banks the safely-automatable ~80% of the toil
(extraction, validation) immediately, for free, using zero new judgment-risk, while deferring
the risky ~20% (creative authoring judgment) until there's both (a) evidence from a real
backlog of hybrid-mode operator transcripts — which double as few-shot examples and a concrete
list of failure modes to prompt-guard against — and (b) a real trigger to justify the
infrastructure and per-submission cost: e.g. **sustained demand beyond what one operator can
turn around (a concrete bar like ">5 pending submissions/week for a month straight")** AND a
resolved cost model (who pays — folded into a paid tier, a capped free quota, or similar).

## B.6 Abuse & safety

- **Quota:** max **2 active submissions per user** at a time, where "active" = `status NOT IN
  ('published', 'rejected')`. Enforced in the upload server action via a single indexed
  `count(*)` query (a scalar aggregate — compliant with master §9's "aggregates that gate
  anything run IN SQL" rule; this is not the PostgREST 1000-row-cap trap since `count(*)`
  returns one row regardless of how many rows it counted). Friendly UI error when exceeded
  ("finish or hear back on an existing submission before starting a new one").
- **Copyright acknowledgment:** a mandatory checkbox (B.3) backed by a DB `check (copyright_ack)`
  constraint — the insert is REJECTED outright if unchecked, never a client-side-only gate.
  Exact language should cover: ownership/right-to-share, that cubad may adapt the material,
  and that removal can be requested.
- **Takedown note:** document a public **content takedown request** path (e.g. an email alias
  such as a `content-rights@` address, or simply routing through `ADMIN_NOTIFY_EMAIL` per
  D10) in the ToS/submission page, so a rights-holder can ask for published content derived
  from a submission to be taken down. Handling is a process, not new code: admin unpublishes
  the unit (`units.status` back to `draft`, or delete per severity) and marks the source
  `submissions.status='rejected'` retroactively with a `review_note` explaining why. This is
  in scope for **8a** (it's a policy/contact-path decision, not a pipeline stage).
- **PII scrubbing:** uploaded personal notes commonly carry marginalia — a student's name,
  student ID, phone number scrawled in a margin. Whoever performs stage (b) (operator or, in
  8c, an automated prompt) must be explicitly instructed (a short addendum to
  `content-schema.md` scoped to submissions) to NEVER carry personally-identifying marginalia
  into generated content. No automated PII-detection tooling is required for 8a/8b (a human —
  operator in (b), admin in (e) — always looks at the source before anything ships). **Before
  ever enabling fully unattended authoring (8c/option ii)**, add a real automated PII-scan pass
  (regex for phone/ID-number patterns at minimum, ideally a vision-model pass over the page
  images) as a hard prerequisite, not an optional nice-to-have — this is exactly the kind of
  control that must exist BEFORE removing the human safety net, not after.
- **Moderation of uploaded images:** for 8a/8b, no automated image-moderation service is
  needed — a human always looks at the images before anything reaches a student's screen
  (either the operator authoring stage (b), or the admin review stage (e), or both). **Before
  8c** (unattended generation), add an image-moderation pass (a vision-safety classifier) on
  every uploaded image before it's ever sent to an authoring model — guards against abusive/
  unrelated uploads being fed straight into an unattended pipeline with no human ever having
  looked at them first. Flag this, like the PII point above, as a hard 8c prerequisite.

## B.7 Phasing — what ships when

**8a — upload + storage + admin visibility only.** The smallest useful slice; ships right
after Phase 7 lands (no dependency on Phase 8's other half, Part A). Students can send
materials; admin processes everything by hand (no automation at all yet) — this alone already
removes the "how do I even receive materials from a student" problem.
1. Migration: `submissions` table + RLS + indexes + `copyright_ack` check constraint (B.2).
2. Storage bucket `submissions` (private, prefix-enforced policies mirroring `payment-proofs`).
3. Student upload UI: file picker, mime/size limits, copyright checkbox, subject/new-subject
   picker, submit action (B.3).
4. Quota check (B.6) wired into the upload server action.
5. Student "my submissions" status page (read-only timeline, B.3).
6. Admin dashboard: submissions queue (list/filter by status), detail view (download/preview
   source files), manual status transitions + `review_note`, Resend email to admin on new
   submission (reuses D10's admin-notify pattern) + Resend email to student on rejection
   (reuses D9's claim-rejection email pattern).
7. Manual verification checklist: upload → admin sees it in queue → admin rejects with a note
   → student sees the note + email.

**8b — automated extraction + validation.** Depends on 8a. Adds stages (a) and (c) as real
automated code; stage (b) (authoring) stays operator-run per B.5's recommendation.
8. Server route / Edge Function: on submission reaching a file-uploaded state, automatically
   run extraction (B.4a) into `submissions/<uid>/<id>/extracted/…`, updating `status` through
   `uploaded → processing` without any human trigger.
9. Extract `scripts/validate-content.mjs`'s per-unit logic into an importable
   `lib/content-validator.ts` function (B.4c) — a SHARED dependency with Phase 5's admin
   upload UI; whichever phase (5 or this one) lands first should build it once for both.
10. Document the operator runbook change: authoring (stage b) now reads directly from
    `extracted/…` instead of a manually-prepared scratch folder — no new code, a process note.
11. Admin review UI (B.4e): diff-style preview (source images beside the rendered draft via
    Phase 5's draft-preview components), Approve & Publish / Reject actions writing
    `generated_unit_ids` + `review_note`.
12. Wire stage (d)'s auto-QA as an automated second-model call once stage (b)'s output lands
    (cheap relative to authoring itself, per B.5) — writes `auto_qa_report`.

**8c — full automated authoring queue.** Depends on 8b AND on the concrete triggers named in
B.5 (sustained demand + a resolved cost model) — do not build this speculatively.
13. Decide + stand up worker infrastructure (Supabase Edge Function cron vs. an external
    worker process) once the volume trigger is actually hit.
14. Wire stage (b) (authoring) itself into the automated queue, calling an LLM API directly,
    with retries/error handling and per-user/per-month cost caps (ties into B.6's quota).
15. Add the PII-scan pass and image-moderation pass (B.6) as hard gates BEFORE this stage is
    allowed to run unattended on any real submission.
16. Cost-monitoring dashboard (tokens/$ spent per submission; alerting on a budget threshold)
    — this is a genuine new ongoing operational cost the business is taking on, unlike every
    other phase in this suite, and deserves visibility from day one of 8c.

---

## Changelog / deviations

- 2026-07-16 (post-review fix): `grant_entitlement_from_order` pseudocode (A.3) no longer
  inlines an `entitlements` insert — it now calls the shared `public.grant_entitlement(...)`
  (Phase 4, SECURITY DEFINER, the only implementation of the D8 stacking rule), matching what
  A.11 already said about reusing the shared grant path. Re-audit follow-up (same day): the
  call passes `v_tier.scope_id` directly (no case-expression over `v_tier.id`), and the
  scope-resolution note below the function was rewritten — `tiers.scope_id uuid` exists per
  master §4 (null iff `scope_type='all'`, `tiers_scope_target` constraint, set by Phase 5's
  tier CRUD), so no resolution logic is needed; the earlier claim that tiers lack a
  `scope_id` column was wrong against the finalized suite.

