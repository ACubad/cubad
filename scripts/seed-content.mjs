import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const CONTENT_DIR = path.join(process.cwd(), "content");
const SUBJECTS_FILE = path.join(CONTENT_DIR, "subjects.json");

const SEED_TRACK = {
  country_code: "TR",
  system: "University",
  level: "Undergraduate",
  title: { tr: "Türkiye — Üniversite (Lisans)", en: "Turkey — University (Undergraduate)" },
  status: "published",
  sort: 0,
};

/** Discover and numerically sort unit-N.json files. */
export function listUnitFiles(files) {
  return files
    .filter((file) => /^unit-\d+\.json$/.test(file))
    .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

async function upsertTrack(supabase) {
  const { data, error } = await supabase
    .from("tracks")
    .upsert(SEED_TRACK, { onConflict: "country_code,system,level" })
    .select("id")
    .single();
  if (error) throw new Error(`track upsert failed: ${error.message}`);
  return data.id;
}

async function upsertSubject(supabase, meta, sort) {
  const { data, error } = await supabase
    .from("subjects")
    .upsert(
      {
        slug: meta.slug,
        title: meta.title,
        tagline: meta.tagline,
        section_order: meta.kind,
        status: "published",
        sort,
      },
      { onConflict: "slug" }
    )
    .select("id")
    .single();
  if (error) throw new Error(`subject upsert failed (${meta.slug}): ${error.message}`);
  return data.id;
}

async function upsertUnits(supabase, subjectId, subjectSlug) {
  const directory = path.join(CONTENT_DIR, subjectSlug);
  if (!fs.existsSync(directory)) {
    console.warn(`  no content directory for ${subjectSlug}, skipping units`);
    return 0;
  }

  const files = listUnitFiles(fs.readdirSync(directory));
  for (const file of files) {
    const unit = readJson(path.join(directory, file));
    const { error } = await supabase.from("units").upsert(
      {
        subject_id: subjectId,
        unit_number: unit.unit,
        slug: unit.slug,
        is_free: true,
        status: "published",
        content: unit,
      },
      { onConflict: "subject_id,slug" }
    );
    if (error) throw new Error(`unit upsert failed (${subjectSlug}/${file}): ${error.message}`);
  }
  return files.length;
}

async function upsertTrackSubject(supabase, trackId, subjectId, sort) {
  const { error } = await supabase
    .from("track_subjects")
    .upsert({ track_id: trackId, subject_id: subjectId, sort }, { onConflict: "track_id,subject_id" });
  if (error) throw new Error(`track_subjects upsert failed: ${error.message}`);
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run npm run seed:content."
    );
  }
  if (!fs.existsSync(SUBJECTS_FILE)) throw new Error("content/subjects.json not found");

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const subjects = readJson(SUBJECTS_FILE);
  console.log(`Seeding ${subjects.length} subjects...`);

  const trackId = await upsertTrack(supabase);
  console.log(`  track TR/University/Undergraduate -> ${trackId}`);

  let totalUnits = 0;
  for (const [sort, meta] of subjects.entries()) {
    const subjectId = await upsertSubject(supabase, meta, sort);
    const units = await upsertUnits(supabase, subjectId, meta.slug);
    await upsertTrackSubject(supabase, trackId, subjectId, sort);
    console.log(`  ${meta.slug}: ${units} units seeded, attached to track`);
    totalUnits += units;
  }
  console.log(`Done. ${subjects.length} subjects, ${totalUnits} units.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
