import { AdminTable, type AdminTableColumn } from "@/components/admin/AdminTable";
import { GenerateCodesForm } from "@/components/admin/GenerateCodesForm";
import { requireAdminPage } from "@/lib/admin/guard";
import type { Bi } from "@/lib/types";
import { revokeCodeBatchAction, revokeCodesAction } from "./actions";

interface CodeRow { id: string; tier_id: string; scope_type: string; max_redemptions: number; redeemed_count: number; valid_until: string | null; batch_id: string | null; note: string | null; revoked_at: string | null; created_at: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function AdminCodesPage({ searchParams }: { searchParams: Promise<{ batch?: string; status?: string }> }) {
  const { supabase } = await requireAdminPage();
  const { batch: rawBatch, status: rawStatus } = await searchParams;
  const batch = rawBatch && UUID.test(rawBatch) ? rawBatch : "";
  const status = rawStatus === "active" || rawStatus === "revoked" ? rawStatus : "all";
  const [{ data: tiersData }, { data: tracksData }, { data: subjectsData }] = await Promise.all([
    supabase.from("tiers").select("id, slug, title").order("sort"),
    supabase.from("tracks").select("id, title").order("sort"),
    supabase.from("subjects").select("id, title").order("sort"),
  ]);
  let query = supabase.from("access_codes").select("id, tier_id, scope_type, max_redemptions, redeemed_count, valid_until, batch_id, note, revoked_at, created_at").order("created_at", { ascending: false }).limit(200);
  if (batch) query = query.eq("batch_id", batch);
  if (status === "active") query = query.is("revoked_at", null);
  if (status === "revoked") query = query.not("revoked_at", "is", null);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const tiers = (tiersData ?? []) as { id: string; slug: string; title: Bi }[];
  const tracks = (tracksData ?? []) as { id: string; title: Bi }[];
  const subjects = (subjectsData ?? []) as { id: string; title: Bi }[];
  const codes = (data ?? []) as CodeRow[];
  const columns: AdminTableColumn<CodeRow>[] = [
    { key: "tier", header: "Tier", render: (code) => tiers.find((tier) => tier.id === code.tier_id)?.slug ?? code.tier_id },
    { key: "scope", header: "Scope", render: (code) => code.scope_type },
    { key: "redeemed", header: "Redeemed", render: (code) => `${code.redeemed_count}/${code.max_redemptions}` },
    { key: "valid", header: "Valid until", render: (code) => code.valid_until ? new Date(code.valid_until).toLocaleDateString("en-GB") : "no deadline" },
    { key: "batch", header: "Batch", render: (code) => <code className="text-[10px]">{code.batch_id?.slice(0, 8) ?? "—"}</code> },
    { key: "note", header: "Note", render: (code) => code.note || "—" },
    { key: "status", header: "Status", render: (code) => <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${code.revoked_at ? "bg-clay-soft text-clay" : "bg-moss-soft text-moss"}`}>{code.revoked_at ? "revoked" : "active"}</span> },
    { key: "actions", header: "", render: (code) => !code.revoked_at ? <form action={revokeCodesAction.bind(null, [code.id])}><button className="rounded-md border border-clay/40 px-2 py-1 text-xs text-clay hover:bg-clay-soft">Revoke</button></form> : null },
  ];
  return (
    <div className="flex flex-col gap-6">
      <div><h1 className="font-display text-xl font-semibold text-ink">Codes</h1><p className="text-sm text-ink-soft">Plaintext is shown once at generation. This list contains metadata only.</p></div>
      <GenerateCodesForm tiers={tiers} tracks={tracks} subjects={subjects} />
      <form className="flex flex-wrap items-end gap-2" action="/admin/codes">
        <label className="flex flex-col gap-1 text-xs">Batch id<input name="batch" defaultValue={rawBatch ?? ""} placeholder="UUID" className="w-72 rounded-lg border border-line bg-paper px-3 py-1.5 text-sm" /></label>
        <label className="flex flex-col gap-1 text-xs">Status<select name="status" defaultValue={status} className="rounded-lg border border-line bg-paper px-3 py-1.5 text-sm"><option value="all">all</option><option value="active">active</option><option value="revoked">revoked</option></select></label>
        <button className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-wash">Filter</button>
      </form>
      {batch && codes.some((code) => !code.revoked_at) && <form action={revokeCodeBatchAction.bind(null, batch)}><button className="rounded-lg border border-clay/40 px-3 py-1.5 text-sm text-clay hover:bg-clay-soft">Revoke all active codes in this batch</button></form>}
      <AdminTable columns={columns} rows={codes} rowKey={(code) => code.id} emptyMessage="No codes match." />
    </div>
  );
}
