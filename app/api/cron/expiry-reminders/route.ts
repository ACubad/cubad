import { sendExpiryReminder } from "@/lib/email/send";
import { escapeHtml } from "@/lib/email/templates";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const maxDuration = 60;

function reminderSubject(lang: "tr" | "en") {
  return lang === "tr" ? "Erişiminiz 3 gün içinde sona eriyor" : "Your access expires in 3 days";
}

function reminderBody(lang: "tr" | "en", expiresAt: string, name: string) {
  const date = new Date(expiresAt).toLocaleDateString(lang === "tr" ? "tr-TR" : "en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return lang === "tr"
    ? `Merhaba ${name || ""},\n\ncubad erişiminiz ${date} tarihinde sona erecek. Kaldığınız yerden devam etmek için erişiminizi yenilemeyi unutmayın.\n\nSevgiler,\ncubad ekibi`
    : `Hi ${name || ""},\n\nYour cubad access expires on ${date}. Renew to keep studying without interruption.\n\nBest,\nThe cubad team`;
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const HOUR = 60 * 60 * 1000;
  const windowStart = new Date(Date.now() + HOUR * (72 - 12)).toISOString();
  const windowEnd = new Date(Date.now() + HOUR * (72 + 12)).toISOString();
  const staleClaim = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from("entitlements")
    .select("id, user_id, expires_at, reminder_claimed_at")
    .is("revoked_at", null)
    .is("reminded_at", null)
    .or(`reminder_claimed_at.is.null,reminder_claimed_at.lt.${staleClaim}`)
    .gte("expires_at", windowStart)
    .lte("expires_at", windowEnd);

  if (error) {
    console.error("expiry-reminders query failed", error);
    return Response.json({ error: "query-failed" }, { status: 500 });
  }

  const releaseClaim = async (id: string, claimAt: string) => {
    const { error: releaseError } = await supabase
      .from("entitlements")
      .update({ reminder_claimed_at: null })
      .eq("id", id)
      .eq("reminder_claimed_at", claimAt)
      .is("reminded_at", null);
    if (releaseError) console.error("expiry-reminders claim release failed", id);
  };

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of rows ?? []) {
    const claimAt = new Date().toISOString();
    try {
      const { data: claimed, error: claimError } = await supabase
        .from("entitlements")
        .update({ reminder_claimed_at: claimAt })
        .eq("id", row.id)
        .is("revoked_at", null)
        .is("reminded_at", null)
        .or(`reminder_claimed_at.is.null,reminder_claimed_at.lt.${staleClaim}`)
        .select("id")
        .maybeSingle();
      if (claimError) {
        console.error("expiry-reminders claim failed", row.id);
        failed++;
        continue;
      }
      if (!claimed) {
        skipped++;
        continue;
      }

      const { data: userResp } = await supabase.auth.admin.getUserById(row.user_id);
      const email = userResp?.user?.email;
      if (!email) {
        await releaseClaim(row.id, claimAt);
        failed++;
        continue;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, preferred_lang")
        .eq("user_id", row.user_id)
        .maybeSingle();
      const lang = profile?.preferred_lang === "en" ? "en" : "tr";
      const text = reminderBody(lang, row.expires_at, profile?.full_name ?? "");
      const emailResult = await sendExpiryReminder(
        email,
        {
          subject: reminderSubject(lang),
          text,
          html: `<div style="font-family:system-ui,-apple-system,Arial,sans-serif;white-space:pre-line">${escapeHtml(text)}</div>`,
        },
        row.id
      );
      if (!emailResult.ok) {
        await releaseClaim(row.id, claimAt);
        failed++;
        continue;
      }

      const { data: marked, error: markError } = await supabase
        .from("entitlements")
        .update({ reminded_at: new Date().toISOString(), reminder_claimed_at: null })
        .eq("id", row.id)
        .eq("reminder_claimed_at", claimAt)
        .is("reminded_at", null)
        .select("id")
        .maybeSingle();
      if (markError || !marked) {
        console.error("expiry-reminders durable mark failed", row.id);
        failed++;
        continue;
      }
      sent++;
    } catch (cause) {
      console.error("expiry-reminders send failed", row.id, cause);
      await releaseClaim(row.id, claimAt);
      failed++;
    }
  }

  return Response.json({ checked: rows?.length ?? 0, sent, failed, skipped });
}
