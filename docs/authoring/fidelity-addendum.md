# FIDELITY ADDENDUM — Graph & Table Fidelity Audit (round 2)

The student compared the app against the course PDFs and found: **graphs that appear in the
PDF solutions are missing from the app**, and some tables/figures aren't presented the way
the sheet presents them. The PDFs are the SOURCE OF TRUTH. Your mission: make the app contain
EVERY figure and EVERY table the sheet contains for your unit — and make every graph richly
explained (how to draw it by hand in the exam, and what it depicts).

## Ground rules
1. You edit the LIVE repo file directly: `C:\Users\ahmed\Downloads\Hidroloji\cubad\content\unit-<N>.json`.
2. The text extractions LOSE ALL FIGURES. You MUST read the page images
   (`...\scratchpad\pdf_extract\soru_pNN.png`, `abak_pNN.png`) for every page of your unit to
   catalog figures. A figure exists if the sheet DRAWS it in the question or the solution —
   including grid maps, cross-sections, curves, hyetographs, S-curves, log plots.
3. Numbers: never invent. Chart/story data must come from the solution tables already in the
   JSON (they were verified) or from the sheet. If a figure is a freeform MAP (station maps,
   isohyet contours, basin blobs), reproduce it as a SCHEMATIC story with coordinates
   estimated from the page image — and say "şematik / schematic" in the first caption.
4. After editing, run BOTH:
   `python -c "import json; json.load(open(r'C:\Users\ahmed\Downloads\Hidroloji\cubad\content\unit-<N>.json', encoding='utf-8'))"`
   `cd C:\Users\ahmed\Downloads\Hidroloji\cubad; node scripts/validate-content.mjs`
   and fix until both pass (the validator checks ALL units — only fix YOUR unit's errors; if
   another unit reports errors, ignore them, they're another agent's).
5. Class slides are available for terminology/extra insight: `...\scratchpad\pdf_extract\slides.txt`
   (305 pages). To view a slide page image: `python ...\scratchpad\pdf_extract\render_slide.py <pageNo>`.
   Use them to enrich explanations where helpful — do not import slide content wholesale.

## New schema fields (already supported by the app)

### Every chart — old AND new — must gain these two fields:
```
"howToDraw":   { "tr": "...", "en": "..." },   // 60-150 words: axes & scales to choose, which
                                               // points to plot from which table, how to sketch
                                               // the curve, what to label — as if guiding a hand
                                               // in the exam. Markdown + $latex$ allowed.
"whatItShows": { "tr": "...", "en": "..." }    // 50-120 words: how to READ it, what shape means
                                               // what, which decisions are made from it.
```

### A chart can now live on a STEP (where the sheet draws it mid-solution):
```
steps[i].chart = { ...same ChartSpec... }
```
Prefer step-level placement when the sheet draws the figure at that point of the solution;
keep/put summary curves at question level. A question can now also have `"charts": [ ... ]`
(an ARRAY) in addition to the single legacy `"chart"`.

### Construction stories (step-through animated drawing) on a STEP:
```
steps[i].story = {
  "title": {tr,en},
  "xLabel": "x (km)", "yLabel": "y (km)",        // optional
  "xDomain": [min,max], "yDomain": [min,max],    // REQUIRED, linear only
  "square": true,                                 // preserve aspect (maps/geometry)
  "showAxes": true,                               // false for pure schematics
  "frames": [                                     // 4-8 frames
    { "caption": {tr,en},                         // 1-3 sentences narrating THIS move
      "add": [ elements... ],
      "remove": ["id", ...]                       // optional: drop construction helpers
    }
  ]
}
```
Elements (each may have "id", "color": ink|deniz|clay|amber|moss|faint, "dash": true,
"width": px, and for polygon "fill": true):
- {"type":"point","x":..,"y":..,"label":"A (24)"}
- {"type":"line","x1":..,"y1":..,"x2":..,"y2":..}
- {"type":"arrow","x1":..,"y1":..,"x2":..,"y2":..}
- {"type":"polyline","points":[[x,y],...]}
- {"type":"polygon","points":[[x,y],...],"fill":true}
- {"type":"text","x":..,"y":..,"text":{tr,en},"size":14}
GOLD EXEMPLAR: unit-2.json → question "2-5" → steps[1].story (Thiessen construction). Study it
first; match its granularity, its caption voice (each caption teaches the WHY of the move),
and its use of remove for construction lines.

## Required work per unit (agent for unit N does only its own unit)

UNIT 1 (soru p1, abak p1): sheet has no figures — verify that's true from images; verify both
tables faithful; add howToDraw/whatItShows to any existing charts (likely none). Small job —
be quick.

UNIT 2 (soru p2-8, abak p2-8): 2-1: sheet draws BOTH the cumulative rainfall curve AND the
hyetograph — app has only the hyetograph → add the cumulative curve (line chart, step-level
where S4 discusses it). 2-3: double-mass chart exists → ALSO add a story: plot cumulative
points → straight fit of recent segment → bend appears → slopes m1/m2 as annotated lines →
corrected points. 2-4: THE map question (see soru_p05.png, p06.png): add TWO stories:
(a) Thiessen construction on the schematic station map (station coords estimated from image,
~12×8 grid, stations A(20) B(24) C(27) D(32) E(38) F(50) G(46) H(53) with the dashed basin
blob as a polyline), (b) izohiyet drawing: stations → contour lines 20..55 (schematic
polylines) → band areas table recall. 2-5: exemplar exists — review it, don't duplicate.
2-6: i-t-T chart exists → explanations. 2-7: depth-area chart exists → also draw the isohyet
map schematic (abak_p08.png: nested ovals 70,60,50,40,30,20 with areas labeled) as a story OR
a second chart-like story; your call which is clearer.

