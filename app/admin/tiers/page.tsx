import { AdminTable, type AdminTableColumn } from "@/components/admin/AdminTable";
import { PricesEditor } from "@/components/admin/PricesEditor";
import { TierScopeFields } from "@/components/admin/TierScopeFields";
import { requireAdminPage } from "@/lib/admin/guard";
import type { Bi } from "@/lib/types";
import { setTierStatusAction, upsertTierAction } from "./actions";

interface TierRow { id: string; slug: string; title: Bi; scope_type: "all" | "track" | "subject"; scope_id: string | null; duration_days: number; prices: { currency: string; amount: number; country: string }[]; status: "published" | "hidden"; sort: number }

export default async function AdminTiersPage() {
  const { supabase } = await requireAdminPage();
  const [{ data, error }, { data: tracksData }, { data: subjectsData }] = await Promise.all([
    supabase.from("tiers").select("id, slug, title, scope_type, scope_id, duration_days, prices, status, sort").order("sort"),
    supabase.from("tracks").select("id, title").order("sort"),
    supabase.from("subjects").select("id, title").order("sort"),
  ]);
  if (error) throw new Error(error.message);
  const tiers = (data ?? []) as TierRow[];
  const tracks = (tracksData ?? []) as { id: string; title: Bi }[];
  const subjects = (subjectsData ?? []) as { id: string; title: Bi }[];
  const scopeName = (tier: TierRow) => tier.scope_type === "track" ? tracks.find((track) => track.id === tier.scope_id)?.title.en ?? tier.scope_id : subjects.find((subject) => subject.id === tier.scope_id)?.title.en ?? tier.scope_id;
  const columns: AdminTableColumn<TierRow>[] = [
    { key: "title", header: "Title", render: (tier) => tier.title.en },
    { key: "slug", header: "Slug", render: (tier) => <code className="text-xs">{tier.slug}</code> },
    { key: "scope", header: "Scope", render: (tier) => tier.scope_type === "all" ? "all" : `${tier.scope_type}: ${scopeName(tier)}` },
    { key: "duration", header: "Days", render: (tier) => tier.duration_days },
    { key: "prices", header: "Prices", render: (tier) => <span className="text-xs">{tier.prices.map((price) => `${price.amount} ${price.currency} (${price.country})`).join(", ") || "—"}</span> },
    { key: "status", header: "Status", render: (tier) => <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tier.status === "published" ? "bg-moss-soft text-moss" : "bg-amber-soft text-amber"}`}>{tier.status}</span> },
    { key: "actions", header: "Actions", render: (tier) => <form action={setTierStatusAction.bind(null, tier.id, tier.status === "published" ? "hidden" : "published")}><button className="rounded-md border border-line px-2 py-1 text-xs hover:bg-wash">{tier.status === "published" ? "Hide" : "Publish"}</button></form> },
  ];
  return (
    <div className="flex flex-col gap-6">
      <div><h1 className="font-display text-xl font-semibold text-ink">Tiers</h1><p className="text-sm text-ink-soft">Sellable access packages: scope, duration, and prices.</p></div>
      <AdminTable columns={columns} rows={tiers} rowKey={(tier) => tier.id} emptyMessage="No tiers yet." />
      <details className="rounded-xl border border-line bg-card p-4">
        <summary className="cursor-pointer text-sm font-semibold text-deniz-deep">New tier</summary>
        <form action={upsertTierAction} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">Slug<input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="term-all" className="rounded-lg border border-line bg-paper px-3 py-1.5" /></label>
          <TierScopeFields tracks={tracks} subjects={subjects} />
          <label className="flex flex-col gap-1 text-sm">Title (Turkish)<input name="title_tr" required className="rounded-lg border border-line bg-paper px-3 py-1.5" /></label>
          <label className="flex flex-col gap-1 text-sm">Title (English)<input name="title_en" required className="rounded-lg border border-line bg-paper px-3 py-1.5" /></label>
          <label className="flex flex-col gap-1 text-sm">Description (Turkish)<input name="description_tr" className="rounded-lg border border-line bg-paper px-3 py-1.5" /></label>
          <label className="flex flex-col gap-1 text-sm">Description (English)<input name="description_en" className="rounded-lg border border-line bg-paper px-3 py-1.5" /></label>
          <label className="flex flex-col gap-1 text-sm">Duration (days)<input name="duration_days" type="number" min={1} defaultValue={30} className="rounded-lg border border-line bg-paper px-3 py-1.5" /></label>
          <label className="flex flex-col gap-1 text-sm">Sort<input name="sort" type="number" defaultValue={0} className="rounded-lg border border-line bg-paper px-3 py-1.5" /></label>
          <div className="col-span-full"><p className="mb-1 text-sm font-medium">Prices</p><PricesEditor initial={[]} /></div>
          <button className="col-span-full w-fit rounded-lg bg-deniz px-4 py-2 text-sm font-semibold text-white hover:bg-deniz-deep">Create tier (hidden)</button>
        </form>
      </details>
    </div>
  );
}
