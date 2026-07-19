import "server-only";

import { getPreviewCapabilityHash } from "@/lib/access/preview-cookie";
import { createClient } from "@/lib/supabase/server";

/** Preserve an anonymous selection for the signed-in user, or bind a requested first choice. */
export async function claimPreviewForCurrentRequest(unitId: string | null): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("claim_unit_preview", {
    p_unit_id: unitId,
    p_preview_hash: await getPreviewCapabilityHash(),
  });
  if (error) {
    console.error("claim_unit_preview failed", error.message);
    return null;
  }
  return typeof data === "string" ? data : null;
}
