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
  revealAll: { en: "Show all steps", tr: "Tüm adımları göster" },
  hideAll: { en: "Hide all steps", tr: "Adımları gizle" },
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
  newChat: { en: "New", tr: "Yeni" },
  continueReply: { en: "Continue the answer", tr: "Cevaba devam et" },
  pastChats: { en: "Past chats", tr: "Geçmiş sohbetler" },
  deleteChat: { en: "Delete this chat", tr: "Bu sohbeti sil" },
  emptyChatTitle: { en: "New conversation", tr: "Yeni sohbet" },
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
  quizSaved: { en: "Saved result", tr: "Kaydedilen sonuç" },
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
  podcastPreparedByTeam: {
    en: "Podcasts are prepared and published by the Cubad team.",
    tr: "Podcastler Cubad ekibi tarafından hazırlanır ve yayınlanır.",
  },
  podcastTranscript: { en: "Transcript", tr: "Metin" },
  podcastError: {
    en: "Something went wrong generating the podcast.",
    tr: "Podcast oluşturulurken bir şeyler ters gitti.",
  },
  resetTitle: { en: "Reset progress", tr: "İlerlemeyi sıfırla" },
  resetIntro: {
    en: "Wipes completed-question marks, quiz scores and flashcard boxes (also on your other synced devices). Content is untouched.",
    tr: "Tamamlanma işaretlerini, sınav puanlarını ve kart kutularını siler (eşitlenmiş diğer cihazlarında da). İçerik olduğu gibi kalır.",
  },
  resetAll: { en: "Everything", tr: "Hepsi" },
  resetConfirm: { en: "Sure? Tap again", tr: "Emin misin? Tekrar dokun" },
  resetDone: { en: "Progress reset.", tr: "İlerleme sıfırlandı." },
  podcastAskLang: {
    en: "Which language would you like the podcast in?",
    tr: "Podcast'i hangi dilde dinlemek istersin?",
  },
  podcastCreateSuffix: { en: "podcast", tr: "podcast oluştur" },
  podcastNeedsKey: {
    en: "The podcast needs a (free) Google Gemini API key. Create one at aistudio.google.com/apikey and paste it here — it is stored only in your browser.",
    tr: "Podcast için (ücretsiz) bir Google Gemini API anahtarı gerekli. aistudio.google.com/apikey adresinden oluşturup buraya yapıştır — sadece tarayıcında saklanır.",
  },

  /* ---------- access / paywall / redeem (Phase 4) ---------- */
  locked: { en: "Locked", tr: "Kilitli" },
  freePreview: { en: "Free preview", tr: "Ücretsiz önizleme" },
  selectedPreview: { en: "Your free preview", tr: "Ücretsiz önizlemen" },
  choosePreviewTitle: { en: "Choose this as your free lesson?", tr: "Ücretsiz dersin bu olsun mu?" },
  choosePreviewIntro: {
    en: "You can study one complete lesson for free. Your first choice stays with this browser and, after sign-in, with your account.",
    tr: "Bir tam dersi ücretsiz çalışabilirsin. İlk seçimin bu tarayıcıda ve giriş yaptıktan sonra hesabında kalır.",
  },
  choosePreviewButton: { en: "Choose this lesson", tr: "Bu dersi seç" },
  previewPrivacyNote: {
    en: "Clearing browser data can reset an anonymous preview; preventing that requires an account.",
    tr: "Tarayıcı verilerini silmek anonim önizlemeyi sıfırlayabilir; bunu önlemek için hesap gerekir.",
  },
  unlockAccess: { en: "Unlock access", tr: "Erişimi aç" },
  paywallTitle: { en: "This lesson is locked", tr: "Bu ders kilitli" },
  paywallIntro: {
    en: "Your free lesson is already selected. Sign in or create an account, then redeem an access code to unlock more lessons.",
    tr: "Ücretsiz dersin zaten seçildi. Daha fazla ders açmak için giriş yap veya hesap oluştur, ardından erişim kodunu kullan.",
  },
  choosePlan: { en: "Available access plan", tr: "Mevcut erişim planı" },
  paymentComingSoon: {
    en: "Online payment is not available yet. Use an access code supplied by Cubad.",
    tr: "Çevrimiçi ödeme henüz kullanılamıyor. Cubad tarafından verilen erişim kodunu kullan.",
  },
  upgradeTitle: { en: "Unlock more lessons", tr: "Daha fazla dersin kilidini aç" },
  upgradeIntro: {
    en: "Payments arrive in a later phase. For now, redeem an access code supplied by Cubad.",
    tr: "Ödemeler sonraki aşamada gelecek. Şimdilik Cubad tarafından verilen erişim kodunu kullan.",
  },
  daysLabel: { en: "days", tr: "gün" },
  iHaveCode: { en: "I have a code", tr: "Kodum var" },
  redeemTitle: { en: "Enter your access code", tr: "Erişim kodunu gir" },
  redeemIntro: {
    en: "Type the code exactly as you received it. Codes are single-use per account.",
    tr: "Kodu sana verildiği gibi yaz. Kodlar hesap başına tek kullanımlıktır.",
  },
  redeemPlaceholder: { en: "CBD-XXXX-XXXX", tr: "CBD-XXXX-XXXX" },
  redeemSubmit: { en: "Redeem code", tr: "Kodu kullan" },
  redeemPending: { en: "Redeeming…", tr: "Kullanılıyor…" },
  redeemSuccessTitle: { en: "Access unlocked!", tr: "Erişim açıldı!" },
  redeemSuccessBody: {
    en: "You can now study this content on all your devices.",
    tr: "Artık bu içeriği tüm cihazlarında çalışabilirsin.",
  },
  continueStudying: { en: "Continue studying", tr: "Çalışmaya devam et" },
  accessUntil: { en: "Access until", tr: "Erişim bitişi" },
  yourSubjects: { en: "Your subjects", tr: "Derslerin" },
  signInToStudy: { en: "Sign in to study", tr: "Çalışmak için giriş yap" },
  createAccountToStudy: { en: "Create account", tr: "Hesap oluştur" },
  redeemErrInvalidCode: {
    en: "That code is not valid. Check the spelling and try again.",
    tr: "Bu kod geçersiz. Yazımını kontrol edip tekrar dene.",
  },
  redeemErrExpired: {
    en: "This code has passed its redemption deadline.",
    tr: "Bu kodun kullanım süresi dolmuş.",
  },
  redeemErrExhausted: {
    en: "This code has reached its redemption limit.",
    tr: "Bu kod kullanım limitine ulaşmış.",
  },
  redeemErrAlreadyRedeemed: {
    en: "You have already redeemed this code.",
    tr: "Bu kodu zaten kullandın.",
  },
  redeemErrRateLimited: {
    en: "Too many attempts. Please try again in about an hour.",
    tr: "Çok fazla deneme yapıldı. Lütfen yaklaşık bir saat sonra tekrar dene.",
  },
  redeemErrGeneric: {
    en: "Something went wrong. Please try again.",
    tr: "Bir şeyler ters gitti. Lütfen tekrar dene.",
  },

  /* ---------- auth & account (Phase 2) ---------- */
  signIn: { en: "Sign in", tr: "Giriş yap" },
  signUp: { en: "Create account", tr: "Hesap oluştur" },
  signOut: { en: "Sign out", tr: "Çıkış yap" },
  account: { en: "Account", tr: "Hesap" },
  settings: { en: "Settings", tr: "Ayarlar" },
  email: { en: "Email", tr: "E-posta" },
  password: { en: "Password", tr: "Parola" },
  confirmPassword: { en: "Confirm password", tr: "Parolayı doğrula" },
  newPassword: { en: "New password", tr: "Yeni parola" },
  fullName: { en: "Full name", tr: "Ad soyad" },
  country: { en: "Country", tr: "Ülke" },
  phone: { en: "Phone (optional)", tr: "Telefon (isteğe bağlı)" },
  preferredLanguage: { en: "Preferred language", tr: "Tercih edilen dil" },
  track: { en: "Study track", tr: "Çalışma programı" },
  chooseTrack: { en: "Choose your track", tr: "Programını seç" },
  chooseCountry: { en: "Choose your country", tr: "Ülkeni seç" },
  haveAccount: { en: "Already have an account?", tr: "Zaten hesabın var mı?" },
  noAccount: { en: "No account yet?", tr: "Henüz hesabın yok mu?" },
  forgotPassword: { en: "Forgot password?", tr: "Parolanı mı unuttun?" },
  forgotPasswordTitle: { en: "Reset your password", tr: "Parolanı sıfırla" },
  forgotPasswordIntro: {
    en: "Enter your email and we'll send you a reset link.",
    tr: "E-postanı gir, sana bir sıfırlama bağlantısı gönderelim.",
  },
  sendResetLink: { en: "Send reset link", tr: "Sıfırlama bağlantısı gönder" },
  resetPasswordTitle: { en: "Choose a new password", tr: "Yeni bir parola seç" },
  updatePassword: { en: "Update password", tr: "Parolayı güncelle" },
  signInTitle: { en: "Sign in to cubad", tr: "cubad'a giriş yap" },
  signUpTitle: { en: "Create your cubad account", tr: "cubad hesabını oluştur" },
  checkEmailTitle: { en: "Check your email", tr: "E-postanı kontrol et" },
  checkEmailBody: {
    en: "We sent you a confirmation link. Click it to activate your account, then sign in.",
    tr: "Sana bir onay bağlantısı gönderdik. Hesabını etkinleştirmek için tıkla, sonra giriş yap.",
  },
  resetSentBody: {
    en: "If that email is registered, a reset link is on its way.",
    tr: "Bu e-posta kayıtlıysa, sıfırlama bağlantısı yolda.",
  },
  /* onboarding */
  onboardingTitle: { en: "Welcome — let's set you up", tr: "Hoş geldin — hadi seni ayarlayalım" },
  onboardingIntro: {
    en: "Tell us a bit about you so we can show the right exams and save your progress.",
    tr: "Sana doğru sınavları gösterip ilerlemeni kaydedebilmemiz için kendinden bahset.",
  },
  finishOnboarding: { en: "Finish setup", tr: "Kurulumu bitir" },
  /* account page */
  accountTitle: { en: "Your account", tr: "Hesabın" },
  yourTrack: { en: "Your track", tr: "Programın" },
  editProfile: { en: "Edit profile", tr: "Profili düzenle" },
  saveChanges: { en: "Save changes", tr: "Değişiklikleri kaydet" },
  profileSaved: { en: "Saved.", tr: "Kaydedildi." },
  /* auth error codes -> messages */
  authErr_invalid_credentials: {
    en: "Wrong email or password.",
    tr: "E-posta veya parola hatalı.",
  },
  authErr_email_not_confirmed: {
    en: "Confirm your email first — check your inbox for the link.",
    tr: "Önce e-postanı onayla — gelen kutundaki bağlantıya bak.",
  },
  authErr_rate_limited: {
    en: "Too many attempts. Wait a minute and try again.",
    tr: "Çok fazla deneme. Bir dakika bekleyip tekrar dene.",
  },
  authErr_weak_password: {
    en: "Password must be at least 8 characters.",
    tr: "Parola en az 8 karakter olmalı.",
  },
  authErr_email_exists: {
    en: "An account with that email already exists. Try signing in.",
    tr: "Bu e-postayla bir hesap zaten var. Giriş yapmayı dene.",
  },
  authErr_expired_or_invalid: {
    en: "That link has expired or is invalid. Request a new one.",
    tr: "Bağlantının süresi dolmuş veya geçersiz. Yenisini iste.",
  },
  authErr_invalid_email: { en: "Enter a valid email.", tr: "Geçerli bir e-posta gir." },
  authErr_passwords_mismatch: { en: "Passwords don't match.", tr: "Parolalar eşleşmiyor." },
  authErr_unknown: {
    en: "Something went wrong. Try again.",
    tr: "Bir şeyler ters gitti. Tekrar dene.",
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
