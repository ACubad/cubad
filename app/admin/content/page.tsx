import Link from "next/link";
import { AdminTable, type AdminTableColumn } from "@/components/admin/AdminTable";
import { requireAdminPage } from "@/lib/admin/guard";
import type { Bi } from "@/lib/types";
import { createSubjectAction, setSubjectStatusAction } from "./actions";

interface SubjectRow {
  id: string;
  slug: string;
  title: Bi;
  status: "draft" | "published" | "archived";
  sort: number;
  units: { count: number }[];
}

interface TrackOption {
  id: string;
  title: Bi;
}

export default async function AdminContentPage() {
  const { supabase } = await requireAdminPage();
  const [{ data: subjectsData, error }, { data: tracksData, error: tracksError }] =
    await Promise.all([
      supabase.from("subjects").select("id, slug, title, status, sort, units(count)").order("sort"),
      supabase.from("tracks").select("id, title").order("sort"),
    ]);
  if (error) throw new Error(error.message);
  if (tracksError) throw new Error(tracksError.message);

  const subjects = (subjectsData ?? []) as unknown as SubjectRow[];
  const tracks = (tracksData ?? []) as TrackOption[];
  const columns: AdminTableColumn<SubjectRow>[] = [
    { key: "title", header: "Title", render: (subject) => <span className="font-medium">{subject.title.en}</span> },
    { key: "slug", header: "Slug", render: (subject) => <code className="text-xs">{subject.slug}</code> },
    {
      key: "status",
      header: "Status",
      render: (subject) => (
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${subject.status === "published" ? "bg-moss-soft text-moss" : subject.status === "archived" ? "bg-clay-soft text-clay" : "bg-amber-soft text-amber"}`}>
          {subject.status}
        </span>
      ),
    },
    { key: "units", header: "Units", render: (subject) => subject.units?.[0]?.count ?? 0 },
    { key: "sort", header: "Sort", render: (subject) => subject.sort },
    {
      key: "actions",
      header: "Actions",
      render: (subject) => (
        <div className="flex flex-wrap gap-1">
          <Link href={`/admin/content/${subject.id}`} className="rounded-md border border-line px-2 py-1 text-xs hover:bg-wash">Open</Link>
          {subject.status !== "published" && (
            <form action={setSubjectStatusAction.bind(null, subject.id, "published")}>
              <button className="rounded-md border border-moss/40 px-2 py-1 text-xs text-moss hover:bg-moss-soft">Publish</button>
            </form>
          )}
          {subject.status === "published" && (
            <form action={setSubjectStatusAction.bind(null, subject.id, "draft")}>
              <button className="rounded-md border border-amber/40 px-2 py-1 text-xs text-amber hover:bg-amber-soft">Unpublish</button>
            </form>
          )}
          {subject.status !== "archived" && (
            <form action={setSubjectStatusAction.bind(null, subject.id, "archived")}>
              <button className="rounded-md border border-clay/40 px-2 py-1 text-xs text-clay hover:bg-clay-soft">Archive</button>
            </form>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-ink">Content</h1>
        <p className="text-sm text-ink-soft">Manage subjects and open their unit publishing workflow.</p>
      </div>
      <AdminTable columns={columns} rows={subjects} rowKey={(subject) => subject.id} emptyMessage="No subjects yet." />
      <details className="rounded-xl border border-line bg-card p-4">
        <summary className="cursor-pointer text-sm font-semibold text-deniz-deep">New subject</summary>
        <form action={createSubjectAction} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">Slug<input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="e.g. hidroloji" className="rounded-lg border border-line bg-paper px-3 py-1.5" /></label>
          <label className="flex flex-col gap-1 text-sm">Section order<select name="section_order" className="rounded-lg border border-line bg-paper px-3 py-1.5"><option value="study">study</option><option value="walkthrough">walkthrough</option></select></label>
          <label className="flex flex-col gap-1 text-sm">Title (Turkish)<input name="title_tr" required className="rounded-lg border border-line bg-paper px-3 py-1.5" /></label>
          <label className="flex flex-col gap-1 text-sm">Title (English)<input name="title_en" required className="rounded-lg border border-line bg-paper px-3 py-1.5" /></label>
          <label className="flex flex-col gap-1 text-sm">Tagline (Turkish)<input name="tagline_tr" required className="rounded-lg border border-line bg-paper px-3 py-1.5" /></label>
          <label className="flex flex-col gap-1 text-sm">Tagline (English)<input name="tagline_en" required className="rounded-lg border border-line bg-paper px-3 py-1.5" /></label>
          <label className="flex flex-col gap-1 text-sm">Sort<input name="sort" type="number" defaultValue={0} className="rounded-lg border border-line bg-paper px-3 py-1.5" /></label>
          <fieldset className="col-span-full text-sm">
            <legend className="mb-1 font-medium">Tracks</legend>
            <div className="flex flex-wrap gap-3">
              {tracks.map((track) => <label key={track.id} className="flex items-center gap-1.5"><input type="checkbox" name="track_ids" value={track.id} />{track.title.en}</label>)}
              {tracks.length === 0 && <p className="text-ink-faint">No tracks yet. Create one in Catalog first.</p>}
            </div>
          </fieldset>
          <button type="submit" className="col-span-full w-fit rounded-lg bg-deniz px-4 py-2 text-sm font-semibold text-white hover:bg-deniz-deep">Create subject (draft)</button>
        </form>
      </details>
    </div>
  );
}
