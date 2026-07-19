import "server-only";

import { createClient } from "@/lib/supabase/server";

/** Pending count is computed in PostgreSQL through PostgREST's exact head count. */
export async function getPendingClaimCount(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("payment_claims")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");
  if (error) {
    // The count decorates shared admin navigation; it must not take unrelated admin pages down.
    console.error("pending payment count failed", error.message);
    return 0;
  }
  return count ?? 0;
}
