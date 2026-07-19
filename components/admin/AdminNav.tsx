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
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/audit", label: "Audit log" },
] as const;

export function AdminNav({ pendingClaims }: { pendingClaims: number }) {
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
            {item.href === "/admin/payments" && pendingClaims > 0 && (
              <span className="min-w-5 rounded-full bg-clay px-1.5 py-0.5 text-center text-[10px] font-semibold text-white">
                {pendingClaims > 99 ? "99+" : pendingClaims}
              </span>
            )}
          </>
        );

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
