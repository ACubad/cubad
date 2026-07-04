"use client";

import { useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import { resetProgress } from "@/lib/sync";
import type { SubjectMeta } from "@/lib/types";

export function ResetCard({ subjects }: { subjects: SubjectMeta[] }) {
  const { t, bi } = useLang();
  // which target is in "are you sure?" state: subject slug, "all", or null
  const [arming, setArming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const disarm = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (disarm.current) clearTimeout(disarm.current);
  }, []);

  const arm = (target: string) => {
    setDone(false);
    setArming(target);
    if (disarm.current) clearTimeout(disarm.current);
    disarm.current = setTimeout(() => setArming(null), 4000);
  };

  const fire = async (target: string) => {
    if (disarm.current) clearTimeout(disarm.current);
    setArming(null);
    setBusy(true);
    await resetProgress(target === "all" ? undefined : target);
    setBusy(false);
    setDone(true);
  };

  const button = (target: string, label: string) => (
    <button
      key={target}
      disabled={busy}
      onClick={() => (arming === target ? fire(target) : arm(target))}
      className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 ${
        arming === target
          ? "border-clay bg-clay text-white"
          : "border-line bg-paper text-ink-soft hover:border-clay/50 hover:text-clay"
      }`}
    >
      {arming === target ? `⚠ ${t("resetConfirm")}` : label}
    </button>
  );

  return (
    <section className="rounded-2xl border border-line bg-card p-5">
      <h2 className="mb-1 font-display text-lg font-semibold text-ink">♻️ {t("resetTitle")}</h2>
      <p className="mb-3 text-sm text-ink-soft">{t("resetIntro")}</p>
      <div className="flex flex-wrap gap-2">
        {subjects.map((s) => button(s.slug, bi(s.title)))}
        {button("all", t("resetAll"))}
      </div>
      {done && <p className="mt-2 text-xs font-semibold text-moss">✓ {t("resetDone")}</p>}
    </section>
  );
}
