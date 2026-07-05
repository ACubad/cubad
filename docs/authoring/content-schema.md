# CUBAD Hydrology Tutor — Content Schema & Authoring Guide

You are authoring the study content for an interactive exam-prep web app. The student's exam
is in 2 days. Content is a single JSON file per unit: `unit-<N>.json`. It must be VALID JSON
(no comments, no trailing commas) and match this schema exactly.

## Source material
- Full worked solutions: `C:\Users\ahmed\AppData\Local\Temp\claude\C--Users-ahmed-Downloads-Hidroloji\792e90fd-14ff-499e-8468-8a2aefc288f4\scratchpad\pdf_extract\soru.txt`
  (text extraction of "Hidroloji_Uygulama Soru ve Çözümleri_.pdf", 43 pages, `----- PAGE N -----` markers)
- Question sheet (some questions ONLY here, without solutions): `...\pdf_extract\abak.txt` (39 pages)
- Page images (PNG, 100dpi) in the same folder: `soru_pNN.png`, `abak_pNN.png`.
  The text extraction MANGLES equations (PDF reading order). When any formula or number is
  ambiguous, READ the page image with the Read tool to see the real layout. Prefer images for
  anything with fractions/subscripts.

## Non-negotiable quality rules
1. **Verify every number.** Recompute EVERY numeric result you write using Python (run it —
   don't do arithmetic in your head). If your recomputation disagrees with the PDF, follow the
   correct math but add the PDF's value in the `work` text with a short note ("Not: föyde X
   yazıyor; doğru değer Y'dir" / "Note: the sheet shows X; the correct value is Y") — unless the
   PDF value is right and you erred. PDF rounding differences ≤1% are fine — use the PDF value.
2. **Both languages, always.** Every `{ "tr": ..., "en": ... }` object needs BOTH filled. TR
   terminology must match the course PDFs (sızma kapasitesi, birim hidrograf, anahtar eğrisi,
   tekerrür süresi, artık yağış...). EN should give the standard English term on first use.
3. **Explain like a friendly tutor**, not a textbook. Short sentences. The `why` field is the
   soul of the app: it answers "why do we do this now — and how would I know to do this in the
   exam?" Never leave it generic ("we apply the formula"); state the reasoning cue (e.g., "The
   question gives volumes in and out of a closed region over a fixed time — that is the signal
   to write a water balance: ΔS = inflow − outflow.").
4. **Markdown + LaTeX.** Text fields are markdown. Inline math `$...$`, display math `$$...$$`.
   In JSON, backslashes must be escaped: `\\Delta S`, `\\frac{a}{b}`. Use `\\text{mm}` for units
   inside math. Keep tables as the `tables` field, NOT markdown tables.
5. **Steps must be small.** One decision or one computation per step. 4–10 steps per question.
   A student clicking through should never face a wall of algebra: break it up.

## File schema (per unit)

```
{
  "unit": 2,
  "slug": "yagis",
  "title": { "tr": "Yağış", "en": "Precipitation" },
  "tagline": { "tr": "≤ 12 kelime", "en": "≤ 12 words" },
  "concept": {
    "overview": { "tr": "markdown 150-300 words, simplest possible intro to the unit's ideas", "en": "..." },
    "keyFormulas": [
      {
        "name": { "tr": "Su dengesi", "en": "Water balance" },
        "latex": "\\Delta S = X - Y",
        "meaning": { "tr": "her sembolün anlamı, kısa", "en": "..." },
        "whenToUse": { "tr": "hangi soru tipinde kullanılır", "en": "..." }
      }
    ],
    "traps": [ { "tr": "unit-level exam trap", "en": "..." } ]
  },
  "questions": [ <Question>, ... ],
  "quiz": [
    {
      "q": { "tr": "...", "en": "..." },
      "options": [ { "tr": "...", "en": "..." }, ... 3-4 options ],
      "correct": 0,
      "explain": { "tr": "why correct is correct AND why the others are wrong", "en": "..." }
    }
    // 6-8 quiz items per unit: concept checks + trap-style questions (unit conversions,
    // sign directions, which-method-when). NOT simple recall of the walkthrough numbers.
  ]
}
```

### Question

```
{
  "id": "2-4",                       // unit-number, canonical numbering (see unit brief)
  "code": "Uygulama 2.4",
  "title": { "tr": "kısa açıklayıcı başlık", "en": "short descriptive title" },
  "difficulty": 2,                   // 1 quick, 2 standard, 3 long/multi-part
  "examLikelihood": "high",          // high | medium | low (judge from how central the topic is)
  "statement": { "tr": "faithful original statement (lightly cleaned)", "en": "translation" },
  "given": [
    { "symbol": "A", "value": "200\\ \\text{km}^2", "label": { "tr": "Havza alanı", "en": "Basin area" } }
  ],
  "goal": { "tr": "ne isteniyor, tek cümle", "en": "what is asked, one line" },
  "tables": [
    { "title": { "tr": "...", "en": "..." }, "headers": ["t (saat)", "..."], "rows": [["800", "..."]] }
  ],
  "chart": <Chart> | null,
  "steps": [ <Step>, ... ],
  "finalAnswer": { "tr": "markdown boxed summary of all answers", "en": "..." },
  "traps": [ { "tr": "question-specific exam trap", "en": "..." } ],
  "whatIfs": [
    {
      "scenario": { "tr": "Ya yağış 50 mm yerine 80 mm olsaydı?", "en": "What if rainfall were 80 mm instead of 50?" },
      "answer": { "tr": "how the solution path & the number change (recompute!)", "en": "..." }
    }
    // 2-4 per question. Pick the changes a professor actually uses to trick students:
    // reversed direction (rise vs fall), different units, a value that flips a regime
    // (i < f vs i > f), asking the inverse question, etc.
  ]
}
```

### Step

```
{
  "title": { "tr": "Adım başlığı (fiil ile)", "en": "Step title (verb-first)" },
  "guiding": { "tr": "Öğrenciye sorulan yönlendirici soru (cevabı vermeden düşündür)", "en": "..." },
  "hint": { "tr": "İpucu: doğru yöne it, cevabı söyleme", "en": "..." },
  "work": { "tr": "markdown+latex: the actual work of this step, numbers included, clearly narrated", "en": "..." },
  "why": { "tr": "Bu adımı NEDEN yapıyoruz + sınavda bunu nasıl fark ederim", "en": "..." },
  "result": "\\Delta S = -79{,}8\\ \\text{mm}",   // latex ONLY, or null if no single numeric result
  "check": null | {
    "q": { "tr": "...", "en": "..." },
    "options": [ { "tr": "...", "en": "..." }, ... ],
    "correct": 1,
    "explain": { "tr": "...", "en": "..." }
  }
  // add "check" to 1-3 pivotal steps per question, not every step
}
```

### Chart  (only when the question is inherently graphical — hyetograph, hydrograph,
rating curve, duration curve, mass curve, infiltration curve, i-t-T)

