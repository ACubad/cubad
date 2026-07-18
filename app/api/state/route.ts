import { createClient } from "@/lib/supabase/server";

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

  let body: { state?: unknown };
  try {
    body = (await request.json()) as { state?: unknown };
  } catch {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }
  if (body.state === undefined) return Response.json({ error: "no-state" }, { status: 400 });

  // Same size guard as the legacy sync route.
  if (JSON.stringify(body.state).length > 3_000_000) {
    return Response.json({ error: "too-large" }, { status: 413 });
  }

  // user_id comes from the authenticated session, NOT the client body — no spoofing.
  const { error } = await supabase
    .from("user_state")
    .upsert(
      { user_id: user.id, state: body.state, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  if (error) return Response.json({ error: "upstream" }, { status: 502 });

  return Response.json({ ok: true });
}