UNIT 3 (soru p9-11): sheet appears table-only — verify from images p9-11; ensure the 3-2 and
3-3 computation tables match the sheet layout; no charts expected (don't force any).

UNIT 4 (soru p12-20, abak p19-20): 4-1: sheet draws the standard infiltration curve (exists in
app) AND the semilog ln(f−fc) vs t line → add semilog fit as a story (points from the solution
table: t=0.033..1.5, ln(f−0.758)=2.083..−1.027; frames: plot points → draw best line → slope
triangle → k=2.12) at the k-fitting step. 4-2: no sheet figure — verify. 4-3: i&f chart exists
→ add regime story: i(t) and f(t) curves → crossing at t=0.95 → shade region 1 (all rain
infiltrates, amber polygon under i) and region 2 (Horton controls, deniz polygon under f) —
this is THE concept of the unit; make the captions rich. 4-4: hyetograph exists → add φ-line
story: bars → try a line high → area above vs 10 mm → settle at φ=37.5 with the two blocks
shaded. 4-5/4-6: abak-only, no sheet figures; 4-6 could reuse a small i-f crossing chart —
add a line chart with i=1.82t^-0.3 and f=1+5e^-t sampled at t=0.25..5 (compute points with
Python) with crossing annotation at t=2.62.

UNIT 5 (soru p21-28, abak p21-26): 5-1: the sheet DRAWS THE RIVER CROSS-SECTION (soru p21,
scales 1/50 & 1/133.3) — REQUIRED: story drawing the cross-section: waterline → depth verticals
at x=0..22 (h values) → bed polyline → slice boundaries → one slice highlighted with its
area formula; use y = −h so the bed hangs below zero, yDomain [-3.2, 0.5]. 5-2: similar but
smaller (abak p22 table) → a cross-section CHART (polyline of (x, −h)) with howToDraw, no story
needed. 5-3: rating chart exists. 5-4: add the log-log fit chart: X=log(h−0.3) vs Y=logQ
points from the solution table with the fitted line, plus explanations. 5-5/5-6: rating tables
→ each gets a rating-curve line chart (points from their tables + the flood/extension point
annotated). 5-7: duration curve exists. 5-8: mass curve exists → ADD the tangents story:
cumulative curve → demand line start→end → two parallel dashed tangents (amber) → vertical
gap arrow (clay) labeled 177·10⁶ m³.

UNIT 6 (soru p29-38, abak p28): 6-1: sheet plots U, Qd AND Q together — app chart has U and Q
→ add the Qd series (values = Q − 30 from the table). 6-2: chart exists (add Qd series too:
Q − 60). 6-3: sheet has TWO figures: the observed hydrograph with baseflow line AND the
hyetograph with the φ-line/t0 — add the hyetograph as a step chart (i values 1,3,4,3,2 cm/h at
0.5h intervals) and a story for the volume-by-squares idea on the hydrograph (hydrograph
polyline → baseflow horizontal → shade direct runoff → grid squares annotation → V=540·10⁴ m³).
6-4: sheet plots 1h vs 3h UH comparison → add line chart (two series from the table). 6-5:
S-curve chart exists → add the shift-and-subtract story: S(t) polyline → S(t−4) dashed →
vertical difference arrows → scaled result; and add the 4h-UH result chart (line, from the
solution table). 6-6: Snyder chart exists → explanations.

UNIT 7 (soru p39-43, abak p33-38): 7-1/7-2: no sheet figures (verify). 7-3: add the rating
curve chart (4 table points + equation curve sampled to h=5) if the sheet draws one (check
soru_p40/41) — if the sheet doesn't draw it, still add it as a question-level chart because
the app's fidelity target is "everything drawn in the sheet + nothing invented"... CORRECTION:
if the sheet does NOT draw it, DO NOT add charts the sheet doesn't have — fidelity means
matching the sheet. Only exception: abak-only questions (7-5) where the sheet's solution is
blank but the ANSWER TABLE in abak (Boyutsuz Debiler grid + frequency curve axes on p37-38)
shows a graph is expected → add the regional dimensionless frequency curve as a line chart:
x=T (log), y=(Q/Q̄)_T with the four computed points (10,1.580),(25,1.931),(50,2.192),
(100,2.451) and pooled-data explanation. Also every existing chart gets explanations.

UNIT 8 (abak p39): no sheet solution, but the well problems are inherently graphical → add ONE
story on 8-1: cross-section schematic: ground line → initial water table (dashed deniz) →
well at x=0 (rect-ish polyline) → observation wells at 20 m & 60 m with drawdowns 5 m & 2 m
(points + arrows) → drawdown cone (polyline through (0.5,−17.87),(20,−5),(60,−2) mirrored) →
labels h1=35, h2=38, H=40. showAxes true, xDomain [-70,70], yDomain [-45,5] (y = level relative
to initial water table; put the aquifer floor at −40). Captions teach Dupuit's assumptions.
8-2: verify tables; a schematic story optional — add only if you can keep it ≤6 frames clean.

## Rich explanations — the bar
howToDraw must be written like a hand guiding the student's pencil: "put t on the x-axis in
minutes, 0-160; i on the y-axis 0-60 mm/h; each interval is a BAR of width Δt whose height is
ΔP/Δt from row 3 of the table; the bars must touch..." whatItShows must interpret in plain
words: "the tallest bar is where the storm dumps fastest; the φ line slices the bars so the
shaded area above equals the runoff depth".
Both languages, every chart, every story-bearing question.

## Report (structured output)
- figuresInPdf: for each question id, list of figures found in the sheet (short names)
- added: list of "qid: chart|story|series|table — description"
- explanationsAdded: count of charts that received howToDraw+whatItShows
- unfixable: anything you could not reproduce faithfully + why
