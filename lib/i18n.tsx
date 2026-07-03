"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Bi, Lang } from "./types";

const STRINGS = {
  tagline: { en: "Pass by understanding.", tr: "Anlayarak geç." },
  units: { en: "Units", tr: "Konular" },
  formulas: { en: "Formula sheet", tr: "Formül kartı" },
  questions: { en: "questions", tr: "soru" },
  question: { en: "Question", tr: "Soru" },
  quiz: { en: "Quick quiz", tr: "Mini sınav" },
  progress: { en: "Progress", tr: "İlerleme" },
  step: { en: "Step", tr: "Adım" },
  of: { en: "of", tr: "/" },
  showHint: { en: "Give me a hint", tr: "İpucu ver" },
  revealStep: { en: "Show me this step", tr: "Adımı göster" },
  nextStep: { en: "Next step", tr: "Sonraki adım" },
  whyThis: { en: "Why do we do this?", tr: "Bunu neden yapıyoruz?" },
  result: { en: "Result of this step", tr: "Bu adımın sonucu" },
  finalAnswer: { en: "Final answer", tr: "Sonuç" },
  traps: { en: "Exam traps — watch out!", tr: "Sınav tuzakları — dikkat!" },
  whatIfs: { en: "What if...? (scenario changes)", tr: "Ya olsaydı...? (senaryo değişimleri)" },
  givenValues: { en: "Given", tr: "Verilenler" },
  goal: { en: "What is asked", tr: "Ne isteniyor" },
  statement: { en: "Question", tr: "Soru" },
  guidingIntro: { en: "Think first", tr: "Önce düşün" },
  hint: { en: "Hint", tr: "İpucu" },
  done: { en: "Completed", tr: "Tamamlandı" },
  markDone: { en: "Mark as completed", tr: "Tamamlandı olarak işaretle" },
  nextQuestion: { en: "Next question", tr: "Sonraki soru" },
  prevQuestion: { en: "Previous question", tr: "Önceki soru" },
  backToUnit: { en: "Back to unit", tr: "Konuya dön" },
  conceptPrimer: { en: "Concept primer", tr: "Konu özeti" },
  keyFormulas: { en: "Key formulas", tr: "Temel formüller" },
  whenToUse: { en: "When to use", tr: "Ne zaman kullanılır" },
  startWalkthrough: { en: "Start walkthrough", tr: "Çözüme başla" },
  continueWalkthrough: { en: "Continue", tr: "Devam et" },
  review: { en: "Review", tr: "Tekrar et" },
  revealAll: { en: "Reveal all steps (review mode)", tr: "Tüm adımları göster (tekrar modu)" },
  difficulty: { en: "Difficulty", tr: "Zorluk" },
  examLikelihood: { en: "Exam likelihood", tr: "Sınavda çıkma olasılığı" },
  high: { en: "high", tr: "yüksek" },
  medium: { en: "medium", tr: "orta" },
  low: { en: "low", tr: "düşük" },
  checkAnswer: { en: "Check", tr: "Kontrol et" },
  correct: { en: "Correct!", tr: "Doğru!" },
  incorrect: { en: "Not quite — see why below.", tr: "Tam değil — nedenini aşağıda gör." },
  score: { en: "Score", tr: "Puan" },
  tryAgain: { en: "Try again", tr: "Tekrar dene" },
  askTutor: { en: "Ask the AI tutor", tr: "Yapay zekâ öğretmene sor" },
  tutorTitle: { en: "AI Tutor", tr: "Yapay Zekâ Öğretmen" },
  tutorPlaceholder: {
    en: "Ask anything about this question...",
    tr: "Bu soruyla ilgili istediğini sor...",
  },
  tutorNeedsKey: {
    en: "The AI tutor needs a (free) Google Gemini API key. Create one at aistudio.google.com/apikey and paste it here — it is stored only in your browser.",
    tr: "Yapay zekâ öğretmen için (ücretsiz) bir Google Gemini API anahtarı gerekli. aistudio.google.com/apikey adresinden oluşturup buraya yapıştır — sadece tarayıcında saklanır.",
  },
  saveKey: { en: "Save key", tr: "Anahtarı kaydet" },
  send: { en: "Send", tr: "Gönder" },
  thinking: { en: "Thinking...", tr: "Düşünüyor..." },
  studyPlan: { en: "2-day study plan", tr: "2 günlük çalışma planı" },
  allUnits: { en: "All units", tr: "Tüm konular" },
  totalProgress: { en: "Overall progress", tr: "Genel ilerleme" },
  chart: { en: "Chart", tr: "Grafik" },
  table: { en: "Data", tr: "Veriler" },
  showStatement: { en: "Show full question", tr: "Sorunun tamamını göster" },
  hideStatement: { en: "Hide question", tr: "Soruyu gizle" },
  print: { en: "Print / save as PDF", tr: "Yazdır / PDF olarak kaydet" },
  quizIntro: {
    en: "Concept checks and trap questions — the kind that separate an AA from a CC.",
    tr: "Kavram ve tuzak soruları — AA ile CC'yi ayıran türden.",
  },
  quizFinish: { en: "Quiz complete!", tr: "Sınav bitti!" },
  quizRestart: { en: "Restart quiz", tr: "Sınavı yeniden başlat" },
  source: {
    en: "Built from Bursa Uludağ University Civil Engineering course materials.",
    tr: "Bursa Uludağ Üniversitesi İnşaat Mühendisliği ders materyallerinden hazırlanmıştır.",
  },

  /* ---------- subjects / multi-subject shell ---------- */
  subjects: { en: "Subjects", tr: "Dersler" },
  chooseSubject: { en: "Choose a subject", tr: "Bir ders seç" },
  unit: { en: "Unit", tr: "Konu" },
  backToSubjects: { en: "All subjects", tr: "Tüm dersler" },
  backToSubjectHome: { en: "Back", tr: "Geri" },
  notesCount: { en: "notes", tr: "not" },
  cardsCount: { en: "cards", tr: "kart" },

  /* ---------- study unit view ---------- */
  konuAnlatimi: { en: "Lesson notes", tr: "Konu anlatımı" },
  flashcardsTitle: { en: "Flashcards", tr: "Kartlar" },
  practiceTitle: { en: "Question bank", tr: "Soru bankası" },
  dueCards: { en: "due", tr: "sırada" },
  answeredCount: { en: "answered", tr: "cevaplandı" },
  stepByStepSolutions: { en: "Step-by-step solutions", tr: "Adım adım çözümler" },
  resources: { en: "Resources", tr: "Kaynaklar" },
  video: { en: "Video", tr: "Video" },

  /* ---------- flashcards ---------- */
  flipCard: { en: "Flip", tr: "Çevir" },
  showEnglish: { en: "EN", tr: "EN" },
  gradeAgain: { en: "Again", tr: "Tekrar" },
  gradeGood: { en: "Good", tr: "İyi" },
  gradeEasy: { en: "Easy", tr: "Kolay" },
  dueOnly: { en: "Due only", tr: "Sadece sırada olanlar" },
  allTags: { en: "All tags", tr: "Tüm etiketler" },
  deckComplete: { en: "Deck complete!", tr: "Deste tamamlandı!" },
  restartDeck: { en: "Restart", tr: "Tekrarla" },
  noCardsDue: { en: "No cards due right now.", tr: "Şu anda sırada kart yok." },
  box: { en: "box", tr: "kutu" },

  /* ---------- practice ---------- */
  all: { en: "All", tr: "Hepsi" },
  mcqOnly: { en: "MCQ", tr: "Test" },
  openOnly: { en: "Open", tr: "Açık uçlu" },
  examStyleOnly: { en: "Exam style", tr: "Sınav tarzı" },
  filterBySection: { en: "Filter by section", tr: "Konuya göre filtrele" },
  yourAnswer: { en: "Your answer (optional)", tr: "Cevabın (isteğe bağlı)" },
  showAnswer: { en: "Show answer", tr: "Cevabı göster" },
  hadIt: { en: "I had it", tr: "Doğruydum" },
  missedIt: { en: "I missed it", tr: "Eksikti" },
  jumpTo: { en: "Jump to", tr: "Git" },

  /* ---------- podcast ---------- */
  podcast: { en: "Podcast", tr: "Podcast" },
  generatePodcast: { en: "Generate podcast", tr: "Podcast oluştur" },
  regeneratePodcast: { en: "Regenerate", tr: "Yeniden oluştur" },
  podcastGenerating: {
    en: "Generating your podcast — this can take 1-2 minutes...",
    tr: "Podcast oluşturuluyor — bu 1-2 dakika sürebilir...",
  },
  podcastTranscript: { en: "Transcript", tr: "Metin" },
  podcastError: {
    en: "Something went wrong generating the podcast.",
    tr: "Podcast oluşturulurken bir şeyler ters gitti.",
  },
  syncTitle: { en: "Cross-device sync", tr: "Cihazlar arası eşitleme" },
  syncIntro: {
    en: "Pick any passcode (4+ characters) and enter the same one on your phone — your progress, flashcard boxes and scores stay in sync everywhere.",
    tr: "Bir parola seç (en az 4 karakter) ve aynısını telefonunda gir — ilerlemen, kart kutuların ve puanların her yerde eşit kalır.",
  },
  syncPlaceholder: { en: "your passcode...", tr: "parolan..." },
  syncEnable: { en: "Enable sync", tr: "Eşitlemeyi aç" },
  syncActive: { en: "Sync on", tr: "Eşitleme açık" },
  syncNow: { en: "Sync now", tr: "Şimdi eşitle" },
  syncDisable: { en: "Turn off", tr: "Kapat" },
  syncError: {
    en: "Sync failed — check your connection and try again.",
    tr: "Eşitleme başarısız — bağlantını kontrol edip tekrar dene.",
  },
  podcastAskLang: {
    en: "Which language would you like the podcast in?",
    tr: "Podcast'i hangi dilde dinlemek istersin?",
  },
  podcastCreateSuffix: { en: "podcast", tr: "podcast oluştur" },
  podcastNeedsKey: {
    en: "The podcast needs a (free) Google Gemini API key. Create one at aistudio.google.com/apikey and paste it here — it is stored only in your browser.",
    tr: "Podcast için (ücretsiz) bir Google Gemini API anahtarı gerekli. aistudio.google.com/apikey adresinden oluşturup buraya yapıştır — sadece tarayıcında saklanır.",
  },
} as const;

export type StringKey = keyof typeof STRINGS;

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: StringKey) => string;
  bi: (b: Bi | undefined | null) => string;
}

const Ctx = createContext<LangCtx>({
  lang: "en",
  setLang: () => {},
  t: (k) => STRINGS[k].en,
  bi: (b) => b?.en ?? "",
});

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    const saved = window.localStorage.getItem("cubad:lang");
    if (saved === "tr" || saved === "en") setLangState(saved);
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    window.localStorage.setItem("cubad:lang", l);
  }, []);

  const t = useCallback((k: StringKey) => STRINGS[k][lang], [lang]);
  const bi = useCallback(
    (b: Bi | undefined | null) => (b ? b[lang] || b.en || b.tr : ""),
    [lang]
  );

  return <Ctx.Provider value={{ lang, setLang, t, bi }}>{children}</Ctx.Provider>;
}

export function useLang() {
  return useContext(Ctx);
}
