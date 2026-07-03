"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLang } from "@/lib/i18n";

export function Header() {
  const { lang, setLang, t } = useLang();
  const pathname = usePathname();
  const subjectMatch = pathname?.match(/^\/s\/([^/]+)/);
  const subject = subjectMatch?.[1];
  // Formula sheet exists only for the hydrology subject's content today.
  const showFormulas = subject === "hidroloji";

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="group flex items-baseline gap-2">
          <span className="wave-underline font-display text-2xl font-semibold tracking-tight text-deniz-deep">
            cubad
          </span>
          <span className="hidden text-xs text-ink-faint sm:inline">{t("tagline")}</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link
            href="/"
            className="rounded-lg px-2.5 py-1.5 font-medium text-ink-soft hover:bg-wash hover:text-deniz-deep"
          >
            {t("units")}
          </Link>
          {showFormulas && (
            <Link
              href={`/s/${subject}/formulas`}
              className="rounded-lg px-2.5 py-1.5 font-medium text-ink-soft hover:bg-wash hover:text-deniz-deep"
            >
              {t("formulas")}
            </Link>
          )}
          <div
            className="ml-2 flex overflow-hidden rounded-full border border-line text-xs font-semibold"
            role="group"
            aria-label="Language"
          >
            {(["en", "tr"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`px-2.5 py-1 uppercase transition-colors ${
                  lang === l ? "bg-deniz text-white" : "bg-card text-ink-soft hover:bg-wash"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </nav>
      </div>
    </header>
  );
}
