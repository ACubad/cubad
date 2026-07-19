"use client";

import { useActionState } from "react";
import { generateCodesAction, type GeneratedCode, type GenerateCodesState } from "@/app/admin/codes/actions";
import type { Bi } from "@/lib/types";
import { CodeScopeFields } from "./CodeScopeFields";

const initialState: GenerateCodesState = { status: "idle" };

function downloadCsv(codes: GeneratedCode[]) {
  const rows = ["code,tier,scope,duration_days,valid_until", ...codes.map((code) => `${code.code},${code.tier},${code.scope},${code.durationDays},${code.validUntil ?? ""}`)];
  const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `cubad-codes-${Date.now()}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function GenerateCodesForm({ tiers, tracks, subjects }: { tiers: { id: string; slug: string; title: Bi }[]; tracks: { id: string; title: Bi }[]; subjects: { id: string; title: Bi }[] }) {
  const [state, action, pending] = useActionState(generateCodesAction, initialState);
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-amber/30 bg-amber-soft px-4 py-2 text-sm text-amber">Plaintext codes are returned once in this authorized response. The database and audit log receive only SHA-256 hashes and non-secret metadata. Copy or download them now.</div>
      <form action={action} className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">Tier<select name="tier_id" required className="rounded-lg border border-line bg-paper px-3 py-1.5">{tiers.map((tier) => <option key={tier.id} value={tier.id}>{tier.title.en} ({tier.slug})</option>)}</select></label>
        <CodeScopeFields tracks={tracks} subjects={subjects} />
        <label className="flex flex-col gap-1 text-sm">Duration override (blank = tier default)<input name="duration_days" type="number" min={1} className="rounded-lg border border-line bg-paper px-3 py-1.5" /></label>
        <label className="flex flex-col gap-1 text-sm">Valid until (optional)<input name="valid_until" type="date" className="rounded-lg border border-line bg-paper px-3 py-1.5" /></label>
        <label className="flex flex-col gap-1 text-sm">How many (1–500)<input name="count" type="number" defaultValue={1} min={1} max={500} className="rounded-lg border border-line bg-paper px-3 py-1.5" /></label>
        <label className="flex flex-col gap-1 text-sm">Note<input name="note" maxLength={500} placeholder="e.g. offline school sale" className="rounded-lg border border-line bg-paper px-3 py-1.5" /></label>
        <p className="col-span-full text-xs text-ink-faint">Every generated code is one-time: exactly one successful redemption.</p>
        <button disabled={pending} className="col-span-full w-fit rounded-lg bg-deniz px-4 py-2 text-sm font-semibold text-white hover:bg-deniz-deep disabled:opacity-50">{pending ? "Generating..." : "Generate"}</button>
      </form>
      {state.status === "error" && <p role="alert" className="rounded-lg border border-clay/30 bg-clay-soft p-3 text-sm text-clay">{state.error}</p>}
      {state.status === "ok" && <div className="rounded-lg border border-moss/30 bg-moss-soft p-3 text-sm"><div className="mb-2 flex items-center justify-between"><p className="font-semibold text-moss">{state.codes.length} code(s) generated</p><button type="button" onClick={() => downloadCsv(state.codes)} className="rounded-md border border-moss/40 px-2 py-1 text-xs font-semibold text-moss hover:bg-white">Download CSV</button></div><pre className="max-h-64 overflow-auto rounded-md bg-card p-2 font-mono text-xs">{state.codes.map((code) => code.code).join("\n")}</pre></div>}
    </div>
  );
}
