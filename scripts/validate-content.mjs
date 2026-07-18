// Validates content/subjects.json and content/<subject>/unit-*.json against the app's schema.
// Usage: node scripts/validate-content.mjs
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CONTENT_DIR = path.join(process.cwd(), "content");
const SUBJECTS_FILE = path.join(CONTENT_DIR, "subjects.json");
export const errors = [];
export const warn = [];

/** Clears accumulated diagnostics before validating an imported unit. */
export function resetDiagnostics() {
  errors.length = 0;
  warn.length = 0;
}

export function isBi(v) {
  return (
    v &&
    typeof v === "object" &&
    typeof v.tr === "string" &&
    v.tr.trim() &&
    typeof v.en === "string" &&
    v.en.trim()
  );
}

export function checkBi(v, where) {
  if (!isBi(v)) errors.push(`${where}: missing/empty tr+en pair`);
}

export function checkMcq(m, where) {
  checkBi(m.q, `${where}.q`);
  if (!Array.isArray(m.options) || m.options.length < 2)
    errors.push(`${where}.options: need >=2`);
  else m.options.forEach((o, i) => checkBi(o, `${where}.options[${i}]`));
  if (
    !Number.isInteger(m.correct) ||
    m.correct < 0 ||
    m.correct >= (m.options?.length ?? 0)
  )
    errors.push(`${where}.correct: out of range`);
  checkBi(m.explain, `${where}.explain`);
}

// LaTeX sequences that JSON-decoded into control characters ("\t", "\n", "\f", "\b", "\r"
// inside math like \frac -> \f + "rac") are the classic authoring bug.
export function checkControlChars(s, where) {
  if (typeof s !== "string") return;
  if (/[\t\f\b\r]|\n(?=[a-z]+\b)/.test(s.replace(/\n\n/g, ""))) {
    const m = s.match(/.{0,12}[\t\f\b].{0,12}/);
    if (m) warn.push(`${where}: suspicious control char near "${m[0].replace(/[\t\f\b\r\n]/g, "⏎")}"`);
  }
}

export function walkStrings(obj, where, fn) {
  if (typeof obj === "string") fn(obj, where);
  else if (Array.isArray(obj)) obj.forEach((v, i) => walkStrings(v, `${where}[${i}]`, fn));
  else if (obj && typeof obj === "object")
    Object.entries(obj).forEach(([k, v]) => walkStrings(v, `${where}.${k}`, fn));
}

export function checkChart(c, where) {
  if (!["bar", "line"].includes(c.type)) errors.push(`${where}.type`);
  if (!isBi(c.title)) errors.push(`${where}.title`);
  (c.series ?? []).forEach((s, si) => {
    if (!Array.isArray(s.points) || s.points.some((p) => !Array.isArray(p) || p.length !== 2 || p.some((n) => typeof n !== "number" || !isFinite(n))))
      errors.push(`${where}.series[${si}].points: non-numeric`);
  });
  if (c.howToDraw && !isBi(c.howToDraw)) errors.push(`${where}.howToDraw`);
  if (c.whatItShows && !isBi(c.whatItShows)) errors.push(`${where}.whatItShows`);
}

export function checkStory(s, where) {
  if (!isBi(s.title)) errors.push(`${where}.title`);
  if (!Array.isArray(s.xDomain) || s.xDomain.length !== 2 || !Array.isArray(s.yDomain) || s.yDomain.length !== 2)
    errors.push(`${where}: xDomain/yDomain must be [min,max]`);
  if (!Array.isArray(s.frames) || s.frames.length < 2) errors.push(`${where}: needs >=2 frames`);
  (s.frames ?? []).forEach((fr, fi) => {
    if (!isBi(fr.caption)) errors.push(`${where}.frames[${fi}].caption`);
    if (!Array.isArray(fr.add)) errors.push(`${where}.frames[${fi}].add`);
    (fr.add ?? []).forEach((el, ei) => {
      const EW = `${where}.frames[${fi}].add[${ei}]`;
      if (!["point", "line", "polyline", "polygon", "text", "arrow"].includes(el.type))
        errors.push(`${EW}.type "${el.type}"`);
      if (el.type === "point" && (typeof el.x !== "number" || typeof el.y !== "number")) errors.push(`${EW}: point needs x,y`);
      if ((el.type === "line" || el.type === "arrow") && [el.x1, el.y1, el.x2, el.y2].some((n) => typeof n !== "number")) errors.push(`${EW}: needs x1,y1,x2,y2`);
      if ((el.type === "polyline" || el.type === "polygon") && (!Array.isArray(el.points) || el.points.some((p) => !Array.isArray(p) || p.length !== 2))) errors.push(`${EW}: needs points[][]`);
      if (el.type === "text" && (typeof el.x !== "number" || typeof el.y !== "number" || !(isBi(el.text) || typeof el.label === "string"))) errors.push(`${EW}: text needs x,y,text`);
      if (el.color && !["ink", "deniz", "clay", "amber", "moss", "faint"].includes(el.color)) errors.push(`${EW}.color "${el.color}"`);
    });
  });
}

