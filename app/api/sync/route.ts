import { createHash } from "node:crypto";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_ANON_KEY;
const TABLE = "cubad_sync";

interface SyncBody {
  code: string;
  /** when present: upsert this state; when absent: just read */
  state?: unknown;
}

function rowId(code: string): string {
  return createHash("sha256").update(`cubad:${code.trim()}`).digest("hex");
}

/**
 * The legacy sprout table treats the row hash as a passcode-derived capability.
 * Its RLS policies require this exact header to match the row id, preventing an
 * anonymous caller from listing or writing unrelated passcode rows.
 */
const sbHeaders = (id: string) => ({
  apikey: SB_KEY as string,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  "x-cubad-sync-id": id,
});

export async function GET() {
  return Response.json({ enabled: Boolean(SB_URL && SB_KEY) });
}

export async function POST(request: Request) {
  if (!SB_URL || !SB_KEY) {
    return Response.json({ error: "sync-unavailable" }, { status: 503 });
  }

  let body: SyncBody;
  try {
    body = (await request.json()) as SyncBody;
  } catch {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }

  const code = (body.code ?? "").trim();
  if (code.length < 4 || code.length > 128) {
    return Response.json({ error: "bad-code" }, { status: 400 });
  }
  const id = rowId(code);

  try {
    if (body.state !== undefined) {
      // size guard: progress + decks + capped chat histories
      const payload = JSON.stringify(body.state);
      if (payload.length > 3_000_000) {
        return Response.json({ error: "too-large" }, { status: 413 });
      }
      const res = await fetch(`${SB_URL}/rest/v1/${TABLE}`, {
        method: "POST",
        headers: {
          ...sbHeaders(id),
          Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify({ id, state: body.state, updated_at: new Date().toISOString() }),
      });
      if (!res.ok) {
        console.error("sync upsert failed", res.status, (await res.text()).slice(0, 200));
        return Response.json({ error: "upstream" }, { status: 502 });
      }
      const rows = (await res.json()) as { updated_at: string }[];
      return Response.json({ ok: true, updated_at: rows[0]?.updated_at ?? null });
    }

    const res = await fetch(
      `${SB_URL}/rest/v1/${TABLE}?id=eq.${id}&select=state,updated_at`,
      { headers: sbHeaders(id) }
    );
    if (!res.ok) {
      console.error("sync read failed", res.status);
      return Response.json({ error: "upstream" }, { status: 502 });
    }
    const rows = (await res.json()) as { state: unknown; updated_at: string }[];
    return Response.json(
      rows.length > 0
        ? { state: rows[0].state, updated_at: rows[0].updated_at }
        : { state: null, updated_at: null }
    );
  } catch (e) {
    console.error("sync route error", e);
    return Response.json({ error: "network" }, { status: 502 });
  }
}
