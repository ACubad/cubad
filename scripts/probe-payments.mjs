#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function localEnvironment() {
  const output = execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npx supabase status -o env"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const values = Object.fromEntries(
    output
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2]])
  );
  return {
    url: values.API_URL,
    anonKey: values.ANON_KEY,
    serviceRoleKey: values.SERVICE_ROLE_KEY,
  };
}

const target = process.argv.includes("--local")
  ? localEnvironment()
  : {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };

if (!target.url || !target.anonKey || !target.serviceRoleKey) {
  console.error("Missing Supabase URL, anon key, or service-role key for the selected target.");
  process.exit(1);
}

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(target.url, target.serviceRoleKey, clientOptions);
const studentA = createClient(target.url, target.anonKey, clientOptions);
const studentB = createClient(target.url, target.anonKey, clientOptions);
const createdUserIds = [];
const storagePaths = [];
const createdTierIds = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectError(label, error) {
  assert(error, `${label}: unexpectedly succeeded`);
  console.log(`PASS ${label}: denied (${error.code ?? error.statusCode ?? "storage"})`);
}

async function createStudent(label) {
  const email = `phase6-${label}-${randomUUID()}@example.invalid`;
  const password = `P6!${randomBytes(24).toString("base64url")}`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `Phase 6 ${label}` },
  });
  if (error || !data.user) throw new Error(`Could not create ${label}: ${error?.message ?? "no user"}`);
  createdUserIds.push(data.user.id);
  return { id: data.user.id, email, password };
}

async function authenticate(client, fixture) {
  const { data, error } = await client.auth.signInWithPassword({
    email: fixture.email,
    password: fixture.password,
  });
  if (error || data.user?.id !== fixture.id) throw new Error(`Sign-in failed: ${error?.message ?? "wrong user"}`);
  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("role")
    .eq("user_id", fixture.id)
    .single();
  if (profileError || profile?.role !== "student") {
    throw new Error(`Fixture is not a genuine student: ${profileError?.message ?? profile?.role ?? "missing"}`);
  }
}

