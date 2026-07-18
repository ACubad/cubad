#!/usr/bin/env node
// One-time local-only Sprout -> Cubad cutover migration. It needs service credentials for
// both projects and must never run in Vercel or receive credentials from committed files.
import { createClient } from "@supabase/supabase-js";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`missing required env var ${name}`);
    process.exit(1);
  }
  return value;
}

const SPROUT_URL = requireEnv("SPROUT_URL");
const SPROUT_KEY = requireEnv("SPROUT_SERVICE_KEY");
const NEW_URL = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const NEW_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const BUCKET = "podcasts";
const PAGE_SIZE = 1000;
const REQUEST_TIMEOUT_MS = 30_000;

// Supabase Storage calls otherwise have no client-side deadline. A timed-out request is handled
// by copyOneFile's existing three-attempt retry loop instead of leaving a local cutover process
// stranded indefinitely on one object.
const timedFetch = (input, init = {}) => fetch(input, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
const clientOptions = { auth: { persistSession: false }, global: { fetch: timedFetch } };
const sprout = createClient(SPROUT_URL, SPROUT_KEY, clientOptions);
const target = createClient(NEW_URL, NEW_KEY, clientOptions);

async function migrateSyncRows() {
  console.log("\n--- copying cubad_sync -> legacy_sync ---");
  let from = 0;
  let copied = 0;
  for (;;) {
    const { data, error } = await sprout
      .from("cubad_sync")
      .select("id, state, updated_at")
      .range(from, from + PAGE_SIZE - 1)
      .order("id", { ascending: true });
    if (error) throw new Error(`reading cubad_sync: ${error.message}`);
    if (!data?.length) break;
    const { error: upsertError } = await target
      .from("legacy_sync")
      .upsert(data.map((row) => ({ id: row.id, state: row.state, updated_at: row.updated_at })), { onConflict: "id" });
    if (upsertError) throw new Error(`writing legacy_sync: ${upsertError.message}`);
    copied += data.length;
    console.log(`  copied ${copied} rows so far...`);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  console.log(`sync rows copied: ${copied}`);
  return copied;
}

/** Recursively enumerate every file, rather than folder, in a storage bucket. */
async function listAllFiles(client, bucket, prefix = "") {
  const files = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await client.storage.from(bucket).list(prefix, {
      limit: 100,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`listing ${bucket}/${prefix}: ${error.message}`);
    if (!data?.length) break;
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null && !entry.metadata) files.push(...(await listAllFiles(client, bucket, path)));
      else files.push(path);
    }
    if (data.length < 100) break;
    offset += 100;
  }
  return files;
}

async function copyOneFile(path, stats) {
  const dir = path.split("/").slice(0, -1).join("/");
  const filename = path.split("/").pop();
  const { data: existing, error: existingError } = await target.storage.from(BUCKET).list(dir, { search: filename });
  if (existingError) throw new Error(`checking destination ${path}: ${existingError.message}`);
  if (existing?.some((file) => file.name === filename)) {
    stats.skipped++;
    console.log(`  skip (exists): ${path}`);
    return;
  }

  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { data: blob, error: downloadError } = await sprout.storage.from(BUCKET).download(path);
      if (downloadError) throw new Error(downloadError.message);
      const buffer = Buffer.from(await blob.arrayBuffer());
      const contentType = path.endsWith(".json") ? "application/json" : "audio/wav";
      const { error: uploadError } = await target.storage
        .from(BUCKET)
        .upload(path, buffer, { contentType, upsert: false });
      if (uploadError) throw new Error(uploadError.message);
      stats.copied++;
      console.log(`  copied (${attempt > 1 ? `retry ${attempt}` : "ok"}): ${path} (${buffer.length} bytes)`);
      return;
    } catch (error) {
      if (attempt === MAX_ATTEMPTS) {
        stats.failed.push({ path, error: String(error) });
        console.error(`  FAILED after ${MAX_ATTEMPTS} attempts: ${path} — ${error}`);
        return;
      }
      console.warn(`  attempt ${attempt} failed for ${path} (${error}), retrying...`);
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
}

async function migrateStorage() {
  console.log("\n--- copying storage bucket 'podcasts' ---");
  const files = await listAllFiles(sprout, BUCKET);
  console.log(`storage objects found: ${files.length}`);
  const stats = { copied: 0, skipped: 0, failed: [] };
  for (const path of files) await copyOneFile(path, stats);
  console.log(`storage objects copied: ${stats.copied}`);
  console.log(`storage objects skipped (already existed): ${stats.skipped}`);
  console.log(`storage objects FAILED: ${stats.failed.length}`);
  if (stats.failed.length) {
    console.log("failed paths:");
    stats.failed.forEach((failure) => console.log(`  - ${failure.path}: ${failure.error}`));
  }
  return { found: files.length, ...stats };
}

async function main() {
  const syncCopied = await migrateSyncRows();
  const storage = await migrateStorage();
  console.log("\n=== migration summary ===");
  console.log(`sync rows copied: ${syncCopied}`);
  console.log(`storage objects found: ${storage.found}`);
  console.log(`storage objects copied: ${storage.copied}`);
  console.log(`storage objects skipped (already existed): ${storage.skipped}`);
  console.log(`storage objects FAILED: ${storage.failed.length}`);
  if (storage.failed.length) process.exit(1);
}

main().catch((error) => {
  console.error("migration aborted:", error);
  process.exit(1);
});
