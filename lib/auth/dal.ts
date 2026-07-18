import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface Profile {
  user_id: string;
  full_name: string;
  country_code: string;
  phone: string;
  preferred_lang: "tr" | "en";
  track_id: string | null;
  role: "student" | "admin";
  onboarded_at: string | null;
}

/** The authenticated user (revalidated against Supabase Auth), or null. */
export const getSessionUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/** The caller's profile row, or null if signed out. */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select(
      "user_id, full_name, country_code, phone, preferred_lang, track_id, role, onboarded_at"
    )
    .eq("user_id", user.id)
    .maybeSingle();
  return (data as Profile) ?? null;
});

/** Require a signed-in user or bounce to sign-in. */
export async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/auth/sign-in");
  return user;
}

/** Require a signed-in AND onboarded user, else bounce appropriately. */
export async function requireOnboarded() {
  const user = await requireUser();
  const profile = await getProfile();
  if (!profile || !profile.onboarded_at) redirect("/onboarding");
  return { user, profile };
}

/** Where to send a user right after auth: onboarding if not done, else account. */
export async function postAuthDestination(): Promise<string> {
  const profile = await getProfile();
  return profile?.onboarded_at ? "/account" : "/onboarding";
}
