"use client";

import { useState } from "react";
import type { Bi } from "@/lib/types";

export function EntitlementScopeFields({ tracks, subjects }: { tracks: { id: string; title: Bi }[]; subjects: { id: string; title: Bi }[] }) {
  const [scopeType, setScopeType] = useState<"all" | "track" | "subject">("all");
  const options = scopeType === "track" ? tracks : scopeType === "subject" ? subjects : [];
  return (
    <>
      <label className="flex flex-col gap-1 text-sm">Scope<select name="scope_type" value={scopeType} onChange={(event) => setScopeType(event.target.value as typeof scopeType)} className="rounded-lg border border-line bg-paper px-3 py-1.5"><option value="all">all</option><option value="track">track</option><option value="subject">subject</option></select></label>
      {scopeType !== "all" && <label className="flex flex-col gap-1 text-sm">{scopeType === "track" ? "Track" : "Subject"}<select name="scope_id" required className="rounded-lg border border-line bg-paper px-3 py-1.5">{options.map((option) => <option key={option.id} value={option.id}>{option.title.en}</option>)}</select></label>}
    </>
  );
}
