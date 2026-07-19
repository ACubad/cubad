import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** Explicit audit helper for the rare admin operation without a dedicated atomic RPC. */
export async function logAdminAction(
  supabase: SupabaseClient,
  action: string,
  entity: string,
  entityId: string | null,
  details: Record<string, unknown> = {}
): Promise<void> {
  const { error } = await supabase.rpc("log_admin_action", {
    p_action: action,
    p_entity: entity,
    p_entity_id: entityId,
    p_details: details,
  });
  if (error) throw new Error(`admin_audit_log write failed: ${error.message}`);
}