/** Existing hydrology-style walkthrough Question rules (shared by both kinds' optional `questions`). */
export function checkWalkthroughQuestions(u, W, ids) {
  (u.questions ?? []).forEach((q, qi) => {
    const QW = `${W}.q[${q.id ?? qi}]`;
    if (typeof q.id !== "string" || !/^\d+-\d+[a-z]?$/.test(q.id))
      errors.push(`${QW}: bad id "${q.id}"`);
    if (ids.has(q.id)) errors.push(`${QW}: duplicate id`);
    ids.add(q.id);
    if (typeof q.code !== "string") errors.push(`${QW}: missing code`);
    checkBi(q.title, `${QW}.title`);
    if (![1, 2, 3].includes(q.difficulty)) errors.push(`${QW}: difficulty`);
    if (!["high", "medium", "low"].includes(q.examLikelihood))
      errors.push(`${QW}: examLikelihood`);
    checkBi(q.statement, `${QW}.statement`);
    checkBi(q.goal, `${QW}.goal`);
    (q.given ?? []).forEach((g, i) => {
      if (typeof g.symbol !== "string" || typeof g.value !== "string")
        errors.push(`${QW}.given[${i}]`);
      checkBi(g.label, `${QW}.given[${i}].label`);
    });
    (q.tables ?? []).forEach((tb, i) => {
      if (!Array.isArray(tb.headers) || !Array.isArray(tb.rows))
        errors.push(`${QW}.tables[${i}]: headers/rows`);
      else
        tb.rows.forEach((r, ri) => {
          if (!Array.isArray(r)) errors.push(`${QW}.tables[${i}].rows[${ri}]`);
        });
    });
    if (q.chart) checkChart(q.chart, `${QW}.chart`);
    (q.charts ?? []).forEach((c, ci) => checkChart(c, `${QW}.charts[${ci}]`));
    if (!Array.isArray(q.steps) || q.steps.length < 2)
      errors.push(`${QW}: needs >=2 steps`);
    (q.steps ?? []).forEach((s, si) => {
      const SW = `${QW}.steps[${si}]`;
      checkBi(s.title, `${SW}.title`);
      checkBi(s.guiding, `${SW}.guiding`);
      checkBi(s.hint, `${SW}.hint`);
      checkBi(s.work, `${SW}.work`);
      checkBi(s.why, `${SW}.why`);
      if (s.check) checkMcq(s.check, `${SW}.check`);
      if (s.chart) checkChart(s.chart, `${SW}.chart`);
      if (s.story) checkStory(s.story, `${SW}.story`);
    });
    checkBi(q.finalAnswer, `${QW}.finalAnswer`);
    (q.traps ?? []).forEach((tr, i) => checkBi(tr, `${QW}.traps[${i}]`));
    if (!Array.isArray(q.whatIfs) || q.whatIfs.length < 1)
      warn.push(`${QW}: no whatIfs`);
    (q.whatIfs ?? []).forEach((wi, i) => {
      checkBi(wi.scenario, `${QW}.whatIfs[${i}].scenario`);
      checkBi(wi.answer, `${QW}.whatIfs[${i}].answer`);
    });
  });
}

