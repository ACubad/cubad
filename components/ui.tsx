"use client";

import type { ReactNode } from "react";
import { useLang } from "@/lib/i18n";
import type { Bi, ContentTable } from "@/lib/types";
import { Md } from "./Md";

/* ---------------- callouts ---------------- */

const CALLOUT_STYLES = {
  why: "border-deniz/25 bg-deniz-soft text-deniz-deep",
  hint: "border-amber/25 bg-amber-soft text-amber",
  trap: "border-clay/25 bg-clay-soft text-clay",
  success: "border-moss/25 bg-moss-soft text-moss",
} as const;

export function Callout({
  kind,
  title,
  children,
}: {
  kind: keyof typeof CALLOUT_STYLES;
  title: string;
  children: ReactNode;
}) {
  const icon = { why: "?", hint: "💡", trap: "⚠", success: "✓" }[kind];
  return (
    <div className={`rounded-xl border px-4 py-3 ${CALLOUT_STYLES[kind]}`}>
      <p className="mb-1 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide">
        <span aria-hidden>{icon}</span>
        {title}
      </p>
      <div className="text-[0.95rem] leading-relaxed text-ink">{children}</div>
    </div>
  );
}

/* ---------------- data table ---------------- */

export function DataTable({ table }: { table: ContentTable }) {
  const { bi } = useLang();
  return (
    <div className="w-full">
      {table.title && (
        <p className="mb-1 text-sm font-medium text-ink-soft">{bi(table.title)}</p>
      )}
      <div className="overflow-x-auto rounded-xl border border-line bg-card">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-line bg-wash/70">
              {table.headers.map((h, i) => (
                <th
                  key={i}
                  className="whitespace-nowrap px-3 py-2 text-left font-semibold text-deniz-deep"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, ri) => (
              <tr key={ri} className={ri % 2 ? "bg-wash/40" : ""}>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className={`whitespace-nowrap px-3 py-1.5 font-mono text-[13px] ${
                      ci === 0 ? "font-semibold text-ink" : "text-ink-soft"
                    }`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- water progress bar ---------------- */

export function WaterProgress({
  value,
  className = "h-2",
}: {
  value: number; // 0..1
  className?: string;
}) {
  return (
    <div className={`water-track ${className}`}>
      <div className="water-fill" style={{ width: `${Math.min(100, Math.round(value * 100))}%` }} />
    </div>
  );
}

/* ---------------- difficulty dots ---------------- */

export function DifficultyDots({ level }: { level: 1 | 2 | 3 }) {
  return (
    <span className="inline-flex items-center gap-0.5" title={`difficulty ${level}/3`}>
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            i <= level ? "bg-deniz" : "bg-line"
          }`}
        />
      ))}
    </span>
  );
}

/* ---------------- exam likelihood badge ---------------- */

export function LikelihoodBadge({ level }: { level: "high" | "medium" | "low" }) {
  const { t } = useLang();
  const styles = {
    high: "bg-clay-soft text-clay",
    medium: "bg-amber-soft text-amber",
    low: "bg-wash text-ink-soft",
  }[level];
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${styles}`}>
      {t("examLikelihood")}: {t(level)}
    </span>
  );
}

/* ---------------- MCQ (shared by step checks & quizzes) ---------------- */

export function Mcq({
  q,
  options,
  correct,
  explain,
  chosen,
  onChoose,
}: {
  q: Bi;
  options: Bi[];
  correct: number;
  explain: Bi;
  chosen: number | null;
  onChoose: (i: number) => void;
}) {
  const { bi, t } = useLang();
  const answered = chosen !== null;
  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <Md className="mb-3 font-medium">{bi(q)}</Md>
      <div className="grid gap-2">
        {options.map((opt, i) => {
          let style = "border-line bg-paper hover:border-deniz/50";
          if (answered) {
            if (i === correct) style = "border-moss bg-moss-soft";
            else if (i === chosen) style = "border-clay bg-clay-soft";
            else style = "border-line-soft bg-paper opacity-60";
          }
          return (
            <button
              key={i}
              disabled={answered}
              onClick={() => onChoose(i)}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:cursor-default ${style}`}
            >
              <span className="mr-2 font-mono text-xs text-ink-faint">
                {String.fromCharCode(65 + i)}
              </span>
              <span className="[&_p]:inline">
                <Md>{bi(opt)}</Md>
              </span>
            </button>
          );
        })}
      </div>
      {answered && (
        <div className="mt-3 rise-in">
          <p
            className={`mb-1 text-sm font-semibold ${
              chosen === correct ? "text-moss" : "text-clay"
            }`}
          >
            {chosen === correct ? t("correct") : t("incorrect")}
          </p>
          <Md className="text-sm">{bi(explain)}</Md>
        </div>
      )}
    </div>
  );
}
