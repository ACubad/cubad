$ErrorActionPreference = "Stop"

$container = "supabase_db_cubad"
$running = docker inspect -f "{{.State.Running}}" $container 2>$null
if ($LASTEXITCODE -ne 0 -or $running -ne "true") {
  throw "Local Supabase database container '$container' is not running."
}

$seed = @'
insert into auth.users (id,aud,role,email,encrypted_password,created_at,updated_at,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values
('aaaaaaaa-1111-1111-1111-111111111111','authenticated','authenticated','phase4-concurrency-a@example.invalid','',now(),now(),now(),'{}','{}'),
('bbbbbbbb-2222-2222-2222-222222222222','authenticated','authenticated','phase4-concurrency-b@example.invalid','',now(),now(),now(),'{}','{}');
insert into public.tiers (id,slug,title,scope_type,duration_days,prices,status)
values ('cccccccc-3333-3333-3333-333333333333','phase4-concurrency-tier',jsonb_build_object('tr','C','en','C'),'all',1,'[]','hidden');
insert into public.access_codes (id,code_hash,tier_id,scope_type,duration_days,max_redemptions)
values ('dddddddd-4444-4444-4444-444444444444',encode(extensions.digest('CONCURRENCYFIXTURE','sha256'),'hex'),'cccccccc-3333-3333-3333-333333333333','all',1,1);
'@

$cleanup = @'
delete from public.code_redemptions where code_id='dddddddd-4444-4444-4444-444444444444';
delete from public.entitlements where user_id in ('aaaaaaaa-1111-1111-1111-111111111111','bbbbbbbb-2222-2222-2222-222222222222');
delete from public.redemption_attempts where user_id in ('aaaaaaaa-1111-1111-1111-111111111111','bbbbbbbb-2222-2222-2222-222222222222');
delete from public.access_codes where id='dddddddd-4444-4444-4444-444444444444';
delete from public.tiers where id='cccccccc-3333-3333-3333-333333333333';
delete from auth.users where id in ('aaaaaaaa-1111-1111-1111-111111111111','bbbbbbbb-2222-2222-2222-222222222222');
'@

function Invoke-Psql([string]$sql) {
  $result = docker exec $container psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atqc $sql
  if ($LASTEXITCODE -ne 0) { throw "psql failed" }
  return ($result -join "`n")
}

try {
  Invoke-Psql $seed | Out-Null

  $sessionA = @'
begin;
select set_config('request.jwt.claims',jsonb_build_object('sub','aaaaaaaa-1111-1111-1111-111111111111','role','authenticated')::text,true);
select public.redeem_code('CONCURRENCYFIXTURE');
select pg_sleep(4);
commit;
'@
  $sessionB = @'
begin;
select set_config('request.jwt.claims',jsonb_build_object('sub','bbbbbbbb-2222-2222-2222-222222222222','role','authenticated')::text,true);
select public.redeem_code('CONCURRENCYFIXTURE');
commit;
'@

  $jobA = Start-Job -ScriptBlock {
    param($containerName, $sql)
    docker exec $containerName psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atqc $sql
    if ($LASTEXITCODE -ne 0) { throw "session A failed" }
  } -ArgumentList $container, $sessionA

  Start-Sleep -Seconds 1
  $outputB = Invoke-Psql $sessionB
  $outputA = (Receive-Job -Job $jobA -Wait -AutoRemoveJob) -join "`n"

  if ($outputA -notmatch '"ok": true') { throw "Session A did not win: $outputA" }
  if ($outputB -notmatch '"error": "exhausted"') { throw "Session B was not exhausted: $outputB" }

  $counts = Invoke-Psql "select redeemed_count || ':' || (select count(*) from public.code_redemptions where code_id='dddddddd-4444-4444-4444-444444444444') from public.access_codes where id='dddddddd-4444-4444-4444-444444444444';"
  if ($counts.Trim() -ne "1:1") { throw "Expected redeemed_count:redemptions = 1:1, got $counts" }

  Write-Output "PASS two-session last-slot race: one success, one exhausted, count 1:1"
}
finally {
  Invoke-Psql $cleanup | Out-Null
}
