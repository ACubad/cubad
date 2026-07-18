#!/usr/bin/env node
// Interim content-publish path until the Phase 5 admin dashboard ships.
// Usage: node scripts/upsert-unit.mjs <subject-slug> <path-to-unit.json>
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { checkUnit, errors, warn, resetDiagnostics } from "./validate-content.mjs";

const [, , subjectSlug, unitPath] = process.argv;
if (!subjectSlug || !unitPath) {
  console.error("usage: node scripts/upsert-unit.mjs <subject-slug> <path-to-unit.json>");
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const REVALIDATE_SECRET = process.env.REVALIDATE_SECRET;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function main() {
  const absPath = path.resolve(process.cwd(), unitPath);
  if (!fs.existsSync(absPath)) {
    console.error(`file not found: ${absPath}`);
    process.exit(1);
  }

  let unit;
  try {
    unit = JSON.parse(fs.readFileSync(absPath, "utf-8"));
  } catch (error) {
    console.error(`invalid JSON in ${absPath}: ${error.message}`);
    process.exit(1);
  }

  const { data: subject, error: subjectError } = await supabase
    .from("subjects")
    .select("id, slug, section_order")
    .eq("slug", subjectSlug)
    .maybeSingle();
  if (subjectError) {
    console.error(`looking up subject "${subjectSlug}": ${subjectError.message}`);
    process.exit(1);
  }
  if (!subject) {
    console.error(
      `no subject with slug "${subjectSlug}" - create it first (this script only upserts units, not subjects)`
    );
    process.exit(1);
  }

  console.log(
    `validating ${subjectSlug}/${path.basename(unitPath)} against section_order "${subject.section_order}"...`
  );
  resetDiagnostics();
  checkUnit(unit, subject.section_order, `${subjectSlug}/${unit.slug ?? "?"}`);

  if (warn.length) {
    console.log(`${warn.length} warning(s):`);
    warn.forEach((message) => console.log(`  warning: ${message}`));
  }
  if (errors.length) {
    console.error(`${errors.length} ERROR(S) - refusing to upsert:`);
    errors.forEach((message) => console.error(`  error: ${message}`));
    process.exit(1);
  }
  console.log(`content OK (0 errors, ${warn.length} warning(s))`);

  const { data: existing, error: existingError } = await supabase
    .from("units")
    .select("id, version")
    .eq("subject_id", subject.id)
    .eq("slug", unit.slug)
    .maybeSingle();
  if (existingError) {
    console.error(`looking up unit "${unit.slug}": ${existingError.message}`);
    process.exit(1);
  }

  const nextVersion = (existing?.version ?? 0) + 1;
  console.log(
    `upserting ${subjectSlug}/${unit.slug} (version ${existing?.version ?? "new"} -> ${nextVersion})...`
  );

  // is_free is deliberately omitted: inserts receive its locked-by-default database value and
  // updates preserve the current access tier. Phase 5 owns entitlement decisions.
  const { error: upsertError } = await supabase.from("units").upsert(
    {
      subject_id: subject.id,
      unit_number: unit.unit,
      slug: unit.slug,
      status: "published",
      content: unit,
      version: nextVersion,
    },
    { onConflict: "subject_id,slug" }
  );
  if (upsertError) {
    console.error(`upsert failed: ${upsertError.message}`);
    process.exit(1);
  }

  if (REVALIDATE_SECRET) {
    const url = `${APP_URL}/api/revalidate?secret=${encodeURIComponent(REVALIDATE_SECRET)}&subject=${encodeURIComponent(subjectSlug)}`;
    const response = await fetch(url);
    if (response.ok) {
      console.log(`revalidated content:${subjectSlug}`);
    } else {
      console.warn(
        `revalidate call failed (${response.status}) - content is saved in the DB but the cache may be stale until manually revalidated`
      );
    }
  } else {
    console.warn(
      "REVALIDATE_SECRET not set - skipping cache invalidation; content will remain stale until explicitly revalidated."
    );
  }

  console.log("done.");
}

main().catch((error) => {
  console.error("upsert-unit failed:", error);
  process.exit(1);
});
