"use client";

import { useLang } from "@/lib/i18n";
import type { Unit } from "@/lib/types";
import { Md, Tex } from "./Md";

export function FormulasView({ units }: { units: Unit[] }) {
  const { t, bi } = useLang();
  const withFormulas = units.filter((u) => (u.concept?.keyFormulas?.length ?? 0) > 0);
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold text-deniz-deep sm:text-4xl">
            {t("formulas")}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            {t("keyFormulas")} ·{" "}
            {withFormulas.reduce((n, u) => n + (u.concept?.keyFormulas.length ?? 0), 0)}
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="no-print rounded-full border border-line bg-card px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:border-deniz/40 hover:text-deniz"
        >
          🖨 {t("print")}
        </button>
      </div>

      {withFormulas.map((u) => (
        <section key={u.slug}>
          <h2 className="mb-3 border-b border-line pb-1 font-display text-xl font-semibold text-ink">
            <span className="mr-2 font-mono text-sm text-deniz">
              {String(u.unit).padStart(2, "0")}
            </span>
            {bi(u.title)}
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {(u.concept?.keyFormulas ?? []).map((f, i) => (
              <div
                key={i}
                className="min-w-0 break-inside-avoid rounded-xl border border-line bg-card p-4"
              >
                <p className="mb-1 text-sm font-semibold text-deniz-deep">{bi(f.name)}</p>
                <div className="overflow-x-auto py-1">
                  <Tex tex={f.latex} />
                </div>
                <Md className="mt-1 !text-[13px] text-ink-soft [&_p]:leading-relaxed">{bi(f.meaning)}</Md>
                <div className="mt-2 text-[13px]">
                  <span className="font-semibold text-deniz">{t("whenToUse")}: </span>
                  <Md className="!text-[13px] inline text-ink-soft [&_p]:inline">{bi(f.whenToUse)}</Md>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
