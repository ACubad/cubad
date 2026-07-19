import type { Lang } from "@/lib/types";

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatExpiry(iso: string, lang: Lang): string {
  const formatted = new Intl.DateTimeFormat(lang === "tr" ? "tr-TR" : "en-GB", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(iso));
  return `${formatted} (UTC)`;
}

function layout(title: string, body: string): string {
  return (
    `<div style="font-family:system-ui,-apple-system,Arial,sans-serif;color:#1c2b33;` +
    `background:#f6f3eb;padding:24px"><div style="max-width:520px;margin:0 auto;` +
    `background:#fff;border:1px solid #e6e0d4;border-radius:12px;padding:24px">` +
    `<h1 style="font-size:18px;margin:0 0 12px">${escapeHtml(title)}</h1>${body}` +
    `<p style="font-size:12px;color:#7b8a90;margin-top:24px">cubad · Pass by understanding.</p>` +
    `</div></div>`
  );
}

export function tmplAdminNewClaim(input: {
  studentName: string;
  studentEmail: string;
  tierTitle: string;
  amount: string;
  currency: string;
  method: string;
  payerRef: string;
  dashboardUrl: string;
}): EmailContent {
  const rows: [string, string][] = [
    ["Student", `${input.studentName} <${input.studentEmail}>`],
    ["Tier", input.tierTitle],
    ["Amount", `${input.amount} ${input.currency}`.trim()],
    ["Method", input.method],
    ["Payer ref", input.payerRef || "—"],
  ];
  const subject = `New payment claim — ${input.studentName} (${input.tierTitle})`;
  const table = rows
    .map(
      ([key, value]) =>
        `<tr><td style="padding:4px 8px 4px 0;color:#7b8a90;vertical-align:top">` +
        `${escapeHtml(key)}</td><td style="padding:4px 0">${escapeHtml(value)}</td></tr>`
    )
    .join("");
  const html = layout(
    "New payment claim",
    `<table style="width:100%;border-collapse:collapse;font-size:14px">${table}</table>` +
      `<p style="margin-top:16px"><a href="${escapeHtml(input.dashboardUrl)}" ` +
      `style="background:#0e5a6d;color:#fff;padding:10px 16px;border-radius:8px;` +
      `text-decoration:none;display:inline-block">Review claim</a></p>` +
      `<p style="font-size:13px;color:#7b8a90;margin-top:12px">Before approving, check the ` +
      `bank or mobile-money statement for this payer reference and amount.</p>`
  );
  const text =
    `New payment claim\n${rows.map(([key, value]) => `${key}: ${value}`).join("\n")}` +
    `\n\nReview: ${input.dashboardUrl}\n\nBefore approving, verify the statement.`;
  return { subject, html, text };
}

export function tmplClaimApproved(
  lang: Lang,
  input: { code: string; tierTitle: string; expiresIso: string; appUrl: string }
): EmailContent {
  const expiry = formatExpiry(input.expiresIso, lang);
  const copy = {
    tr: {
      subject: "Ödemeniz onaylandı — erişim kodunuz",
      title: "Ödemeniz onaylandı",
      intro: "erişiminiz etkinleştirildi.",
      code: "Erişim kodunuz (makbuz olarak saklayın):",
      note: "Erişiminiz zaten açık — bu kodu tekrar girmenize gerek yok. Kaydınız için saklayın.",
      expiry: "Erişim bitiş tarihi:",
      cta: "Çalışmaya başla",
    },
    en: {
      subject: "Payment approved — your access code",
      title: "Payment approved",
      intro: "access is now active.",
      code: "Your access code (keep as your receipt):",
      note: "Your access is already active — you do not need to redeem this code. Keep it for your records.",
      expiry: "Access valid until:",
      cta: "Start studying",
    },
  }[lang];
  const html = layout(
    copy.title,
    `<p style="font-size:14px;line-height:1.5"><strong>${escapeHtml(input.tierTitle)}</strong> ` +
      `${escapeHtml(copy.intro)}</p><p style="font-size:13px;color:#7b8a90;margin:16px 0 4px">` +
      `${escapeHtml(copy.code)}</p><p style="font-family:ui-monospace,monospace;font-size:24px;` +
      `font-weight:700;letter-spacing:2px;background:#e6f0f2;color:#0e5a6d;padding:12px 16px;` +
      `border-radius:10px;text-align:center;margin:0 0 16px">${escapeHtml(input.code)}</p>` +
      `<p style="font-size:13px;line-height:1.5;background:#eef6ee;border-radius:8px;padding:10px 12px">` +
      `${escapeHtml(copy.note)}</p><p style="font-size:14px;margin-top:12px">${escapeHtml(copy.expiry)} ` +
      `<strong>${escapeHtml(expiry)}</strong></p><p style="margin-top:16px"><a href="${escapeHtml(
        input.appUrl
      )}" style="background:#0e5a6d;color:#fff;padding:10px 16px;border-radius:8px;` +
      `text-decoration:none;display:inline-block">${escapeHtml(copy.cta)}</a></p>`
  );
  const text = `${copy.title}\n\n${input.tierTitle} ${copy.intro}\n\n${copy.code}\n${input.code}\n\n${copy.note}\n\n${copy.expiry} ${expiry}\n\n${input.appUrl}`;
  return { subject: copy.subject, html, text };
}

export function tmplClaimRejected(
  lang: Lang,
  input: { reason: string; appUrl: string }
): EmailContent {
  const copy = {
    tr: {
      subject: "Ödeme bildiriminiz onaylanmadı",
      title: "Ödeme bildiriminiz onaylanmadı",
      intro: "Ödeme bildiriminizi doğrulayamadık. Neden:",
      cta: "Yeniden gönder",
    },
    en: {
      subject: "Your payment claim was not approved",
      title: "Your payment claim was not approved",
      intro: "We could not verify your payment claim. Reason:",
      cta: "Resubmit",
    },
  }[lang];
  const upgradeUrl = `${input.appUrl}/upgrade`;
  const html = layout(
    copy.title,
    `<p style="font-size:14px;line-height:1.5">${escapeHtml(copy.intro)}</p>` +
      `<p style="font-size:14px;line-height:1.5;background:#f7eaea;border-left:3px solid #b4462f;` +
      `padding:10px 12px;border-radius:6px">${escapeHtml(input.reason)}</p>` +
      `<p style="margin-top:16px"><a href="${escapeHtml(upgradeUrl)}" style="background:#0e5a6d;` +
      `color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">` +
      `${escapeHtml(copy.cta)}</a></p>`
  );
  const text = `${copy.title}\n\n${copy.intro}\n${input.reason}\n\n${copy.cta}: ${upgradeUrl}`;
  return { subject: copy.subject, html, text };
}
