import { AdminTable, type AdminTableColumn } from "@/components/admin/AdminTable";
import { requireAdminPage } from "@/lib/admin/guard";
import type { Bi } from "@/lib/types";
import { createTrackAction, setTrackStatusAction, setTrackSubjectsAction } from "./actions";

interface TrackRow {
  id: string;
  country_code: string;
  system: string;
  level: string;
  title: Bi;
  status: "published" | "hidden";
  sort: number;
}

interface SubjectOption { id: string; slug: string; title: Bi }

export default async function AdminCatalogPage() {
  const { supabase } = await requireAdminPage();
  const [{ data: tracksData, error }, { data: subjectsData, error: subjectsError }, { data: assignmentsData, error: assignmentsError }] = await Promise.all([
    supabase.from("tracks").select("id, country_code, system, level, title, status, sort").order("sort"),
    supabase.from("subjects").select("id, slug, title").order("sort"),
    supabase.from("track_subjects").select("track_id, subject_id"),
  ]);
  if (error) throw new Error(error.message);
  if (subjectsError) throw new Error(subjectsError.message);
  if (assignmentsError) throw new Error(assignmentsError.message);
  const tracks = (tracksData ?? []) as TrackRow[];
  const subjects = (subjectsData ?? []) as SubjectOption[];
  const assignedByTrack = new Map<string, Set<string>>();
  for (const row of (assignmentsData ?? []) as { track_id: string; subject_id: string }[]) {
    const assigned = assignedByTrack.get(row.track_id) ?? new Set<string>();
    assigned.add(row.subject_id);
    assignedByTrack.set(row.track_id, assigned);
  }

  const columns: AdminTableColumn<TrackRow>[] = [
    { key: "title", header: "Title", render: (track) => track.title.en },
    { key: "country", header: "Country", render: (track) => track.country_code },
    { key: "system", header: "System", render: (track) => track.system },
    { key: "level", header: "Level", render: (track) => track.level },
    { key: "status", header: "Status", render: (track) => <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${track.status === "published" ? "bg-moss-soft text-moss" : "bg-amber-soft text-amber"}`}>{track.status}</span> },
    { key: "sort", header: "Sort", render: (track) => track.sort },
    { key: "actions", header: "Actions", render: (track) => <form action={setTrackStatusAction.bind(null, track.id, track.status === "published" ? "hidden" : "published")}><button className="rounded-md border border-line px-2 py-1 text-xs hover:bg-wash">{track.status === "published" ? "Hide" : "Publish"}</button></form> },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div><h1 className="font-display text-xl font-semibold text-ink">Catalog</h1><p className="text-sm text-ink-soft">Tracks and the subjects available in each one.</p></div>
      <AdminTable columns={columns} rows={tracks} rowKey={(track) => track.id} emptyMessage="No tracks yet." />
      <details className="rounded-xl border border-line bg-card p-4">
        <summary className="cursor-pointer text-sm font-semibold text-deniz-deep">New track</summary>
        <form action={createTrackAction} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">Country code<input name="country_code" required maxLength={2} placeholder="TZ" className="rounded-lg border border-line bg-paper px-3 py-1.5 uppercase" /></label>
          <label className="flex flex-col gap-1 text-sm">System<input name="system" required placeholder="NECTA CSEE" className="rounded-lg border border-line bg-paper px-3 py-1.5" /></label>
          <label className="flex flex-col gap-1 text-sm">Level<input name="level" required placeholder="Form 4" className="rounded-lg border border-line bg-paper px-3 py-1.5" /></label>
          <label className="flex flex-col gap-1 text-sm">Sort<input name="sort" type="number" defaultValue={0} className="rounded-lg border border-line bg-paper px-3 py-1.5" /></label>
          <label className="flex flex-col gap-1 text-sm">Title (Turkish)<input name="title_tr" required className="rounded-lg border border-line bg-paper px-3 py-1.5" /></label>
          <label className="flex flex-col gap-1 text-sm">Title (English)<input name="title_en" required className="rounded-lg border border-line bg-paper px-3 py-1.5" /></label>
          <button className="col-span-full w-fit rounded-lg bg-deniz px-4 py-2 text-sm font-semibold text-white hover:bg-deniz-deep">Create track (hidden)</button>
        </form>
      </details>
      <div className="flex flex-col gap-4">
        <h2 className="font-display text-lg font-semibold text-ink">Subject assignment per track</h2>
        {tracks.map((track) => {
          const assigned = assignedByTrack.get(track.id) ?? new Set<string>();
          return (
            <form key={track.id} action={setTrackSubjectsAction.bind(null, track.id)} className="rounded-xl border border-line bg-card p-4">
              <p className="mb-2 text-sm font-semibold text-deniz-deep">{track.title.en}</p>
              <div className="flex flex-wrap gap-3 text-sm">
                {subjects.map((subject) => <label key={subject.id} className="flex items-center gap-1.5"><input type="checkbox" name="subject_ids" value={subject.id} defaultChecked={assigned.has(subject.id)} />{subject.title.en}</label>)}
                {subjects.length === 0 && <p className="text-ink-faint">No subjects yet.</p>}
              </div>
              <button className="mt-3 rounded-md border border-deniz/40 px-3 py-1.5 text-xs font-semibold text-deniz-deep hover:bg-deniz-soft">Save assignment</button>
            </form>
          );
        })}
      </div>
    </div>
  );
}
