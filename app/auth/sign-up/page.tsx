import { getSessionUser } from "@/lib/auth/dal";
import { redirect } from "next/navigation";
import { SignUpForm } from "@/components/auth/SignUpForm";

export default async function SignUpPage() {
  if (await getSessionUser()) redirect("/account");
  return <SignUpForm />;
}
