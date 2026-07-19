/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Bi } from "@/lib/types";

export interface ValidationResult {
  errors: string[];
  warnings: string[];
  questionCount: number;
}

export interface ValidationContext {
  errors: string[];
  warnings: string[];
}

export function isBi(value: unknown): value is Bi {
  if (!value || typeof value !== "object") return false;
  const pair = value as Partial<Bi>;
  return (
    typeof pair.tr === "string" &&
    pair.tr.trim().length > 0 &&
    typeof pair.en === "string" &&
    pair.en.trim().length > 0
  );
}

export function checkBi(value: unknown, where: string, context: ValidationContext): void {
  if (!isBi(value)) context.errors.push(`${where}: missing/empty tr+en pair`);
}

export function checkMcq(item: any, where: string, context: ValidationContext): void {
  checkBi(item?.q, `${where}.q`, context);
  if (!Array.isArray(item?.options) || item.options.length < 2) {
    context.errors.push(`${where}.options: need >=2`);
  } else {
    item.options.forEach((option: unknown, index: number) =>
      checkBi(option, `${where}.options[${index}]`, context)
    );
  }
  if (
    !Number.isInteger(item?.correct) ||
    item.correct < 0 ||
    item.correct >= (item?.options?.length ?? 0)
  ) {
    context.errors.push(`${where}.correct: out of range`);
  }
  checkBi(item?.explain, `${where}.explain`, context);
}

export function checkControlChars(
  value: unknown,
  where: string,
  context: ValidationContext
): void {
  if (typeof value !== "string") return;
  if (/[\t\f\b\r]|\n(?=[a-z]+\b)/.test(value.replace(/\n\n/g, ""))) {
    const match = value.match(/.{0,12}[\t\f\b].{0,12}/);
    if (match) {
      context.warnings.push(
        `${where}: suspicious control char near "${match[0].replace(/[\t\f\b\r\n]/g, "âŽ")}"`
      );
    }
  }
}

export function walkStrings(
  value: unknown,
  where: string,
  visit: (text: string, path: string) => void
): void {
  if (typeof value === "string") visit(value, where);
  else if (Array.isArray(value)) {
    value.forEach((child, index) => walkStrings(child, `${where}[${index}]`, visit));
  } else if (value && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([key, child]) =>
      walkStrings(child, `${where}.${key}`, visit)
    );
  }
}

export function checkChart(chart: any, where: string, context: ValidationContext): void {
  if (!["bar", "line"].includes(chart?.type)) context.errors.push(`${where}.type`);
  if (!isBi(chart?.title)) context.errors.push(`${where}.title`);
  (chart?.series ?? []).forEach((series: any, seriesIndex: number) => {
    if (
      !Array.isArray(series?.points) ||
      series.points.some(
        (point: unknown) =>
          !Array.isArray(point) ||
          point.length !== 2 ||
          point.some((number) => typeof number !== "number" || !Number.isFinite(number))
      )
    ) {
      context.errors.push(`${where}.series[${seriesIndex}].points: non-numeric`);
    }
  });
  if (chart?.howToDraw && !isBi(chart.howToDraw)) context.errors.push(`${where}.howToDraw`);
  if (chart?.whatItShows && !isBi(chart.whatItShows)) context.errors.push(`${where}.whatItShows`);
}

