import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** UX guard for pages and layouts. Database RLS remains the security boundary. */
export async function requireAdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/sign-in?next=/admin");

  const { data: isAdmin, error } = await supabase.rpc("is_admin");
  if (error || !isAdmin) redirect("/");

  return { supabase, user };
}

/**
 * Independent Server Action authorization. Actions are direct POST entry points and must not
 * rely on an admin page having rendered first.
 */
export async function requireAdminAction() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Unauthorized: not signed in");

  const { data: isAdmin, error } = await supabase.rpc("is_admin");
  if (error || !isAdmin) throw new Error("Unauthorized: admin role required");

  return { supabase, user };
}
