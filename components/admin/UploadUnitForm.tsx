"use client";

import { useActionState } from "react";
import { upsertUnitAction, type UpsertUnitState } from "@/app/admin/content/actions";

const initialState: UpsertUnitState = { status: "idle" };

export function UploadUnitForm({ subjectId }: { subjectId: string }) {
  const [state, formAction, pending] = useActionState(upsertUnitAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="subject_id" value={subjectId} />
      <label className="flex flex-col gap-1 text-sm">
        Unit JSON (paste, or choose a file below)
        <textarea
          name="json_text"
          rows={10}
          required
          placeholder={'{"unit": 1, "slug": "...", ...}'}
          className="rounded-lg border border-line bg-paper px-3 py-2 font-mono text-xs"
        />
      </label>
      <input
        type="file"
        accept="application/json,.json"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          const textarea = event.target.form?.elements.namedItem("json_text") as HTMLTextAreaElement | null;
          if (textarea) textarea.value = await file.text();
        }}
        className="text-sm"
      />
      <button type="submit" disabled={pending} className="w-fit rounded-lg bg-deniz px-4 py-2 text-sm font-semibold text-white hover:bg-deniz-deep disabled:opacity-50">
        {pending ? "Validating..." : "Validate & save as draft"}
      </button>

      {state.status === "error" && (
        <div role="alert" className="rounded-lg border border-clay/30 bg-clay-soft p-3 text-sm text-clay">
          <p className="mb-1 font-semibold">{state.errors.length} error(s) — not saved</p>
          <ul className="list-disc pl-5">{state.errors.map((error, index) => <li key={index}>{error}</li>)}</ul>
        </div>
      )}
      {state.status === "ok" && (
        <div className="rounded-lg border border-moss/30 bg-moss-soft p-3 text-sm text-moss">
          <p className="font-semibold">Saved as draft (v{state.version}).</p>
          {state.warnings.length > 0 && (
            <><p className="mt-2 font-semibold text-amber">{state.warnings.length} warning(s):</p><ul className="list-disc pl-5 text-ink-soft">{state.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></>
          )}
          <a href={`/admin/preview/${state.subjectSlug}/${state.unitSlug}`} target="_blank" rel="noreferrer" className="mt-2 inline-block font-semibold text-deniz-deep underline">Open draft preview →</a>
        </div>
      )}
    </form>
  );
}
