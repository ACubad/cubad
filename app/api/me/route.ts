import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic"; // per-user — never cache

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ me: null });

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, track_id")
    .eq("user_id", user.id)
    .maybeSingle();

  // WHY service-role: tracks gets a public read policy in Phase 3/4; until then
  // the cookie/anon client sees 0 rows. Only the published track's Bi title is
  // returned — safe to expose.
  let trackTitle: unknown = null;
  if (profile?.track_id) {
    const service = createServiceRoleClient();
    const { data: track } = await service
      .from("tracks")
      .select("title")
      .eq("id", profile.track_id)
      .eq("status", "published")
      .maybeSingle();
    trackTitle = track?.title ?? null;
  }

  return Response.json({
    me: { email: user.email ?? "", fullName: profile?.full_name ?? "", trackTitle },
  });
}
