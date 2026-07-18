import { createHash } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";

const TABLE = "legacy_sync";

interface SyncBody {
  code: string;
  /** when present: upsert this state; when absent: just read */
  state?: unknown;
}

function rowId(code: string): string {
  return createHash("sha256").update(`cubad:${code.trim()}`).digest("hex");
}

export async function GET() {
  return Response.json({
    enabled: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
  });
}

export async function POST(request: Request) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
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
  const supabase = createServiceRoleClient();

  try {
    if (body.state !== undefined) {
      // size guard: progress + decks + capped chat histories
      const payload = JSON.stringify(body.state);
      if (payload.length > 3_000_000) {
        return Response.json({ error: "too-large" }, { status: 413 });
      }
      const { data, error } = await supabase
        .from(TABLE)
        .upsert(
          { id, state: body.state, updated_at: new Date().toISOString() },
          { onConflict: "id" }
        )
        .select("updated_at")
        .single();
      if (error) {
        console.error("sync upsert failed", error.message);
        return Response.json({ error: "upstream" }, { status: 502 });
      }
      return Response.json({ ok: true, updated_at: data?.updated_at ?? null });
    }

    const { data, error } = await supabase
      .from(TABLE)
      .select("state, updated_at")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      console.error("sync read failed", error.message);
      return Response.json({ error: "upstream" }, { status: 502 });
    }
    return Response.json(
      data
        ? { state: data.state, updated_at: data.updated_at }
        : { state: null, updated_at: null }
    );
  } catch (e) {
    console.error("sync route error", e);
    return Response.json({ error: "network" }, { status: 502 });
  }
}
