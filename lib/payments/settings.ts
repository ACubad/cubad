import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Bi } from "@/lib/types";

export interface PaymentInstructions {
  mpesa: Bi;
  bank: Bi;
  whatsapp: Bi;
}

const EMPTY: Bi = { tr: "", en: "" };

function asBi(value: unknown): Bi {
  if (!value || typeof value !== "object") return EMPTY;
  const candidate = value as Partial<Bi>;
  return {
    tr: typeof candidate.tr === "string" ? candidate.tr : "",
    en: typeof candidate.en === "string" ? candidate.en : "",
  };
}

export async function getPaymentInstructions(): Promise<PaymentInstructions> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "payment_instructions")
    .maybeSingle();

  if (error) throw new Error(`payment instructions read failed: ${error.message}`);
  const value = (data?.value ?? {}) as Record<string, unknown>;
  return {
    mpesa: asBi(value.mpesa),
    bank: asBi(value.bank),
    whatsapp: asBi(value.whatsapp),
  };
}
