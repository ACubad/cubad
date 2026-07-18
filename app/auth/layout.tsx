import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md py-8">
      <section className="rounded-2xl border border-line bg-card p-6 shadow-sm">{children}</section>
    </div>
  );
}