```
{
  "type": "bar" | "line",
  "title": { "tr": "...", "en": "..." },
  "xLabel": "t (dakika)", "yLabel": "i (mm/saat)",
  "logX": false, "logY": false,
  "series": [
    { "name": "T=5 yıl", "kind": "line" | "bar", "points": [[x, y], [x, y], ...] }
  ],
  "annotations": [ { "x": 45, "y": 36, "label": { "tr": "okunan değer", "en": "read value" } } ]  // optional
}
```
Numbers in `points` must be plain JSON numbers. For bar (hyetograph) series, each point is
[interval-end-time, intensity] and bars are drawn over the preceding interval; include the
interval start via first point's predecessor being implicit from previous point. Keep it simple:
for hyetographs give one [t_mid, i] per interval plus "barWidths": [w1, w2, ...] (minutes) if
intervals are unequal.

## Turkish number formatting
In TR text use comma decimals as the PDFs do ($79{,}8$); in EN text use dots. In `result`
latex, use the TR style with `{,}` (it renders as 79,8) — the app shows the same latex in
both languages, so prefer `79{,}8` ≈ course style.

## What to do when the source has no solution
Some questions exist only in abak.txt with a blank "Çözüm:" — you must SOLVE them yourself:
standard methods from the same unit (they're always the same techniques as the solved ones).
Verify with Python. Mark nothing special in the JSON — the walkthrough looks the same.

## Output
Write the finished file to:
`C:\Users\ahmed\AppData\Local\Temp\claude\C--Users-ahmed-Downloads-Hidroloji\792e90fd-14ff-499e-8468-8a2aefc288f4\scratchpad\content\unit-<N>.json`
Then run `python -c "import json; json.load(open(r'<path>', encoding='utf-8'))"` to prove it parses.
Your final message: one line per question — id, title, #steps, and any uncertainty that needs review.
