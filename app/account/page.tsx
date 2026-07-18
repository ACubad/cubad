import { requireOnboarded } from "@/lib/auth/dal";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { EditProfileForm } from "@/components/EditProfileForm";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { AccountHeadingClient } from "@/components/AccountHeadingClient";
import type { TrackOption } from "@/components/OnboardingWizard";

export default async function AccountPage() {
  const { user, profile } = await requireOnboarded();
  // WHY service-role: tracks gets a public read policy in Phase 3/4; until then
  // the cookie/anon client sees 0 rows. Only published display fields are exposed.
  const service = createServiceRoleClient();
  const { data: tracks } = await service
    .from("tracks")
    .select("id, title, country_code, system, level")
    .eq("status", "published")
    .order("sort", { ascending: true });

  const trackList = (tracks as TrackOption[] | null) ?? [];
  const current = trackList.find((tr) => tr.id === profile.track_id) ?? null;

  return (
    <div className="mx-auto grid w-full max-w-md gap-6 py-6">
      <AccountHeadingClient email={user.email ?? ""} trackTitle={current?.title ?? null} />
      <section className="rounded-2xl border border-line bg-card p-6">
        <EditProfileForm profile={profile} tracks={trackList} />
      </section>
      <SignOutButton />
    </div>
  );
}
