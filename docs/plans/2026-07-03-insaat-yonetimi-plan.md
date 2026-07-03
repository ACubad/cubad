# Implementation Plan — İnşaat Yönetimi (Construction Management) in cubad — v2

**Goal**: add a second subject to cubad built for **learning through questions**: per unit —
🎧 podcast explanation → easy notes → flashcards (reveal-back + EN chip) → an UNCAPPED,
coverage-complete question bank. Videos are SOURCE MATERIAL (correctly grouped per topic to
drive generation), not an in-app viewing experience. Animated construction stories wherever
a concept is drawable.

**Orchestration contract**: Fable = orchestrator/brains only (briefs, schemas, final pass).
**Sonnet** implements everything, zero decisions. **Opus** runs **two audit passes**.

**v2 corrections from the user (2026-07-03)**
- ❌ No notes+embedded-video topic pages. Videos feed generation; each unit lists its source
  videos as plain grouped links (so the grouping is visible), nothing more.
- ✅ Questions are the primary learning vehicle. **No count cap** — the bank must cover
  EVERYTHING discussed in the notes/sources; coverage, not quota, is the stop condition.
- ✅ Flashcards: front → flip to reveal answer on back, plus "EN" chip revealing the English
  meaning.
- ✅ Notes ("Konu anlatımı") stay: easy-language concept explanations per unit, placed before
  flashcards/questions in the flow.
- ✅ 🎧 Podcast button on each unit's notes: generates a podcast-style audio explanation of
  those notes via the Gemini API (script → TTS). Uses the user's BYOK key from the browser
  (or `GEMINI_API_KEY` on Vercel). The user listens first, then does flashcards → questions.
- ✅ Animated step-through stories (GraphStory) "where needed or possible".

---

## 0. Source inventory (surveyed 2026-07-03)

**Videos** (all with tr auto-captions; total ≈ 7h12m) — grouping per unit in §1:
| # | ID | Title | Length |
|---|----|-------|--------|
| 1 | EHN_MGuF-ik | İnşaat Yönetimi 1. Hafta | 34:02 |
| 2 | 8pQWQcSaD9c | İnşaat Yönetimi 2. Hafta | 23:04 |
| 3 | Zb1wwMDGqW4 | Kazı İşleri (2. Hafta) | 7:36 |
| 4 | V5BDPsYJ3tg | Planlı Alanlar İmar Yönetmeliği | 41:47 |
| 5 | 6vFFm55-Pso | Kamu İhale Kanunu | 1:14:44 |
| 6 | UD0NpT4ygd8 | Sözleşme Hazırlama İlkeleri | 27:09 |
| 7 | MDqFBjG_uOg | Borçlar Kanunu — Eser Sözleşmesi | 21:46 |
| 8 | RWHwv3xfAgQ | İnşaat Sözleşmeleri | 1:04:16 |
| 9 | wmTQAr14nOg | Teknik Şartname | 16:47 |
| 10 | auBYq2O-BRY | Kamu İhale Sözleşmeleri Kanunu | 33:59 |
| 11 | cXSaZL0xee8 | İş Planlaması (9. Hafta) | 35:55 |
| 12 | 4S4vDh9mYmo | Süre Analizi (10. Hafta) | 37:31 |
| 13 | QxhD8_aGG9I | Programlama Araçları (11. HAFTA) | 35:12 |

