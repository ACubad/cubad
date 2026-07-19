"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { postAuthDestination } from "@/lib/auth/dal";
import { claimPreviewForCurrentRequest } from "@/lib/access/preview";
import { safeNextPath } from "@/lib/navigation";

export type AuthErrorCode =
  | "invalid_credentials"
  | "email_not_confirmed"
  | "rate_limited"
  | "weak_password"
  | "email_exists"
  | "expired_or_invalid"
  | "invalid_email"
  | "passwords_mismatch"
  | "unknown";

export type AuthState =
  | { ok?: boolean; done?: boolean; errorCode?: AuthErrorCode }
  | undefined;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function mapAuthError(error: { code?: string; status?: number; message?: string }): AuthErrorCode {
  const c = error.code ?? "";
  if (c === "invalid_credentials" || c === "invalid_grant") return "invalid_credentials";
  if (c === "email_not_confirmed") return "email_not_confirmed";
  if (c === "over_email_send_rate_limit" || c === "over_request_rate_limit" || error.status === 429)
    return "rate_limited";
  if (c === "weak_password") return "weak_password";
  if (c === "user_already_exists" || c === "email_exists") return "email_exists";
  if (c === "otp_expired" || c === "otp_disabled") return "expired_or_invalid";
  return "unknown";
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (!EMAIL_RE.test(email)) return { errorCode: "invalid_email" };
  if (password.length < 8) return { errorCode: "weak_password" };
  if (password !== confirm) return { errorCode: "passwords_mismatch" };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/confirm?next=/onboarding`,
    },
  });
  if (error) return { errorCode: mapAuthError(error) };
  // Local/self-hosted configurations may return a session immediately. Production email
  // confirmation promotes the preview in /auth/confirm instead.
  if (data.session) await claimPreviewForCurrentRequest(null);
  return { done: true }; // "check your email"
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!EMAIL_RE.test(email)) return { errorCode: "invalid_email" };
  if (!password) return { errorCode: "invalid_credentials" };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { errorCode: mapAuthError(error) };

  // Preserve this browser's anonymous first choice only if the account has no durable choice.
  await claimPreviewForCurrentRequest(null);

  const next = String(formData.get("next") ?? "");
  const dest = safeNextPath(next, "") || await postAuthDestination();
  revalidatePath("/", "layout");
  redirect(dest);
}

export async function requestPasswordReset(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { errorCode: "invalid_email" };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/reset-password`,
  });
  // Don't leak which emails exist: report success regardless, except on rate limit.
  if (error && (error.code === "over_email_send_rate_limit" || error.status === 429)) {
    return { errorCode: "rate_limited" };
  }
  return { done: true };
}

export async function updatePassword(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < 8) return { errorCode: "weak_password" };
  if (password !== confirm) return { errorCode: "passwords_mismatch" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser(); // recovery session set by /auth/confirm
  if (!user) return { errorCode: "expired_or_invalid" };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { errorCode: mapAuthError(error) };

  revalidatePath("/", "layout");
  redirect("/account");
}
