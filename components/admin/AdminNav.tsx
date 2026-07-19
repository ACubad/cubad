"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/admin", label: "Overview", exact: true },
  { href: "/admin/content", label: "Content" },
  { href: "/admin/catalog", label: "Catalog" },
  { href: "/admin/tiers", label: "Tiers" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/codes", label: "Codes" },
  { href: "/admin/payments", label: "Payments", phase6: true },
  { href: "/admin/audit", label: "Audit log" },
] as const;

export function AdminNav() {
  const pathname = usePathname() ?? "";

  return (
    <nav
      aria-label="Admin navigation"
      className="flex shrink-0 gap-1 overflow-x-auto sm:w-48 sm:flex-col sm:overflow-visible"
    >
      {ITEMS.map((item) => {
        const active = "exact" in item ? pathname === item.href : pathname.startsWith(item.href);
        const className = `flex items-center justify-between gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          active
            ? "bg-deniz text-white"
            : "text-ink-soft hover:bg-wash hover:text-deniz-deep"
        }`;
        const label = (
          <>
            <span>{item.label}</span>
            {"phase6" in item && (
              <span className="rounded-full border border-current/25 px-1.5 py-0.5 text-[9px] uppercase tracking-wide opacity-70">
                Phase 6
              </span>
            )}
          </>
        );

        if ("phase6" in item) {
          return (
            <span
              key={item.href}
              aria-disabled="true"
              title="Available in Phase 6"
              className={`${className} cursor-not-allowed opacity-70 hover:bg-transparent hover:text-ink-soft`}
            >
              {label}
            </span>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            className={className}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
