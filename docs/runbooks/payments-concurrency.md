# Payment review concurrency probe

This probe proves that competing review requests serialize on the payment-claim row. It covers both approve-versus-approve and approve-versus-reject races, then verifies that only one terminal transition and one set of approval artifacts committed.

## Run locally

Start the local Supabase stack, reset it to the repository migrations, and run:

```powershell
npx supabase start
npx supabase db reset
powershell -NoProfile -ExecutionPolicy Bypass -File supabase/tests/06-payments-concurrency.ps1
```

Expected output:

```text
PASS simultaneous approve/approve: one commit, one not-pending, artifacts 1:1:1:1
PASS simultaneous approve/reject: one terminal transition and one audit
```

The script uses fixed synthetic UUIDs, always removes its jobs, and deletes all test rows in a `finally` block. It never reads or writes production data.
