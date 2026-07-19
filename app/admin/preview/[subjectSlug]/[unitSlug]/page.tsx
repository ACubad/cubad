import { notFound } from "next/navigation";
import { UnitPage } from "@/components/UnitPage";
import { requireAdminPage } from "@/lib/admin/guard";
import { toSubjectMeta, toUnit } from "@/lib/content-db";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminPreviewPage({ params }: { params: Promise<{ subjectSlug: string; unitSlug: string }> }) {
  await requireAdminPage();
  const { subjectSlug, unitSlug } = await params;
  const supabase = createServiceRoleClient();

  const { data: subjectRow, error: subjectError } = await supabase
    .from("subjects")
    .select("id, slug, title, tagline, section_order")
    .eq("slug", subjectSlug)
    .single();
  if (subjectError || !subjectRow) notFound();

  const { data: unitRow, error: unitError } = await supabase
    .from("units")
    .select("content, status, version")
    .eq("subject_id", subjectRow.id)
    .eq("slug", unitSlug)
    .single();
  if (unitError || !unitRow) notFound();

  const subject = toSubjectMeta(subjectRow);
  const unit = toUnit(unitRow);
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-amber/30 bg-amber-soft px-4 py-2 text-sm text-amber">
        Draft preview — status: <strong>{unitRow.status}</strong>, version {unitRow.version}. This uncached admin route does not alter student access.
      </div>
      <UnitPage subject={subject} unit={unit} />
    </div>
  );
}
