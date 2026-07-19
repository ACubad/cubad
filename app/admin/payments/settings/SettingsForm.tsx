"use client";

import Link from "next/link";
import { useActionState } from "react";
import { updatePaymentInstructions, type SettingsState } from "../actions";
import type { PaymentInstructions } from "@/lib/payments/settings";

function Field({ name, label, value }: { name: string; label: string; value: string }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-ink-faint">{label}</span>
      <textarea name={name} required maxLength={10000} defaultValue={value} rows={3} className="rounded-lg border border-line bg-paper px-3 py-2 text-ink" />
    </label>
  );
}

export function SettingsForm({ initial }: { initial: PaymentInstructions }) {
  const [state, action, saving] = useActionState<SettingsState, FormData>(
    updatePaymentInstructions,
    {}
  );
  return (
    <main className="max-w-2xl">
      <Link href="/admin/payments" className="text-sm font-medium text-deniz underline">
        ← Back to payments
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-ink">Payment instructions</h1>
      <p className="mt-1 text-sm text-ink-soft">Markdown is supported. Both Turkish and English are required.</p>

      <form action={action} className="mt-6 grid gap-5">
        <fieldset className="grid gap-2 rounded-xl border border-line bg-paper p-4">
          <legend className="px-1 text-sm font-semibold text-ink">M-Pesa</legend>
          <Field name="mpesa_tr" label="TR" value={initial.mpesa.tr} />
          <Field name="mpesa_en" label="EN" value={initial.mpesa.en} />
        </fieldset>
        <fieldset className="grid gap-2 rounded-xl border border-line bg-paper p-4">
          <legend className="px-1 text-sm font-semibold text-ink">Bank</legend>
          <Field name="bank_tr" label="TR" value={initial.bank.tr} />
          <Field name="bank_en" label="EN" value={initial.bank.en} />
        </fieldset>
        <fieldset className="grid gap-2 rounded-xl border border-line bg-paper p-4">
          <legend className="px-1 text-sm font-semibold text-ink">WhatsApp</legend>
          <Field name="whatsapp_tr" label="TR" value={initial.whatsapp.tr} />
          <Field name="whatsapp_en" label="EN" value={initial.whatsapp.en} />
        </fieldset>

        {state.error && <p role="alert" className="text-sm text-clay">Error: {state.error}</p>}
        {state.ok && <p className="text-sm text-moss">Saved ✓</p>}
        <button type="submit" disabled={saving} className="justify-self-start rounded-xl bg-deniz px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
          {saving ? "Saving…" : "Save instructions"}
        </button>
      </form>
    </main>
  );
}
