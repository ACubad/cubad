"use client";

import { useLang } from "@/lib/i18n";
import type { Bi } from "@/lib/types";

export function SubjectTitle({ title, tagline }: { title: Bi; tagline: Bi }) {
  const { bi } = useLang();
  return (
    <>
      <h2 className="font-display text-lg font-semibold text-ink group-hover:text-deniz-deep">
        {bi(title)}
      </h2>
      <p className="mt-1 line-clamp-2 text-sm text-ink-soft">{bi(tagline)}</p>
    </>
  );
}
