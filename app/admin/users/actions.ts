"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/admin/guard";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function grantEntitlementAction(userId: string, formData: FormData) {
  const { supabase } = await requireAdminAction();
  const scopeType = String(formData.get("scope_type") ?? "all");
  const scopeId = scopeType === "all" ? null : String(formData.get("scope_id") ?? "") || null;
  const tierId = String(formData.get("tier_id") ?? "");
  const durationDays = Number(formData.get("duration_days") ?? 30);
  if (!UUID.test(userId)) throw new Error("invalid user id");
  if (!["all", "track", "subject"].includes(scopeType)) throw new Error("invalid scope");
  if (scopeType !== "all" && (!scopeId || !UUID.test(scopeId))) throw new Error("pick a valid scope");
  if (!UUID.test(tierId)) throw new Error("pick a tier");
  if (!Number.isInteger(durationDays) || durationDays <= 0) throw new Error("duration must be a positive integer");
  const { error } = await supabase.rpc("admin_grant_entitlement", { p_user_id: userId, p_scope_type: scopeType, p_scope_id: scopeId, p_tier_id: tierId, p_duration_days: durationDays });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/users/${userId}`);
}

export async function revokeEntitlementAction(userId: string, entitlementId: string) {
  const { supabase } = await requireAdminAction();
  if (!UUID.test(userId) || !UUID.test(entitlementId)) throw new Error("invalid entitlement id");
  const { data: entitlement, error: lookupError } = await supabase.from("entitlements").select("user_id").eq("id", entitlementId).single();
  if (lookupError || entitlement?.user_id !== userId) throw new Error("entitlement not found for user");
  const { error } = await supabase.rpc("admin_revoke", { p_table: "entitlements", p_ids: [entitlementId] });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/users/${userId}`);
}
