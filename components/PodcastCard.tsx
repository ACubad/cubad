"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import type { Unit } from "@/lib/types";

interface PodcastLine {
  s: "Deniz" | "Mert";
  t: string;
}

type PodLang = "tr" | "en";
type Status = "loading" | "idle" | "generating" | "ready" | "scriptOnly" | "error";

interface LangState {
  status: Status;
  audioUrl: string | null;
  scriptUrl: string | null;
  lines: PodcastLine[];
}

interface PodcastCapability {
  tr: { audio: string; script: string | null } | null;
  en: { audio: string; script: string | null } | null;
  canGenerate?: boolean;
}

const DB_NAME = "cubad-podcasts";
const STORE = "audio";
const FRESH: LangState = { status: "loading", audioUrl: null, scriptUrl: null, lines: [] };

function cacheKey(subject: string, unitSlug: string, lang: string) {
  return `${subject}/${unitSlug}/${lang}`;
}

/** Decode base64 holding UTF-8 bytes (Turkish text) into a proper JS string. */
function decodeBase64Utf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

interface CachedPodcast {
  blob: Blob;
  lines: PodcastLine[];
}

async function getCached(key: string): Promise<CachedPodcast | undefined> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as CachedPodcast | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

async function putCached(key: string, value: CachedPodcast): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* best-effort cache */
  }
}

