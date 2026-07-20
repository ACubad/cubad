"use client";

import { useActionState } from "react";
import { Md } from "@/components/Md";
import { useLang } from "@/lib/i18n";
import type { PaymentInstructions } from "@/lib/payments/settings";
import type { Bi } from "@/lib/types";
import { submitClaim, type SubmitState } from "../../actions";

const COPY = {
  heading: { tr: "Ödeme yap", en: "Make your payment" },
  external: {
    tr: "Bu sürüm otomatik ödeme almaz. Aşağıdaki yöntemlerden biriyle ödeme yapıp dekontunu gönder.",
    en: "This version does not take payments automatically. Pay using an instruction below, then send your proof.",
  },
  instructions: { tr: "Ödeme talimatları", en: "Payment instructions" },
  bank: { tr: "Banka havalesi", en: "Bank transfer" },
  whatsapp: { tr: "WhatsApp", en: "WhatsApp" },
  form: { tr: "Ödeme bildirimi gönder", en: "Submit your payment claim" },
  method: { tr: "Ödeme yöntemi", en: "Payment method" },
  payerRef: {
    tr: "İşlem no / gönderen (ör. SFC8KL29XY)",
    en: "Transaction ID / sender (e.g. SFC8KL29XY)",
  },
  amount: { tr: "Tutar", en: "Amount" },
  currency: { tr: "Para birimi", en: "Currency" },
  proof: {
    tr: "Dekont (JPG, PNG, WEBP veya PDF; en fazla 10 MB)",
    en: "Proof (JPG, PNG, WEBP or PDF; max 10 MB)",
  },
  submit: { tr: "Bildirimi gönder", en: "Submit claim" },
  submitting: { tr: "Gönderiliyor…", en: "Submitting…" },
} satisfies Record<string, Bi>;

const METHODS: { value: string; label: Bi }[] = [
  { value: "mpesa", label: { tr: "M-Pesa", en: "M-Pesa" } },
  { value: "tigopesa", label: { tr: "Tigo Pesa", en: "Tigo Pesa" } },
  { value: "airtelmoney", label: { tr: "Airtel Money", en: "Airtel Money" } },
  { value: "bank", label: { tr: "Banka", en: "Bank" } },
  { value: "other", label: { tr: "Diğer", en: "Other" } },
];

const ERRORS: Record<string, Bi> = {
  "bad-input": { tr: "Eksik veya geçersiz bilgi.", en: "Missing or invalid information." },
  "bad-amount": { tr: "Tutar geçersiz.", en: "The amount is invalid." },
  "bad-currency": { tr: "Para birimi geçersiz.", en: "The currency is invalid." },
  "proof-required": { tr: "Lütfen bir dekont ekleyin.", en: "Please attach a proof file." },
  "too-large": { tr: "Dosya 10 MB sınırını aşıyor.", en: "The file exceeds the 10 MB limit." },
  "bad-type": {
    tr: "Sadece JPG, PNG, WEBP veya PDF kabul edilir.",
    en: "Only JPG, PNG, WEBP or PDF are accepted.",
  },
  "mime-mismatch": {
    tr: "Dosya içeriği seçilen dosya türüyle eşleşmiyor.",
    en: "The file contents do not match the selected file type.",
  },
  "tier-unavailable": { tr: "Bu paket artık mevcut değil.", en: "This plan is no longer available." },
  "rate-limited": {
    tr: "Günlük ödeme bildirimi sınırına ulaştın. 24 saat sonra tekrar dene.",
    en: "You reached the daily payment-claim limit. Try again in 24 hours.",
  },
  "too-many-open": {
    tr: "En fazla 3 bekleyen bildirimin olabilir. Önce birini iptal et.",
    en: "You can have at most 3 pending claims. Cancel one first.",
  },
  "count-failed": { tr: "Bildirim limiti kontrol edilemedi.", en: "Could not check the claim limit." },
  "insert-failed": { tr: "Bildirim kaydedilemedi.", en: "Could not save the claim." },
  "upload-failed": { tr: "Dekont yüklenemedi.", en: "Could not upload the proof." },
  "finalize-failed": { tr: "Bildirim tamamlanamadı.", en: "Could not finalize the claim." },
  "cleanup-failed": {
    tr: "Bildirim temizlenemedi. Lütfen bekleyen bildirimlerini kontrol et.",
    en: "Cleanup could not finish. Please check your pending claims before retrying.",
  },
};

