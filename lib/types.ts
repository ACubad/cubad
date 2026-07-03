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
  /** exam-oriented instructions: axes, scales, which points to plot, how to sketch */
  howToDraw?: Bi;
  /** interpretation: what the finished graph tells you */
  whatItShows?: Bi;
}

/* ---------- graph story (step-through construction animation) ---------- */

export type StoryColor = "ink" | "deniz" | "clay" | "amber" | "moss" | "faint";

export interface StoryElement {
  id?: string;
  type: "point" | "line" | "polyline" | "polygon" | "text" | "arrow";
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  points?: [number, number][];
  /** short label drawn next to a point */
  label?: string;
  /** for type "text" */
  text?: Bi;
  color?: StoryColor;
  dash?: boolean;
  width?: number;
  /** translucent fill for polygons */
  fill?: boolean;
  size?: number;
}

export interface StoryFrame {
  caption: Bi;
  add: StoryElement[];
  remove?: string[];
}

export interface GraphStory {
  title: Bi;
  xLabel?: string;
  yLabel?: string;
  xDomain: [number, number];
  yDomain: [number, number];
  /** preserve aspect ratio (maps / geometric constructions) */
  square?: boolean;
  /** default true; set false for map-like schematics */
  showAxes?: boolean;
  frames: StoryFrame[];
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
  /** chart drawn at THIS step of the solution (as in the course sheet) */
  chart?: ChartSpec | null;
  /** step-through construction animation for graphs the student must draw */
  story?: GraphStory | null;
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
  /** additional result graphs (a question can have several, as in the sheet) */
  charts?: ChartSpec[];
  steps: Step[];
  finalAnswer: Bi;
  traps: Bi[];
  whatIfs: WhatIf[];
}

export interface SubjectMeta {
  slug: string;
  kind: "walkthrough" | "study";
  title: Bi;
  tagline: Bi;
}

export interface NoteSection {
  id: string;
  title: Bi;
  body: Bi;
  story?: GraphStory | null;
}

export interface Flashcard {
  id: string;
  front: Bi;
  back: Bi;
  en: string;
  tag: string;
}

export interface PracticeMcq {
  id: string;
  type: "mcq";
  covers: string[];
  difficulty: 1 | 2 | 3;
  examStyle?: boolean;
  q: Bi;
  options: Bi[];
  correct: number;
  explain: Bi;
}

export interface PracticeOpen {
  id: string;
  type: "open";
  covers: string[];
  difficulty: 1 | 2 | 3;
  examStyle?: boolean;
  q: Bi;
  answer: Bi;
}

export type PracticeItem = PracticeMcq | PracticeOpen;

export interface UnitSources {
  videos: { id: string; title: string; length: string }[];
  pdfs: string[];
}

export interface Unit {
  unit: number;
  slug: string;
  title: Bi;
  tagline: Bi;
  concept?: UnitConcept;
  questions?: Question[];
  quiz?: QuizItem[];
  sources?: UnitSources;
  notes?: NoteSection[];
  flashcards?: Flashcard[];
  practice?: PracticeItem[];
}
