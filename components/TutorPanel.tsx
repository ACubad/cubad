"use client";

import { useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import { notifyStateChanged, SYNC_APPLIED_EVENT } from "@/lib/sync";
import type { Bi } from "@/lib/types";
import { Md } from "./Md";

interface Msg {
  role: "user" | "model";
  text: string;
}

type Provider = "gemini" | "openai";

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

function loadChats(topicId: string): ChatStore {
  try {
    const raw = window.localStorage.getItem(chatKey(topicId));
    if (raw) return JSON.parse(raw) as ChatStore;
  } catch {
    /* corrupted — start fresh */
  }
  return { convos: [], activeId: null };
}

function saveChats(topicId: string, store: ChatStore) {
  try {
    const trimmed: ChatStore = {
      activeId: store.activeId,
      convos: store.convos
        .slice(-MAX_CONVOS)
        .map((c) => ({ ...c, messages: c.messages.slice(-MAX_MSGS) })),
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [convos, setConvos] = useState<Convo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
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
    saveChats(topicId, { convos: updated, activeId: c.id });
  };

  const deleteChat = () => {
    const updated = convos.filter((c) => c.id !== activeId);
    const nextActive = updated[updated.length - 1] ?? null;
    setConvos(updated);
    setActiveId(nextActive?.id ?? null);
    setMessages(nextActive?.messages ?? []);
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

  const send = async (forcedText?: string) => {
    const text = (forcedText ?? input).trim();
    if (!text || busy) return;
    if (!forcedText) setInput("");
    setError(null);
    setTruncated(false);
    const next: Msg[] = [...messages, { role: "user", text }];
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
      const data = (await res.json()) as { text?: string; truncated?: boolean; error?: string };
      if (!res.ok || !data.text) {
        if (data.error === "bad-key" || data.error === "no-key") {
          forgetKey();
          setError(
            lang === "tr"
              ? "Anahtar reddedildi — lütfen geçerli bir anahtar gir."
              : "The key was rejected — please enter a valid key."
          );
        } else {
          setError(
            lang === "tr"
              ? "Bir şeyler ters gitti; tekrar dener misin?"
              : "Something went wrong; please try again."
          );
        }
        persistMessages(messages);
      } else {
        persistMessages([...next, { role: "model", text: data.text }]);
        setTruncated(Boolean(data.truncated));
      }
    } catch {
      setError(lang === "tr" ? "Bağlantı hatası." : "Network error.");
      persistMessages(messages);
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
                  <Md>{m.text}</Md>
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
              <div className="flex gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
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
                  disabled={busy || needsKey || !input.trim()}
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
