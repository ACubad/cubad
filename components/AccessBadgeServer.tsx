import "server-only";

import { getActiveEntitlementExpiry } from "@/lib/access/access";
import { AccessBadge } from "./AccessBadge";

export async function AccessBadgeServer() {
  const expiresAt = await getActiveEntitlementExpiry();
  return expiresAt ? <AccessBadge expiresAt={expiresAt} /> : null;
}
