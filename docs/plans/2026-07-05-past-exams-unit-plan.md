# HANDOFF PLAN — Past-Exam Questions unit (hydrology) from new_arrivals

Written 2026-07-05 as a session handoff (previous chat ran low on context). Execute in a
fresh session. All decisions are made — follow, don't re-litigate.

## Mission (user's words, condensed)
New chapter/section in the hydrology subject with step-by-step walkthrough solutions for
past exam questions in `C:\Users\ahmed\Downloads\Hidroloji\new_arrivals`. Check every file
and photo THOROUGHLY; include ALL questions that can be clearly seen and read; produce the
graphs/drawings that accompany solutions. Orchestration contract: **Fable orchestrates only**
(briefs, final pass), **Sonnet implements**, **Opus audits** — and Opus may also be used for
diagram/story authoring where judgment is needed. Fable does the final pass + deploy.

## Sources (inventoried)
`new_arrivals\`: `hidroloji final.pdf` (2.7 MB — the final exam) + 15 WhatsApp JPEGs
(photographed exam sheets, 25–143 KB, quality varies). Photos may overlap with the PDF or
each other — dedupe questions. A question is included if readable; truly unreadable ones are
skipped WITH an explicit per-photo report (never silently).

## Target shape (decided)
- New unit file: `content/hidroloji/unit-9.json`, slug `cikmis-sorular`,
  title tr "Çıkmış Sınav Soruları" / en "Past Exam Questions",
  tagline about practicing with the real thing.
- Standard hydrology walkthrough schema (see `docs/authoring/content-schema.md`; GraphStory
  and chart fidelity rules in `docs/authoring/fidelity-addendum.md`; gold exemplars inside
  `content/hidroloji/unit-2.json` q2-5 steps[1].story and any unit-7 charts).
- Question ids `9-1`, `9-2`, ... ; `code` reflects provenance, e.g. "Final 2026 — Soru 3" or
  "Foto 7 — Soru 1". Difficulty/examLikelihood as usual (examLikelihood high — these ARE exam
  questions).
- Include a small `concept` primer: exam strategy + a map "this question ↔ which unit teaches
  it" (cross-links like the recap pattern), and a 6-8 item quiz built from the exams' trap
  patterns (validator requires walkthrough units to be complete).
- Figures: every graph/diagram the solution needs gets a chart (data plots) or GraphStory
  (constructions) per the fidelity addendum, each with howToDraw/whatItShows.

## Pipeline (mirror of what worked before)
- **P0 (Fable, scripts):** PyMuPDF-extract the PDF (text + page PNGs ~110dpi) into the new
  session's scratchpad; photos are used directly (agents Read the JPEGs). Quick readability
  triage of the 15 photos.
- **P1 (Fable):** question inventory brief — read PDF pages + photos ONCE at survey level,
  assign question ids, cluster into 3-5 Sonnet work packages (by source/topic), note which
  need figures and which figure type, dedupe overlaps. Decision-complete per package.
- **P2 (Workflow):** Sonnet author per package — transcribe faithfully (statement tables,
  given values), solve step-by-step with Python verification, tutor voice per schema, traps +
  whatIfs; write into a per-package fragment JSON in scratchpad. Figure-heavy items: the
  author lists figure specs; a separate **Opus diagram agent** authors the GraphStory/chart
  JSON for them (user explicitly allowed Opus for drawings). Then **Opus audit ×2 per package**
  (pass 1 fidelity/coverage vs source images + numeric recompute; pass 2 quality/schema/
  language, answer-every-check-blind). Assembler step (script or one Sonnet) merges fragments
  into unit-9.json + primer + quiz, then one Opus cross-file audit.
- **P3 (Fable final pass):** validate (`node scripts/validate-content.mjs`), independent
  numeric spot-sweep with Python, build, playwright mobile overflow check on 2-3 new pages
  (pattern: eval scrollWidth-clientWidth at 375px), commit/push, `vercel deploy --prod --yes`,
  live verify.

## Environment facts the new session needs
- Repo `C:\Users\ahmed\Downloads\Hidroloji\cubad`; deploys to https://cubad.vercel.app
  (`vercel deploy --prod --yes`); git push works (credential manager, user ACubad).
- Multi-subject app: content/<subject>/unit-N.json + subjects.json; hidroloji has units 1-8;
  progress keys are subject-scoped — new unit needs NO code changes, content only (routes and
  pages are generated from content). generateStaticParams picks it up automatically.
- GEMINI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY are Vercel env vars AND in cubad/.env.local.
- Validator branches on subject kind; hydrology units need concept+questions+quiz.
- Turkish decimals with {,} in latex; JSON-escaped backslashes; bilingual {tr,en} everywhere.
- Podcasts: 4 still missing (sozlesme-turleri EN, programlama EN+TR, planlama TR) — TTS daily
  quota; regenerate via site buttons or scratchpad pregen script pattern (dev server :3005,
  POST /api/podcast per unit/lang) — unrelated to this task but may come up.

## Cost guardrails
Photos are small — agents must Read images directly, not re-render. Keep Sonnet packages
3-5 (not per-question). Opus only for audits + figure authoring. Expect roughly the size of
one hydrology fidelity round (~1.5-2.5M subagent tokens) depending on question count.
