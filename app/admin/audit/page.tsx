import Link from "next/link";
import { AdminTable, type AdminTableColumn } from "@/components/admin/AdminTable";
import { requireAdminPage } from "@/lib/admin/guard";

const PAGE_SIZE = 50;

interface AuditRow {
  id: number;
  actor: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

function auditHref(action: string, page: number) {
  const params = new URLSearchParams({ page: String(page) });
  if (action) params.set("action", action);
  return `/admin/audit?${params}`;
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; page?: string }>;
}) {
  const { supabase } = await requireAdminPage();
  const raw = await searchParams;
  const action = (raw.action ?? "").trim().slice(0, 80).replace(/[^a-zA-Z0-9._-]/g, "");
  const parsedPage = Number.parseInt(raw.page ?? "1", 10);
  const page = Number.isFinite(parsedPage) ? Math.max(1, parsedPage) : 1;

  let query = supabase
    .from("admin_audit_log")
    .select("id, actor, action, entity, entity_id, details, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (action) query = query.ilike("action", `${action}%`);

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as AuditRow[];

  const actorIds = [...new Set(rows.map((row) => row.actor).filter((actor): actor is string => Boolean(actor)))];
  const { data: actorData, error: actorError } = actorIds.length
    ? await supabase.from("profiles").select("user_id, email").in("user_id", actorIds)
    : { data: [] as { user_id: string; email: string }[], error: null };
  if (actorError) throw new Error(actorError.message);
  const emailByActor = new Map((actorData ?? []).map((actor) => [actor.user_id, actor.email]));

  const columns: AdminTableColumn<AuditRow>[] = [
    { key: "when", header: "When", render: (row) => new Date(row.created_at).toLocaleString("en-GB") },
    { key: "actor", header: "Actor", render: (row) => (row.actor ? emailByActor.get(row.actor) ?? row.actor : "—") },
    { key: "action", header: "Action", render: (row) => <code className="text-xs">{row.action}</code> },
    { key: "entity", header: "Entity", render: (row) => `${row.entity}${row.entity_id ? ` (${row.entity_id.slice(0, 8)})` : ""}` },
    {
      key: "details",
      header: "Details",
      render: (row) => (
        <details>
          <summary className="cursor-pointer text-xs text-deniz-deep">View</summary>
          <pre className="mt-1 max-w-xs overflow-auto rounded-md bg-wash p-2 text-[11px]">
            {JSON.stringify(row.details, null, 2)}
          </pre>
        </details>
      ),
    },
  ];
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-ink">Audit log</h1>
        <p className="text-sm text-ink-soft">{count ?? 0} total entries · page {page} of {totalPages}.</p>
      </div>

      <form className="flex flex-wrap gap-2" action="/admin/audit">
        <input
          name="action"
          defaultValue={action}
          placeholder="Action prefix, e.g. unit. or code."
          className="w-72 rounded-lg border border-line bg-paper px-3 py-1.5 text-sm"
        />
        <button type="submit" className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-wash">Filter</button>
      </form>

      <AdminTable columns={columns} rows={rows} rowKey={(row) => String(row.id)} emptyMessage="No audit entries match." />

      <div className="flex gap-2 text-sm">
        {page > 1 && <Link href={auditHref(action, page - 1)} className="rounded-md border border-line px-2 py-1 hover:bg-wash">← Prev</Link>}
        {page < totalPages && <Link href={auditHref(action, page + 1)} className="rounded-md border border-line px-2 py-1 hover:bg-wash">Next →</Link>}
      </div>
    </div>
  );
}
