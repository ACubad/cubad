"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ensurePreviewCapabilityHash } from "@/lib/access/preview-cookie";
import { claimPreviewForCurrentRequest } from "@/lib/access/preview";
import { getUnitMeta } from "@/lib/content-db";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Explicit POST mutation: the first chosen published unit becomes this browser/account's preview. */
export async function choosePreviewAction(formData: FormData): Promise<void> {
  const subjectSlug = String(formData.get("subject") ?? "");
  const unitSlug = String(formData.get("unit") ?? "");
  if (!SLUG_RE.test(subjectSlug) || !SLUG_RE.test(unitSlug)) redirect("/");

  const meta = await getUnitMeta(subjectSlug, unitSlug);
  if (!meta) redirect(`/s/${subjectSlug}`);

  await ensurePreviewCapabilityHash();
  await claimPreviewForCurrentRequest(meta.id);

  revalidatePath("/", "layout");
  redirect(`/s/${subjectSlug}/unit/${unitSlug}`);
}
