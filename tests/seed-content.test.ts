import { describe, expect, it } from "vitest";
import { listUnitFiles } from "../scripts/seed-content.mjs";

describe("listUnitFiles", () => {
  it("keeps only unit-N.json files", () => {
    expect(listUnitFiles(["unit-1.json", "unit-2.json", "README.md", "unit-x.json", "notes.txt"])).toEqual([
      "unit-1.json",
      "unit-2.json",
    ]);
  });

  it("sorts numerically, not lexicographically", () => {
    expect(listUnitFiles(["unit-10.json", "unit-2.json", "unit-1.json"])).toEqual([
      "unit-1.json",
      "unit-2.json",
      "unit-10.json",
    ]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(listUnitFiles(["subjects.json", "README.md"])).toEqual([]);
  });
});