export function checkStory(story: any, where: string, context: ValidationContext): void {
  if (!isBi(story?.title)) context.errors.push(`${where}.title`);
  if (
    !Array.isArray(story?.xDomain) ||
    story.xDomain.length !== 2 ||
    !Array.isArray(story?.yDomain) ||
    story.yDomain.length !== 2
  ) {
    context.errors.push(`${where}: xDomain/yDomain must be [min,max]`);
  }
  if (!Array.isArray(story?.frames) || story.frames.length < 2) {
    context.errors.push(`${where}: needs >=2 frames`);
  }
  (story?.frames ?? []).forEach((frame: any, frameIndex: number) => {
    if (!isBi(frame?.caption)) context.errors.push(`${where}.frames[${frameIndex}].caption`);
    if (!Array.isArray(frame?.add)) context.errors.push(`${where}.frames[${frameIndex}].add`);
    (frame?.add ?? []).forEach((element: any, elementIndex: number) => {
      const elementWhere = `${where}.frames[${frameIndex}].add[${elementIndex}]`;
      if (!["point", "line", "polyline", "polygon", "text", "arrow"].includes(element?.type)) {
        context.errors.push(`${elementWhere}.type "${element?.type}"`);
      }
      if (
        element?.type === "point" &&
        (typeof element.x !== "number" || typeof element.y !== "number")
      ) {
        context.errors.push(`${elementWhere}: point needs x,y`);
      }
      if (
        (element?.type === "line" || element?.type === "arrow") &&
        [element.x1, element.y1, element.x2, element.y2].some(
          (number) => typeof number !== "number"
        )
      ) {
        context.errors.push(`${elementWhere}: needs x1,y1,x2,y2`);
      }
      if (
        (element?.type === "polyline" || element?.type === "polygon") &&
        (!Array.isArray(element.points) ||
          element.points.some(
            (point: unknown) => !Array.isArray(point) || point.length !== 2
          ))
      ) {
        context.errors.push(`${elementWhere}: needs points[][]`);
      }
      if (
        element?.type === "text" &&
        (typeof element.x !== "number" ||
          typeof element.y !== "number" ||
          !(isBi(element.text) || typeof element.label === "string"))
      ) {
        context.errors.push(`${elementWhere}: text needs x,y,text`);
      }
      if (
        element?.color &&
        !["ink", "deniz", "clay", "amber", "moss", "faint"].includes(element.color)
      ) {
        context.errors.push(`${elementWhere}.color "${element.color}"`);
      }
    });
  });
}

export function checkWalkthroughQuestions(
  unit: any,
  where: string,
  ids: Set<string>,
  context: ValidationContext
): void {
  (unit?.questions ?? []).forEach((question: any, questionIndex: number) => {
    const questionWhere = `${where}.q[${question?.id ?? questionIndex}]`;
    if (typeof question?.id !== "string" || !/^\d+-\d+[a-z]?$/.test(question.id)) {
      context.errors.push(`${questionWhere}: bad id "${question?.id}"`);
    }
    if (ids.has(question?.id)) context.errors.push(`${questionWhere}: duplicate id`);
    ids.add(question?.id);
    if (typeof question?.code !== "string") context.errors.push(`${questionWhere}: missing code`);
    checkBi(question?.title, `${questionWhere}.title`, context);
    if (![1, 2, 3].includes(question?.difficulty)) context.errors.push(`${questionWhere}: difficulty`);
    if (!["high", "medium", "low"].includes(question?.examLikelihood)) {
      context.errors.push(`${questionWhere}: examLikelihood`);
    }
    checkBi(question?.statement, `${questionWhere}.statement`, context);
    checkBi(question?.goal, `${questionWhere}.goal`, context);
    (question?.given ?? []).forEach((given: any, index: number) => {
      if (typeof given?.symbol !== "string" || typeof given?.value !== "string") {
        context.errors.push(`${questionWhere}.given[${index}]`);
      }
      checkBi(given?.label, `${questionWhere}.given[${index}].label`, context);
    });
    (question?.tables ?? []).forEach((table: any, index: number) => {
      if (!Array.isArray(table?.headers) || !Array.isArray(table?.rows)) {
        context.errors.push(`${questionWhere}.tables[${index}]: headers/rows`);
      } else {
        table.rows.forEach((row: unknown, rowIndex: number) => {
          if (!Array.isArray(row)) context.errors.push(`${questionWhere}.tables[${index}].rows[${rowIndex}]`);
        });
      }
    });
    if (question?.chart) checkChart(question.chart, `${questionWhere}.chart`, context);
    (question?.charts ?? []).forEach((chart: any, index: number) =>
      checkChart(chart, `${questionWhere}.charts[${index}]`, context)
    );
    if (!Array.isArray(question?.steps) || question.steps.length < 2) {
      context.errors.push(`${questionWhere}: needs >=2 steps`);
    }
    (question?.steps ?? []).forEach((step: any, stepIndex: number) => {
      const stepWhere = `${questionWhere}.steps[${stepIndex}]`;
      checkBi(step?.title, `${stepWhere}.title`, context);
      checkBi(step?.guiding, `${stepWhere}.guiding`, context);
      checkBi(step?.hint, `${stepWhere}.hint`, context);
      checkBi(step?.work, `${stepWhere}.work`, context);
      checkBi(step?.why, `${stepWhere}.why`, context);
      if (step?.check) checkMcq(step.check, `${stepWhere}.check`, context);
      if (step?.chart) checkChart(step.chart, `${stepWhere}.chart`, context);
      if (step?.story) checkStory(step.story, `${stepWhere}.story`, context);
    });
    checkBi(question?.finalAnswer, `${questionWhere}.finalAnswer`, context);
    (question?.traps ?? []).forEach((trap: unknown, index: number) =>
      checkBi(trap, `${questionWhere}.traps[${index}]`, context)
    );
    if (!Array.isArray(question?.whatIfs) || question.whatIfs.length < 1) {
      context.warnings.push(`${questionWhere}: no whatIfs`);
    }
    (question?.whatIfs ?? []).forEach((whatIf: any, index: number) => {
      checkBi(whatIf?.scenario, `${questionWhere}.whatIfs[${index}].scenario`, context);
      checkBi(whatIf?.answer, `${questionWhere}.whatIfs[${index}].answer`, context);
    });
  });
}

