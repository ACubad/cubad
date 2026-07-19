import { notFound, redirect } from "next/navigation";
import { priceForCountry, type TierPrice } from "@/lib/payments/pricing";
import { getPaymentInstructions } from "@/lib/payments/settings";
import { createClient } from "@/lib/supabase/server";
import { ClaimForm } from "./ClaimForm";

export const dynamic = "force-dynamic";

export default async function PayPage({
  params,
}: {
  params: Promise<{ tierSlug: string }>;
}) {
  const { tierSlug } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/auth/sign-in?next=/upgrade/pay/${encodeURIComponent(tierSlug)}`);

  const [{ data: tier, error: tierError }, { data: profile, error: profileError }, instructions] =
    await Promise.all([
      supabase
        .from("tiers")
        .select("id,slug,title,prices")
        .eq("slug", tierSlug)
        .eq("status", "published")
        .maybeSingle(),
      supabase.from("profiles").select("country_code").eq("user_id", user.id).maybeSingle(),
      getPaymentInstructions(),
    ]);

  if (tierError) throw new Error(`tier read failed: ${tierError.message}`);
  if (profileError) throw new Error(`profile pricing read failed: ${profileError.message}`);
  if (!tier) notFound();

  const price = priceForCountry(
    tier.prices as unknown as TierPrice[],
    profile?.country_code || ""
  );
  return (
    <ClaimForm
      tierId={tier.id as string}
      tierTitle={tier.title as { tr: string; en: string }}
      defaultAmount={price?.amount ?? null}
      defaultCurrency={price?.currency ?? ""}
      instructions={instructions}
    />
  );
}
