import Link from "next/link";
import { AdminTable, type AdminTableColumn } from "@/components/admin/AdminTable";
import { requireAdminPage } from "@/lib/admin/guard";

const PAGE_SIZE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
interface ProfileRow { user_id: string; email: string; full_name: string; country_code: string; role: "student" | "admin"; created_at: string }

function sanitizeSearchTerm(value: string): string {
  return value.replace(/[^\p{L}\p{N}@._+\-\s]/gu, "").trim().slice(0, 100);
}

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ q?: string; cursor?: string }> }) {
  const { supabase } = await requireAdminPage();
  const { q: rawQuery, cursor } = await searchParams;
  let query = supabase.from("profiles").select("user_id, email, full_name, country_code, role, created_at").order("created_at", { ascending: false }).order("user_id", { ascending: false }).limit(PAGE_SIZE);
  const search = rawQuery ? sanitizeSearchTerm(rawQuery) : "";
  if (search) query = query.or(`email.ilike.%${search}%,full_name.ilike.%${search}%,phone.ilike.%${search}%`);
  if (cursor) {
    const [createdAt, userId, extra] = cursor.split("|");
    if (!extra && UUID.test(userId ?? "") && Number.isFinite(Date.parse(createdAt ?? ""))) {
      query = query.or(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},user_id.lt.${userId})`);
    }
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ProfileRow[];
  const last = rows.at(-1);
  const nextCursor = rows.length === PAGE_SIZE && last ? `${last.created_at}|${last.user_id}` : null;
  const columns: AdminTableColumn<ProfileRow>[] = [
    { key: "email", header: "Email", render: (profile) => profile.email || <span className="text-ink-faint">—</span> },
    { key: "name", header: "Name", render: (profile) => profile.full_name || <span className="text-ink-faint">—</span> },
    { key: "country", header: "Country", render: (profile) => profile.country_code || "—" },
    { key: "role", header: "Role", render: (profile) => <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${profile.role === "admin" ? "bg-deniz-soft text-deniz-deep" : "bg-wash text-ink-soft"}`}>{profile.role}</span> },
    { key: "joined", header: "Joined", render: (profile) => new Date(profile.created_at).toLocaleDateString("en-GB") },
    { key: "open", header: "", render: (profile) => <Link href={`/admin/users/${profile.user_id}`} className="rounded-md border border-line px-2 py-1 text-xs hover:bg-wash">Open</Link> },
  ];
  return (
    <div className="flex flex-col gap-6">
      <div><h1 className="font-display text-xl font-semibold text-ink">Users</h1><p className="text-sm text-ink-soft">{rows.length} shown on this keyset-paginated page.</p></div>
      <form className="flex gap-2" action="/admin/users"><input name="q" defaultValue={rawQuery ?? ""} placeholder="Search email, name, or phone" className="w-72 rounded-lg border border-line bg-paper px-3 py-1.5 text-sm" /><button className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-wash">Search</button></form>
      <AdminTable columns={columns} rows={rows} rowKey={(profile) => profile.user_id} emptyMessage="No users match." />
      {nextCursor && <Link href={`/admin/users?${new URLSearchParams({ ...(rawQuery ? { q: rawQuery } : {}), cursor: nextCursor })}`} className="w-fit rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-wash">Next page →</Link>}
    </div>
  );
}
