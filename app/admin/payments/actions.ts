"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { generateCode, hashCode } from "@/lib/access/codes";
import { requireAdminAction } from "@/lib/admin/guard";
import { sendClaimApproved, sendClaimRejected } from "@/lib/email/send";
import { createServiceRoleClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ApproveState {
  ok?: boolean;
  error?: string;
  code?: string;
  expiresIso?: string;
  emailOk?: boolean;
  emailError?: string;
}

export interface RejectState {
  ok?: boolean;
  error?: string;
}

export interface SettingsState {
  ok?: boolean;
  error?: string;
}

export async function approveClaim(
  _previous: ApproveState,
  formData: FormData
): Promise<ApproveState> {
  const { supabase, user } = await requireAdminAction();
  const claimId = String(formData.get("claimId") ?? "");
  if (!UUID_RE.test(claimId)) return { error: "bad-input" };

  const { data: claim, error: claimError } = await supabase
    .from("payment_claims")
    .select("id,user_id,tier_id,status,proof_path")
    .eq("id", claimId)
    .maybeSingle();
  if (claimError || !claim) return { error: "not-found" };
  if (claim.status !== "pending") return { error: "not-pending" };
  if (!claim.proof_path) return { error: "proof-required" };

  const { data: tier, error: tierError } = await supabase
    .from("tiers")
    .select("id,slug,title,duration_days")
    .eq("id", claim.tier_id)
    .maybeSingle();
  if (tierError || !tier) return { error: "tier-missing" };

  const plaintext = generateCode();
  const service = createServiceRoleClient();
  const { data: result, error: rpcError } = await service.rpc("approve_claim", {
    p_claim_id: claimId,
    p_code_hash: hashCode(plaintext),
    p_duration_days: tier.duration_days as number,
    p_reviewer: user.id,
  });
  if (rpcError) {
    if (rpcError.message.includes("not-pending")) return { error: "not-pending" };
    if (rpcError.message.includes("proof-required")) return { error: "proof-required" };
    return { error: "approve-failed" };
  }

  const expiresIso = (result as { expires_at?: string } | null)?.expires_at;
  if (!expiresIso) return { error: "approve-result-invalid" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("email,preferred_lang")
    .eq("user_id", claim.user_id)
    .maybeSingle();
  const lang = profile?.preferred_lang === "en" ? "en" : "tr";
  const title = tier.title as { tr?: string; en?: string };
  const emailResult = await sendClaimApproved(profile?.email || "", lang, {
    code: plaintext,
    tierTitle: title[lang] || title.en || (tier.slug as string),
    expiresIso,
    appUrl: process.env.NEXT_PUBLIC_APP_URL || "",
  });

  revalidatePath("/admin/payments");
  revalidatePath(`/admin/payments/${claimId}`);
  revalidatePath("/upgrade/claims");
  revalidatePath("/", "layout");
  return {
    ok: true,
    code: plaintext,
    expiresIso,
    emailOk: emailResult.ok,
    emailError: emailResult.ok ? undefined : emailResult.error,
  };
}

export async function rejectClaim(
  _previous: RejectState,
  formData: FormData
): Promise<RejectState> {
  const { supabase, user } = await requireAdminAction();
  const claimId = String(formData.get("claimId") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!UUID_RE.test(claimId)) return { error: "bad-input" };
  if (!note) return { error: "note-required" };
  if (note.length > 2000) return { error: "note-too-long" };

  const service = createServiceRoleClient();
  const { data: result, error } = await service.rpc("reject_claim", {
    p_claim_id: claimId,
    p_reviewer: user.id,
    p_note: note,
  });
  if (error) {
    if (error.message.includes("not-pending")) return { error: "not-pending" };
    if (error.message.includes("note-required")) return { error: "note-required" };
    return { error: "reject-failed" };
  }

  const studentId = (result as { user_id?: string } | null)?.user_id;
  const { data: profile } = studentId
    ? await supabase
        .from("profiles")
        .select("email,preferred_lang")
        .eq("user_id", studentId)
        .maybeSingle()
    : { data: null };
  const lang = profile?.preferred_lang === "en" ? "en" : "tr";
  after(async () => {
    await sendClaimRejected(profile?.email || "", lang, {
      reason: note,
      appUrl: process.env.NEXT_PUBLIC_APP_URL || "",
    });
  });

  revalidatePath("/admin/payments");
  revalidatePath(`/admin/payments/${claimId}`);
  revalidatePath("/upgrade/claims");
  return { ok: true };
}

export async function updatePaymentInstructions(
  _previous: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  const { user } = await requireAdminAction();
  const get = (key: string) => String(formData.get(key) ?? "").trim();
  const value = {
    mpesa: { tr: get("mpesa_tr"), en: get("mpesa_en") },
    bank: { tr: get("bank_tr"), en: get("bank_en") },
    whatsapp: { tr: get("whatsapp_tr"), en: get("whatsapp_en") },
  };
  const fields = Object.values(value).flatMap((entry) => [entry.tr, entry.en]);
  if (fields.some((field) => !field)) return { error: "all-fields-required" };
  if (fields.some((field) => field.length > 10_000)) return { error: "field-too-long" };

  const service = createServiceRoleClient();
  const { error } = await service.rpc("set_app_setting", {
    p_key: "payment_instructions",
    p_value: value,
    p_actor: user.id,
  });
  if (error) return { error: "save-failed" };

  revalidatePath("/admin/payments/settings");
  revalidatePath("/upgrade/pay/[tierSlug]", "page");
  return { ok: true };
}
