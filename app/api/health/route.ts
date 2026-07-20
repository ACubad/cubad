import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  try {
    const { error } = await supabase.from("tracks").select("id").limit(1);

    if (error) {
      console.error("Health check database query failed", error);
      return Response.json({ ok: false }, { status: 503 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error("Health check database request failed", error);
    return Response.json({ ok: false }, { status: 503 });
  }
}