**Lecture notes** (`ders notları\`, 38 files): course core (İnşaat Yönetimi.pdf, _1.pdf),
Kazı-Dolgu, metraj set (Beton, Demir-Donatı, Duvar, Kalıp, Kaplama), İmar Yönetmeliği,
Kamu İhale Kanunu (×2), sözleşme set (temel ilkeler, Eser Sözleşmesi, anahtar teslim,
birim fiyat, teklif birim fiyat, maliyet+kâr, kat karşılığı), teknik şartname, SÜRE ANALİZİ,
Programlama Araçları. **Exam calibration**: `output\Insaat_Yonetimi_Ara_Sinav_Soru_ve_Cevaplari.pdf`.
Assignment folders = optional reference only.

## 1. Course structure → 10 units (video grouping)

| Unit | Slug | Videos ▸ PDFs |
|------|------|----------------|
| 1. İnşaat Yönetimine Giriş | giris | v1, v2 ▸ İnşaat Yönetimi.pdf, İnşaat Yönetimi_1.pdf |
| 2. Kazı ve Dolgu İşleri | kazi-dolgu | v3 ▸ Kazı-Dolgu PDF |
| 3. Metraj | metraj | — ▸ 5 metraj PDFs (computation-heavy) |
| 4. Planlı Alanlar İmar Yönetmeliği | imar | v4 ▸ İmar slides + planli PDF |
| 5. Kamu İhale Kanunu ve İhale Usulleri | ihale | v5 ▸ 2 KİK PDFs |
| 6. Sözleşme İlkeleri ve Eser Sözleşmesi | sozlesme-ilkeler | v6, v7 ▸ temel ilkeler, Borçlar K. PDFs |
| 7. İnşaat Sözleşme Türleri | sozlesme-turleri | v8 ▸ 5 contract-type PDFs |
| 8. KİK Sözleşmeleri + Teknik Şartname | kik-sartname | v9, v10 ▸ 2 PDFs |
| 9. İş Planlaması ve Süre Analizi | planlama | v11, v12 ▸ SÜRE ANALİZİ PDF |
| 10. Programlama Araçları (Gantt, CPM, PERT) | programlama | v13 ▸ Programlama Araçları PDF |

## 2. App changes (Fable specs, Sonnet implements)

- Multi-subject: `content/<subject>/unit-N.json` + subjects manifest; hydrology moves to
  `content/hidroloji/` (redirects preserve old URLs); home = subject picker.
- **Unit page flow (this subject)**: 🎧 Podcast → 📖 Konu anlatımı (notes) → 🃏 Flashcards →
  ❓ Soru bankası (+ walkthroughs for computational topics). A small "Kaynaklar" footer lists
  the unit's videos as plain YouTube links + PDF names (grouping made visible; no embeds).
- **New content types**:
  - `unit.notes[]`: `{ title:Bi, body:Bi (markdown+latex), story?:GraphStory }` — easy
    concept explanations; stories where drawable (CPM network passes, Gantt build-up, metraj
    geometry, ihale process flow, contract-type decision tree).
  - `unit.flashcards[]`: `{ front:Bi, back:Bi, en:string, tag }` — FlashcardDeck: flip
    reveal, EN chip, Leitner (again/good/easy) in localStorage, shuffle, tag filter.
  - `unit.practice[]`: **uncapped** question bank — MCQ (reuse Mcq) and open questions with
    reveal-model-answer; each question carries `covers: ["concept-id", ...]` for the
    coverage audit; midterm-styled where the past exam gives a pattern.
  - `unit.sources`: `{ videos:[{id,title,length}], pdfs:[names] }` for the Kaynaklar footer.
- **🎧 /api/podcast** route: body {unitSlug, notesText, lang, userKey?} → step 1: Gemini text
  model writes a 5-8 min two-host conversational script over the notes (simple, warm,
  exam-focused); step 2: Gemini TTS (`gemini-2.5-flash-preview-tts`, multi-speaker) → WAV
  (server wraps PCM). Client: audio player + IndexedDB cache per unit+lang; regenerate
  button. Key resolution identical to tutor (env → browser BYOK). Fallback if TTS
  unavailable: show the script as readable dialogue.

## 3. Pipeline

**P0 — Ingestion (Fable scripts, deterministic)**: yt-dlp tr-orig auto-subs → cleaned
timestamped transcripts ×13; PyMuPDF text+page-images for all ders-notları PDFs + midterm.
Gate: word counts sane, 2 transcripts spot-read.

**P1 — Unit briefs (Fable)**: per unit: sources, concept checklist skeleton, flashcard tag
taxonomy, question-type mix, which concepts get stories, walkthrough list for metraj/CPM.
Coverage rule stated per unit: EVERY concept in checklist → ≥1 note mention, ≥1 flashcard,
≥1 question. No caps anywhere.

**P2 — UI build (Sonnet from Fable's component specs)**: subject routing refactor +
FlashcardDeck + practice page + podcast route/player + Kaynaklar footer. Gate (Fable):
typecheck, build, hydrology smoke test, preview screenshots.

**P3 — Content authoring (Sonnet ×10, one per unit)**: notes → flashcards → questions from
transcript+PDF sources; cross-check terminology against PDFs (auto-captions garble legal
terms); every question answerable from the notes alone.

**P4 — Opus audit pass 1: COVERAGE & FIDELITY (×10)**: build the coverage matrix — every PDF
heading/section AND every ~2-3 min transcript segment → mapped to notes + ≥1 flashcard +
≥1 question, or explicitly waived with reason (boilerplate). Verify facts, article numbers,
formulas against sources. Fix in place. This is the nothing-left-behind gate.

**P5 — Opus audit pass 2: QUALITY & CONSISTENCY (×10 + 1 cross-unit)**: independent re-audit:
schema, TR/EN completeness, EN flashcard accuracy, question quality (distractors plausible,
open answers complete), notes simplicity, story correctness; cross-unit dedupe/coherence.

**P6 — Final pass (Fable)**: validators, sampled independent checks (CPM numbers, metraj
computations, article citations), build, preview, deploy.

## 4. Estimates & risks

~35-40 subagents; question bank likely 300-600 items across 10 units (uncapped, coverage-driven).
Risks: caption quality on legal terms (PDF cross-check rule); Gemini TTS free-tier limits
(cache + graceful script fallback); route refactor regressions (hydrology smoke test);
long transcripts (chunked cleaner).

## 5. Out of scope

Assignment folders / 780MB tender package (reference only); cross-device sync; video embedding.
