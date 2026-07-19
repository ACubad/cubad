"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/navigation";

export type RedeemState =
  | { status: "idle" }
  | { status: "success"; expiresAt: string | null; next: string }
  | { status: "error"; error: string };

const KNOWN_ERRORS = new Set([
  "invalid-code",
  "expired",
  "exhausted",
  "already-redeemed",
  "rate-limited",
]);

export async function redeemAction(
  _previous: RedeemState,
  formData: FormData
): Promise<RedeemState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", error: "generic" };

  const raw = String(formData.get("code") ?? "").trim();
  if (!raw || raw.length > 128) return { status: "error", error: "invalid-code" };

  const { data, error } = await supabase.rpc("redeem_code", { p_code: raw });
  if (error) {
    console.error("redeem_code rpc error", error.message);
    return { status: "error", error: "generic" };
  }

  const result = data as
    | { ok: true; entitlement: { expires_at?: string } }
    | { ok: false; error?: string }
    | null;
  if (result?.ok) {
    revalidatePath("/", "layout");
    return {
      status: "success",
      expiresAt: result.entitlement.expires_at ?? null,
      next: safeNextPath(String(formData.get("next") ?? "/")),
    };
  }

  const code = result?.error && KNOWN_ERRORS.has(result.error) ? result.error : "generic";
  return { status: "error", error: code };
}
