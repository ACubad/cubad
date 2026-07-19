import "server-only";

import { getPreviewCapabilityHash } from "@/lib/access/preview-cookie";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

/** Preserve an anonymous selection for the signed-in user, or bind a requested first choice. */
export async function claimPreviewForCurrentRequest(unitId: string | null): Promise<string | null> {
  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  // Anonymous callers cannot execute the claim RPC directly. Only this trusted server path uses
  // the service role; authenticated callers retain auth.uid() so their durable row is immutable.
  const rpcClient = user ? userClient : createServiceRoleClient();
  const { data, error } = await rpcClient.rpc("claim_unit_preview", {
    p_unit_id: unitId,
    p_preview_hash: await getPreviewCapabilityHash(),
  });
  if (error) {
    console.error("claim_unit_preview failed", error.message);
    return null;
  }
  return typeof data === "string" ? data : null;
}
