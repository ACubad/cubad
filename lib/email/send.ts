import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/server";
import type { Lang } from "@/lib/types";
import {
  tmplAdminNewClaim,
  tmplClaimApproved,
  tmplClaimRejected,
  type EmailContent,
} from "./templates";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
}

async function recordFailure(kind: string, recipient: string, error: string): Promise<void> {
  try {
    const service = createServiceRoleClient();
    const { error: auditError } = await service.from("admin_audit_log").insert({
      actor: null,
      action: "email.failed",
      entity: "email",
      entity_id: kind,
      details: { kind, recipient, error: error.slice(0, 500) },
    });
    if (auditError) throw auditError;
  } catch {
    // Email failures may never unwind a committed payment decision.
    console.error("email.failed audit insert failed", kind);
  }
}

async function sendOne(kind: string, recipient: string, content: EmailContent): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || "onboarding@resend.dev";
  if (!key) {
    await recordFailure(kind, recipient, "missing-api-key");
    return { ok: false, error: "missing-api-key" };
  }
  if (!recipient) {
    await recordFailure(kind, recipient, "missing-recipient");
    return { ok: false, error: "missing-recipient" };
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [recipient],
        subject: content.subject,
        html: content.html,
        text: content.text,
      }),
    });
    if (!response.ok) {
      const error = `resend-${response.status}: ${(await response.text()).slice(0, 300)}`;
      await recordFailure(kind, recipient, error);
      return { ok: false, error };
    }
    const result = (await response.json()) as { id?: string };
    return { ok: true, id: result.id };
  } catch (cause) {
    const error = `network: ${cause instanceof Error ? cause.message : "unknown"}`;
    await recordFailure(kind, recipient, error);
    return { ok: false, error };
  }
}

export function sendAdminNewClaim(
  input: Parameters<typeof tmplAdminNewClaim>[0]
): Promise<SendResult> {
  return sendOne(
    "admin.new_claim",
    process.env.ADMIN_NOTIFY_EMAIL || "",
    tmplAdminNewClaim(input)
  );
}

export function sendClaimApproved(
  recipient: string,
  lang: Lang,
  input: Parameters<typeof tmplClaimApproved>[1]
): Promise<SendResult> {
  return sendOne("claim.approved", recipient, tmplClaimApproved(lang, input));
}

export function sendClaimRejected(
  recipient: string,
  lang: Lang,
  input: Parameters<typeof tmplClaimRejected>[1]
): Promise<SendResult> {
  return sendOne("claim.rejected", recipient, tmplClaimRejected(lang, input));
}
