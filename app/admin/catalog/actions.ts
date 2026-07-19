"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/admin/guard";
import { revalidateContent } from "@/lib/content-db";
import type { Bi } from "@/lib/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function setTrackStatusAction(trackId: string, status: "published" | "hidden") {
  const { supabase } = await requireAdminAction();
  if (!UUID.test(trackId)) throw new Error("invalid track id");
  if (!["published", "hidden"].includes(status)) throw new Error("invalid status");
  const { error } = await supabase.rpc("admin_set_status", {
    p_table: "tracks",
    p_id: trackId,
    p_status: status,
  });
  if (error) throw new Error(error.message);
  revalidateContent();
  revalidatePath("/admin/catalog");
}

export async function createTrackAction(formData: FormData) {
  const { supabase } = await requireAdminAction();
  const countryCode = String(formData.get("country_code") ?? "").trim().toUpperCase();
  const system = String(formData.get("system") ?? "").trim();
  const level = String(formData.get("level") ?? "").trim();
  const titleTr = String(formData.get("title_tr") ?? "").trim();
  const titleEn = String(formData.get("title_en") ?? "").trim();
  const sort = Number(formData.get("sort") ?? 0);
  if (!/^[A-Z]{2}$/.test(countryCode)) throw new Error("country_code must be a 2-letter ISO code");
  if (!system || !level) throw new Error("system and level are required");
  if (!titleTr || !titleEn) throw new Error("title (tr + en) is required");
  if (!Number.isInteger(sort)) throw new Error("sort must be an integer");
  const title: Bi = { tr: titleTr, en: titleEn };
  const { error } = await supabase.rpc("admin_upsert_track", {
    p_id: null,
    p_country_code: countryCode,
    p_system: system,
    p_level: level,
    p_title: title,
    p_sort: sort,
  });
  if (error) throw new Error(error.message);
  revalidateContent();
  revalidatePath("/admin/catalog");
}

export async function setTrackSubjectsAction(trackId: string, formData: FormData) {
  const { supabase } = await requireAdminAction();
  if (!UUID.test(trackId)) throw new Error("invalid track id");
  const subjectIds = formData.getAll("subject_ids").map(String);
  if (subjectIds.some((id) => !UUID.test(id))) throw new Error("invalid subject id");
  const { error } = await supabase.rpc("admin_set_track_subjects", {
    p_track_id: trackId,
    p_subject_ids: subjectIds,
  });
  if (error) throw new Error(error.message);
  revalidateContent();
  revalidatePath("/admin/catalog");
}
