$ErrorActionPreference = "Stop"

$container = "supabase_db_cubad"
$running = docker inspect -f "{{.State.Running}}" $container 2>$null
if ($LASTEXITCODE -ne 0 -or $running -ne "true") {
  throw "Local Supabase database container '$container' is not running."
}

$adminId = "64000000-0000-4000-8000-000000000001"
$studentId = "64000000-0000-4000-8000-000000000002"
$tierId = "64000000-0000-4000-8000-000000000003"
$approvalClaimId = "64000000-0000-4000-8000-000000000004"
$mixedClaimId = "64000000-0000-4000-8000-000000000005"
$approvalHashA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
$approvalHashB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
$mixedHash = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"

function Invoke-Psql([string]$sql) {
  $result = docker exec $container psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atqc $sql 2>&1
  if ($LASTEXITCODE -ne 0) { throw "psql failed: $($result -join "`n")" }
  return ($result -join "`n")
}

function Start-PsqlJob([string]$sql) {
  return Start-Job -ScriptBlock {
    param($containerName, $statement)
    $output = docker exec $containerName psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atqc $statement 2>&1
    [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = ($output -join "`n") }
  } -ArgumentList $container, $sql
}

function Invoke-ExpectedLoser([string]$sql) {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = docker exec $container psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atqc $sql 2>&1
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousPreference
  }
  $text = $output -join "`n"
  if ($exitCode -eq 0) { throw "Competing session unexpectedly succeeded: $text" }
  if ($text -notmatch "not-pending") { throw "Expected not-pending, got: $text" }
  return $text
}

$seed = @"
insert into auth.users (id,aud,role,email,encrypted_password,created_at,updated_at,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values
('$adminId','authenticated','authenticated','phase6-race-admin@example.invalid','',now(),now(),now(),'{}','{}'),
('$studentId','authenticated','authenticated','phase6-race-student@example.invalid','',now(),now(),now(),'{}','{}');
select set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,false);
update public.profiles set role='admin' where user_id='$adminId';
insert into public.tiers (id,slug,title,scope_type,duration_days,prices,status)
values ('$tierId','phase6-race-tier',jsonb_build_object('tr','Race','en','Race'),'all',30,'[]','hidden');
insert into public.payment_claims (id,user_id,tier_id,amount,currency,method,payer_ref,proof_path)
values
('$approvalClaimId','$studentId','$tierId',10,'USD','bank','race-a','$studentId/$approvalClaimId/proof.pdf'),
('$mixedClaimId','$studentId','$tierId',10,'USD','bank','race-b','$studentId/$mixedClaimId/proof.pdf');
"@

$cleanup = @"
delete from public.admin_audit_log where actor='$adminId' or entity_id in ('$approvalClaimId','$mixedClaimId');
delete from public.code_redemptions where user_id='$studentId';
delete from public.entitlements where user_id='$studentId';
delete from public.access_codes where created_by='$adminId';
delete from public.payment_claims where id in ('$approvalClaimId','$mixedClaimId');
delete from public.tiers where id='$tierId';
delete from auth.users where id in ('$adminId','$studentId');
"@

try {
  Invoke-Psql $seed | Out-Null

  $approvalWinner = @"
begin;
select public.approve_claim('$approvalClaimId','$approvalHashA',30,'$adminId');
select pg_sleep(4);
commit;
"@
  $approvalLoser = "select public.approve_claim('$approvalClaimId','$approvalHashB',30,'$adminId');"

  $jobA = Start-PsqlJob $approvalWinner
  Start-Sleep -Seconds 1
  Invoke-ExpectedLoser $approvalLoser | Out-Null
  $winnerA = Receive-Job -Job $jobA -Wait -AutoRemoveJob
  if ($winnerA.ExitCode -ne 0 -or $winnerA.Output -notmatch '"ok": true') {
    throw "Approval winner failed: $($winnerA.Output)"
  }

  $approvalCounts = Invoke-Psql @"
select
  (select count(*) from public.access_codes where note='payment-claim:$approvalClaimId') || ':' ||
  (select count(*) from public.code_redemptions r join public.access_codes c on c.id=r.code_id where c.note='payment-claim:$approvalClaimId') || ':' ||
  (select count(*) from public.entitlements e join public.access_codes c on c.id=e.source_id where c.note='payment-claim:$approvalClaimId') || ':' ||
  (select count(*) from public.admin_audit_log where action='claim.approve' and entity_id='$approvalClaimId');
"@
  if ($approvalCounts.Trim() -ne "1:1:1:1") {
    throw "Expected one code:redemption:entitlement:audit, got $approvalCounts"
  }
  Write-Output "PASS simultaneous approve/approve: one commit, one not-pending, artifacts 1:1:1:1"

  $mixedWinner = @"
begin;
select public.approve_claim('$mixedClaimId','$mixedHash',30,'$adminId');
select pg_sleep(4);
commit;
"@
  $mixedLoser = "select public.reject_claim('$mixedClaimId','$adminId','late competing rejection');"

  $jobMixed = Start-PsqlJob $mixedWinner
  Start-Sleep -Seconds 1
  Invoke-ExpectedLoser $mixedLoser | Out-Null
  $winnerMixed = Receive-Job -Job $jobMixed -Wait -AutoRemoveJob
  if ($winnerMixed.ExitCode -ne 0 -or $winnerMixed.Output -notmatch '"ok": true') {
    throw "Mixed-race winner failed: $($winnerMixed.Output)"
  }

  $mixedCounts = Invoke-Psql @"
select
  (select status from public.payment_claims where id='$mixedClaimId') || ':' ||
  (select count(*) from public.access_codes where note='payment-claim:$mixedClaimId') || ':' ||
  (select count(*) from public.admin_audit_log where entity_id='$mixedClaimId');
"@
  if ($mixedCounts.Trim() -ne "approved:1:1") {
    throw "Expected approved:one code:one terminal audit, got $mixedCounts"
  }
  Write-Output "PASS simultaneous approve/reject: one terminal transition and one audit"
}
finally {
  Get-Job | Where-Object State -ne "Completed" | Stop-Job -ErrorAction SilentlyContinue
  Get-Job | Remove-Job -Force -ErrorAction SilentlyContinue
  Invoke-Psql $cleanup | Out-Null
}
