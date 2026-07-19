import { requireAdminPage } from "@/lib/admin/guard";

interface OverviewStats {
  total_users: number;
  onboarded_users: number;
  active_entitlements: number;
  pending_claims: number;
  codes_redeemed_30d: number;
  dau_proxy: number;
}

const CARDS: { key: keyof OverviewStats; label: string; hint: string }[] = [
  { key: "total_users", label: "Total users", hint: "All signed-up accounts" },
  { key: "onboarded_users", label: "Onboarded", hint: "Completed the onboarding wizard" },
  { key: "active_entitlements", label: "Active entitlements", hint: "Unrevoked and within its date range" },
  { key: "pending_claims", label: "Pending claims", hint: "Awaiting review in Phase 6" },
  { key: "codes_redeemed_30d", label: "Codes redeemed (30d)", hint: "Redemptions during the last 30 days" },
  { key: "dau_proxy", label: "Active today (proxy)", hint: "Study state touched in the last 24 hours" },
];

export default async function AdminOverviewPage() {
  const { supabase } = await requireAdminPage();
  const { data, error } = await supabase.rpc("admin_overview_stats");

  if (error) throw new Error(error.message);
  const stats = data as OverviewStats;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-ink">Overview</h1>
        <p className="text-sm text-ink-soft">Live SQL aggregates for the current product state.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((card) => (
          <div key={card.key} className="rounded-xl border border-line bg-card p-4">
            <p className="text-2xl font-semibold text-deniz-deep">{stats[card.key]}</p>
            <p className="text-sm font-medium text-ink">{card.label}</p>
            <p className="text-xs text-ink-faint">{card.hint}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
