import { redirect } from "next/navigation";
import { priceForCountry, type TierPrice } from "@/lib/payments/pricing";
import { createClient } from "@/lib/supabase/server";
import { UpgradeList } from "./UpgradeList";

export const dynamic = "force-dynamic";

export default async function UpgradePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in?next=/upgrade");

  const [{ data: profile, error: profileError }, { data: tiers, error: tiersError }] =
    await Promise.all([
      supabase.from("profiles").select("country_code").eq("user_id", user.id).maybeSingle(),
      supabase
        .from("tiers")
        .select("slug,title,description,scope_type,duration_days,prices")
        .eq("status", "published")
        .order("sort", { ascending: true }),
    ]);

  if (profileError) throw new Error(`profile pricing read failed: ${profileError.message}`);
  if (tiersError) throw new Error(`published tier read failed: ${tiersError.message}`);
  const country = profile?.country_code || "";
  const items = (tiers ?? []).map((tier) => ({
    slug: tier.slug as string,
    title: tier.title as { tr: string; en: string },
    description: tier.description as { tr: string; en: string },
    scopeType: tier.scope_type as string,
    durationDays: tier.duration_days as number,
    price: priceForCountry(tier.prices as unknown as TierPrice[], country),
  }));

  return <UpgradeList items={items} />;
}
