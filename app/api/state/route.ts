import { createClient } from "@/lib/supabase/server";

interface StateBody {
  state?: unknown;
  base_updated_at?: unknown;
  force?: unknown;
}

async function conflictResponse(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
) {
  const { data, error } = await supabase
    .from("user_state")
    .select("state, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return Response.json({ error: "upstream" }, { status: 502 });

  return Response.json(
    { error: "conflict", state: data?.state ?? null, updated_at: data?.updated_at ?? null },
    { status: 409 }
  );
}

export const dynamic = "force-dynamic"; // reads cookies/user — never cache

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const { data, error } = await supabase
    .from("user_state")
    .select("state, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return Response.json({ error: "upstream" }, { status: 502 });

  return Response.json({ state: data?.state ?? null, updated_at: data?.updated_at ?? null });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });

  let body: StateBody;
  try {
    body = (await request.json()) as StateBody;
  } catch {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }
  if (body.state === undefined) return Response.json({ error: "no-state" }, { status: 400 });

  // Same size guard as the legacy sync route.
  if (JSON.stringify(body.state).length > 3_000_000) {
    return Response.json({ error: "too-large" }, { status: 413 });
  }

  // user_id comes from the authenticated session, NOT the client body — no spoofing.
  const updatedAt = new Date().toISOString();

  // A reset deliberately replaces all study state. Normal sync writes use the
  // timestamp returned by GET as a compare-and-swap token so two devices cannot
  // silently overwrite each other with independently merged snapshots.
  if (body.force === true) {
    const { error } = await supabase
      .from("user_state")
      .upsert(
        { user_id: user.id, state: body.state, updated_at: updatedAt },
        { onConflict: "user_id" }
      );
    if (error) return Response.json({ error: "upstream" }, { status: 502 });
    return Response.json({ ok: true, updated_at: updatedAt });
  }

  const baseUpdatedAt =
    typeof body.base_updated_at === "string" ? body.base_updated_at : null;

  if (baseUpdatedAt) {
    const { data, error } = await supabase
      .from("user_state")
      .update({ state: body.state, updated_at: updatedAt })
      .eq("user_id", user.id)
      .eq("updated_at", baseUpdatedAt)
      .select("updated_at")
      .maybeSingle();
    if (error) return Response.json({ error: "upstream" }, { status: 502 });
    if (!data) return conflictResponse(supabase, user.id);
    return Response.json({ ok: true, updated_at: data.updated_at });
  }

  const { data, error } = await supabase
    .from("user_state")
    .insert({ user_id: user.id, state: body.state, updated_at: updatedAt })
    .select("updated_at")
    .maybeSingle();
  if (!error && data) return Response.json({ ok: true, updated_at: data.updated_at });
  if (error?.code === "23505") return conflictResponse(supabase, user.id);
  return Response.json({ error: "upstream" }, { status: 502 });
}
