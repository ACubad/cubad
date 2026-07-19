"use client";

import { useState } from "react";

export interface PriceRow { currency: string; amount: number; country: string }

export function PricesEditor({ initial }: { initial: PriceRow[] }) {
  const [rows, setRows] = useState<PriceRow[]>(
    initial.length > 0 ? initial : [{ currency: "TZS", amount: 0, country: "TZ" }]
  );
  const update = (index: number, patch: Partial<PriceRow>) =>
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));

  return (
    <div className="flex flex-col gap-2">
      <input type="hidden" name="prices_json" value={JSON.stringify(rows)} />
      {rows.map((row, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2">
          <input aria-label={`Price ${index + 1} currency`} value={row.currency} onChange={(event) => update(index, { currency: event.target.value.toUpperCase() })} placeholder="TZS" maxLength={3} className="w-16 rounded-md border border-line bg-paper px-2 py-1 text-sm uppercase" />
          <input aria-label={`Price ${index + 1} amount`} type="number" min={0} value={row.amount} onChange={(event) => update(index, { amount: Number(event.target.value) })} className="w-28 rounded-md border border-line bg-paper px-2 py-1 text-sm" />
          <input aria-label={`Price ${index + 1} country`} value={row.country} onChange={(event) => update(index, { country: event.target.value.toUpperCase() })} placeholder="TZ or *" maxLength={2} className="w-16 rounded-md border border-line bg-paper px-2 py-1 text-sm uppercase" />
          <button type="button" onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))} className="text-xs text-clay hover:underline">Remove</button>
        </div>
      ))}
      <button type="button" onClick={() => setRows((current) => [...current, { currency: "USD", amount: 0, country: "*" }])} className="w-fit rounded-md border border-line px-2 py-1 text-xs hover:bg-wash">+ Add price row</button>
    </div>
  );
}
