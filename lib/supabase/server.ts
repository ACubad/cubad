import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getPreviewCapabilityHash } from "@/lib/access/preview-cookie";

/** Cookie-bound Supabase client for Server Components, Actions, and routes. */
export async function createClient() {
  const cookieStore = await cookies();
  const previewHash = await getPreviewCapabilityHash();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: previewHash ? { "x-cubad-preview-hash": previewHash } : {},
      },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Components cannot set cookies. Phase 2's proxy refreshes
            // sessions on every request.
          }
        },
      },
    }
  );
}

/**
 * Service-role client. This is the only service-key touchpoint in the
 * codebase and is restricted to server-side jobs.
 */
export function createServiceRoleClient() {
  return createSupabaseJsClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

/** Keep service-role environment inspection inside this server-only module. */
export function isServiceRoleConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
