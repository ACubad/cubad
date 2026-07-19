import { createHash, randomBytes } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are required");
}

async function request(path, { token = anonKey, method = "GET", body, headers = {}, allowError = false } = {}) {
  const response = await fetch(`${url}${path}`, {
    method,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let value = null;
  try {
    value = text ? JSON.parse(text) : null;
  } catch {
    value = text;
  }
  if (!allowError && !response.ok) {
    throw new Error(`${method} ${path} failed (${response.status}): ${text}`);
  }
  return { status: response.status, ok: response.ok, value };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const suffix = `${Date.now()}-${randomBytes(4).toString("hex")}`;
const email = `phase4-postgrest-${suffix}@example.invalid`;
const password = `Local-${randomBytes(18).toString("base64url")}!`;
const plainCode = `CBDVERIFY${randomBytes(8).toString("hex").toUpperCase()}`;
const codeHash = createHash("sha256").update(plainCode).digest("hex");
const browserHash = createHash("sha256").update(randomBytes(32)).digest("hex");
let userId;
let codeId;

try {
  const catalog = await request(
    "/rest/v1/units?select=id,slug,subjects!inner(slug)&subjects.slug=eq.hidroloji&status=eq.published&order=unit_number.asc&limit=2",
    { token: serviceKey },
  );
  assert(Array.isArray(catalog.value) && catalog.value.length === 2, "two published Hydrology units are required");
  const [unitA, unitB] = catalog.value;

  const publicClaim = await request("/rest/v1/rpc/claim_unit_preview", {
    method: "POST",
    body: { p_unit_id: unitA.id, p_preview_hash: browserHash },
    headers: { "x-cubad-preview-hash": browserHash },
    allowError: true,
  });
  assert(!publicClaim.ok, "anonymous caller minted a preview capability directly");

  const anonFirst = await request("/rest/v1/rpc/claim_unit_preview", {
    token: serviceKey,
    method: "POST",
    body: { p_unit_id: unitA.id, p_preview_hash: browserHash },
    headers: { "x-cubad-preview-hash": browserHash },
  });
  const anonSecond = await request("/rest/v1/rpc/claim_unit_preview", {
    token: serviceKey,
    method: "POST",
    body: { p_unit_id: unitB.id, p_preview_hash: browserHash },
    headers: { "x-cubad-preview-hash": browserHash },
  });
  assert(anonFirst.value === unitA.id && anonSecond.value === unitA.id, "anonymous preview was not immutable");
  const anonAllowed = await request("/rest/v1/rpc/get_unit_content", {
    method: "POST",
    body: { p_subject_slug: "hidroloji", p_unit_slug: unitA.slug },
    headers: { "x-cubad-preview-hash": browserHash },
  });
  const anonDenied = await request("/rest/v1/rpc/get_unit_content", {
    method: "POST",
    body: { p_subject_slug: "hidroloji", p_unit_slug: unitB.slug },
    headers: { "x-cubad-preview-hash": browserHash },
  });
  assert(anonAllowed.value && anonDenied.value === null, "anonymous content gate failed");
  console.log("PASS trusted anonymous claim and one-unit preview over raw PostgREST");

  const created = await request("/auth/v1/admin/users", {
    token: serviceKey,
    method: "POST",
    body: { email, password, email_confirm: true },
  });
  userId = created.value.id;
  assert(userId, "temporary user was not created");

  const signedIn = await request("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email, password },
  });
  const studentToken = signedIn.value.access_token;
  assert(studentToken, "temporary student token was not issued");

  const profiles = await request("/rest/v1/profiles?select=user_id,role", { token: studentToken });
  assert(profiles.value.length === 1 && profiles.value[0].user_id === userId && profiles.value[0].role === "student", "profile owner RLS failed");
  await request(`/rest/v1/profiles?user_id=eq.${userId}`, {
    token: studentToken,
    method: "PATCH",
    body: { full_name: "Phase 4 PostgREST Probe" },
  });
  const roleEscalation = await request(`/rest/v1/profiles?user_id=eq.${userId}`, {
    token: studentToken,
    method: "PATCH",
    body: { role: "admin" },
    allowError: true,
  });
  assert(!roleEscalation.ok, "student profile role escalation succeeded");

  const studentFirst = await request("/rest/v1/rpc/claim_unit_preview", {
    token: studentToken,
    method: "POST",
    body: { p_unit_id: unitA.id, p_preview_hash: null },
  });
  const studentSecond = await request("/rest/v1/rpc/claim_unit_preview", {
    token: studentToken,
    method: "POST",
    body: { p_unit_id: unitB.id, p_preview_hash: null },
  });
  assert(studentFirst.value === unitA.id && studentSecond.value === unitA.id, "durable preview was not immutable");

  const visibleUnitsBefore = await request("/rest/v1/units?select=id&status=eq.published", { token: studentToken });
  const codesBefore = await request("/rest/v1/access_codes?select=*", { token: studentToken });
  const deniedInsert = await request("/rest/v1/entitlements", {
    token: studentToken,
    method: "POST",
    body: { user_id: userId, scope_type: "all", expires_at: new Date(Date.now() + 86400000).toISOString(), source: "admin" },
    allowError: true,
  });
  assert(visibleUnitsBefore.value.length === 1 && visibleUnitsBefore.value[0].id === unitA.id, "raw units RLS did not expose exactly the selected preview");
  assert(Array.isArray(codesBefore.value) && codesBefore.value.length === 0, "access-code hashes leaked to a student");
  assert(!deniedInsert.ok, "student inserted an entitlement");
  console.log("PASS student profile and pre-entitlement RLS over raw PostgREST");

  const tiers = await request("/rest/v1/tiers?select=id&slug=eq.term-all&limit=1", { token: serviceKey });
  assert(tiers.value.length === 1, "canonical term-all tier is missing");
  const code = await request("/rest/v1/access_codes", {
    token: serviceKey,
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: {
      code_hash: codeHash,
      tier_id: tiers.value[0].id,
      scope_type: "all",
      duration_days: 120,
      max_redemptions: 1,
      note: "temporary Phase 4 PostgREST verification fixture",
    },
  });
  codeId = code.value[0].id;

  const redeemed = await request("/rest/v1/rpc/redeem_code", {
    token: studentToken,
    method: "POST",
    body: { p_code: plainCode },
  });
  assert(redeemed.value?.ok === true, "valid raw redemption failed");
  const entitlements = await request("/rest/v1/entitlements?select=id,expires_at", { token: studentToken });
  const visibleUnitsAfter = await request("/rest/v1/units?select=id&status=eq.published", { token: studentToken });
  const codesAfter = await request("/rest/v1/access_codes?select=*", { token: studentToken });
  assert(entitlements.value.length === 1, "student could not read the granted entitlement");
  assert(visibleUnitsAfter.value.length > 1, "entitlement did not unlock the catalog");
  assert(Array.isArray(codesAfter.value) && codesAfter.value.length === 0, "code hashes leaked after redemption");
  console.log("PASS atomic redemption and post-entitlement access over raw PostgREST");
} finally {
  if (userId) {
    await request(`/rest/v1/redemption_attempts?user_id=eq.${userId}`, { token: serviceKey, method: "DELETE", allowError: true });
    await request(`/rest/v1/code_redemptions?user_id=eq.${userId}`, { token: serviceKey, method: "DELETE", allowError: true });
    await request(`/rest/v1/entitlements?user_id=eq.${userId}`, { token: serviceKey, method: "DELETE", allowError: true });
    await request(`/rest/v1/user_preview_selections?user_id=eq.${userId}`, { token: serviceKey, method: "DELETE", allowError: true });
  }
  if (codeId) {
    await request(`/rest/v1/access_codes?id=eq.${codeId}`, { token: serviceKey, method: "DELETE", allowError: true });
  }
  await request(`/rest/v1/anonymous_preview_selections?browser_hash=eq.${browserHash}`, { token: serviceKey, method: "DELETE", allowError: true });
  if (userId) {
    await request(`/auth/v1/admin/users/${userId}`, { token: serviceKey, method: "DELETE", allowError: true });
  }
}
