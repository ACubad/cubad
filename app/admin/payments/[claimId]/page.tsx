import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ReviewPanel } from "./ReviewPanel";

export default async function ClaimDetailPage({
  params,
}: {
  params: Promise<{ claimId: string }>;
}) {
  const { claimId } = await params;
  const supabase = await createClient();
  const { data: claim, error: claimError } = await supabase
    .from("payment_claims")
    .select("id,user_id,tier_id,amount,currency,method,payer_ref,proof_path,status,review_note,reviewed_at,created_at")
    .eq("id", claimId)
    .maybeSingle();
  if (claimError) throw new Error(`claim detail failed: ${claimError.message}`);
  if (!claim) notFound();

  const [{ data: profile, error: profileError }, { data: tier, error: tierError }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("full_name,email,phone,country_code")
        .eq("user_id", claim.user_id)
        .maybeSingle(),
      supabase
        .from("tiers")
        .select("slug,title,scope_type,duration_days")
        .eq("id", claim.tier_id)
        .maybeSingle(),
    ]);
  if (profileError) throw new Error(`claim profile failed: ${profileError.message}`);
  if (tierError) throw new Error(`claim tier failed: ${tierError.message}`);

  // The object name comes exclusively from the server-written claim row. The cookie-bound admin
  // client exercises payment_proofs_select_own_or_admin when minting this short-lived URL.
  let proofUrl: string | null = null;
  if (claim.proof_path) {
    const { data: signed, error } = await supabase.storage
      .from("payment-proofs")
      .createSignedUrl(claim.proof_path as string, 600);
    if (!error) proofUrl = signed?.signedUrl || null;
  }
  const isPdf = (claim.proof_path as string | null)?.toLowerCase().endsWith(".pdf") || false;
  const title = (tier?.title as { en?: string } | null)?.en || (tier?.slug as string) || "—";
  const amount = claim.amount === null
    ? "—"
    : `${Number(claim.amount).toLocaleString("en-GB")} ${claim.currency || ""}`;

  return (
    <main>
      <Link href="/admin/payments" className="text-sm font-medium text-deniz underline">
        ← Back to queue
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-ink">Claim review</h1>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-line bg-paper p-4 text-sm">
          <h2 className="mb-2 font-semibold text-ink">Student</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-ink-faint">Name</dt><dd>{profile?.full_name || "—"}</dd>
            <dt className="text-ink-faint">Email</dt><dd className="font-mono">{profile?.email || "—"}</dd>
            <dt className="text-ink-faint">Phone</dt><dd className="font-mono">{profile?.phone || "—"}</dd>
            <dt className="text-ink-faint">Country</dt><dd>{profile?.country_code || "—"}</dd>
          </dl>
        </section>

        <section className="rounded-xl border border-line bg-paper p-4 text-sm">
          <h2 className="mb-2 font-semibold text-ink">Payment</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-ink-faint">Tier</dt><dd>{title} ({tier?.scope_type} · {tier?.duration_days}d)</dd>
            <dt className="text-ink-faint">Amount</dt><dd className="font-mono">{amount}</dd>
            <dt className="text-ink-faint">Method</dt><dd>{claim.method as string}</dd>
            <dt className="text-ink-faint">Payer ref</dt><dd className="font-mono">{(claim.payer_ref as string) || "—"}</dd>
            <dt className="text-ink-faint">Status</dt><dd>{claim.status as string}</dd>
          </dl>
        </section>
      </div>

      <section className="mt-4 rounded-xl border border-line bg-paper p-4">
        <h2 className="mb-2 text-sm font-semibold text-ink">Private proof</h2>
        {!claim.proof_path ? (
          <p className="text-sm text-clay">No proof uploaded. Approval is blocked.</p>
        ) : !proofUrl ? (
          <p className="text-sm text-clay">Could not sign the proof URL. Reload to retry.</p>
        ) : isPdf ? (
          <a href={proofUrl} target="_blank" rel="noreferrer" className="text-deniz underline">
            Open proof PDF (link valid for 10 minutes)
          </a>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={proofUrl} alt="Payment proof" className="max-h-[600px] w-auto rounded-lg border border-line" />
        )}
      </section>

      <section className="mt-4 rounded-xl border border-amber/30 bg-amber-soft p-4 text-sm text-ink">
        <h2 className="mb-2 font-semibold">Before approving — verify manually</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Find the transaction in the bank or mobile-money statement using payer reference <span className="font-mono">{(claim.payer_ref as string) || "(none)"}</span>.</li>
          <li>Confirm the received amount is <span className="font-mono">{amount}</span>.</li>
          <li>Confirm the sender and timing are consistent with this student.</li>
          <li>Only then approve. Approval activates access immediately and cannot be undone here.</li>
        </ul>
      </section>

      <ReviewPanel
        claimId={claim.id as string}
        status={claim.status as string}
        reviewNote={(claim.review_note as string | null) || ""}
        hasProof={Boolean(claim.proof_path && proofUrl)}
      />
    </main>
  );
}
