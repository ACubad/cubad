// CLI wrapper for the pure validator in lib/content/validate.ts.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";

const validator = await tsImport("../lib/content/validate.ts", import.meta.url);

export const errors = [];
export const warn = [];

export function resetDiagnostics() {
  errors.length = 0;
  warn.length = 0;
}

export function checkUnit(unit, sectionOrder, where) {
  const result = validator.validateUnit(sectionOrder, unit, where);
  errors.push(...result.errors);
  warn.push(...result.warnings);
  return result.questionCount;
}

// Preserve Phase 3's public script exports for scripts/upsert-unit.mjs and local tooling.
export const isBi = validator.isBi;
export const checkBi = validator.checkBi;
export const checkMcq = validator.checkMcq;
export const checkControlChars = validator.checkControlChars;
export const walkStrings = validator.walkStrings;
export const checkChart = validator.checkChart;
export const checkStory = validator.checkStory;
export const checkWalkthroughQuestions = validator.checkWalkthroughQuestions;
export const checkWalkthroughUnit = validator.checkWalkthroughUnit;
export const checkStudyUnit = validator.checkStudyUnit;

const contentDirectory = path.join(process.cwd(), "content");
const subjectsFile = path.join(contentDirectory, "subjects.json");
const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const subjects = fs.existsSync(subjectsFile)
    ? JSON.parse(fs.readFileSync(subjectsFile, "utf-8"))
    : [];
  if (subjects.length === 0) {
    console.error("no subjects found in content/subjects.json");
    process.exit(1);
  }

  let totalFiles = 0;
  let totalQuestions = 0;
  for (const subject of subjects) {
    const directory = path.join(contentDirectory, subject.slug);
    if (!fs.existsSync(directory)) {
      errors.push(`content/${subject.slug}: directory missing`);
      continue;
    }
    const files = fs
      .readdirSync(directory)
      .filter((file) => /^unit-\d+\.json$/.test(file))
      .sort();
    if (files.length === 0) {
      errors.push(`content/${subject.slug}: no unit files found`);
      continue;
    }

    for (const file of files) {
      totalFiles += 1;
      let unit;
      try {
        unit = JSON.parse(fs.readFileSync(path.join(directory, file), "utf-8"));
      } catch (error) {
        errors.push(`${subject.slug}/${file}: JSON parse error: ${error.message}`);
        continue;
      }
      const where = `${subject.slug}/${file.replace(".json", "")}`;
      totalQuestions += checkUnit(unit, subject.kind, where);
    }
  }

  console.log(
    `checked ${subjects.length} subjects, ${totalFiles} files, ${totalQuestions} walkthrough questions`
  );
  if (warn.length) {
    console.log(`\n${warn.length} warnings:`);
    warn.slice(0, 40).forEach((warning) => console.log("  âš  " + warning));
  }
  if (errors.length) {
    console.error(`\n${errors.length} ERRORS:`);
    errors.slice(0, 60).forEach((error) => console.error("  âœ— " + error));
    process.exit(1);
  }
  console.log("content OK");
}
