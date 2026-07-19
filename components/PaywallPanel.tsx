import "server-only";

import { getSessionUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { PaywallCopy } from "./PaywallCopy";

interface Price {
  currency: string;
  amount: number;
  country: string;
}

interface Tier {
  id: string;
  slug: string;
  title: { tr: string; en: string };
  description: { tr: string; en: string };
  duration_days: number;
  prices: Price[];
}

function pickPrice(prices: Price[], country: string): Price | null {
  if (!prices?.length) return null;
  return (
    prices.find((price) => price.country === country) ??
    prices.find((price) => price.country === "*") ??
    prices[0]
  );
}

export async function PaywallPanel({
  subjectSlug,
  unitSlug,
}: {
  subjectSlug: string;
  unitSlug: string;
}) {
  const user = await getSessionUser();
  const next = `/s/${subjectSlug}/unit/${unitSlug}`;
  let tiers: { tier: Tier; price: Price | null }[] = [];

  if (user) {
    const supabase = await createClient();
    const [{ data: profile }, { data: tierRows }] = await Promise.all([
      supabase.from("profiles").select("country_code").maybeSingle(),
      supabase
        .from("tiers")
        .select("id,slug,title,description,duration_days,prices")
        .eq("status", "published")
        .order("sort", { ascending: true }),
    ]);
    const country = profile?.country_code ?? "";
    tiers = (tierRows ?? []).map((row) => {
      const tier = row as unknown as Tier;
      return { tier, price: pickPrice(tier.prices, country) };
    });
  }

  return (
    <PaywallCopy
      signedIn={Boolean(user)}
      tiers={tiers}
      redeemHref={`/redeem?next=${encodeURIComponent(next)}`}
      upgradeHref={`/upgrade?next=${encodeURIComponent(next)}`}
      signInHref={`/auth/sign-in?next=${encodeURIComponent(next)}`}
      signUpHref="/auth/sign-up"
    />
  );
}