export function PodcastCard({ subject, unit }: { subject: string; unit: Unit }) {
  const { lang: uiLang, t } = useLang();
  const notes = unit.notes ?? [];
  const [podLang, setPodLang] = useState<PodLang | null>(null);
  const [langState, setLangState] = useState<Record<PodLang, LangState>>({ tr: FRESH, en: FRESH });
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [canGenerate, setCanGenerate] = useState(false);
  const objectUrlsRef = useRef<string[]>([]);

  const patch = useCallback((lang: PodLang, state: Partial<LangState>) => {
    setLangState((previous) => ({ ...previous, [lang]: { ...previous[lang], ...state } }));
  }, []);

  useEffect(() => {
    if (!notes.length) return;
    let cancelled = false;

    const discover = async (
      lang: PodLang,
      cloud: { audio: string; script: string | null } | null
    ) => {
      if (cloud) {
        patch(lang, { status: "ready", audioUrl: cloud.audio, scriptUrl: cloud.script });
        return true;
      }
      const cached = await getCached(cacheKey(subject, unit.slug, lang));
      if (cached && !cancelled) {
        const url = URL.createObjectURL(cached.blob);
        objectUrlsRef.current.push(url);
        patch(lang, { status: "ready", audioUrl: url, lines: cached.lines });
        return true;
      }
      patch(lang, { status: "idle" });
      return false;
    };

    fetch(`/api/podcast?subject=${encodeURIComponent(subject)}&unit=${encodeURIComponent(unit.slug)}`)
      .then((response) => response.json() as Promise<PodcastCapability>)
      .then(async (data) => {
        if (cancelled) return;
        setCanGenerate(Boolean(data.canGenerate));
        const [hasTr, hasEn] = await Promise.all([
          discover("tr", data.tr),
          discover("en", data.en),
        ]);
        if (hasTr || hasEn) {
          setPodLang(uiLang === "tr" ? (hasTr ? "tr" : "en") : hasEn ? "en" : "tr");
        }
      })
      .catch(async () => {
        if (cancelled) return;
        const [hasTr, hasEn] = await Promise.all([discover("tr", null), discover("en", null)]);
        if (hasTr || hasEn) setPodLang(hasTr ? "tr" : "en");
      });

    return () => {
      cancelled = true;
      for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
      objectUrlsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, unit.slug, notes.length]);

  if (!notes.length) return null;

  const generate = async (lang: PodLang, force = false) => {
    if (!canGenerate) return;
    setPodLang(lang);
    patch(lang, { status: "generating" });

    try {
      const response = await fetch("/api/podcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, unitSlug: unit.slug, lang, force }),
      });

      if (response.status === 401 || response.status === 403) {
        setCanGenerate(false);
        patch(lang, { status: "idle" });
        return;
      }

      const contentType = response.headers.get("Content-Type") ?? "";
      if (contentType.includes("audio/wav")) {
        const blob = await response.blob();
        const linesB64 = response.headers.get("X-Podcast-Lines");
        const lines: PodcastLine[] = linesB64
          ? (JSON.parse(decodeBase64Utf8(linesB64)) as PodcastLine[])
          : [];
        const url = URL.createObjectURL(blob);
        objectUrlsRef.current.push(url);
        patch(lang, { status: "ready", audioUrl: url, lines });
        await putCached(cacheKey(subject, unit.slug, lang), { blob, lines });
        return;
      }

      const data = (await response.json()) as {
        url?: string;
        scriptUrl?: string | null;
        scriptOnly?: boolean;
        lines?: PodcastLine[];
      };
      if (data.url) {
        patch(lang, {
          status: "ready",
          audioUrl: data.url,
          scriptUrl: data.scriptUrl ?? null,
          lines: data.lines ?? [],
        });
      } else if (data.scriptOnly && data.lines) {
        patch(lang, { status: "scriptOnly", lines: data.lines });
      } else {
        patch(lang, { status: "error" });
      }
    } catch {
      patch(lang, { status: "error" });
    }
  };

  const openTranscript = async () => {
    setTranscriptOpen((open) => !open);
    if (!podLang) return;
    const state = langState[podLang];
    if (!transcriptOpen && state.lines.length === 0 && state.scriptUrl) {
      try {
        const response = await fetch(state.scriptUrl);
        patch(podLang, { lines: (await response.json()) as PodcastLine[] });
      } catch {
        /* transcript unavailable; audio remains usable */
      }
    }
  };

  const current = podLang ? langState[podLang] : null;
  const stillDiscovering = langState.tr.status === "loading" || langState.en.status === "loading";
  const langLabel = (lang: PodLang) => (lang === "tr" ? "Türkçe" : "English");
  const langReady = (lang: PodLang) => langState[lang].status === "ready";

  return (
    <section className="rounded-2xl border border-line bg-card p-5 sm:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-xl font-semibold text-ink">🎧 {t("podcast")}</h2>
        <div className="flex items-center gap-2">
          {(podLang || langReady("tr") || langReady("en")) && (
            <div className="flex overflow-hidden rounded-full border border-line text-xs font-semibold">
              {(["tr", "en"] as const).map((lang) => (
                <button
                  key={lang}
                  onClick={() => setPodLang(lang)}
                  className={`px-3 py-1.5 transition-colors ${
                    podLang === lang
                      ? "bg-deniz text-white"
                      : "bg-paper text-ink-soft hover:bg-wash"
                  }`}
                >
                  {langLabel(lang)}{langReady(lang) ? " ✓" : ""}
                </button>
              ))}
            </div>
          )}
          {canGenerate && current && (current.status === "ready" || current.status === "scriptOnly") && podLang && (
            <button
              onClick={() => void generate(podLang, true)}
              className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:border-deniz/40 hover:text-deniz"
            >
              {t("regeneratePodcast")}
            </button>
          )}
        </div>
      </div>

      {stillDiscovering && (
        <div className="pulse-soft rounded-xl bg-wash px-4 py-3 text-sm text-ink-faint">…</div>
      )}

      {!stillDiscovering && !podLang && canGenerate && (
        <div className="space-y-2.5">
          <p className="text-sm font-medium text-ink">{t("podcastAskLang")}</p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void generate("tr")}
              className="rounded-full bg-deniz px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-deniz-deep"
            >
              🇹🇷 Türkçe {t("podcastCreateSuffix")}
            </button>
            <button
              onClick={() => void generate("en")}
              className="rounded-full bg-deniz px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-deniz-deep"
            >
              🇬🇧 English {t("podcastCreateSuffix")}
            </button>
          </div>
        </div>
      )}

      {!stillDiscovering && !podLang && !canGenerate && (
        <p className="rounded-xl bg-wash px-4 py-3 text-sm text-ink-soft">
          {t("podcastPreparedByTeam")}
        </p>
      )}

      {current && podLang && (
        <>
          {current.status === "idle" && canGenerate && (
            <button
              onClick={() => void generate(podLang)}
              className="rounded-full bg-deniz px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-deniz-deep"
            >
              🎧 {t("generatePodcast")} ({langLabel(podLang)})
            </button>
          )}

          {current.status === "generating" && (
            <div className="pulse-soft rounded-xl border border-line bg-wash px-4 py-3 text-sm text-ink-soft">
              {t("podcastGenerating")}
            </div>
          )}

          {current.status === "error" && canGenerate && (
            <div className="space-y-3">
              <div className="rounded-xl border border-clay/30 bg-clay-soft px-4 py-3 text-sm text-clay">
                {t("podcastError")}
              </div>
              <button
                onClick={() => void generate(podLang)}
                className="rounded-full bg-deniz px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-deniz-deep"
              >
                {t("generatePodcast")} ({langLabel(podLang)})
              </button>
            </div>
          )}

          {(current.status === "ready" || current.status === "scriptOnly") && (
            <div className="space-y-3">
              {current.status === "ready" && current.audioUrl && (
                <audio controls src={current.audioUrl} className="w-full">
                  <track kind="captions" />
                </audio>
              )}
              {(current.lines.length > 0 || current.scriptUrl) && (
                <div>
                  <button
                    onClick={() => void openTranscript()}
                    className="text-xs font-semibold uppercase tracking-wide text-deniz hover:text-deniz-deep"
                  >
                    {transcriptOpen ? "− " : "+ "}
                    {t("podcastTranscript")}
                  </button>
                  {transcriptOpen && current.lines.length > 0 && (
                    <div className="rise-in mt-2 max-h-80 space-y-2 overflow-y-auto rounded-xl bg-wash px-4 py-3 text-sm">
                      {current.lines.map((line, index) => (
                        <p key={index}>
                          <span className="font-semibold text-deniz-deep">{line.s}: </span>
                          <span className="text-ink">{line.t}</span>
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
