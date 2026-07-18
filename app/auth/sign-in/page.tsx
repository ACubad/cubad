import { getSessionUser } from "@/lib/auth/dal";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/auth/SignInForm";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (await getSessionUser()) redirect("/account");
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") ? next : undefined;
  return <SignInForm next={safeNext} />;
}