export function checkWalkthroughUnit(u, W, totalQRef) {
  if (!Array.isArray(u.questions) || u.questions.length === 0)
    errors.push(`${W}: no questions`);

  checkBi(u.concept?.overview, `${W}.concept.overview`);
  (u.concept?.keyFormulas ?? []).forEach((kf, i) => {
    checkBi(kf.name, `${W}.keyFormulas[${i}].name`);
    if (typeof kf.latex !== "string" || !kf.latex.trim())
      errors.push(`${W}.keyFormulas[${i}].latex missing`);
    checkBi(kf.meaning, `${W}.keyFormulas[${i}].meaning`);
    checkBi(kf.whenToUse, `${W}.keyFormulas[${i}].whenToUse`);
  });
  (u.concept?.traps ?? []).forEach((tr, i) => checkBi(tr, `${W}.concept.traps[${i}]`));

  const ids = new Set();
  totalQRef.n += (u.questions ?? []).length;
  checkWalkthroughQuestions(u, W, ids);

  if (!Array.isArray(u.quiz) || u.quiz.length < 4)
    warn.push(`${W}: quiz has <4 items`);
  (u.quiz ?? []).forEach((m, i) => checkMcq(m, `${W}.quiz[${i}]`));
}

export function checkStudyUnit(u, W) {
  // sources
  if (!u.sources || typeof u.sources !== "object") {
    errors.push(`${W}.sources: missing`);
  } else {
    if (!Array.isArray(u.sources.videos)) errors.push(`${W}.sources.videos: must be array`);
    else
      u.sources.videos.forEach((v, i) => {
        if (typeof v.id !== "string" || !v.id.trim()) errors.push(`${W}.sources.videos[${i}].id`);
        if (typeof v.title !== "string" || !v.title.trim()) errors.push(`${W}.sources.videos[${i}].title`);
        if (typeof v.length !== "string" || !v.length.trim()) errors.push(`${W}.sources.videos[${i}].length`);
      });
    if (!Array.isArray(u.sources.pdfs)) errors.push(`${W}.sources.pdfs: must be array`);
    else
      u.sources.pdfs.forEach((p, i) => {
        if (typeof p !== "string" || !p.trim()) errors.push(`${W}.sources.pdfs[${i}]`);
      });
  }

  // notes
  const noteIds = new Set();
  if (!Array.isArray(u.notes) || u.notes.length < 4) {
    errors.push(`${W}.notes: need >=4`);
  }
  (u.notes ?? []).forEach((n, i) => {
    const NW = `${W}.notes[${i}]`;
    if (typeof n.id !== "string" || !/^n\d+$/.test(n.id)) errors.push(`${NW}.id: bad id "${n.id}"`);
    if (noteIds.has(n.id)) errors.push(`${NW}.id: duplicate`);
    noteIds.add(n.id);
    checkBi(n.title, `${NW}.title`);
    checkBi(n.body, `${NW}.body`);
    if (n.story) checkStory(n.story, `${NW}.story`);
  });

  // flashcards
  const cardIds = new Set();
  if (!Array.isArray(u.flashcards) || u.flashcards.length < 20) {
    errors.push(`${W}.flashcards: need >=20`);
  }
  (u.flashcards ?? []).forEach((c, i) => {
    const CW = `${W}.flashcards[${i}]`;
    if (typeof c.id !== "string" || !c.id.trim()) errors.push(`${CW}.id`);
    if (cardIds.has(c.id)) errors.push(`${CW}.id: duplicate`);
    cardIds.add(c.id);
    checkBi(c.front, `${CW}.front`);
    checkBi(c.back, `${CW}.back`);
    if (typeof c.en !== "string" || !c.en.trim()) errors.push(`${CW}.en: empty`);
    if (typeof c.tag !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.tag))
      errors.push(`${CW}.tag: not kebab-case "${c.tag}"`);
  });

  // practice
  const practiceIds = new Set();
  const coversSeen = new Set();
  if (!Array.isArray(u.practice) || u.practice.length < 15) {
    errors.push(`${W}.practice: need >=15`);
  }
  (u.practice ?? []).forEach((p, i) => {
    const PW = `${W}.practice[${i}]`;
    if (typeof p.id !== "string" || !p.id.trim()) errors.push(`${PW}.id`);
    if (practiceIds.has(p.id)) errors.push(`${PW}.id: duplicate`);
    practiceIds.add(p.id);
    if (!["mcq", "open"].includes(p.type)) errors.push(`${PW}.type`);
    checkBi(p.q, `${PW}.q`);
    if (![1, 2, 3].includes(p.difficulty)) errors.push(`${PW}.difficulty`);
    if (!Array.isArray(p.covers) || p.covers.length === 0) {
      errors.push(`${PW}.covers: need >=1`);
    } else {
      p.covers.forEach((cid) => {
        if (!noteIds.has(cid)) errors.push(`${PW}.covers: "${cid}" not a note id`);
        coversSeen.add(cid);
      });
    }
    if (p.type === "mcq") {
      if (!Array.isArray(p.options) || p.options.length !== 4)
        errors.push(`${PW}.options: need exactly 4`);
      else p.options.forEach((o, oi) => checkBi(o, `${PW}.options[${oi}]`));
      if (
        !Number.isInteger(p.correct) ||
        p.correct < 0 ||
        p.correct >= (p.options?.length ?? 0)
      )
        errors.push(`${PW}.correct: out of range`);
      checkBi(p.explain, `${PW}.explain`);
    } else if (p.type === "open") {
      checkBi(p.answer, `${PW}.answer`);
    }
  });

  // cross-check: every note id referenced by >=1 practice item
  for (const nid of noteIds) {
    if (!coversSeen.has(nid)) warn.push(`${W}: note "${nid}" is never covered by any practice item`);
  }

  // optional walkthrough questions (same schema as hydrology)
  if (u.questions) {
    const ids = new Set();
    checkWalkthroughQuestions(u, W, ids);
  }
}

