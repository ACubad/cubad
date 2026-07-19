"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { sendAdminNewClaim } from "@/lib/email/send";
import {
  ALLOWED_MIME,
  MAX_PROOF_BYTES,
  proofMagicMatches,
  sanitizeFilename,
} from "@/lib/payments/filename";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_METHODS = new Set(["mpesa", "tigopesa", "airtelmoney", "bank", "other"]);

export interface SubmitState {
  error?: string;
}

export async function submitClaim(
  _previous: SubmitState,
  formData: FormData
): Promise<SubmitState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in?next=/upgrade");

  const tierId = String(formData.get("tierId") ?? "");
  const method = String(formData.get("method") ?? "");
  const payerRef = String(formData.get("payerRef") ?? "").trim().slice(0, 200);
  const currency = String(formData.get("currency") ?? "").trim().toUpperCase().slice(0, 8);
  const amountInput = String(formData.get("amount") ?? "").trim();
  const amount = amountInput ? Number(amountInput) : null;
  const file = formData.get("proof");

  if (!UUID_RE.test(tierId) || !VALID_METHODS.has(method)) return { error: "bad-input" };
  if (currency && !/^[A-Z]{3,8}$/.test(currency)) return { error: "bad-currency" };
  if (amount !== null && (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000_000)) {
    return { error: "bad-amount" };
  }
  if (!(file instanceof File) || file.size === 0) return { error: "proof-required" };
  if (file.size > MAX_PROOF_BYTES) return { error: "too-large" };
  if (!ALLOWED_MIME.includes(file.type)) return { error: "bad-type" };
  const safeName = sanitizeFilename(file.name, file.type);
  if (!safeName) return { error: "bad-type" };

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!proofMagicMatches(bytes, file.type)) return { error: "mime-mismatch" };

  // Independently authorize the product being claimed. Hidden/unknown tiers cannot be submitted.
  const { data: tier, error: tierError } = await supabase
    .from("tiers")
    .select("id,title")
    .eq("id", tierId)
    .eq("status", "published")
    .maybeSingle();
  if (tierError || !tier) return { error: "tier-unavailable" };

  // Friendly UX guard. The trigger's advisory-lock count remains authoritative under concurrency.
  const { count, error: countError } = await supabase
    .from("payment_claims")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "pending");
  if (countError) return { error: "count-failed" };
  if ((count ?? 0) >= 3) return { error: "too-many-open" };

  // Cookie-bound user insert deliberately exercises claims_insert_own_pending RLS.
  const { data: claim, error: insertError } = await supabase
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
  if (insertError || !claim) {
    if (insertError?.message.includes("open-claim-limit")) return { error: "too-many-open" };
    return { error: "insert-failed" };
  }

  const service = createServiceRoleClient();
  const path = `${user.id}/${claim.id}/${safeName}`;
  const { error: uploadError } = await service.storage
    .from("payment-proofs")
    .upload(path, bytes, { contentType: file.type, upsert: false });
  if (uploadError) {
    await service.from("payment_claims").delete().eq("id", claim.id).eq("user_id", user.id);
    return { error: "upload-failed" };
  }

  const { data: finalized, error: finalizeError } = await service
    .from("payment_claims")
    .update({ proof_path: path })
    .eq("id", claim.id)
    .eq("user_id", user.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (finalizeError || !finalized) {
    await service.storage.from("payment-proofs").remove([path]);
    await service.from("payment_claims").delete().eq("id", claim.id).eq("user_id", user.id);
    return { error: "finalize-failed" };
  }

  const { data: profile } = await service
    .from("profiles")
    .select("full_name,email")
    .eq("user_id", user.id)
    .maybeSingle();
  const tierTitle = (tier.title as { en?: string } | null)?.en || "(tier)";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  after(async () => {
    await sendAdminNewClaim({
      studentName: profile?.full_name || "(no name)",
      studentEmail: profile?.email || user.email || "",
      tierTitle,
      amount: amount === null ? "—" : String(amount),
      currency,
      method,
      payerRef,
      dashboardUrl: `${appUrl}/admin/payments/${claim.id}`,
    });
  });

  revalidatePath("/upgrade/claims");
  revalidatePath("/admin/payments");
  redirect("/upgrade/claims?submitted=1");
}

export async function cancelClaim(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in?next=/upgrade/claims");

  const claimId = String(formData.get("claimId") ?? "");
  if (!UUID_RE.test(claimId)) return;

  const { data: claim } = await supabase
    .from("payment_claims")
    .select("proof_path,status")
    .eq("id", claimId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!claim || claim.status !== "pending") return;

  // `.select` distinguishes a successful zero-row race from an actual owner cancellation.
  const { data: deleted, error } = await supabase
    .from("payment_claims")
    .delete()
    .eq("id", claimId)
    .eq("user_id", user.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (!error && deleted && claim.proof_path) {
    const service = createServiceRoleClient();
    await service.storage.from("payment-proofs").remove([claim.proof_path]);
  }
  revalidatePath("/upgrade/claims");
  revalidatePath("/admin/payments");
}