export function ClaimForm({
  tierId,
  tierTitle,
  defaultAmount,
  defaultCurrency,
  instructions,
}: {
  tierId: string;
  tierTitle: Bi;
  defaultAmount: number | null;
  defaultCurrency: string;
  instructions: PaymentInstructions;
}) {
  const { bi } = useLang();
  const [state, action, pending] = useActionState<SubmitState, FormData>(submitClaim, {});
  const instruction = (label: Bi, body: Bi) =>
    bi(body).trim() ? (
      <div className="rounded-xl border border-line bg-paper p-3">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-deniz-deep">
          {bi(label)}
        </p>
        <Md className="text-sm">{bi(body)}</Md>
      </div>
    ) : null;

  return (
    <main className="mx-auto max-w-xl px-1 py-4 sm:px-4 sm:py-8">
      <h1 className="font-display text-2xl font-semibold text-deniz-deep">{bi(COPY.heading)}</h1>
      <p className="mt-1 text-sm font-medium text-ink">{bi(tierTitle)}</p>
      <p className="mt-2 text-sm text-ink-soft">{bi(COPY.external)}</p>

      <section className="mt-5">
        <h2 className="mb-2 text-sm font-semibold text-ink">{bi(COPY.instructions)}</h2>
        <div className="grid gap-2">
          {instruction({ tr: "M-Pesa", en: "M-Pesa" }, instructions.mpesa)}
          {instruction(COPY.bank, instructions.bank)}
          {instruction(COPY.whatsapp, instructions.whatsapp)}
        </div>
      </section>

      <form action={action} className="mt-6 grid gap-4 rounded-2xl border border-line bg-card p-5">
        <input type="hidden" name="tierId" value={tierId} />
        <h2 className="font-display text-lg font-semibold text-ink">{bi(COPY.form)}</h2>

        <label className="grid gap-1 text-sm">
          <span className="font-medium text-ink">{bi(COPY.method)}</span>
          <select name="method" required defaultValue="mpesa" className="rounded-lg border border-line bg-paper px-3 py-2">
            {METHODS.map((method) => (
              <option key={method.value} value={method.value}>
                {bi(method.label)}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 text-sm">
          <span className="font-medium text-ink">{bi(COPY.payerRef)}</span>
          <input name="payerRef" type="text" maxLength={200} className="rounded-lg border border-line bg-paper px-3 py-2 font-mono" />
        </label>

        <div className="grid grid-cols-[2fr_1fr] gap-3">
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-ink">{bi(COPY.amount)}</span>
            <input name="amount" type="number" step="0.01" min="0" defaultValue={defaultAmount ?? ""} className="rounded-lg border border-line bg-paper px-3 py-2 font-mono" />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-ink">{bi(COPY.currency)}</span>
            <input name="currency" type="text" maxLength={8} defaultValue={defaultCurrency} className="rounded-lg border border-line bg-paper px-3 py-2 font-mono uppercase" />
          </label>
        </div>

        <label className="grid gap-1 text-sm">
          <span className="font-medium text-ink">{bi(COPY.proof)}</span>
          <input name="proof" type="file" required accept="image/jpeg,image/png,image/webp,application/pdf" className="rounded-lg border border-line bg-paper px-3 py-2 text-sm" />
        </label>

        {state.error && (
          <p role="alert" className="rounded-lg border border-clay/30 bg-clay-soft px-3 py-2 text-sm text-clay">
            {bi(ERRORS[state.error] ?? { tr: "Bir hata oluştu.", en: "Something went wrong." })}
          </p>
        )}

        <button type="submit" disabled={pending} className="rounded-xl bg-deniz px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-deniz-deep disabled:opacity-60">
          {pending ? bi(COPY.submitting) : bi(COPY.submit)}
        </button>
      </form>
    </main>
  );
}
