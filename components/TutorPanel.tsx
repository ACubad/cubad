"use client";

import { useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import type { Question } from "@/lib/types";
import { Md } from "./Md";

interface Msg {
  role: "user" | "model";
  text: string;
}

const KEY_STORAGE = "cubad:gemini-key";

export function TutorPanel({ question }: { question: Question }) {
  const { lang, t, bi } = useLang();
  const [open, setOpen] = useState(false);
  const [hasServerKey, setHasServerKey] = useState<boolean | null>(null);
  const [userKey, setUserKey] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setUserKey(window.localStorage.getItem(KEY_STORAGE) ?? "");
  }, []);

  useEffect(() => {
    if (!open || hasServerKey !== null) return;
    fetch("/api/tutor")
      .then((r) => r.json())
      .then((d: { hasServerKey: boolean }) => setHasServerKey(d.hasServerKey))
      .catch(() => setHasServerKey(false));
  }, [open, hasServerKey]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const needsKey = hasServerKey === false && !userKey;

  const saveKey = () => {
    const k = keyInput.trim();
    if (!k) return;
    window.localStorage.setItem(KEY_STORAGE, k);
    setUserKey(k);
    setKeyInput("");
    setError(null);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setError(null);
    const next: Msg[] = [...messages, { role: "user", text }];
    setMessages(next);
    setBusy(true);
    try {
      const context = JSON.stringify({
        id: question.id,
        code: question.code,
        title: question.title,
        statement: question.statement,
        goal: question.goal,
        finalAnswer: question.finalAnswer,
      });
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, context, lang, userKey: userKey || undefined }),
      });
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok || !data.text) {
        if (data.error === "bad-key") {
          window.localStorage.removeItem(KEY_STORAGE);
          setUserKey("");
          setError(
            lang === "tr"
              ? "Anahtar reddedildi — lütfen geçerli bir Gemini anahtarı gir."
              : "The key was rejected — please enter a valid Gemini key."
          );
        } else {
          setError(
            lang === "tr"
              ? "Bir şeyler ters gitti; tekrar dener misin?"
              : "Something went wrong; please try again."
          );
        }
        setMessages(messages);
      } else {
        setMessages([...next, { role: "model", text: data.text }]);
      }
    } catch {
      setError(lang === "tr" ? "Bağlantı hatası." : "Network error.");
      setMessages(messages);
    } finally {
      setBusy(false);
    }
  };

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
              <button
                onClick={() => setOpen(false)}
                className="rounded-full px-2.5 py-1 text-ink-soft hover:bg-wash"
                aria-label="close"
              >
                ✕
              </button>
            </div>

            <div ref={scrollRef} className="thin-scroll flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {messages.length === 0 && !needsKey && (
                <div className="rounded-xl bg-wash px-4 py-3 text-sm text-ink-soft">
                  {lang === "tr"
                    ? `"${bi(question.title)}" hakkında istediğini sor: bir adımı anlamadıysan, farklı bir değerle ne olurdu merak ediyorsan, ya da benzer bir soru istiyorsan.`
                    : `Ask anything about "${bi(question.title)}": a step you didn't get, what happens with different values, or ask for a similar practice question.`}
                </div>
              )}

              {needsKey && (
                <div className="space-y-3 rounded-xl border border-amber/30 bg-amber-soft px-4 py-3 text-sm">
                  <p className="text-ink">{t("tutorNeedsKey")}</p>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={keyInput}
                      onChange={(e) => setKeyInput(e.target.value)}
                      placeholder="AIza..."
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
                    href="https://aistudio.google.com/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block text-xs font-semibold text-deniz underline"
                  >
                    aistudio.google.com/apikey ↗
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
                  onClick={send}
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
