import { redirect } from "next/navigation";
import { RedeemForm } from "@/components/RedeemForm";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function safeNext(value: string | undefined): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export default async function RedeemPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeNext((await searchParams).next);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const destination = `/redeem?next=${encodeURIComponent(next)}`;
    redirect(`/auth/sign-in?next=${encodeURIComponent(destination)}`);
  }

  return (
    <div className="mx-auto max-w-md py-6">
      <RedeemForm next={next} />
    </div>
  );
}
