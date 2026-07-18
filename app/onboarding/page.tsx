import { redirect } from "next/navigation";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getSessionUser, getProfile } from "@/lib/auth/dal";
import { OnboardingWizard, type TrackOption } from "@/components/OnboardingWizard";
import { ImportPasscodeForm } from "@/components/ImportPasscodeForm";

export default async function OnboardingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/auth/sign-in?next=/onboarding");
  const profile = await getProfile();
  if (profile?.onboarded_at) redirect("/account");

  // WHY service-role: tracks gets a public read policy in Phase 3/4; until then
  // the cookie/anon client sees 0 rows, so service-role read is required. We only
  // pass id + display fields of PUBLISHED rows to the client — safe to expose.
  const service = createServiceRoleClient();
  const { data: tracks } = await service
    .from("tracks")
    .select("id, title, country_code, system, level")
    .eq("status", "published")
    .order("sort", { ascending: true });

  return (
    <div className="mx-auto grid w-full max-w-md gap-6 py-6">
      <section className="rounded-2xl border border-line bg-card p-6">
        <OnboardingWizard tracks={(tracks as TrackOption[]) ?? []} />
      </section>
      <ImportPasscodeForm />
    </div>
  );
}
