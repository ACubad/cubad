"use client";

import { useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import { canPersistStudyState, notifyStateChanged, SYNC_APPLIED_EVENT } from "@/lib/sync";
import type { Bi } from "@/lib/types";
import { Md } from "./Md";

interface Msg {
  role: "user" | "model";
  text: string;
  attachments?: TutorAttachment[];
}

interface TutorAttachment {
  kind: "image";
  mimeType: string;
  data?: string;
  name?: string;
  size?: number;
}

type Provider = "gemini" | "openai";

type TutorError =
  | "bad-key"
  | "empty-response"
  | "invalid-attachment"
  | "invalid-request"
  | "model-not-found"
  | "network"
  | "no-key"
  | "overloaded"
  | "quota"
  | "rate-limited"
  | "upstream"
  | "upstream-timeout";

interface TutorApiResponse {
  text?: string;
  truncated?: boolean;
  error?: TutorError;
  message?: string;
  retryAfterSeconds?: number;
}

const KEY_STORAGE: Record<Provider, string> = {
  gemini: "cubad:gemini-key",
  openai: "cubad:openai-key",
};

const MODELS: Record<Provider, string[]> = {
  gemini: ["gemini-3.5-flash", "gemini-3.1-pro-preview", "gemini-3-flash-preview", "gemini-2.5-flash"],
  openai: ["gpt-5-mini", "gpt-5", "gpt-4.1-mini", "gpt-4o-mini"],
};
/** old defaults that should silently upgrade to the current default */
const STALE_DEFAULTS = new Set(["gemini-2.5-flash"]);

const KEY_URLS: Record<Provider, string> = {
  gemini: "https://aistudio.google.com/apikey",
  openai: "https://platform.openai.com/api-keys",
};

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const IMAGE_MIME_TYPES = new Set([
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/* ---------- per-topic conversation persistence (localStorage) ---------- */

interface Convo {
  id: string;
  createdAt: number;
  updatedAt?: number;
  messages: Msg[];
}

interface ChatStore {
  convos: Convo[];
  activeId: string | null;
}

const MAX_CONVOS = 10;
const MAX_MSGS = 60;

const chatKey = (topicId: string) => `cubad:chats:${topicId}`;

function messagesForStorage(messages: Msg[]): Msg[] {
  return messages.map((m) => {
    if (!m.attachments?.length) return m;
    return {
      ...m,
      attachments: m.attachments.map(({ kind, mimeType, name, size }) => ({
        kind,
        mimeType,
        name,
        size,
      })),
    };
  });
}

function loadChats(topicId: string): ChatStore {
  if (!canPersistStudyState()) return { convos: [], activeId: null };
  try {
    const raw = window.localStorage.getItem(chatKey(topicId));
    if (raw) return JSON.parse(raw) as ChatStore;
  } catch {
    /* corrupted — start fresh */
  }
  return { convos: [], activeId: null };
}

function saveChats(topicId: string, store: ChatStore) {
  if (!canPersistStudyState()) return;
  try {
    const trimmed: ChatStore = {
      activeId: store.activeId,
      convos: store.convos
        .slice(-MAX_CONVOS)
        .map((c) => ({ ...c, messages: messagesForStorage(c.messages.slice(-MAX_MSGS)) })),
    };
    window.localStorage.setItem(chatKey(topicId), JSON.stringify(trimmed));
    notifyStateChanged(); // include chats in the next cross-device sync push
  } catch {
    /* storage full — chat just won't persist */
  }
}

function convoLabel(c: Convo, fallback: string, locale: string): string {
  const firstUser = c.messages.find((m) => m.role === "user")?.text?.trim();
  const title = firstUser ? firstUser.slice(0, 36) + (firstUser.length > 36 ? "…" : "") : fallback;
  const date = new Date(c.createdAt).toLocaleDateString(locale, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${title} · ${date}`;
}

function formatBytes(bytes?: number) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function photoPrompt(lang: string) {
  return lang === "tr"
    ? "Bu fotoğrafı bu sorunun bağlamında açıklayabilir misin?"
    : "Please help me understand this photo in the context of this question.";
}

function tutorErrorMessage(
  code: TutorError | undefined,
  lang: string,
  providerLabel: string,
  model: string,
  retryAfterSeconds?: number
) {
  const retry = retryAfterSeconds
    ? lang === "tr"
      ? ` ${retryAfterSeconds} saniye sonra tekrar dene.`
      : ` Try again in about ${retryAfterSeconds} seconds.`
    : "";

  switch (code) {
    case "bad-key":
    case "no-key":
      return lang === "tr"
        ? "Anahtar reddedildi - lütfen geçerli bir anahtar gir."
        : "The key was rejected - please enter a valid key.";
    case "rate-limited":
      return lang === "tr"
        ? "Paylaşılan eğitmen saatlik sınırına ulaştı. Bir saat sonra tekrar dene veya kendi API anahtarını kullan."
        : "The shared tutor reached its hourly limit. Try again in an hour or use your own API key.";
    case "quota":
      return lang === "tr"
        ? `${providerLabel} bu anahtar için kota/billing sınırına takıldı (${model}). AI Studio kota-billing sayfasını kontrol et veya başka bir model/anahtar dene.${retry}`
        : `${providerLabel} hit a quota or billing limit for this key (${model}). Check AI Studio rate limits/billing or try another model/key.${retry}`;
    case "overloaded":
      return lang === "tr"
        ? `${providerLabel} şu anda bu modelde yoğunluk bildiriyor (${model}). Biraz sonra tekrar dene veya ayarlardan daha hafif bir modele geç.${retry}`
        : `${providerLabel} says this model is overloaded right now (${model}). Try again shortly or switch to a lighter model in settings.${retry}`;
    case "model-not-found":
      return lang === "tr"
        ? `Bu model bu anahtar için kullanılabilir görünmüyor: ${model}. Ayarlardan gemini-2.5-flash gibi görünen bir model seç.`
        : `This model does not look available for this key: ${model}. Pick a visible model like gemini-2.5-flash in settings.`;
    case "invalid-attachment":
      return lang === "tr"
        ? "Bu fotoğraf türü veya boyutu desteklenmiyor. JPEG, PNG, WebP, GIF veya HEIC olarak 6 MB altında dene."
        : "That photo type or size is not supported. Try JPEG, PNG, WebP, GIF, or HEIC under 6 MB.";
    case "invalid-request":
      return lang === "tr"
        ? `${providerLabel} isteği reddetti. Fotoğrafı küçültmeyi veya farklı bir model seçmeyi dene.`
        : `${providerLabel} rejected the request. Try a smaller photo or a different model.`;
    case "upstream-timeout":
      return lang === "tr"
        ? `${providerLabel} zamanında cevap vermedi. Daha sonra tekrar dene veya başka bir modele geç.`
        : `${providerLabel} did not answer before timeout. Try again later or switch models.`;
    case "empty-response":
      return lang === "tr"
        ? `${providerLabel} boş cevap döndürdü. Tekrar deneyebilirsin.`
        : `${providerLabel} returned an empty answer. Please try again.`;
    case "network":
      return lang === "tr" ? "Bağlantı hatası." : "Network error.";
    default:
      return lang === "tr"
        ? "Bir şeyler ters gitti; tekrar dener misin?"
        : "Something went wrong; please try again.";
  }
}

export function tutorErrorState(
  error: TutorError | undefined,
  lang: "tr" | "en",
  providerLabel = "AI",
  model = "",
  retryAfterSeconds?: number
): { message: string; forgetKey: boolean } {
  return {
    forgetKey: error === "bad-key" || error === "no-key",
    message: tutorErrorMessage(error, lang, providerLabel, model, retryAfterSeconds),
  };
}

export function TutorPanel({
  subject,
  topicId,
  topicTitle,
  context,
}: {
  subject?: string;
  /** stable id for this page's chat history, e.g. "hidroloji/q/2-5" */
  topicId: string;
  topicTitle: Bi;
  context: string;
}) {
  const { lang, t, bi } = useLang();
  const [open, setOpen] = useState(false);
  const [serverKeys, setServerKeys] = useState<{ gemini: boolean; openai: boolean } | null>(null);
  const [provider, setProvider] = useState<Provider>("gemini");
  const [model, setModel] = useState<string>(MODELS.gemini[0]);
  const [customModel, setCustomModel] = useState("");
  const [userKeys, setUserKeys] = useState<Record<Provider, string>>({ gemini: "", openai: "" });
  const [keyInput, setKeyInput] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [attachment, setAttachment] = useState<TutorAttachment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [convos, setConvos] = useState<Convo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);

  // restore this topic's conversations (and refresh when a sync pulls new ones)
  useEffect(() => {
    const restore = () => {
      const store = loadChats(topicId);
      setConvos(store.convos);
      const active =
        store.convos.find((c) => c.id === store.activeId) ??
        store.convos[store.convos.length - 1];
      setActiveId(active?.id ?? null);
      setMessages(active?.messages ?? []);
      setAttachment(null);
    };
    restore();
    const onSync = () => {
      if (!busyRef.current) restore();
    };
    window.addEventListener(SYNC_APPLIED_EVENT, onSync);
    return () => window.removeEventListener(SYNC_APPLIED_EVENT, onSync);
  }, [topicId]);

  /** update messages of the active conversation (creating one if needed) and persist */
  const persistMessages = (next: Msg[]) => {
    setMessages(next);
    setConvos((prev) => {
      let id = activeId;
      let list = prev;
      if (!id || !list.some((c) => c.id === id)) {
        id = crypto.randomUUID();
        list = [...list, { id, createdAt: Date.now(), messages: [] }];
        setActiveId(id);
      }
      const updated = list.map((c) =>
        c.id === id ? { ...c, messages: next, updatedAt: Date.now() } : c
      );
      saveChats(topicId, { convos: updated, activeId: id });
      return updated;
    });
  };

  const switchConvo = (id: string) => {
    setActiveId(id);
    const c = convos.find((x) => x.id === id);
    setMessages(c?.messages ?? []);
    setAttachment(null);
    saveChats(topicId, { convos, activeId: id });
  };

  const newChat = () => {
    // reuse the current conversation if it's still empty
    const active = convos.find((c) => c.id === activeId);
    if (active && active.messages.length === 0) return;
    const c: Convo = { id: crypto.randomUUID(), createdAt: Date.now(), messages: [] };
    const updated = [...convos, c];
    setConvos(updated);
    setActiveId(c.id);
    setMessages([]);
    setAttachment(null);
    saveChats(topicId, { convos: updated, activeId: c.id });
  };

  const deleteChat = () => {
    const updated = convos.filter((c) => c.id !== activeId);
    const nextActive = updated[updated.length - 1] ?? null;
    setConvos(updated);
    setActiveId(nextActive?.id ?? null);
    setMessages(nextActive?.messages ?? []);
    setAttachment(null);
    saveChats(topicId, { convos: updated, activeId: nextActive?.id ?? null });
  };

  // restore saved settings + keys
  useEffect(() => {
    const p = window.localStorage.getItem("cubad:tutor:provider") as Provider | null;
    let m = window.localStorage.getItem("cubad:tutor:model");
    if (p === "gemini" || p === "openai") setProvider(p);
    if (m && STALE_DEFAULTS.has(m)) {
      // an old saved default — upgrade to the current one
      m = MODELS[p === "openai" ? "openai" : "gemini"][0];
      window.localStorage.setItem("cubad:tutor:model", m);
    }
    if (m) {
      setModel(m);
      if (!MODELS[p === "openai" ? "openai" : "gemini"].includes(m)) setCustomModel(m);
    }
    setUserKeys({
      gemini: window.localStorage.getItem(KEY_STORAGE.gemini) ?? "",
      openai: window.localStorage.getItem(KEY_STORAGE.openai) ?? "",
    });
  }, []);

  useEffect(() => {
    if (!open || serverKeys !== null) return;
    fetch("/api/tutor")
      .then((r) => r.json())
      .then((d: { gemini: boolean; openai: boolean }) =>
        setServerKeys({ gemini: !!d.gemini, openai: !!d.openai })
      )
      .catch(() => setServerKeys({ gemini: false, openai: false }));
  }, [open, serverKeys]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const hasServerKey = serverKeys?.[provider] ?? false;
  const hasUserKey = Boolean(userKeys[provider]);
  const needsKey = serverKeys !== null && !hasServerKey && !hasUserKey;

  const pickProvider = (p: Provider) => {
    setProvider(p);
    const first = MODELS[p][0];
    setModel(first);
    setCustomModel("");
    window.localStorage.setItem("cubad:tutor:provider", p);
    window.localStorage.setItem("cubad:tutor:model", first);
    setError(null);
  };

  const pickModel = (m: string) => {
    setModel(m);
    window.localStorage.setItem("cubad:tutor:model", m);
  };

  const saveKey = () => {
    const k = keyInput.trim();
    if (!k) return;
    window.localStorage.setItem(KEY_STORAGE[provider], k);
    setUserKeys((prev) => ({ ...prev, [provider]: k }));
    setKeyInput("");
    setError(null);
  };

  const forgetKey = () => {
    window.localStorage.removeItem(KEY_STORAGE[provider]);
    setUserKeys((prev) => ({ ...prev, [provider]: "" }));
  };

  const clearAttachment = () => {
    setAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const attachFile = (file: File | undefined) => {
    if (!file) return;
    const mimeType = file.type || "image/jpeg";
    if (!IMAGE_MIME_TYPES.has(mimeType) || file.size > MAX_IMAGE_BYTES) {
      setError(tutorErrorMessage("invalid-attachment", lang, providerLabel, model));
      clearAttachment();
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      const data = comma >= 0 ? result.slice(comma + 1) : result;
      if (!data) {
        setError(tutorErrorMessage("invalid-attachment", lang, providerLabel, model));
        return;
      }
      setAttachment({
        kind: "image",
        mimeType,
        data,
        name: file.name,
        size: file.size,
      });
      setError(null);
      setTruncated(false);
    };
    reader.onerror = () => setError(tutorErrorMessage("invalid-attachment", lang, providerLabel, model));
    reader.readAsDataURL(file);
  };

  const send = async (forcedText?: string) => {
    const selectedAttachment = forcedText ? null : attachment;
    const rawText = (forcedText ?? input).trim();
    const text = rawText || (selectedAttachment ? photoPrompt(lang) : "");
    if ((!text && !selectedAttachment) || busy) return;
    const previousInput = input;
    const previousAttachment = attachment;
    if (!forcedText) {
      setInput("");
      clearAttachment();
    }
    setError(null);
    setTruncated(false);
    const next: Msg[] = [
      ...messages,
      {
        role: "user",
        text,
        ...(selectedAttachment ? { attachments: [selectedAttachment] } : {}),
      },
    ];
    persistMessages(next);
    setBusy(true);
    busyRef.current = true;
    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next,
          context,
          subject,
          lang,
          provider,
          model,
          userKey: userKeys[provider] || undefined,
        }),
      });
      const data = (await res.json()) as TutorApiResponse;
      if (!res.ok || !data.text) {
        const errorState = tutorErrorState(
          data.error,
          lang,
          providerLabel,
          model,
          data.retryAfterSeconds
        );
        if (errorState.forgetKey) forgetKey();
        setError(errorState.message);
        persistMessages(messages);
        if (!forcedText) {
          setInput(previousInput);
          setAttachment(previousAttachment);
        }
        return;
      } else {
        persistMessages([...next, { role: "model", text: data.text }]);
        setTruncated(Boolean(data.truncated));
      }
    } catch {
      setError(tutorErrorMessage("network", lang, providerLabel, model));
      persistMessages(messages);
      if (!forcedText) {
        setInput(previousInput);
        setAttachment(previousAttachment);
      }
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  };

  const providerLabel = provider === "gemini" ? "Google Gemini" : "OpenAI";

  return (
    <>
      {/* floating button */}
      <button
        onClick={() => setOpen(true)}
        className={`no-print fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-deniz-deep px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(9,60,73,0.4)] transition-transform hover:scale-105 ${
          open ? "hidden" : ""
        }`}
      >
        <span aria-hidden>🎓</span> {t("askTutor")}
      </button>

      {/* drawer */}
      {open && (
        <div className="no-print fixed inset-0 z-50 flex justify-end bg-ink/30" onClick={() => setOpen(false)}>
          <div
            className="flex h-full w-full max-w-md flex-col bg-paper shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line bg-card px-4 py-3">
              <p className="font-display text-lg font-semibold text-deniz-deep">
                🎓 {t("tutorTitle")}
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowSettings((s) => !s)}
                  className={`rounded-full px-2.5 py-1 text-sm ${showSettings ? "bg-wash text-deniz-deep" : "text-ink-soft hover:bg-wash"}`}
                  title="Model settings"
                  aria-label="settings"
                >
                  ⚙
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-full px-2.5 py-1 text-ink-soft hover:bg-wash"
                  aria-label="close"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* conversation switcher — history is scoped to THIS topic only */}
            {convos.length > 0 && (
              <div className="flex items-center gap-2 border-b border-line bg-card px-4 py-2">
                <select
                  value={activeId ?? ""}
                  onChange={(e) => switchConvo(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-2 py-1.5 text-xs"
                  aria-label={t("pastChats")}
                >
                  {[...convos].reverse().map((c) => (
                    <option key={c.id} value={c.id}>
                      {convoLabel(c, t("emptyChatTitle"), lang === "tr" ? "tr-TR" : "en-GB")}
                    </option>
                  ))}
                </select>
                <button
                  onClick={newChat}
                  className="shrink-0 rounded-full border border-deniz/40 px-2.5 py-1 text-xs font-semibold text-deniz transition-colors hover:bg-deniz-soft"
                >
                  ＋ {t("newChat")}
                </button>
                <button
                  onClick={deleteChat}
                  aria-label="delete conversation"
                  title={t("deleteChat")}
                  className="shrink-0 rounded-full px-2 py-1 text-xs text-ink-faint transition-colors hover:bg-clay-soft hover:text-clay"
                >
                  🗑
                </button>
              </div>
            )}

            {/* model / provider settings */}
            {showSettings && (
              <div className="space-y-3 border-b border-line bg-card px-4 py-3 text-sm">
                <div className="flex overflow-hidden rounded-full border border-line text-xs font-semibold">
                  {(["gemini", "openai"] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => pickProvider(p)}
                      className={`flex-1 px-3 py-1.5 transition-colors ${
                        provider === p ? "bg-deniz text-white" : "bg-paper text-ink-soft hover:bg-wash"
                      }`}
                    >
                      {p === "gemini" ? "Gemini" : "OpenAI"}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {MODELS[provider].map((m) => (
                    <button
                      key={m}
                      onClick={() => { pickModel(m); setCustomModel(""); }}
                      className={`rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                        model === m && !customModel
                          ? "border-deniz bg-deniz-soft text-deniz-deep"
                          : "border-line bg-paper text-ink-soft hover:border-deniz/40"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={customModel}
                  onChange={(e) => {
                    setCustomModel(e.target.value);
                    if (e.target.value.trim()) pickModel(e.target.value.trim());
                  }}
                  placeholder={lang === "tr" ? "veya özel model adı..." : "or a custom model id..."}
                  className="w-full rounded-lg border border-line bg-paper px-3 py-1.5 font-mono text-xs"
                />
                <div className="flex items-center justify-between gap-2 text-xs">
                  {hasServerKey ? (
                    <span className="text-moss">✓ {lang === "tr" ? "Sunucu anahtarı aktif" : "Server key active"}</span>
                  ) : hasUserKey ? (
                    <>
                      <span className="text-moss">
                        ✓ {lang === "tr" ? `${providerLabel} anahtarı kayıtlı (tarayıcında)` : `${providerLabel} key saved (in your browser)`}
                      </span>
                      <button onClick={forgetKey} className="shrink-0 rounded-full border border-clay/40 px-2.5 py-1 font-semibold text-clay hover:bg-clay-soft">
                        {lang === "tr" ? "Anahtarı unut" : "Forget key"}
                      </button>
                    </>
                  ) : (
                    <span className="text-ink-faint">{lang === "tr" ? "Anahtar gerekli" : "Key required"}</span>
                  )}
                </div>
              </div>
            )}

            <div ref={scrollRef} className="thin-scroll flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {messages.length === 0 && !needsKey && (
                <div className="rounded-xl bg-wash px-4 py-3 text-sm text-ink-soft">
                  {lang === "tr"
                    ? `"${bi(topicTitle)}" hakkında istediğini sor: anlamadığın bir nokta, farklı bir değerle ne olurdu, ya da benzer bir alıştırma sorusu.`
                    : `Ask anything about "${bi(topicTitle)}": a point you didn't get, what happens with different values, or ask for a similar practice question.`}
                  <span className="mt-2 block font-mono text-[11px] text-ink-faint">
                    {providerLabel} · {model}
                  </span>
                </div>
              )}

              {needsKey && (
                <div className="space-y-3 rounded-xl border border-amber/30 bg-amber-soft px-4 py-3 text-sm">
                  <p className="text-ink">
                    {lang === "tr"
                      ? `Yapay zekâ öğretmen için (ücretsiz) bir ${providerLabel} API anahtarı gerekli. Aşağıya yapıştır — sadece tarayıcında saklanır.`
                      : `The AI tutor needs a ${providerLabel} API key. Paste it below — it is stored only in your browser.`}
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={keyInput}
                      onChange={(e) => setKeyInput(e.target.value)}
                      placeholder={provider === "gemini" ? "AIza..." : "sk-..."}
                      className="min-w-0 flex-1 rounded-lg border border-line bg-card px-3 py-2 font-mono text-xs"
                    />
                    <button
                      onClick={saveKey}
                      className="shrink-0 rounded-lg bg-deniz px-3 py-2 text-xs font-semibold text-white hover:bg-deniz-deep"
                    >
                      {t("saveKey")}
                    </button>
                  </div>
                  <a
                    href={KEY_URLS[provider]}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block text-xs font-semibold text-deniz underline"
                  >
                    {KEY_URLS[provider].replace("https://", "")} ↗
                  </a>
                </div>
              )}

              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`max-w-[92%] rounded-2xl px-4 py-2.5 text-sm ${
                    m.role === "user"
                      ? "ml-auto bg-deniz text-white [&_.prose-cubad]:text-white"
                      : "bg-card border border-line"
                  }`}
                >
                  {m.attachments?.map((a, ix) => (
                    <div key={`${a.name ?? a.mimeType}-${ix}`} className={m.text ? "mb-2" : ""}>
                      {a.data ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`data:${a.mimeType};base64,${a.data}`}
                          alt={a.name ?? "Attached image"}
                          className="max-h-48 w-full rounded-xl border border-white/20 object-cover"
                        />
                      ) : (
                        <div className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs">
                          {a.name ?? (lang === "tr" ? "Ekli fotoğraf" : "Attached photo")}
                        </div>
                      )}
                    </div>
                  ))}
                  {m.text && <Md>{m.text}</Md>}
                </div>
              ))}

              {truncated && !busy && (
                <button
                  onClick={() => send(lang === "tr" ? "devam et" : "continue")}
                  className="rise-in flex items-center gap-1.5 rounded-full border border-deniz/40 bg-deniz-soft px-3.5 py-1.5 text-xs font-semibold text-deniz-deep transition-colors hover:bg-deniz hover:text-white"
                >
                  ▸ {t("continueReply")}
                </button>
              )}

              {busy && (
                <div className="pulse-soft rounded-2xl border border-line bg-card px-4 py-2.5 text-sm text-ink-faint">
                  {t("thinking")}
                </div>
              )}

              {error && (
                <div className="rounded-xl border border-clay/30 bg-clay-soft px-4 py-2.5 text-sm text-clay">
                  {error}
                </div>
              )}
            </div>

            <div className="border-t border-line bg-card p-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => attachFile(e.target.files?.[0])}
              />
              {attachment && (
                <div className="mb-2 flex items-center gap-2 rounded-xl border border-line bg-paper p-2">
                  {attachment.data && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`data:${attachment.mimeType};base64,${attachment.data}`}
                      alt=""
                      className="h-12 w-12 shrink-0 rounded-lg object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-ink">
                      {attachment.name ?? (lang === "tr" ? "Fotoğraf" : "Photo")}
                    </p>
                    <p className="text-[11px] text-ink-faint">{formatBytes(attachment.size)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={clearAttachment}
                    className="shrink-0 rounded-full px-2 py-1 text-sm text-ink-faint hover:bg-wash hover:text-clay"
                    aria-label={lang === "tr" ? "Fotoğrafı kaldır" : "Remove photo"}
                    title={lang === "tr" ? "Fotoğrafı kaldır" : "Remove photo"}
                  >
                    ×
                  </button>
                </div>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy || needsKey}
                  className="shrink-0 self-end rounded-xl border border-line bg-paper px-3 py-2.5 text-sm font-semibold text-deniz transition-colors hover:border-deniz/50 hover:bg-deniz-soft disabled:opacity-40"
                  aria-label={lang === "tr" ? "Fotoğraf ekle" : "Attach photo"}
                  title={lang === "tr" ? "Fotoğraf ekle" : "Attach photo"}
                >
                  <span aria-hidden>&#128247;</span>
                </button>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onPaste={(e) => {
                    const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
                    if (file) {
                      e.preventDefault();
                      attachFile(file);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  rows={2}
                  placeholder={t("tutorPlaceholder")}
                  disabled={needsKey}
                  className="min-w-0 flex-1 resize-none rounded-xl border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-deniz/50 disabled:opacity-50"
                />
                <button
                  onClick={() => send()}
                  disabled={busy || needsKey || (!input.trim() && !attachment)}
                  className="shrink-0 self-end rounded-xl bg-deniz px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-deniz-deep disabled:opacity-40"
                >
                  {t("send")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
