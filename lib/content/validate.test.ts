import { describe, expect, it } from "vitest";
import { validateUnit } from "./validate";

const bi = (tr: string, en: string) => ({ tr, en });

function validWalkthroughUnit() {
  return {
    unit: 1,
    slug: "test-unit",
    title: bi("Test Konu", "Test Unit"),
    tagline: bi("KÄ±sa aÃ§Ä±klama", "Short blurb"),
    concept: { overview: bi("Genel bakÄ±ÅŸ", "Overview"), keyFormulas: [], traps: [] },
    questions: [
      {
        id: "1-1",
        code: "Q1",
        title: bi("Soru 1", "Question 1"),
        difficulty: 1,
        examLikelihood: "medium",
        statement: bi("Ä°fade", "Statement"),
        given: [],
        goal: bi("AmaÃ§", "Goal"),
        steps: [
          { title: bi("AdÄ±m 1", "Step 1"), guiding: bi("YÃ¶n", "Guide"), hint: bi("Ä°pucu", "Hint"), work: bi("Ä°ÅŸlem", "Work"), why: bi("Neden", "Why") },
          { title: bi("AdÄ±m 2", "Step 2"), guiding: bi("YÃ¶n 2", "Guide 2"), hint: bi("Ä°pucu 2", "Hint 2"), work: bi("Ä°ÅŸlem 2", "Work 2"), why: bi("Neden 2", "Why 2") },
        ],
        finalAnswer: bi("SonuÃ§", "Final answer"),
        traps: [],
        whatIfs: [{ scenario: bi("Senaryo", "Scenario"), answer: bi("Cevap", "Answer") }],
      },
    ],
    quiz: [] as Array<{
      q: ReturnType<typeof bi>;
      options: ReturnType<typeof bi>[];
      correct: number;
      explain: ReturnType<typeof bi>;
    }>,
  };
}

describe("validateUnit", () => {
  it("accepts a valid walkthrough fixture and reports non-blocking warnings", () => {
    const result = validateUnit("walkthrough", validWalkthroughUnit());
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((warning) => warning.includes("quiz has <4 items"))).toBe(true);
    expect(result.questionCount).toBe(1);
  });

  it("reports a missing bilingual value at its exact path", () => {
    const unit = validWalkthroughUnit();
    // @ts-expect-error deliberately malformed fixture
    unit.title = { tr: "Test Konu" };
    expect(validateUnit("walkthrough", unit).errors).toContain(
      "unit.title: missing/empty tr+en pair"
    );
  });

  it("reports an out-of-range MCQ answer", () => {
    const unit = validWalkthroughUnit();
    unit.quiz = [
      {
        q: bi("Soru?", "Question?"),
        options: [bi("A", "A"), bi("B", "B")],
        correct: 5,
        explain: bi("AÃ§Ä±klama", "Explain"),
      },
    ];
    expect(validateUnit("walkthrough", unit).errors).toContain(
      "unit.quiz[0].correct: out of range"
    );
  });

  it("warns, rather than rejects, a decoded LaTeX control character", () => {
    const unit = validWalkthroughUnit();
    unit.tagline = bi("KÄ±sa aÃ§Ä±klama", "\beta escaped wrong");
    const result = validateUnit("walkthrough", unit);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((warning) => warning.includes("suspicious control char"))).toBe(true);
  });

  it("returns validation errors instead of throwing for non-array collection fields", () => {
    const unit = validWalkthroughUnit();
    const question = unit.questions[0] as Record<string, unknown>;
    question.given = {};
    question.tables = "not-an-array";
    question.charts = {};
    question.steps = {};
    question.traps = {};
    question.whatIfs = {};

    const result = validateUnit("walkthrough", unit);
    expect(result.errors).toContain("unit.q[1-1]: needs >=2 steps");
    expect(result.questionCount).toBe(1);

    const malformedTopLevel = { ...validWalkthroughUnit(), questions: {} };
    expect(validateUnit("walkthrough", malformedTopLevel)).toMatchObject({
      errors: expect.arrayContaining(["unit: no questions"]),
      questionCount: 0,
    });
  });
});
