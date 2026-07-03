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

const DB_NAME = "cubad-podcasts";
const STORE = "audio";
const KEY_STORAGE = "cubad:gemini-key";

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
  // which language's podcast is being viewed; null = not chosen yet (ask the user)
  const [podLang, setPodLang] = useState<PodLang | null>(null);
  const [langState, setLangState] = useState<Record<PodLang, LangState>>({
    tr: FRESH,
    en: FRESH,
  });
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [needsKey, setNeedsKey] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const objectUrlsRef = useRef<string[]>([]);

  const patch = useCallback((l: PodLang, s: Partial<LangState>) => {
    setLangState((prev) => ({ ...prev, [l]: { ...prev[l], ...s } }));
  }, []);

  // discover what already exists: cloud library first, then local device cache
  useEffect(() => {
    if (!notes.length) return;
    let cancelled = false;

    const discover = async (l: PodLang, cloud: { audio: string; script: string | null } | null) => {
      if (cloud) {
        patch(l, { status: "ready", audioUrl: cloud.audio, scriptUrl: cloud.script });
        return true;
      }
      const cached = await getCached(cacheKey(subject, unit.slug, l));
      if (cached && !cancelled) {
        const url = URL.createObjectURL(cached.blob);
        objectUrlsRef.current.push(url);
        patch(l, { status: "ready", audioUrl: url, lines: cached.lines });
        return true;
      }
      patch(l, { status: "idle" });
      return false;
    };

    fetch(`/api/podcast?subject=${encodeURIComponent(subject)}&unit=${encodeURIComponent(unit.slug)}`)
      .then((r) => r.json())
      .then(async (d: { tr: { audio: string; script: string | null } | null; en: { audio: string; script: string | null } | null }) => {
        if (cancelled) return;
        const [hasTr, hasEn] = await Promise.all([discover("tr", d.tr), discover("en", d.en)]);
        // auto-select: an existing podcast in the UI language, else any existing one
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

  const generate = async (l: PodLang, force = false) => {
    setPodLang(l);
    patch(l, { status: "generating" });
    setNeedsKey(false);

    const userKey = window.localStorage.getItem(KEY_STORAGE) ?? "";
    try {
      const res = await fetch("/api/podcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          unitSlug: unit.slug,
          lang: l,
          userKey: userKey || undefined,
          force,
        }),
      });

      if (res.status === 401) {
        setNeedsKey(true);
        patch(l, { status: "idle" });
        return;
      }

      const contentType = res.headers.get("Content-Type") ?? "";
      if (contentType.includes("audio/wav")) {
        // no cloud storage configured — device-local mode
        const blob = await res.blob();
        const linesB64 = res.headers.get("X-Podcast-Lines");
        const parsedLines: PodcastLine[] = linesB64
          ? (JSON.parse(decodeBase64Utf8(linesB64)) as PodcastLine[])
          : [];
        const url = URL.createObjectURL(blob);
        objectUrlsRef.current.push(url);
        patch(l, { status: "ready", audioUrl: url, lines: parsedLines });
        await putCached(cacheKey(subject, unit.slug, l), { blob, lines: parsedLines });
        return;
      }

      const data = (await res.json()) as {
        url?: string;
        scriptUrl?: string | null;
        scriptOnly?: boolean;
        lines?: PodcastLine[];
        error?: string;
      };
      if (data.url) {
        // stored in the cloud — same file on every device
        patch(l, {
          status: "ready",
          audioUrl: data.url,
          scriptUrl: data.scriptUrl ?? null,
          lines: data.lines ?? [],
        });
        return;
      }
      if (data.scriptOnly && data.lines) {
        patch(l, { status: "scriptOnly", lines: data.lines });
        return;
      }
      patch(l, { status: "error" });
    } catch {
      patch(l, { status: "error" });
    }
  };

  const openTranscript = async () => {
    setTranscriptOpen((o) => !o);
    if (!podLang) return;
    const s = langState[podLang];
    if (!transcriptOpen && s.lines.length === 0 && s.scriptUrl) {
      try {
        const r = await fetch(s.scriptUrl);
        const lines = (await r.json()) as PodcastLine[];
        patch(podLang, { lines });
      } catch {
        /* transcript unavailable — audio still plays */
      }
    }
  };

  const saveKey = () => {
    const k = keyInput.trim();
    if (!k) return;
    window.localStorage.setItem(KEY_STORAGE, k);
    setKeyInput("");
    setNeedsKey(false);
    if (podLang) generate(podLang);
  };

  const cur = podLang ? langState[podLang] : null;
  const stillDiscovering = langState.tr.status === "loading" || langState.en.status === "loading";

  const langLabel = (l: PodLang) => (l === "tr" ? "Türkçe" : "English");
  const langReady = (l: PodLang) => langState[l].status === "ready";

  return (
    <section className="rounded-2xl border border-line bg-card p-5 sm:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-xl font-semibold text-ink">🎧 {t("podcast")}</h2>
        <div className="flex items-center gap-2">
          {/* language chips — always visible once something exists or a lang is chosen */}
          {(podLang || langReady("tr") || langReady("en")) && (
            <div className="flex overflow-hidden rounded-full border border-line text-xs font-semibold">
              {(["tr", "en"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setPodLang(l)}
                  className={`px-3 py-1.5 transition-colors ${
                    podLang === l
                      ? "bg-deniz text-white"
                      : "bg-paper text-ink-soft hover:bg-wash"
                  }`}
                >
                  {langLabel(l)}
                  {langReady(l) ? " ✓" : ""}
                </button>
              ))}
            </div>
          )}
          {cur && (cur.status === "ready" || cur.status === "scriptOnly") && podLang && (
            <button
              onClick={() => generate(podLang, true)}
              className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:border-deniz/40 hover:text-deniz"
            >
              {t("regeneratePodcast")}
            </button>
          )}
        </div>
      </div>

      {needsKey && (
        <div className="mb-3 space-y-3 rounded-xl border border-amber/30 bg-amber-soft px-4 py-3 text-sm">
          <p className="text-ink">{t("podcastNeedsKey")}</p>
          <div className="flex gap-2">
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="AIza..."
              className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 font-mono text-xs"
            />
            <button
              onClick={saveKey}
              className="shrink-0 rounded-lg bg-deniz px-3 py-2 text-xs font-semibold text-white hover:bg-deniz-deep"
            >
              {t("saveKey")}
            </button>
          </div>
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
            className="inline-block text-xs font-semibold text-deniz underline"
          >
            aistudio.google.com/apikey ↗
          </a>
        </div>
      )}

      {stillDiscovering && (
        <div className="pulse-soft rounded-xl bg-wash px-4 py-3 text-sm text-ink-faint">…</div>
      )}

      {/* nothing chosen yet → ask the language FIRST */}
      {!stillDiscovering && !podLang && !needsKey && (
        <div className="space-y-2.5">
          <p className="text-sm font-medium text-ink">{t("podcastAskLang")}</p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => generate("tr")}
              className="rounded-full bg-deniz px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-deniz-deep"
            >
              🇹🇷 Türkçe {t("podcastCreateSuffix")}
            </button>
            <button
              onClick={() => generate("en")}
              className="rounded-full bg-deniz px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-deniz-deep"
            >
              🇬🇧 English {t("podcastCreateSuffix")}
            </button>
          </div>
        </div>
      )}

      {cur && podLang && (
        <>
          {cur.status === "idle" && !needsKey && (
            <button
              onClick={() => generate(podLang)}
              className="rounded-full bg-deniz px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-deniz-deep"
            >
              🎧 {t("generatePodcast")} ({langLabel(podLang)})
            </button>
          )}

          {cur.status === "generating" && (
            <div className="pulse-soft rounded-xl border border-line bg-wash px-4 py-3 text-sm text-ink-soft">
              {t("podcastGenerating")}
            </div>
          )}

          {cur.status === "error" && (
            <div className="space-y-3">
              <div className="rounded-xl border border-clay/30 bg-clay-soft px-4 py-3 text-sm text-clay">
                {t("podcastError")}
              </div>
              <button
                onClick={() => generate(podLang)}
                className="rounded-full bg-deniz px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-deniz-deep"
              >
                {t("generatePodcast")} ({langLabel(podLang)})
              </button>
            </div>
          )}

          {(cur.status === "ready" || cur.status === "scriptOnly") && (
            <div className="space-y-3">
              {cur.status === "ready" && cur.audioUrl && (
                <audio controls src={cur.audioUrl} className="w-full">
                  <track kind="captions" />
                </audio>
              )}
              {(cur.lines.length > 0 || cur.scriptUrl) && (
                <div>
                  <button
                    onClick={openTranscript}
                    className="text-xs font-semibold uppercase tracking-wide text-deniz hover:text-deniz-deep"
                  >
                    {transcriptOpen ? "− " : "+ "}
                    {t("podcastTranscript")}
                  </button>
                  {transcriptOpen && cur.lines.length > 0 && (
                    <div className="rise-in mt-2 max-h-80 space-y-2 overflow-y-auto rounded-xl bg-wash px-4 py-3 text-sm">
                      {cur.lines.map((l, i) => (
                        <p key={i}>
                          <span className="font-semibold text-deniz-deep">{l.s}: </span>
                          <span className="text-ink">{l.t}</span>
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
