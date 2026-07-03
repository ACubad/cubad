"use client";

import { useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import type { Unit } from "@/lib/types";

interface PodcastLine {
  s: "Deniz" | "Mert";
  t: string;
}

type Status = "idle" | "generating" | "ready" | "scriptOnly" | "error";

const DB_NAME = "cubad-podcasts";
const STORE = "audio";
const KEY_STORAGE = "cubad:gemini-key";

function cacheKey(subject: string, unitSlug: string, lang: string) {
  return `${subject}/${unitSlug}/${lang}`;
}

/**
 * Decode a base64 string that holds UTF-8 bytes (e.g. Turkish text) back into a
 * proper JS string. Plain `atob` returns a Latin-1 binary string, which mangles
 * any multi-byte character, so we re-interpret the bytes as UTF-8.
 */
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
  const { lang, t } = useLang();
  const notes = unit.notes ?? [];
  const [status, setStatus] = useState<Status>("idle");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [lines, setLines] = useState<PodcastLine[]>([]);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [needsKey, setNeedsKey] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const objectUrlRef = useRef<string | null>(null);

  const key = cacheKey(subject, unit.slug, lang);

  // on mount / lang or unit change: check cache
  useEffect(() => {
    if (!notes.length) return;
    let cancelled = false;
    setStatus("idle");
    setAudioUrl(null);
    setLines([]);
    getCached(key).then((cached) => {
      if (cancelled || !cached) return;
      const url = URL.createObjectURL(cached.blob);
      objectUrlRef.current = url;
      setAudioUrl(url);
      setLines(cached.lines);
      setStatus("ready");
    });
    return () => {
      cancelled = true;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, notes.length]);

  if (!notes.length) return null;

  const generate = async () => {
    setStatus("generating");
    setNeedsKey(false);

    const userKey = window.localStorage.getItem(KEY_STORAGE) ?? "";
    try {
      const res = await fetch("/api/podcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          unitSlug: unit.slug,
          lang,
          userKey: userKey || undefined,
        }),
      });

      if (res.status === 401) {
        setNeedsKey(true);
        setStatus("idle");
        return;
      }

      const contentType = res.headers.get("Content-Type") ?? "";
      if (contentType.includes("audio/wav")) {
        const blob = await res.blob();
        const linesB64 = res.headers.get("X-Podcast-Lines");
        const parsedLines: PodcastLine[] = linesB64
          ? (JSON.parse(decodeBase64Utf8(linesB64)) as PodcastLine[])
          : [];
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setAudioUrl(url);
        setLines(parsedLines);
        setStatus("ready");
        await putCached(key, { blob, lines: parsedLines });
        return;
      }

      const data = (await res.json()) as {
        scriptOnly?: boolean;
        lines?: PodcastLine[];
        error?: string;
      };
      if (data.scriptOnly && data.lines) {
        setLines(data.lines);
        setStatus("scriptOnly");
        return;
      }
      setStatus("error");
    } catch {
      setStatus("error");
    }
  };

  const saveKey = () => {
    const k = keyInput.trim();
    if (!k) return;
    window.localStorage.setItem(KEY_STORAGE, k);
    setKeyInput("");
    setNeedsKey(false);
    generate();
  };

  return (
    <section className="rounded-2xl border border-line bg-card p-5 sm:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-xl font-semibold text-ink">
          🎧 {t("podcast")}
        </h2>
        {(status === "ready" || status === "scriptOnly") && (
          <button
            onClick={generate}
            className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:border-deniz/40 hover:text-deniz"
          >
            {t("regeneratePodcast")}
          </button>
        )}
      </div>

      {needsKey && (
        <div className="space-y-3 rounded-xl border border-amber/30 bg-amber-soft px-4 py-3 text-sm">
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

      {status === "idle" && !needsKey && (
        <button
          onClick={generate}
          className="rounded-full bg-deniz px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-deniz-deep"
        >
          🎧 {t("generatePodcast")}
        </button>
      )}

      {status === "generating" && (
        <div className="pulse-soft rounded-xl border border-line bg-wash px-4 py-3 text-sm text-ink-soft">
          {t("podcastGenerating")}
        </div>
      )}

      {status === "error" && (
        <div className="space-y-3">
          <div className="rounded-xl border border-clay/30 bg-clay-soft px-4 py-3 text-sm text-clay">
            {t("podcastError")}
          </div>
          <button
            onClick={generate}
            className="rounded-full bg-deniz px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-deniz-deep"
          >
            {t("generatePodcast")}
          </button>
        </div>
      )}

      {(status === "ready" || status === "scriptOnly") && (
        <div className="space-y-3">
          {status === "ready" && audioUrl && (
            <audio controls src={audioUrl} className="w-full">
              <track kind="captions" />
            </audio>
          )}
          {lines.length > 0 && (
            <div>
              <button
                onClick={() => setTranscriptOpen((o) => !o)}
                className="text-xs font-semibold uppercase tracking-wide text-deniz hover:text-deniz-deep"
              >
                {transcriptOpen ? "− " : "+ "}
                {t("podcastTranscript")}
              </button>
              {transcriptOpen && (
                <div className="rise-in mt-2 max-h-80 space-y-2 overflow-y-auto rounded-xl bg-wash px-4 py-3 text-sm">
                  {lines.map((l, i) => (
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
    </section>
  );
}
