export type Bi = { tr: string; en: string };

export type Lang = "tr" | "en";

export interface KeyFormula {
  name: Bi;
  latex: string;
  meaning: Bi;
  whenToUse: Bi;
}

export interface UnitConcept {
  overview: Bi;
  keyFormulas: KeyFormula[];
  traps: Bi[];
}

export interface QuizItem {
  q: Bi;
  options: Bi[];
  correct: number;
  explain: Bi;
}

export interface GivenItem {
  symbol: string;
  value: string;
  label: Bi;
}

export interface ContentTable {
  title?: Bi;
  headers: string[];
  rows: string[][];
}

export interface ChartAnnotation {
  x: number;
  y: number;
  label: Bi;
}

export interface ChartSeries {
  name: string;
  kind: "line" | "bar";
  points: [number, number][];
}

export interface ChartSpec {
  type: "bar" | "line";
  title: Bi;
  xLabel: string;
  yLabel: string;
  logX?: boolean;
  logY?: boolean;
  series: ChartSeries[];
  barWidths?: number[];
  annotations?: ChartAnnotation[];
}

export interface StepCheck {
  q: Bi;
  options: Bi[];
  correct: number;
  explain: Bi;
}

export interface Step {
  title: Bi;
  guiding: Bi;
  hint: Bi;
  work: Bi;
  why: Bi;
  result?: string | null;
  check?: StepCheck | null;
}

export interface WhatIf {
  scenario: Bi;
  answer: Bi;
}

export interface Question {
  id: string;
  code: string;
  title: Bi;
  difficulty: 1 | 2 | 3;
  examLikelihood: "high" | "medium" | "low";
  statement: Bi;
  given: GivenItem[];
  goal: Bi;
  tables?: ContentTable[];
  chart?: ChartSpec | null;
  steps: Step[];
  finalAnswer: Bi;
  traps: Bi[];
  whatIfs: WhatIf[];
}

export interface Unit {
  unit: number;
  slug: string;
  title: Bi;
  tagline: Bi;
  concept: UnitConcept;
  questions: Question[];
  quiz: QuizItem[];
}
