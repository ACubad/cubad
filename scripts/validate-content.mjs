// Validates content/unit-*.json against the app's content schema.
// Usage: node scripts/validate-content.mjs
import fs from "node:fs";
import path from "node:path";

const dir = path.join(process.cwd(), "content");
const errors = [];
const warn = [];

function isBi(v) {
  return (
    v &&
    typeof v === "object" &&
    typeof v.tr === "string" &&
    v.tr.trim() &&
    typeof v.en === "string" &&
    v.en.trim()
  );
}

function checkBi(v, where) {
  if (!isBi(v)) errors.push(`${where}: missing/empty tr+en pair`);
}

function checkMcq(m, where) {
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
function checkControlChars(s, where) {
  if (typeof s !== "string") return;
  if (/[\t\f\b\r]|\n(?=[a-z]+\b)/.test(s.replace(/\n\n/g, ""))) {
    const m = s.match(/.{0,12}[\t\f\b].{0,12}/);
    if (m) warn.push(`${where}: suspicious control char near "${m[0].replace(/[\t\f\b\r\n]/g, "⏎")}"`);
  }
}

function walkStrings(obj, where, fn) {
  if (typeof obj === "string") fn(obj, where);
  else if (Array.isArray(obj)) obj.forEach((v, i) => walkStrings(v, `${where}[${i}]`, fn));
  else if (obj && typeof obj === "object")
    Object.entries(obj).forEach(([k, v]) => walkStrings(v, `${where}.${k}`, fn));
}

const files = fs
  .readdirSync(dir)
  .filter((f) => /^unit-\d+\.json$/.test(f))
  .sort();

if (files.length === 0) {
  console.error("no content files found");
  process.exit(1);
}

let totalQ = 0;
for (const f of files) {
  let u;
  try {
    u = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
  } catch (e) {
    errors.push(`${f}: JSON parse error: ${e.message}`);
    continue;
  }
  const W = f.replace(".json", "");
  if (!Number.isInteger(u.unit)) errors.push(`${W}: unit must be int`);
  if (typeof u.slug !== "string" || !/^[a-z0-9-]+$/.test(u.slug))
    errors.push(`${W}: bad slug`);
  checkBi(u.title, `${W}.title`);
  checkBi(u.tagline, `${W}.tagline`);
  checkBi(u.concept?.overview, `${W}.concept.overview`);
  (u.concept?.keyFormulas ?? []).forEach((kf, i) => {
    checkBi(kf.name, `${W}.keyFormulas[${i}].name`);
    if (typeof kf.latex !== "string" || !kf.latex.trim())
      errors.push(`${W}.keyFormulas[${i}].latex missing`);
    checkBi(kf.meaning, `${W}.keyFormulas[${i}].meaning`);
    checkBi(kf.whenToUse, `${W}.keyFormulas[${i}].whenToUse`);
  });
  (u.concept?.traps ?? []).forEach((tr, i) => checkBi(tr, `${W}.concept.traps[${i}]`));

  if (!Array.isArray(u.questions) || u.questions.length === 0)
    errors.push(`${W}: no questions`);

  const ids = new Set();
  (u.questions ?? []).forEach((q, qi) => {
    totalQ++;
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
    function checkChart(c, where) {
      if (!["bar", "line"].includes(c.type)) errors.push(`${where}.type`);
      if (!isBi(c.title)) errors.push(`${where}.title`);
      (c.series ?? []).forEach((s, si) => {
        if (!Array.isArray(s.points) || s.points.some((p) => !Array.isArray(p) || p.length !== 2 || p.some((n) => typeof n !== "number" || !isFinite(n))))
          errors.push(`${where}.series[${si}].points: non-numeric`);
      });
      if (c.howToDraw && !isBi(c.howToDraw)) errors.push(`${where}.howToDraw`);
      if (c.whatItShows && !isBi(c.whatItShows)) errors.push(`${where}.whatItShows`);
    }
    function checkStory(s, where) {
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

  if (!Array.isArray(u.quiz) || u.quiz.length < 4)
    warn.push(`${W}: quiz has <4 items`);
  (u.quiz ?? []).forEach((m, i) => checkMcq(m, `${W}.quiz[${i}]`));

  walkStrings(u, W, checkControlChars);
}

console.log(`checked ${files.length} files, ${totalQ} questions`);
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