export function checkWalkthroughUnit(
  unit: any,
  where: string,
  context: ValidationContext
): number {
  if (!Array.isArray(unit?.questions) || unit.questions.length === 0) {
    context.errors.push(`${where}: no questions`);
  }
  checkBi(unit?.concept?.overview, `${where}.concept.overview`, context);
  (unit?.concept?.keyFormulas ?? []).forEach((formula: any, index: number) => {
    checkBi(formula?.name, `${where}.keyFormulas[${index}].name`, context);
    if (typeof formula?.latex !== "string" || !formula.latex.trim()) {
      context.errors.push(`${where}.keyFormulas[${index}].latex missing`);
    }
    checkBi(formula?.meaning, `${where}.keyFormulas[${index}].meaning`, context);
    checkBi(formula?.whenToUse, `${where}.keyFormulas[${index}].whenToUse`, context);
  });
  (unit?.concept?.traps ?? []).forEach((trap: unknown, index: number) =>
    checkBi(trap, `${where}.concept.traps[${index}]`, context)
  );
  checkWalkthroughQuestions(unit, where, new Set<string>(), context);
  if (!Array.isArray(unit?.quiz) || unit.quiz.length < 4) {
    context.warnings.push(`${where}: quiz has <4 items`);
  }
  (unit?.quiz ?? []).forEach((item: any, index: number) =>
    checkMcq(item, `${where}.quiz[${index}]`, context)
  );
  return (unit?.questions ?? []).length;
}

