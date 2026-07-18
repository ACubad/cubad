import { getSessionUser } from "@/lib/auth/dal";
import { redirect } from "next/navigation";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

export default async function ResetPasswordPage() {
  if (!(await getSessionUser())) redirect("/auth/forgot-password");
  return <ResetPasswordForm />;
}
