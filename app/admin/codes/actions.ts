"use server";

import { revalidatePath } from "next/cache";
import { generateCode, hashCode } from "@/lib/access/codes";
import { requireAdminAction } from "@/lib/admin/guard";

export interface GeneratedCode { code: string; tier: string; scope: string; durationDays: number; validUntil: string | null }
export type GenerateCodesState = { status: "idle" } | { status: "error"; error: string } | { status: "ok"; codes: GeneratedCode[] };
const MAX_BATCH = 500;
const MAX_RETRY_ROUNDS = 5;

export async function generateCodesAction(_previous: GenerateCodesState, formData: FormData): Promise<GenerateCodesState> {
  const { supabase } = await requireAdminAction();
  const tierId = String(formData.get("tier_id") ?? "");
  const scopeType = String(formData.get("scope_type") ?? "all");
  const scopeId = scopeType === "all" ? null : String(formData.get("scope_id") ?? "") || null;
  const requestedCount = Number(formData.get("count") ?? 1);
  const durationRaw = String(formData.get("duration_days") ?? "").trim();
  const validUntilRaw = String(formData.get("valid_until") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);
  if (!tierId) return { status: "error", error: "pick a tier" };
  if (!["all", "track", "subject"].includes(scopeType)) return { status: "error", error: "invalid scope" };
  if (scopeType !== "all" && !scopeId) return { status: "error", error: "pick a scope" };
  if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > MAX_BATCH) return { status: "error", error: "count must be an integer from 1 to 500" };
  let validUntil: string | null = null;
  if (validUntilRaw) {
    const date = new Date(`${validUntilRaw}T23:59:59.999Z`);
    if (!Number.isFinite(date.getTime()) || date <= new Date()) return { status: "error", error: "valid-until date must be in the future" };
    validUntil = date.toISOString();
  }
  const { data: tier, error: tierError } = await supabase.from("tiers").select("slug, duration_days").eq("id", tierId).single();
  if (tierError || !tier) return { status: "error", error: "tier not found" };
  const durationDays = durationRaw ? Number(durationRaw) : tier.duration_days;
  if (!Number.isInteger(durationDays) || durationDays <= 0) return { status: "error", error: "duration must be a positive integer" };

  const batchId = crypto.randomUUID();
  const plaintextByHash = new Map<string, string>();
  const insertedHashes = new Set<string>();
  let rounds = 0;
  while (insertedHashes.size < requestedCount && rounds < MAX_RETRY_ROUNDS) {
    rounds += 1;
    const hashes: string[] = [];
    for (let index = insertedHashes.size; index < requestedCount; index += 1) {
      const plaintext = generateCode();
      const hash = hashCode(plaintext);
      plaintextByHash.set(hash, plaintext);
      hashes.push(hash);
    }
    const { data, error } = await supabase.rpc("admin_generate_codes", { p_tier_id: tierId, p_scope_type: scopeType, p_scope_id: scopeId, p_duration_days: durationDays, p_max_redemptions: 1, p_valid_until: validUntil, p_note: note, p_batch_id: batchId, p_code_hashes: hashes });
    if (error) return { status: "error", error: error.message };
    for (const row of (data as { code_hash: string }[]) ?? []) insertedHashes.add(row.code_hash);
  }
  if (insertedHashes.size !== requestedCount) return { status: "error", error: `only generated ${insertedHashes.size}/${requestedCount} codes after ${MAX_RETRY_ROUNDS} retry rounds` };
  const codes = Array.from(insertedHashes, (hash) => ({ code: plaintextByHash.get(hash)!, tier: tier.slug, scope: scopeType, durationDays, validUntil }));
  revalidatePath("/admin/codes");
  return { status: "ok", codes };
}

export async function revokeCodesAction(codeIds: string[]) {
  const { supabase } = await requireAdminAction();
  if (codeIds.length < 1 || codeIds.length > 500) throw new Error("invalid revoke batch");
  const { error } = await supabase.rpc("admin_revoke", { p_table: "access_codes", p_ids: codeIds });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/codes");
}

export async function revokeCodeBatchAction(batchId: string) {
  const { supabase } = await requireAdminAction();
  const { data, error } = await supabase.from("access_codes").select("id").eq("batch_id", batchId).is("revoked_at", null).limit(MAX_BATCH);
  if (error) throw new Error(error.message);
  const ids = (data ?? []).map((row) => row.id);
  if (ids.length === 0) return;
  const { error: revokeError } = await supabase.rpc("admin_revoke", { p_table: "access_codes", p_ids: ids });
  if (revokeError) throw new Error(revokeError.message);
  revalidatePath("/admin/codes");
}
