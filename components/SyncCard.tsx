"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";
import { getSyncCode, SYNC_CODE_KEY, SYNC_LAST_KEY, SYNC_APPLIED_EVENT, syncNow } from "@/lib/sync";

export function SyncCard() {
  const { lang, t } = useLang();
  const [code, setCode] = useState("");
  const [input, setInput] = useState("");
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    setCode(getSyncCode());
    const raw = window.localStorage.getItem(SYNC_LAST_KEY);
    if (raw) setLastSync(Number(raw));
    const onApplied = () => {
      const v = window.localStorage.getItem(SYNC_LAST_KEY);
      if (v) setLastSync(Number(v));
    };
    window.addEventListener(SYNC_APPLIED_EVENT, onApplied);
    return () => window.removeEventListener(SYNC_APPLIED_EVENT, onApplied);
  }, []);

  const enable = async () => {
    const c = input.trim();
    if (c.length < 4) return;
    window.localStorage.setItem(SYNC_CODE_KEY, c);
    setCode(c);
    setInput("");
    setBusy(true);
    setError(false);
    const r = await syncNow();
    setBusy(false);
    if (!r.ok) setError(true);
  };

  const disable = () => {
    window.localStorage.removeItem(SYNC_CODE_KEY);
    setCode("");
    setLastSync(null);
  };

  const manualSync = async () => {
    setBusy(true);
    setError(false);
    const r = await syncNow();
    setBusy(false);
    if (!r.ok) setError(true);
  };

  return (
    <section className="rounded-2xl border border-line bg-card p-5">
      <h2 className="mb-1 font-display text-lg font-semibold text-ink">🔄 {t("syncTitle")}</h2>
      {!code ? (
        <>
          <p className="mb-3 text-sm text-ink-soft">{t("syncIntro")}</p>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && enable()}
              placeholder={t("syncPlaceholder")}
              className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm sm:max-w-xs"
            />
            <button
              onClick={enable}
              disabled={input.trim().length < 4 || busy}
              className="rounded-full bg-deniz px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-deniz-deep disabled:opacity-40"
            >
              {busy ? "…" : t("syncEnable")}
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="text-moss">
            ✓ {t("syncActive")}
            {lastSync
              ? ` · ${new Date(lastSync).toLocaleTimeString(lang === "tr" ? "tr-TR" : "en-GB", { hour: "2-digit", minute: "2-digit" })}`
              : ""}
          </span>
          <button
            onClick={manualSync}
            disabled={busy}
            className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-ink-soft transition-colors hover:border-deniz/40 hover:text-deniz disabled:opacity-40"
          >
            {busy ? "…" : t("syncNow")}
          </button>
          <button
            onClick={disable}
            className="rounded-full border border-clay/40 px-3 py-1 text-xs font-semibold text-clay transition-colors hover:bg-clay-soft"
          >
            {t("syncDisable")}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-clay">{t("syncError")}</p>}
    </section>
  );
}
