import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

const STATUSES = ["pending", "approved", "rejected"] as const;
const METHODS = ["mpesa", "tigopesa", "airtelmoney", "bank", "other"] as const;

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; method?: string }>;
}) {
  const queryParams = await searchParams;
  const status = STATUSES.includes(queryParams.status as (typeof STATUSES)[number])
    ? queryParams.status || ""
    : "";
  const method = METHODS.includes(queryParams.method as (typeof METHODS)[number])
    ? queryParams.method || ""
    : "";
  const supabase = await createClient();

  let query = supabase
    .from("payment_claims")
    .select("id,user_id,tier_id,amount,currency,method,status,created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (status) query = query.eq("status", status);
  if (method) query = query.eq("method", method);
  const { data: claims, error: claimsError } = await query;
  if (claimsError) throw new Error(`payment queue failed: ${claimsError.message}`);

  const rows = [...(claims ?? [])].sort((left, right) => {
    const leftRank = left.status === "pending" ? 0 : 1;
    const rightRank = right.status === "pending" ? 0 : 1;
    return leftRank - rightRank;
  });
  const tierIds = [...new Set(rows.map((row) => row.tier_id as string))];
  const userIds = [...new Set(rows.map((row) => row.user_id as string))];
  const [{ data: tiers, error: tiersError }, { data: profiles, error: profilesError }] =
    await Promise.all([
      tierIds.length
        ? supabase.from("tiers").select("id,title").in("id", tierIds)
        : Promise.resolve({ data: [] as { id: string; title: unknown }[], error: null }),
      userIds.length
        ? supabase.from("profiles").select("user_id,full_name").in("user_id", userIds)
        : Promise.resolve({ data: [] as { user_id: string; full_name: string }[], error: null }),
    ]);
  if (tiersError) throw new Error(`payment tier lookup failed: ${tiersError.message}`);
  if (profilesError) throw new Error(`payment student lookup failed: ${profilesError.message}`);
  const tierMap = new Map(
    (tiers ?? []).map((tier) => [tier.id as string, tier.title as { en?: string }])
  );
  const studentMap = new Map(
    (profiles ?? []).map((profile) => [profile.user_id as string, profile.full_name as string])
  );

  const filterHref = (patch: { status?: string; method?: string }) => {
    const params = new URLSearchParams();
    const nextStatus = patch.status ?? status;
    const nextMethod = patch.method ?? method;
    if (nextStatus) params.set("status", nextStatus);
    if (nextMethod) params.set("method", nextMethod);
    return params.size ? `/admin/payments?${params}` : "/admin/payments";
  };

  return (
    <main>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Payments</h1>
          <p className="mt-1 text-sm text-ink-soft">Manual proof review queue</p>
        </div>
        <Link href="/admin/payments/settings" className="text-sm font-medium text-deniz underline">
          Payment instructions
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-faint">Status:</span>
        <Link href={filterHref({ status: "" })} className={!status ? "font-semibold text-deniz" : "text-ink-soft"}>
          all
        </Link>
        {STATUSES.map((value) => (
          <Link key={value} href={filterHref({ status: value })} className={status === value ? "font-semibold text-deniz" : "text-ink-soft"}>
            {value}
          </Link>
        ))}
        <span className="ml-3 text-ink-faint">Method:</span>
        <Link href={filterHref({ method: "" })} className={!method ? "font-semibold text-deniz" : "text-ink-soft"}>
          all
        </Link>
        {METHODS.map((value) => (
          <Link key={value} href={filterHref({ method: value })} className={method === value ? "font-semibold text-deniz" : "text-ink-soft"}>
            {value}
          </Link>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-paper">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-line bg-wash/70 text-left">
              <th className="px-3 py-2 font-semibold">Created</th>
              <th className="px-3 py-2 font-semibold">Student</th>
              <th className="px-3 py-2 font-semibold">Tier</th>
              <th className="px-3 py-2 font-semibold">Amount</th>
              <th className="px-3 py-2 font-semibold">Method</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-ink-faint">No claims.</td></tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id as string} className="border-b border-line/60 last:border-0">
                  <td className="px-3 py-2 font-mono text-xs text-ink-faint">
                    {(row.created_at as string).slice(0, 16).replace("T", " ")}
                  </td>
                  <td className="px-3 py-2">{studentMap.get(row.user_id as string) || "—"}</td>
                  <td className="px-3 py-2">{tierMap.get(row.tier_id as string)?.en || "—"}</td>
                  <td className="px-3 py-2 font-mono">
                    {row.amount === null ? "—" : `${Number(row.amount).toLocaleString("en-GB")} ${row.currency || ""}`}
                  </td>
                  <td className="px-3 py-2">{row.method as string}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      row.status === "pending"
                        ? "bg-amber-soft text-amber"
                        : row.status === "approved"
                          ? "bg-moss-soft text-moss"
                          : "bg-clay-soft text-clay"
                    }`}>
                      {row.status as string}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/admin/payments/${row.id}`} className="font-medium text-deniz underline">
                      review
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
