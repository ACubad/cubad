import { redirect } from "next/navigation";
import { UpgradeCopy } from "@/components/UpgradeCopy";
import { getSessionUser } from "@/lib/auth/dal";
import { safeNextPath } from "@/lib/navigation";

export const dynamic = "force-dynamic";

export default async function UpgradePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeNextPath((await searchParams).next);
  if (!(await getSessionUser())) {
    const destination = `/upgrade?next=${encodeURIComponent(next)}`;
    redirect(`/auth/sign-in?next=${encodeURIComponent(destination)}`);
  }
  return <UpgradeCopy redeemHref={`/redeem?next=${encodeURIComponent(next)}`} />;
}
