import { notFound } from "next/navigation";
import { AdminTable, type AdminTableColumn } from "@/components/admin/AdminTable";
import { UploadUnitForm } from "@/components/admin/UploadUnitForm";
import { requireAdminPage } from "@/lib/admin/guard";
import type { Bi } from "@/lib/types";
import { setUnitStatusAction } from "../actions";

interface UnitRow {
  id: string;
  unitNumber: number;
  slug: string;
  title: Bi;
  status: "draft" | "published";
  version: number;
  updatedAt: string;
}

export default async function AdminSubjectDetailPage({ params }: { params: Promise<{ subjectId: string }> }) {
  const { supabase } = await requireAdminPage();
  const { subjectId } = await params;
  const { data: subject } = await supabase
    .from("subjects")
    .select("id, slug, title, section_order")
    .eq("id", subjectId)
    .single();
  if (!subject) notFound();

  const { data, error } = await supabase
    .from("units")
    .select("id, unit_number, slug, content, status, version, updated_at")
    .eq("subject_id", subjectId)
    .order("unit_number");
  if (error) throw new Error(error.message);

  const units: UnitRow[] = (data ?? []).map((unit) => ({
    id: unit.id,
    unitNumber: unit.unit_number,
    slug: unit.slug,
    title: (unit.content as { title?: Bi })?.title ?? { tr: "", en: "(untitled)" },
    status: unit.status,
    version: unit.version,
    updatedAt: unit.updated_at,
  }));
  const columns: AdminTableColumn<UnitRow>[] = [
    { key: "number", header: "#", render: (unit) => unit.unitNumber },
    { key: "slug", header: "Slug", render: (unit) => <code className="text-xs">{unit.slug}</code> },
    { key: "title", header: "Title", render: (unit) => unit.title.en },
    { key: "status", header: "Status", render: (unit) => <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${unit.status === "published" ? "bg-moss-soft text-moss" : "bg-amber-soft text-amber"}`}>{unit.status}</span> },
    { key: "preview", header: "Preview access", render: () => <span className="text-xs text-ink-soft">First-chosen lesson</span> },
    { key: "version", header: "Version", render: (unit) => unit.version },
    { key: "updated", header: "Updated", render: (unit) => new Date(unit.updatedAt).toLocaleString("en-GB") },
    {
      key: "actions",
      header: "Actions",
      render: (unit) => (
        <div className="flex flex-wrap gap-1">
          <a href={`/admin/preview/${subject.slug}/${unit.slug}`} target="_blank" rel="noreferrer" className="rounded-md border border-line px-2 py-1 text-xs hover:bg-wash">Preview</a>
          <form action={setUnitStatusAction.bind(null, unit.id, unit.status === "draft" ? "published" : "draft")}>
            <button className={`rounded-md border px-2 py-1 text-xs ${unit.status === "draft" ? "border-moss/40 text-moss hover:bg-moss-soft" : "border-amber/40 text-amber hover:bg-amber-soft"}`}>{unit.status === "draft" ? "Publish" : "Unpublish"}</button>
          </form>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-ink">{subject.title.en}</h1>
        <p className="text-sm text-ink-soft"><code>{subject.slug}</code> · section order: {subject.section_order}</p>
      </div>
      <div className="rounded-lg border border-deniz/20 bg-deniz-soft px-4 py-3 text-sm text-deniz-deep">
        Preview access follows Phase 4: each visitor or unentitled student chooses one complete published lesson. There is no global free-unit toggle.
      </div>
      <AdminTable columns={columns} rows={units} rowKey={(unit) => unit.id} emptyMessage="No units yet." />
      <div className="rounded-xl border border-line bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-deniz-deep">Upload a unit</h2>
        <UploadUnitForm subjectId={subject.id} />
      </div>
    </div>
  );
}