export function checkStudyUnit(unit: any, where: string, context: ValidationContext): void {
  if (!unit?.sources || typeof unit.sources !== "object") {
    context.errors.push(`${where}.sources: missing`);
  } else {
    if (!Array.isArray(unit.sources.videos)) context.errors.push(`${where}.sources.videos: must be array`);
    else unit.sources.videos.forEach((video: any, index: number) => {
      if (typeof video?.id !== "string" || !video.id.trim()) context.errors.push(`${where}.sources.videos[${index}].id`);
      if (typeof video?.title !== "string" || !video.title.trim()) context.errors.push(`${where}.sources.videos[${index}].title`);
      if (typeof video?.length !== "string" || !video.length.trim()) context.errors.push(`${where}.sources.videos[${index}].length`);
    });
    if (!Array.isArray(unit.sources.pdfs)) context.errors.push(`${where}.sources.pdfs: must be array`);
    else unit.sources.pdfs.forEach((pdf: unknown, index: number) => {
      if (typeof pdf !== "string" || !pdf.trim()) context.errors.push(`${where}.sources.pdfs[${index}]`);
    });
  }

  const noteIds = new Set<string>();
  if (!Array.isArray(unit?.notes) || unit.notes.length < 4) context.errors.push(`${where}.notes: need >=4`);
  (unit?.notes ?? []).forEach((note: any, index: number) => {
    const noteWhere = `${where}.notes[${index}]`;
    if (typeof note?.id !== "string" || !/^n\d+$/.test(note.id)) context.errors.push(`${noteWhere}.id: bad id "${note?.id}"`);
    if (noteIds.has(note?.id)) context.errors.push(`${noteWhere}.id: duplicate`);
    noteIds.add(note?.id);
    checkBi(note?.title, `${noteWhere}.title`, context);
    checkBi(note?.body, `${noteWhere}.body`, context);
    if (note?.story) checkStory(note.story, `${noteWhere}.story`, context);
  });

  const cardIds = new Set<string>();
  if (!Array.isArray(unit?.flashcards) || unit.flashcards.length < 20) context.errors.push(`${where}.flashcards: need >=20`);
  (unit?.flashcards ?? []).forEach((card: any, index: number) => {
    const cardWhere = `${where}.flashcards[${index}]`;
    if (typeof card?.id !== "string" || !card.id.trim()) context.errors.push(`${cardWhere}.id`);
    if (cardIds.has(card?.id)) context.errors.push(`${cardWhere}.id: duplicate`);
    cardIds.add(card?.id);
    checkBi(card?.front, `${cardWhere}.front`, context);
    checkBi(card?.back, `${cardWhere}.back`, context);
    if (typeof card?.en !== "string" || !card.en.trim()) context.errors.push(`${cardWhere}.en: empty`);
    if (typeof card?.tag !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(card.tag)) context.errors.push(`${cardWhere}.tag: not kebab-case "${card?.tag}"`);
  });

  const practiceIds = new Set<string>();
  const coversSeen = new Set<string>();
  if (!Array.isArray(unit?.practice) || unit.practice.length < 15) context.errors.push(`${where}.practice: need >=15`);
  (unit?.practice ?? []).forEach((item: any, index: number) => {
    const practiceWhere = `${where}.practice[${index}]`;
    if (typeof item?.id !== "string" || !item.id.trim()) context.errors.push(`${practiceWhere}.id`);
    if (practiceIds.has(item?.id)) context.errors.push(`${practiceWhere}.id: duplicate`);
    practiceIds.add(item?.id);
    if (!["mcq", "open"].includes(item?.type)) context.errors.push(`${practiceWhere}.type`);
    checkBi(item?.q, `${practiceWhere}.q`, context);
    if (![1, 2, 3].includes(item?.difficulty)) context.errors.push(`${practiceWhere}.difficulty`);
    if (!Array.isArray(item?.covers) || item.covers.length === 0) context.errors.push(`${practiceWhere}.covers: need >=1`);
    else item.covers.forEach((noteId: string) => {
      if (!noteIds.has(noteId)) context.errors.push(`${practiceWhere}.covers: "${noteId}" not a note id`);
      coversSeen.add(noteId);
    });
    if (item?.type === "mcq") {
      if (!Array.isArray(item.options) || item.options.length !== 4) context.errors.push(`${practiceWhere}.options: need exactly 4`);
      else item.options.forEach((option: unknown, optionIndex: number) => checkBi(option, `${practiceWhere}.options[${optionIndex}]`, context));
      if (!Number.isInteger(item.correct) || item.correct < 0 || item.correct >= (item.options?.length ?? 0)) context.errors.push(`${practiceWhere}.correct: out of range`);
      checkBi(item.explain, `${practiceWhere}.explain`, context);
    } else if (item?.type === "open") {
      checkBi(item.answer, `${practiceWhere}.answer`, context);
    }
  });
  for (const noteId of noteIds) {
    if (!coversSeen.has(noteId)) context.warnings.push(`${where}: note "${noteId}" is never covered by any practice item`);
  }
  if (unit?.questions) checkWalkthroughQuestions(unit, where, new Set<string>(), context);
}

export function validateUnit(
  sectionOrder: "walkthrough" | "study",
  value: unknown,
  where = "unit"
): ValidationResult {
  const context: ValidationContext = { errors: [], warnings: [] };
  const unit = value as any;
  if (!Number.isInteger(unit?.unit)) context.errors.push(`${where}: unit must be int`);
  if (typeof unit?.slug !== "string" || !/^[a-z0-9-]+$/.test(unit.slug)) context.errors.push(`${where}: bad slug`);
  checkBi(unit?.title, `${where}.title`, context);
  checkBi(unit?.tagline, `${where}.tagline`, context);

  let questionCount = 0;
  if (sectionOrder === "walkthrough") questionCount = checkWalkthroughUnit(unit, where, context);
  else if (sectionOrder === "study") checkStudyUnit(unit, where, context);
  else context.errors.push(`${where}: unknown section_order "${sectionOrder}"`);

  walkStrings(unit, where, (text, path) => checkControlChars(text, path, context));
  return { errors: context.errors, warnings: context.warnings, questionCount };
}
