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
  hasProof,
}: {
  claimId: string;
  status: string;
  reviewNote: string;
  hasProof: boolean;
}) {
  const [approveState, approveAction, approving] = useActionState<ApproveState, FormData>(
    approveClaim,
    {}
  );
  const [rejectState, rejectAction, rejecting] = useActionState<RejectState, FormData>(
    rejectClaim,
    {}
  );

  if (status !== "pending" || approveState.ok || rejectState.ok) {
    return (
      <section className="mt-4 rounded-xl border border-line bg-paper p-4 text-sm">
        {approveState.ok ? (
          <div>
            <p className="font-semibold text-moss">Approved. Access is active.</p>
            <p className="mt-2 text-ink-faint">Access code (shown once; copy it only if delivery failed):</p>
            <p className="mt-1 rounded-lg bg-deniz-soft px-3 py-2 text-center font-mono text-xl font-bold tracking-widest text-deniz-deep">
              {approveState.code}
            </p>
            <p className="mt-2 text-xs text-ink-faint">
              Student email: {approveState.emailOk ? "sent ✓" : `failed (${approveState.emailError || "unknown"})`}
            </p>
          </div>
        ) : rejectState.ok ? (
          <div>
            <p className="font-semibold text-clay">Rejected.</p>
            <p className="mt-1 text-xs text-ink-faint">Email delivery is queued; any failure is recorded in Audit log.</p>
          </div>
        ) : (
          <p className="text-ink-soft">
            This claim is <strong>{status}</strong>{reviewNote ? `. Note: ${reviewNote}` : ""}.
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="mt-4 grid gap-4 md:grid-cols-2">
      <form action={approveAction} className="rounded-xl border border-moss/30 bg-moss-soft p-4">
        <input type="hidden" name="claimId" value={claimId} />
        <h3 className="mb-2 text-sm font-semibold text-moss">Approve</h3>
        <p className="mb-3 text-xs text-ink-soft">Mints and auto-redeems one code, activates access, then emails the receipt.</p>
        {approveState.error && (
          <p className="mb-2 text-xs text-clay">
            {approveState.error === "not-pending" ? "Already handled by another admin." : `Error: ${approveState.error}`}
          </p>
        )}
        <button type="submit" disabled={approving || rejecting || !hasProof} className="rounded-lg bg-moss px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {approving ? "Approving…" : "Approve & issue code"}
        </button>
      </form>

      <form action={rejectAction} className="rounded-xl border border-clay/30 bg-clay-soft p-4">
        <input type="hidden" name="claimId" value={claimId} />
        <h3 className="mb-2 text-sm font-semibold text-clay">Reject</h3>
        <label className="mb-2 block text-xs text-ink-soft">
          Reason (required; the student sees this)
          <textarea name="note" required maxLength={2000} rows={3} className="mt-1 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink" placeholder="e.g. No matching transaction for this payer reference." />
        </label>
        {rejectState.error && (
          <p className="mb-2 text-xs text-clay">
            {rejectState.error === "note-required"
              ? "A reason is required."
              : rejectState.error === "not-pending"
                ? "Already handled by another admin."
                : `Error: ${rejectState.error}`}
          </p>
        )}
        <button type="submit" disabled={rejecting || approving} className="rounded-lg bg-clay px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {rejecting ? "Rejecting…" : "Reject claim"}
        </button>
      </form>
    </section>
  );
}
