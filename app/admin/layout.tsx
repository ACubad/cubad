import type { ReactNode } from "react";
import { AdminNav } from "@/components/admin/AdminNav";
import { requireAdminPage } from "@/lib/admin/guard";

export const metadata = {
  title: "cubad admin",
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdminPage();

  return (
    <div className="-mx-4 flex min-h-[calc(100vh-8rem)] flex-col gap-6 sm:flex-row sm:items-start">
      <AdminNav />
      <div className="min-w-0 flex-1 rounded-xl border border-line bg-card p-4 sm:p-6">
        {children}
      </div>
    </div>
  );
}
