# Implementation Plan — İnşaat Yönetimi (Construction Management) in cubad

**Goal**: add a second subject to the cubad app: notes + videos together per topic, generated
practice questions, and bilingual flashcards (TR front, English meaning on reveal) covering
EVERY concept in the sources — nothing left behind.

**Orchestration contract** (user requirement): Fable = orchestrator/brains only — writes
decision-complete specs, schemas and prompts, does final integration. **Sonnet** implements
(zero decisions). **Opus** runs **two audit passes**. Token budget: Fable stays thin.

---

## 0. Source inventory (surveyed 2026-07-03)

**Videos** (all with tr auto-captions; total ≈ 7h12m):
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
| 13 | QxhD8_aGG9I | Programlama Araçları (11. Hafta) | 35:12 |

**Lecture notes** (`ders notları\`, 38 files): İnşaat Yönetimi.pdf + _1.pdf (course core),
Kazı-Dolgu, metraj set (Beton, Demir-Donatı, Duvar, Kalıp, Kaplama), İmar Yönetmeliği (slides
+ regulation), Kamu İhale Kanunu (×2), sözleşme set (temel ilkeler, Eser Sözleşmesi, anahtar
teslim, birim fiyat, teklif birim fiyat, maliyet+kâr, kat karşılığı), teknik şartname,
SÜRE ANALİZİ, Programlama Araçları, ödev sheets.
**Exam calibration**: `output\Insaat_Yonetimi_Ara_Sinav_Soru_ve_Cevaplari.pdf` (past midterm Q&A).
Assignment folders (5.Group, 9./10.Ödev, ihale_dokumani) = optional reference only.

## 1. Course structure → 10 units

| Unit | Slug | Sources (videos ▸ PDFs) |
|------|------|--------------------------|
| 1. İnşaat Yönetimine Giriş | giris | v1, v2 ▸ İnşaat Yönetimi.pdf, İnşaat Yönetimi_1.pdf |
| 2. Kazı ve Dolgu İşleri | kazi-dolgu | v3 ▸ Kazı-Dolgu PDF |
| 3. Metraj (Beton, Donatı, Duvar, Kalıp, Kaplama) | metraj | — ▸ 5 metraj PDFs (computation-heavy) |
| 4. Planlı Alanlar İmar Yönetmeliği | imar | v4 ▸ İmar slides + planli PDF |
| 5. Kamu İhale Kanunu ve İhale Usulleri | ihale | v5 ▸ 2 KİK PDFs |
| 6. Sözleşme İlkeleri ve Eser Sözleşmesi | sozlesme-ilkeler | v6, v7 ▸ temel ilkeler, Borçlar K. PDFs |
| 7. İnşaat Sözleşme Türleri | sozlesme-turleri | v8 ▸ anahtar teslim, birim fiyat, teklif BF, maliyet+kâr, kat karşılığı PDFs |
| 8. Kamu İhale Sözleşmeleri K. + Teknik Şartname | kik-sartname | v9, v10 ▸ 2 PDFs |
| 9. İş Planlaması ve Süre Analizi | planlama | v11, v12 ▸ SÜRE ANALİZİ PDF |
| 10. Programlama Araçları (Gantt, CPM, PERT) | programlama | v13 ▸ Programlama Araçları PDF |

## 2. App architecture change: multi-subject cubad (Fable specs, Sonnet implements)

- `content/<subject>/unit-N.json`; subjects.json manifest {slug, title, tagline, examDate?}.
  Existing hydrology files move to `content/hidroloji/` (routes gain a subject segment;
  old routes redirect).
- Home = subject picker cards; per-subject home keeps unit grid + study plan.
- **New content types** (added to existing schema; walkthroughs/quiz/charts reused as-is):
  - `unit.lessons[]`: notes sections — `{ title:Bi, body:Bi (markdown+latex), video?: {youtubeId, startSec, endSec?}, keyTerms:[{tr, en, def:Bi}] }` → topic page renders notes with an embedded YouTube player; each section's ▶ button seeks the player to its timestamp (lite-embed, privacy-enhanced youtube-nocookie).
  - `unit.flashcards[]`: `{ front:Bi-or-TR, back:Bi, en: string (English meaning/translation), tag }` → FlashcardDeck component: flip animation, "EN" reveal chip on the back, Leitner boxes (again/good/easy) in localStorage, shuffle, per-tag filter.
  - `unit.practice[]`: generated questions — MCQ (reuse Mcq) + open questions with model answers (reveal pattern), styled on the past midterm.
- Computation topics (metraj, süre analizi/CPM) ALSO get 2-4 step-by-step walkthroughs
  reusing the existing Walkthrough/GraphStory machinery (CPM network story: forward pass,
  backward pass, float, critical path highlight — same player as hydrology).

## 3. Pipeline (phases, owners, gates)

**P0 — Ingestion (scripts by Fable, run once, deterministic)**
`yt-dlp --write-auto-subs --sub-langs tr-orig --skip-download` for the 13 IDs → VTT → cleaner
script (strip cues, merge rolling duplicates, keep [mm:ss] anchors every ~15s) → 13 transcript
.txt files. PyMuPDF text + page images for every ders-notları PDF + the midterm PDF.
Gate: word counts sane, spot-read 2 transcripts.

**P1 — Unit briefs (Fable, the "decisions")**
One brief per unit: exact source files/pages, transcript spans, the concept checklist skeleton,
flashcard tag taxonomy, question count targets, which computations become walkthroughs.
Schema doc for the three new content types with one gold exemplar unit brief fully worked.

**P2 — UI build (Sonnet from Fable's component specs; Fable verifies via build+preview)**
Subject manifest/routing refactor, topic/lesson page with video embed + timestamp seeking,
FlashcardDeck, practice page. Definition of done: typecheck, build, validator extended
(lessons/flashcards/practice rules), preview screenshots.

**P3 — Content authoring (Sonnet, 10 agents, one per unit)**
Input: brief + transcripts + PDF text + page images. Output: unit JSON with lessons (notes
synthesized from BOTH video and PDFs, video timestamps per section), 30-60 flashcards/unit
(every concept, term, article number, formula), 8-12 practice questions (midterm-styled),
walkthroughs for computational units. Bilingual everywhere; easy-tutor voice per the
existing content-schema quality bar.

**P4 — Opus audit pass 1: COVERAGE & FIDELITY (10 agents)**
Build the coverage matrix per unit: every PDF heading/section + every ~2-3 min transcript
segment → must map to a lesson section AND ≥1 flashcard (or be explicitly marked
non-examinable boilerplate with reason). Verify facts/numbers/article citations against
sources. Fix in place; report matrix + fixes. Nothing-left-behind is THIS gate.

**P5 — Opus audit pass 2: QUALITY & CONSISTENCY (10 agents + 1 cross-unit)**
Second independent pass: schema validity, TR/EN completeness, flashcard EN accuracy,
pedagogy of explanations, dedupe/cross-link concepts across units, practice-question
answerability from the notes alone. Cross-unit agent checks the whole subject reads as one
coherent course.

**P6 — Final pass (Fable)**
Validator, independent spot-sweeps (sampled flashcards vs sources, CPM numbers recomputed),
build, preview verification, commit, push, deploy to cubad.vercel.app.

## 4. Estimates & risks

- Agent budget: ~10 Sonnet content + ~21 Opus audit + few Sonnet UI ≈ 30-35 agents;
  heavier than hydrology round 1 (~2M tokens) because of 2 audit passes; Fable usage minimal
  (briefs + final pass).
- Risks: (a) auto-caption quality on legal terminology → mitigated by PDF cross-check rule
  in P3/P4 prompts; (b) very long videos (v5 74min) → transcripts chunked by the cleaner;
  (c) route refactor regressions → P2 gate includes hydrology smoke test; (d) YouTube embeds
  blocked offline → notes are self-sufficient by design (video is enrichment, not the only
  carrier of any concept — enforced in P4).

## 5. Out of scope (this round)

Assignment folders and the 780MB tender package (reference only), spaced-repetition sync
across devices (localStorage only), AI-generated video summaries beyond notes.
