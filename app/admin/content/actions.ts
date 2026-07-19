"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminAction } from "@/lib/admin/guard";
import { revalidateContent } from "@/lib/content-db";
import type { Bi } from "@/lib/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function setSubjectStatusAction(
  subjectId: string,
  status: "draft" | "published" | "archived"
) {
  const { supabase } = await requireAdminAction();
  if (!UUID.test(subjectId)) throw new Error("invalid subject id");
  if (!["draft", "published", "archived"].includes(status)) throw new Error("invalid status");

  const { data: subject, error: lookupError } = await supabase
    .from("subjects")
    .select("slug")
    .eq("id", subjectId)
    .single();
  if (lookupError || !subject) throw new Error("subject not found");

  const { error } = await supabase.rpc("admin_set_status", {
    p_table: "subjects",
    p_id: subjectId,
    p_status: status,
  });
  if (error) throw new Error(error.message);
  revalidateContent(subject.slug);
  revalidatePath("/admin/content");
}

export async function createSubjectAction(formData: FormData) {
  const { supabase } = await requireAdminAction();
  const slug = String(formData.get("slug") ?? "").trim();
  const titleTr = String(formData.get("title_tr") ?? "").trim();
  const titleEn = String(formData.get("title_en") ?? "").trim();
  const taglineTr = String(formData.get("tagline_tr") ?? "").trim();
  const taglineEn = String(formData.get("tagline_en") ?? "").trim();
  const sectionOrder = String(formData.get("section_order") ?? "study");
  const sort = Number(formData.get("sort") ?? 0);
  const trackIds = formData.getAll("track_ids").map(String);

  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new Error("slug must be lowercase-kebab-case");
  if (!titleTr || !titleEn) throw new Error("title (tr + en) is required");
  if (!taglineTr || !taglineEn) throw new Error("tagline (tr + en) is required");
  if (!["walkthrough", "study"].includes(sectionOrder)) throw new Error("invalid section_order");
  if (!Number.isInteger(sort)) throw new Error("sort must be an integer");
  if (trackIds.some((id) => !UUID.test(id))) throw new Error("invalid track id");

  const title: Bi = { tr: titleTr, en: titleEn };
  const tagline: Bi = { tr: taglineTr, en: taglineEn };
  const { error } = await supabase.rpc("admin_upsert_subject", {
    p_id: null,
    p_slug: slug,
    p_title: title,
    p_tagline: tagline,
    p_section_order: sectionOrder,
    p_sort: sort,
    p_track_ids: trackIds,
  });
  if (error) throw new Error(error.message);

  revalidateContent();
  revalidatePath("/admin/content");
  redirect("/admin/content");
}
