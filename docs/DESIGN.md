# cubad — Design Notes

## Goal

A student has a hydrology exam in ~2 days. They need to *understand* ~37 worked application
questions (BUÜ İnşaat Müh. Hidroloji uygulama föyü), not memorize them. The product is a
tutor, not a document viewer: it walks the student through each question one decision at a
time, always explaining **why** the step is taken and how to recognize it in an exam.

## Core interaction: the walkthrough loop

For each step of a question:

1. **Think first** — a guiding question frames the decision without revealing it.
2. **Hint (optional)** — a nudge in the right direction.
3. **Reveal** — the worked math for this step (KaTeX), kept deliberately small
   (one decision or one computation per step).
4. **Why do we do this?** — the exam-recognition reasoning: what in the problem statement
   signals this step; where students go wrong.
5. Occasional **check** — a one-tap MCQ at pivotal steps.

After the last step: final answer → exam traps (⚠) → what-if scenarios (value changes,
reversed directions, regime flips) → next question.

Progressive disclosure is the central design rule: the student never faces a wall of algebra.

## Content architecture

- `content/unit-N.json` — fully content-driven UI; bilingual (`{tr, en}`) at every text node.
- Turkish = exam fidelity (statements match the course sheet); English = explanation clarity.
- Content was authored from the course PDFs, and every computed number was re-verified with
  independent Python computation (two-pass: author agent + adversarial verifier agent).
- Schema enforced by `scripts/validate-content.mjs`.

## Visual direction — "engineer's field notebook"

- Warm paper (`#f6f3eb`) + ink (`#1c2b33`) + one strong accent: petrol/deniz blue (`#0e5a6d`).
- Fraunces (display) / Instrument Sans (body) / IBM Plex Mono (numbers) — latin-ext subsets
  for Turkish.
- Water as the progress metaphor: rising "water-fill" progress bars, wave underline wordmark.
- Calm, uncluttered; density lives inside cards; charts are hand-rolled SVG for full control
  (log axes for i-t-T and rating curves, unequal-width bars for hyetographs).

## Technical choices

- **Next.js App Router, static-first**: unit and question pages are SSG
  (`generateStaticParams`); content read from the filesystem at build time.
- **Client-side language + progress** (localStorage) — no accounts, works instantly.
- **AI tutor**: `/api/tutor` proxies Gemini (`gemini-2.5-flash`). Key resolution order:
  `GEMINI_API_KEY` env → user-supplied key from the panel (stored in localStorage only).
  The route ships question context as JSON in the system instruction.
- **No chart library**: bespoke `Chart.tsx` (~200 lines) renders line/bar with linear/log
  scales and annotations from a small JSON spec, keeping bundle small and rendering
  deterministic.

## Extending to new subjects

Drop new `unit-N.json` files into `content/`. The homepage, unit pages, walkthroughs,
quizzes and formula sheet are all generated from content. For a different course, replace
the content directory and adjust the study-plan copy on the homepage.