async function main() {
  const fixtureA = await createStudent("student-a");
  const fixtureB = await createStudent("student-b");
  await authenticate(studentA, fixtureA);
  await authenticate(studentB, fixtureB);
  console.log("PASS disposable identities have authenticated student profiles");

  const { data: tier, error: tierError } = await studentA
    .from("tiers")
    .select("id")
    .eq("status", "published")
    .order("sort")
    .limit(1)
    .single();
  if (tierError || !tier) throw new Error(`No published tier available: ${tierError?.message ?? "missing"}`);

  const claimId = randomUUID();
  const claim = {
    id: claimId,
    user_id: fixtureA.id,
    tier_id: tier.id,
    amount: 6,
    currency: "USD",
    method: "bank",
    payer_ref: "phase6-probe",
  };
  const { error: insertError } = await studentA.from("payment_claims").insert(claim);
  if (insertError) throw new Error(`Owner pending insert failed: ${insertError.message}`);
  console.log("PASS owner can insert a pending claim");

  const { data: crossRead, error: crossReadError } = await studentB
    .from("payment_claims")
    .select("id")
    .eq("id", claimId);
  if (crossReadError) throw new Error(`Cross-user read probe failed unexpectedly: ${crossReadError.message}`);
  assert(crossRead.length === 0, "Cross-user claim became visible");
  console.log("PASS cross-user claim read returns zero rows");

  const { error: approvedInsertError } = await studentB.from("payment_claims").insert({
    ...claim,
    id: randomUUID(),
    user_id: fixtureB.id,
    status: "approved",
  });
  expectError("student approved-status insert", approvedInsertError);

  const { error: spoofInsertError } = await studentB.from("payment_claims").insert({
    ...claim,
    id: randomUUID(),
  });
  expectError("student cross-user insert", spoofInsertError);

  const { error: forgedProofError } = await studentB.from("payment_claims").insert({
    ...claim,
    id: randomUUID(),
    user_id: fixtureB.id,
    proof_path: `${fixtureB.id}/${randomUUID()}/forged.png`,
  });
  expectError("student proof_path insert", forgedProofError);

  const hiddenTierId = randomUUID();
  const { error: hiddenTierCreateError } = await service.from("tiers").insert({
    id: hiddenTierId,
    slug: `phase6-probe-hidden-${randomUUID()}`,
    title: { tr: "Probe", en: "Probe" },
    scope_type: "all",
    duration_days: 30,
    prices: [],
    status: "hidden",
  });
  if (hiddenTierCreateError) throw new Error(`Hidden-tier fixture failed: ${hiddenTierCreateError.message}`);
  createdTierIds.push(hiddenTierId);
  const { error: hiddenTierError } = await studentB.from("payment_claims").insert({
    ...claim,
    id: randomUUID(),
    user_id: fixtureB.id,
    tier_id: hiddenTierId,
  });
  expectError("student hidden-tier claim", hiddenTierError);

  const { error: invalidMoneyError } = await studentB.from("payment_claims").insert({
    ...claim,
    id: randomUUID(),
    user_id: fixtureB.id,
    amount: -1,
    currency: "usd",
  });
  expectError("student invalid amount/currency", invalidMoneyError);

  const { error: directUpdateError } = await studentA
    .from("payment_claims")
    .update({ status: "approved", proof_path: "forged" })
    .eq("id", claimId);
  expectError("student status/proof update", directUpdateError);

  const { error: rpcError } = await studentA.rpc("approve_claim", {
    p_claim_id: claimId,
    p_code_hash: "d".repeat(64),
    p_duration_days: 30,
    p_reviewer: fixtureA.id,
  });
  expectError("student approve_claim execute", rpcError);

  for (let index = 2; index <= 3; index += 1) {
    const { error } = await studentA.from("payment_claims").insert({
      ...claim,
      id: randomUUID(),
      payer_ref: `phase6-probe-${index}`,
    });
    if (error) throw new Error(`Pending claim ${index} failed: ${error.message}`);
  }
  const { error: fourthError } = await studentA.from("payment_claims").insert({
    ...claim,
    id: randomUUID(),
    payer_ref: "phase6-probe-4",
  });
  expectError("fourth pending claim", fourthError);

  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ownPath = `${fixtureA.id}/${claimId}/probe.png`;
  storagePaths.push(ownPath);
  const { error: ownUploadError } = await studentA.storage
    .from("payment-proofs")
    .upload(ownPath, png, { contentType: "image/png", upsert: false });
  if (ownUploadError) throw new Error(`Own-prefix upload failed: ${ownUploadError.message}`);

  const { data: ownSigned, error: ownSignedError } = await studentA.storage
    .from("payment-proofs")
    .createSignedUrl(ownPath, 30);
  if (ownSignedError || !ownSigned?.signedUrl) throw new Error(`Owner signed URL failed: ${ownSignedError?.message}`);
  console.log("PASS private owner upload and signed URL");

  const { data: crossSigned, error: crossSignedError } = await studentB.storage
    .from("payment-proofs")
    .createSignedUrl(ownPath, 30);
  assert(crossSignedError || !crossSigned?.signedUrl, "Cross-user signed URL unexpectedly succeeded");
  console.log("PASS cross-user signed URL denied");

  const wrongPrefixPath = `${fixtureA.id}/${randomUUID()}/wrong-prefix.png`;
  storagePaths.push(wrongPrefixPath);
  const { error: wrongPrefixError } = await studentB.storage
    .from("payment-proofs")
    .upload(wrongPrefixPath, png, { contentType: "image/png", upsert: false });
  expectError("wrong-prefix proof upload", wrongPrefixError);

  const gifPath = `${fixtureB.id}/${randomUUID()}/probe.gif`;
  storagePaths.push(gifPath);
  const { error: gifError } = await studentB.storage
    .from("payment-proofs")
    .upload(gifPath, Uint8Array.from([0x47, 0x49, 0x46, 0x38]), {
      contentType: "image/gif",
      upsert: false,
    });
  expectError("disallowed GIF upload", gifError);

  const oversizePath = `${fixtureB.id}/${randomUUID()}/oversize.png`;
  storagePaths.push(oversizePath);
  const { error: oversizeError } = await studentB.storage
    .from("payment-proofs")
    .upload(oversizePath, new Uint8Array(10 * 1024 * 1024 + 1), {
      contentType: "image/png",
      upsert: false,
    });
  expectError("oversized proof upload", oversizeError);

  console.log("\nALL PHASE-6 GENUINE-STUDENT RLS/STORAGE PROBES PASSED");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (storagePaths.length) await service.storage.from("payment-proofs").remove(storagePaths);
    await studentA.auth.signOut();
    await studentB.auth.signOut();
    for (const userId of createdUserIds.reverse()) {
      const { error } = await service.auth.admin.deleteUser(userId);
      if (error) {
        console.error(`Disposable fixture cleanup failed: ${error.message}`);
        process.exitCode = 1;
      }
    }
    if (createdTierIds.length) {
      const { error } = await service.from("tiers").delete().in("id", createdTierIds);
      if (error) {
        console.error(`Disposable tier cleanup failed: ${error.message}`);
        process.exitCode = 1;
      }
    }
  });
