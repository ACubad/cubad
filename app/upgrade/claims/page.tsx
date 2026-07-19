import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ClaimsList } from "./ClaimsList";

export const dynamic = "force-dynamic";

export default async function ClaimsPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in?next=/upgrade/claims");

  const { data: claims, error: claimsError } = await supabase
    .from("payment_claims")
    .select("id,tier_id,amount,currency,method,status,review_note,created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (claimsError) throw new Error(`claim history failed: ${claimsError.message}`);

  const tierIds = [...new Set((claims ?? []).map((claim) => claim.tier_id as string))];
  const { data: tiers, error: tiersError } = tierIds.length
    ? await supabase.from("tiers").select("id,slug,title").in("id", tierIds)
    : { data: [] as { id: string; slug: string; title: unknown }[], error: null };
  if (tiersError) throw new Error(`claim tier lookup failed: ${tiersError.message}`);
  const tierMap = new Map((tiers ?? []).map((tier) => [tier.id as string, tier]));

  const items = (claims ?? []).map((claim) => {
    const tier = tierMap.get(claim.tier_id as string);
    return {
      id: claim.id as string,
      tierSlug: (tier?.slug as string) || "",
      tierTitle: (tier?.title as { tr: string; en: string }) || { tr: "", en: "" },
      amount: claim.amount === null ? null : Number(claim.amount),
      currency: (claim.currency as string | null) || "",
      method: claim.method as string,
      status: claim.status as "pending" | "approved" | "rejected",
      reviewNote: (claim.review_note as string | null) || "",
      createdAt: claim.created_at as string,
    };
  });

  return <ClaimsList items={items} submitted={(await searchParams).submitted === "1"} />;
}
