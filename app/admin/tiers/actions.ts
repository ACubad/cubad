"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/admin/guard";
import type { Bi } from "@/lib/types";

interface PriceRow { currency: string; amount: number; country: string }

function parsePrices(raw: string): PriceRow[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("prices: invalid JSON"); }
  if (!Array.isArray(parsed)) throw new Error("prices: must be an array");
  return parsed.map((value, index) => {
    const row = value as Partial<PriceRow>;
    if (typeof row.currency !== "string" || !/^[A-Z]{3}$/.test(row.currency)) throw new Error(`prices[${index}].currency: must be a 3-letter code`);
    if (typeof row.amount !== "number" || !Number.isFinite(row.amount) || row.amount < 0) throw new Error(`prices[${index}].amount: must be a non-negative number`);
    if (typeof row.country !== "string" || !(row.country === "*" || /^[A-Z]{2}$/.test(row.country))) throw new Error(`prices[${index}].country: must be a 2-letter code or "*"`);
    return { currency: row.currency, amount: row.amount, country: row.country };
  });
}

export async function setTierStatusAction(tierId: string, status: "published" | "hidden") {
  const { supabase } = await requireAdminAction();
  const { error } = await supabase.rpc("admin_set_status", { p_table: "tiers", p_id: tierId, p_status: status });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/tiers");
  revalidatePath("/upgrade");
}

export async function upsertTierAction(formData: FormData) {
  const { supabase } = await requireAdminAction();
  const id = String(formData.get("id") ?? "") || null;
  const slug = String(formData.get("slug") ?? "").trim();
  const titleTr = String(formData.get("title_tr") ?? "").trim();
  const titleEn = String(formData.get("title_en") ?? "").trim();
  const description: Bi = { tr: String(formData.get("description_tr") ?? "").trim(), en: String(formData.get("description_en") ?? "").trim() };
  const scopeType = String(formData.get("scope_type") ?? "all");
  const scopeId = scopeType === "all" ? null : String(formData.get("scope_id") ?? "") || null;
  const durationDays = Number(formData.get("duration_days") ?? 30);
  const sort = Number(formData.get("sort") ?? 0);
  const prices = parsePrices(String(formData.get("prices_json") ?? "[]"));
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new Error("slug must be lowercase-kebab-case");
  if (!titleTr || !titleEn) throw new Error("title (tr + en) is required");
  if (!["all", "track", "subject"].includes(scopeType)) throw new Error("invalid scope_type");
  if (scopeType !== "all" && !scopeId) throw new Error("pick the track/subject this tier targets");
  if (!Number.isInteger(durationDays) || durationDays <= 0) throw new Error("duration_days must be a positive integer");
  if (!Number.isInteger(sort)) throw new Error("sort must be an integer");
  const title: Bi = { tr: titleTr, en: titleEn };
  const { error } = await supabase.rpc("admin_upsert_tier", { p_id: id, p_slug: slug, p_title: title, p_description: description, p_scope_type: scopeType, p_scope_id: scopeId, p_duration_days: durationDays, p_prices: prices, p_sort: sort });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/tiers");
  revalidatePath("/upgrade");
}
