import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/server";

export interface RateLimitOptions {
  /** Server-built bucket key, for example `tutor:user:<uuid>`. */
  key: string;
  max: number;
  windowSeconds: number;
}

/**
 * Record a server-side rate-limit event and report whether it is allowed.
 *
 * The RPC is intentionally service-role-only because callers choose the
 * bucket key. Limiter failures fail open so a monitoring/database incident
 * does not take otherwise-authorized product paths offline.
 */
export async function checkRateLimit({
  key,
  max,
  windowSeconds,
}: RateLimitOptions): Promise<boolean> {
  try {
    const rateLimitClient = createServiceRoleClient();
    const { data, error } = await rateLimitClient.rpc("check_rate_limit", {
      p_key: key,
      p_max: max,
      p_window: `${windowSeconds} seconds`,
    });
    if (error) {
      console.error("checkRateLimit RPC error", {
        namespace: key.split(":")[0],
        error: error.message,
      });
      return true;
    }
    if (typeof data !== "boolean") {
      console.error("checkRateLimit malformed result", {
        namespace: key.split(":")[0],
      });
      return true;
    }
    return data;
  } catch (error) {
    console.error("checkRateLimit exception", {
      namespace: key.split(":")[0],
      error,
    });
    return true;
  }
}

/** Best-effort fallback bucket for an unauthenticated request on Vercel. */
export function clientIp(request: Request): string {
  const forwarded =
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for") ??
    request.headers.get("x-real-ip");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}
