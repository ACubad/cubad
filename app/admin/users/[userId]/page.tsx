import { notFound } from "next/navigation";
import { AdminTable, type AdminTableColumn } from "@/components/admin/AdminTable";
import { EntitlementScopeFields } from "@/components/admin/EntitlementScopeFields";
import { requireAdminPage } from "@/lib/admin/guard";
import type { Bi } from "@/lib/types";
import { grantEntitlementAction, revokeEntitlementAction } from "../actions";

interface EntitlementRow { id: string; scope_type: "all" | "track" | "subject"; scope_id: string | null; tier_id: string | null; starts_at: string; expires_at: string; source: "code" | "admin" | "payment"; revoked_at: string | null }

export default async function AdminUserDetailPage({ params }: { params: Promise<{ userId: string }> }) {
  const { supabase } = await requireAdminPage();
  const { userId } = await params;
  const { data: profile } = await supabase.from("profiles").select("user_id, email, full_name, phone, country_code, preferred_lang, role, track_id, onboarded_at, created_at").eq("user_id", userId).single();
  if (!profile) notFound();
  const [{ data: entitlementsData, error }, { data: redemptionsData }, { data: tiersData }, { data: tracksData }, { data: subjectsData }] = await Promise.all([
    supabase.from("entitlements").select("id, scope_type, scope_id, tier_id, starts_at, expires_at, source, revoked_at").eq("user_id", userId).order("created_at", { ascending: false }),
    supabase.from("code_redemptions").select("id, created_at, code_id").eq("user_id", userId).order("created_at", { ascending: false }),
    supabase.from("tiers").select("id, slug, title").order("sort"),
    supabase.from("tracks").select("id, title").order("sort"),
    supabase.from("subjects").select("id, title").order("sort"),
  ]);
  if (error) throw new Error(error.message);
  const entitlements = (entitlementsData ?? []) as EntitlementRow[];
  const tiers = (tiersData ?? []) as { id: string; slug: string; title: Bi }[];
  const tracks = (tracksData ?? []) as { id: string; title: Bi }[];
  const subjects = (subjectsData ?? []) as { id: string; title: Bi }[];
  const titleForTier = (id: string | null) => tiers.find((tier) => tier.id === id)?.title.en ?? "—";
  const scopeLabel = (entitlement: EntitlementRow) => entitlement.scope_type === "all" ? "all" : `${entitlement.scope_type}: ${(entitlement.scope_type === "track" ? tracks : subjects).find((item) => item.id === entitlement.scope_id)?.title.en ?? entitlement.scope_id}`;
  const columns: AdminTableColumn<EntitlementRow>[] = [
    { key: "scope", header: "Scope", render: scopeLabel },
    { key: "tier", header: "Tier", render: (entitlement) => titleForTier(entitlement.tier_id) },
    { key: "starts", header: "Starts", render: (entitlement) => new Date(entitlement.starts_at).toLocaleDateString("en-GB") },
    { key: "expires", header: "Expires", render: (entitlement) => new Date(entitlement.expires_at).toLocaleDateString("en-GB") },
    { key: "source", header: "Source", render: (entitlement) => entitlement.source },
    { key: "status", header: "Status", render: (entitlement) => { const active = !entitlement.revoked_at && new Date(entitlement.expires_at) > new Date(); return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${active ? "bg-moss-soft text-moss" : "bg-wash text-ink-soft"}`}>{entitlement.revoked_at ? "revoked" : active ? "active" : "expired"}</span>; } },
    { key: "actions", header: "", render: (entitlement) => !entitlement.revoked_at ? <form action={revokeEntitlementAction.bind(null, profile.user_id, entitlement.id)}><button className="rounded-md border border-clay/40 px-2 py-1 text-xs text-clay hover:bg-clay-soft">Revoke</button></form> : null },
  ];
  return (
    <div className="flex flex-col gap-6">
      <div><h1 className="font-display text-xl font-semibold text-ink">{profile.email}</h1><p className="text-sm text-ink-soft">{profile.full_name || "(no name)"} · {profile.country_code || "—"} · role: {profile.role} · {profile.onboarded_at ? "onboarded" : "not onboarded"}</p></div>
      <section><h2 className="mb-2 text-sm font-semibold text-deniz-deep">Entitlements</h2><AdminTable columns={columns} rows={entitlements} rowKey={(entitlement) => entitlement.id} emptyMessage="No entitlements." /></section>
      <section className="rounded-xl border border-line bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-deniz-deep">Grant entitlement</h2>
        <form action={grantEntitlementAction.bind(null, profile.user_id)} className="grid gap-3 sm:grid-cols-2">
          <EntitlementScopeFields tracks={tracks} subjects={subjects} />
          <label className="flex flex-col gap-1 text-sm">Tier<select name="tier_id" required className="rounded-lg border border-line bg-paper px-3 py-1.5">{tiers.map((tier) => <option key={tier.id} value={tier.id}>{tier.title.en} ({tier.slug})</option>)}</select></label>
          <label className="flex flex-col gap-1 text-sm">Duration (days)<input name="duration_days" type="number" min={1} defaultValue={30} className="rounded-lg border border-line bg-paper px-3 py-1.5" /></label>
          <button className="col-span-full w-fit rounded-lg bg-deniz px-4 py-2 text-sm font-semibold text-white hover:bg-deniz-deep">Grant</button>
        </form>
      </section>
      <section><h2 className="mb-2 text-sm font-semibold text-deniz-deep">Redemptions</h2><p className="text-sm text-ink-soft">{(redemptionsData ?? []).length} code(s) redeemed by this user.</p></section>
      <section><h2 className="mb-2 text-sm font-semibold text-deniz-deep">Payment claims</h2><p className="text-sm text-ink-soft">Phase 6 adds claim history and review controls here.</p></section>
    </div>
  );
}
