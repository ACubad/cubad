# cubad — Hydrology, step by step

An interactive exam-prep tutor built from the Bursa Uludağ University Civil Engineering
**Hydrology** problem set (uygulama soruları ve çözümleri). Every question is a guided,
hand-holding walkthrough: think first, take a hint, reveal the step, and — most importantly —
understand **why** we take it.

## Features

- **Step-by-step walkthroughs** for all 37 questions across 8 units — each step has a
  guiding question, an optional hint, the worked math (KaTeX), and a *"Why do we do this?"*
  card with exam-recognition reasoning.
- **Exam traps** (⚠) — the unit conversions, sign directions, and regime checks professors
  use to trick students.
- **What-if scenarios** — how the answer changes when a value, direction, or condition changes.
- **Concept primers** per unit + a printable **formula sheet**.
- **Quick quizzes** per unit with instant feedback and explanations.
- **Bilingual** — original Turkish statements (exam fidelity) with full English explanations;
  toggle in the header.
- **Progress tracking** in your browser (localStorage — no account needed).
- **AI tutor (optional)** — a Gemini-powered chat that knows the current question. Works with
  either a server key or a key you paste in the panel (stored only in your browser).

## Units

1. Giriş — Su Dengesi (Water balance)
2. Yağış (Precipitation)
3. Buharlaşma (Evaporation)
4. Sızma (Infiltration)
5. Akım Ölçümleri ve Yüzeysel Akış (Streamflow & runoff)
6. Hidrograflar (Hydrographs)
7. Taşkınlar (Floods)
8. Yeraltı Suyu (Groundwater)

## Development

```bash
npm install
npm run dev            # http://localhost:3000
node scripts/validate-content.mjs   # validate content JSON
npm run build
```

## Enabling the AI tutor

Two ways (either works):

1. **Vercel env var** — add `GEMINI_API_KEY` in Vercel → Project → Settings →
   Environment Variables, then redeploy. Every visitor gets the tutor.
2. **In the browser** — open the tutor panel on any question and paste your own key
   (free at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)). The key is
   stored only in your browser's localStorage and sent only with your own requests.

## Content model

All study content lives in `content/unit-N.json` (validated by
`scripts/validate-content.mjs`). Each unit has a concept primer, questions with bilingual
steps/hints/whys/traps/what-ifs, and a quiz. To add a new subject, drop in new unit files —
the UI is fully content-driven.

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS 4 · KaTeX · custom SVG charts ·
Gemini API (optional) · deployed on Vercel.
