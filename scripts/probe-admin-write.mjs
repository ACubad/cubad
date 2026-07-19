#!/usr/bin/env node

import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  process.exit(1);
}

const student = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const service = serviceRoleKey
  ? createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
const zero = "00000000-0000-0000-0000-000000000000";
let disposableUserId = null;

function isExplicitAdminDenial(error) {
  return error?.code === "42501" && /not authorized/i.test(error.message);
}

function isExplicitTableDenial(error) {
  return error?.code === "42501" && /(permission denied|row-level security|not authorized)/i.test(error.message);
}

async function expectDenied(label, request, matcher = isExplicitAdminDenial) {
  const { error } = await request;
  if (!error) {
    console.error(`${label}: SUCCEEDED (BUG)`);
    return false;
  }
  if (!matcher(error)) {
    console.error(`${label}: FAILED FOR THE WRONG REASON — [${error.code ?? "no-code"}] ${error.message}`);
    return false;
  }
  console.log(`${label}: DENIED (expected) — [${error.code}] ${error.message}`);
  return true;
}

async function credentials() {
  if (process.env.STUDENT_EMAIL && process.env.STUDENT_PASSWORD) {
    return { email: process.env.STUDENT_EMAIL, password: process.env.STUDENT_PASSWORD };
  }
  if (!service) {
    throw new Error("Provide STUDENT_EMAIL/STUDENT_PASSWORD, or SUPABASE_SERVICE_ROLE_KEY for a disposable fixture.");
  }

  const email = `phase5-probe-${randomUUID()}@example.invalid`;
  const password = `P5!${randomBytes(24).toString("base64url")}`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: "Phase 5 probe" },
  });
  if (error || !data.user) throw new Error(`Could not create disposable student: ${error?.message ?? "unknown error"}`);
  disposableUserId = data.user.id;
  return { email, password };
}

async function main() {
  const { email, password } = await credentials();
  const { data: authData, error: authError } = await student.auth.signInWithPassword({ email, password });
  if (authError || !authData.user) throw new Error(`Student sign-in failed: ${authError?.message ?? "no user returned"}`);

  const { data: profile, error: profileError } = await student
    .from("profiles")
    .select("role")
    .eq("user_id", authData.user.id)
    .single();
  if (profileError || profile?.role !== "student") {
    throw new Error(`Probe identity is not a genuine student (${profileError?.message ?? profile?.role ?? "missing profile"}).`);
  }
  console.log("Verified authenticated profile role: student");

  const probes = [
    ["log_admin_action", student.rpc("log_admin_action", { p_action: "probe.test", p_entity: "probe", p_entity_id: null, p_details: {} })],
    ["admin_set_status", student.rpc("admin_set_status", { p_table: "subjects", p_id: zero, p_status: "published" })],
    ["admin_revoke", student.rpc("admin_revoke", { p_table: "entitlements", p_ids: [zero] })],
    ["admin_upsert_subject", student.rpc("admin_upsert_subject", { p_id: null, p_slug: "probe", p_title: { tr: "Probe", en: "Probe" }, p_tagline: { tr: "Probe", en: "Probe" }, p_section_order: "study", p_sort: 0, p_track_ids: [] })],
    ["admin_upsert_unit", student.rpc("admin_upsert_unit", { p_subject_id: zero, p_slug: "probe", p_unit_number: 1, p_content: { slug: "probe", unit: 1 } })],
    ["admin_upsert_track", student.rpc("admin_upsert_track", { p_id: null, p_country_code: "TR", p_system: "probe", p_level: "probe", p_title: { tr: "Probe", en: "Probe" }, p_sort: 0 })],
    ["admin_set_track_subjects", student.rpc("admin_set_track_subjects", { p_track_id: zero, p_subject_ids: [] })],
    ["admin_upsert_tier", student.rpc("admin_upsert_tier", { p_id: null, p_slug: "probe", p_title: { tr: "Probe", en: "Probe" }, p_description: { tr: "", en: "" }, p_scope_type: "all", p_scope_id: null, p_duration_days: 30, p_prices: [], p_sort: 0 })],
    ["admin_grant_entitlement", student.rpc("admin_grant_entitlement", { p_user_id: authData.user.id, p_scope_type: "all", p_scope_id: null, p_tier_id: zero, p_duration_days: 30 })],
    ["admin_generate_codes", student.rpc("admin_generate_codes", { p_tier_id: zero, p_scope_type: "all", p_scope_id: null, p_duration_days: 30, p_max_redemptions: 1, p_valid_until: null, p_note: "probe", p_batch_id: randomUUID(), p_code_hashes: ["d".repeat(64)] })],
    ["admin_overview_stats", student.rpc("admin_overview_stats")],
  ];

  let passed = true;
  for (const [label, request] of probes) passed = (await expectDenied(label, request)) && passed;

  const directWrites = [
    ["direct profile email update", student.from("profiles").update({ email: "forged@example.invalid" }).eq("user_id", authData.user.id)],
    ["direct subjects insert", student.from("subjects").insert({ slug: "probe", title: { tr: "Probe", en: "Probe" }, tagline: { tr: "Probe", en: "Probe" } })],
    ["direct access_codes insert", student.from("access_codes").insert({ code_hash: "e".repeat(64), tier_id: zero, scope_type: "all", duration_days: 30 })],
    ["direct admin_audit_log insert", student.from("admin_audit_log").insert({ action: "probe.test", entity: "probe" })],
  ];
  for (const [label, request] of directWrites) passed = (await expectDenied(label, request, isExplicitTableDenial)) && passed;

  if (!passed) throw new Error("One or more Phase 5 authorization probes failed.");
  console.log("\nALL PHASE-5 ADMIN-WRITE PROBES PASSED");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await student.auth.signOut();
    if (disposableUserId && service) {
      const { error } = await service.auth.admin.deleteUser(disposableUserId);
      if (error) {
        console.error(`Disposable student cleanup failed: ${error.message}`);
        process.exitCode = 1;
      }
    }
  });