/** Validates one parsed unit object against its subject schema. */
export function checkUnit(u, sectionOrder, where) {
  if (!Number.isInteger(u.unit)) errors.push(`${where}: unit must be int`);
  if (typeof u.slug !== "string" || !/^[a-z0-9-]+$/.test(u.slug))
    errors.push(`${where}: bad slug`);
  checkBi(u.title, `${where}.title`);
  checkBi(u.tagline, `${where}.tagline`);
  if (sectionOrder === "walkthrough") {
    checkWalkthroughUnit(u, where, { n: 0 });
  } else if (sectionOrder === "study") {
    checkStudyUnit(u, where);
  } else {
    errors.push(`${where}: unknown section_order "${sectionOrder}"`);
  }
  walkStrings(u, where, checkControlChars);
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
const subjects = fs.existsSync(SUBJECTS_FILE)
  ? JSON.parse(fs.readFileSync(SUBJECTS_FILE, "utf-8"))
  : [];

if (subjects.length === 0) {
  console.error("no subjects found in content/subjects.json");
  process.exit(1);
}

let totalFiles = 0;
const totalQRef = { n: 0 };

for (const subject of subjects) {
  const dir = path.join(CONTENT_DIR, subject.slug);
  if (!fs.existsSync(dir)) {
    errors.push(`content/${subject.slug}: directory missing`);
    continue;
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^unit-\d+\.json$/.test(f))
    .sort();

  if (files.length === 0) {
    errors.push(`content/${subject.slug}: no unit files found`);
    continue;
  }

  for (const f of files) {
    totalFiles++;
    let u;
    try {
      u = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
    } catch (e) {
      errors.push(`${subject.slug}/${f}: JSON parse error: ${e.message}`);
      continue;
    }
    const W = `${subject.slug}/${f.replace(".json", "")}`;
    checkUnit(u, subject.kind, W);
    if (subject.kind === "walkthrough") totalQRef.n += (u.questions ?? []).length;
  }
}

console.log(`checked ${subjects.length} subjects, ${totalFiles} files, ${totalQRef.n} walkthrough questions`);
if (warn.length) {
  console.log(`\n${warn.length} warnings:`);
  warn.slice(0, 40).forEach((w) => console.log("  ⚠ " + w));
}
if (errors.length) {
  console.error(`\n${errors.length} ERRORS:`);
  errors.slice(0, 60).forEach((e) => console.error("  ✗ " + e));
  process.exit(1);
}
console.log("content OK");
}
