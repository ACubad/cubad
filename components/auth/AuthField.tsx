"use client";

export function AuthField({
  id, label, type = "text", autoComplete, required = true, defaultValue,
}: {
  id: string; label: string; type?: string; autoComplete?: string;
  required?: boolean; defaultValue?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink-soft">{label}</span>
      <input
        id={id}
        name={id}
        type={type}
        required={required}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-deniz/60"
      />
    </label>
  );
}
