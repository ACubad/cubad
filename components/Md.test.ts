import { describe, expect, it } from "vitest";

import { normalizeMarkdown } from "./Md";

describe("normalizeMarkdown", () => {
  it("unfences Markdown tables and normalizes HTML breaks only inside table rows", () => {
    const markdown = [
      "Before<br>outside",
      "",
      "```markdown",
      "| Item | Notes |",
      "| --- | --- |",
      "| A | first<br>second |",
      "```",
    ].join("\n");

    expect(normalizeMarkdown(markdown)).toBe(
      [
        "Before<br>outside",
        "",
        "| Item | Notes |",
        "| --- | --- |",
        "| A | first / second |",
      ].join("\n")
    );
  });

  it("leaves non-table code fences unchanged", () => {
    const markdown = "```ts\nconst value = '<br>';\n```";
    expect(normalizeMarkdown(markdown)).toBe(markdown);
  });
});
