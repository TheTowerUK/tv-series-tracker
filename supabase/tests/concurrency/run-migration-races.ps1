[CmdletBinding()]
param(
  [string]$ProjectId = 'TVSeriesTracker',
  [string]$DockerPath = 'docker'
)

$ErrorActionPreference='Stop'
$container="supabase_db_$ProjectId"
$tempFiles=[Collections.Generic.List[string]]::new()
$ownerA='84000000-0000-0000-0000-000000000001'; $ownerB='84000000-0000-0000-0000-000000000002'; $other='84000000-0000-0000-0000-000000000003'

function To-Json($v){$v|ConvertTo-Json -Depth 20 -Compress}
function To-B64([string]$v){[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($v))}
function Invoke-Psql([string]$Sql){
  $i=[IO.Path]::GetTempFileName();$o=[IO.Path]::GetTempFileName();$e=[IO.Path]::GetTempFileName();$tempFiles.Add($i);$tempFiles.Add($o);$tempFiles.Add($e);[IO.File]::WriteAllText($i,$Sql,[Text.UTF8Encoding]::new($false))
  $p=Start-Process $DockerPath -ArgumentList @('exec','-i',$container,'psql','-U','postgres','-d','postgres','-AtX','-v','ON_ERROR_STOP=1') -RedirectStandardInput $i -RedirectStandardOutput $o -RedirectStandardError $e -NoNewWindow -PassThru -Wait
  if($p.ExitCode-ne0){throw [IO.File]::ReadAllText($e)};return [IO.File]::ReadAllText($o)
}
function Start-Session([string]$Sql){
  $i=[IO.Path]::GetTempFileName();$o=[IO.Path]::GetTempFileName();$e=[IO.Path]::GetTempFileName();$tempFiles.Add($i);$tempFiles.Add($o);$tempFiles.Add($e);[IO.File]::WriteAllText($i,$Sql,[Text.UTF8Encoding]::new($false))
  $p=Start-Process $DockerPath -ArgumentList @('exec','-i',$container,'psql','-U','postgres','-d','postgres','-AtX','-v','ON_ERROR_STOP=1') -RedirectStandardInput $i -RedirectStandardOutput $o -RedirectStandardError $e -NoNewWindow -PassThru
  [pscustomobject]@{Process=$p;Output=$o;Error=$e;Started=[DateTimeOffset]::UtcNow}
}
function Complete-Session($s){$s.Process.WaitForExit();$out=[IO.File]::ReadAllText($s.Output);$err=[IO.File]::ReadAllText($s.Error);if($s.Process.ExitCode-ne0){throw $err};$line=@($out-split"`r?`n"|Where-Object{$_-match'^\{.*\}$'})[0];if(-not$line){throw"No RPC envelope: $out $err"};[pscustomobject]@{Envelope=($line|ConvertFrom-Json);ElapsedMs=([DateTimeOffset]::UtcNow-$s.Started).TotalMilliseconds}}
function Checksum($payload) { $b=To-B64(To-Json $payload); @((Invoke-Psql "set role tracker_api_owner;select tracker_private.canonical_tracker_sha256(convert_from(decode('$b','base64'),'UTF8')::jsonb);")-split"`r?`n"|Where-Object{$_-match'^[0-9a-f]{64}$'})[0] }
function Request($raw,$sum,$expected){[ordered]@{migrationKey='localstorage-tvSeriesTrackerData.v1';mode='replace_cloud';sourceSchemaVersion=1;sourcePayload=$raw;sourceChecksum=$sum;expectedCloudChecksum=$expected;mergeDecisions=[ordered]@{decisions=@()}}}
function RpcSql($owner,$request,$pause=0){$b=To-B64(To-Json $request);"begin;select set_config('request.jwt.claim.sub','$owner',true);select public.tracker_migrate_v1(convert_from(decode('$b','base64'),'UTF8')::jsonb);$(if($pause){"select pg_sleep($pause);"})commit;"}
function Assert($ok,$message) { if (-not $ok) { throw $message } }

try{
  Invoke-Psql "grant tracker_api_owner to postgres;insert into auth.users(id,email)values('$ownerA','race-a@example.invalid'),('$ownerB','race-b@example.invalid'),('$other','race-other@example.invalid');insert into public.shows(id,user_id,platform,title)values('84900000-0000-4000-8000-000000000003','$other','Test','Other owner sentinel');"|Out-Null
  $empty=Checksum([ordered]@{schemaVersion=2;shows=@()})
  $rawA=[ordered]@{schemaVersion=1;shows=@([ordered]@{id='race-1';platform='Test';title='Serialized';firstAirDate='2026-01-01';description='';posterUrl='';createdAt='2026-08-20T00:00:00.000Z';updatedAt='2026-08-20T00:00:00.000Z';seasons=@([ordered]@{number=1;status='Not Started'})})}
  $normA=[ordered]@{schemaVersion=2;shows=@([ordered]@{identity='legacy:race-1';legacyId='race-1';platform='Test';title='Serialized';firstAirDate='2026-01-01';synopsis='';posterUrl=$null;tmdbId=$null;tmdbPosterPath=$null;createdAt='2026-08-20T00:00:00.000Z';updatedAt='2026-08-20T00:00:00.000Z';seasons=@([ordered]@{number=1;status='not_started'})})};$sumA=Checksum $normA;$reqA=Request $rawA $sumA $empty
  $s1=Start-Session (RpcSql $ownerA $reqA 4);Start-Sleep -Milliseconds 700;$s2=Start-Session (RpcSql $ownerA $reqA);$r1=Complete-Session $s1;$r2=Complete-Session $s2
  Assert($r1.Envelope.outcome-eq'success'-and$r2.Envelope.outcome-eq'conflict') "Contended identical request did not serialize to success/conflict: $(To-Json $r1.Envelope) / $(To-Json $r2.Envelope)"
  Assert((Invoke-Psql "select count(*) from public.shows where user_id='$ownerA';").Trim()-eq'1') 'Contended retry duplicated rows.'
  $retrySql=RpcSql $ownerA (Request $rawA $sumA $sumA);$retryOut=((Invoke-Psql $retrySql)-split"`r?`n"|Where-Object{$_-match'^\{.*\}$'}|Select-Object -First 1)|ConvertFrom-Json
  Assert($retryOut.outcome-eq'success'-and$retryOut.data.shows.inserted-eq0-and$retryOut.data.shows.updated-eq0-and$retryOut.data.seasons.inserted-eq0-and$retryOut.data.seasons.updated-eq0) 'Same-key/source retry after contention was not idempotent.'

  $rawB=($rawA|ConvertTo-Json -Depth 20|ConvertFrom-Json -DateKind String);$rawB.shows[0].title='Stale Loser';$rawB.shows[0].updatedAt='2026-08-20T01:00:00.000Z'
  $normB=($normA|ConvertTo-Json -Depth 20|ConvertFrom-Json -DateKind String);$normB.shows[0].title='Stale Loser';$normB.shows[0].updatedAt='2026-08-20T01:00:00.000Z';$sumB=Checksum $normB
  $s1=Start-Session (RpcSql $ownerB $reqA 4);Start-Sleep -Milliseconds 700;$s2=Start-Session (RpcSql $ownerB (Request $rawB $sumB $empty));$r3=Complete-Session $s1;$r4=Complete-Session $s2
  Assert($r3.Envelope.outcome-eq'success'-and$r4.Envelope.outcome-eq'conflict') 'Stale contended migration was not rejected.'
  Assert((Invoke-Psql "select title from public.shows where user_id='$ownerB';").Trim()-eq'Serialized') 'Stale contender partially reconciled.'
  Assert((Invoke-Psql "select count(*) from public.shows where user_id='$other' and id='84900000-0000-4000-8000-000000000003';").Trim()-eq'1') 'Migration bypassed owner isolation.'

  $restorePayload=[ordered]@{schemaVersion=2;contractVersion='2.0.0';exportedAt='2026-08-20T02:00:00.000Z';shows=@([ordered]@{identity='cloud:84900000-0000-4000-8000-000000000003';legacyId=$null;platform='Test';title='Collision';firstAirDate=$null;synopsis='';posterUrl=$null;tmdbId=$null;tmdbPosterPath=$null;createdAt='2026-08-20T00:00:00.000Z';updatedAt='2026-08-20T00:00:00.000Z';seasons=@()})};$restoreSum=Checksum $restorePayload
  $restoreReq=[ordered]@{mode='reviewed_merge';sourceSchemaVersion=2;sourcePayload=$restorePayload;sourceChecksum=$restoreSum;expectedCloudChecksum=$sumA;mergeDecisions=[ordered]@{decisions=@([ordered]@{entityType='show';sourceIdentity='cloud:84900000-0000-4000-8000-000000000003';cloudIdentity=$null;action='create_local_record';expectedRevision=$null})}}
  $b=To-B64(To-Json $restoreReq);$restore=((Invoke-Psql "select set_config('request.jwt.claim.sub','$ownerA',false);select public.tracker_restore_v2(convert_from(decode('$b','base64'),'UTF8')::jsonb);")-split"`r?`n"|Where-Object{$_-match'^\{.*\}$'}|Select-Object -First 1)|ConvertFrom-Json
  Assert($restore.outcome-eq'validation_error') 'Restore cross-owner UUID collision was not rejected.';Assert((To-Json $restore)-notmatch'Other owner sentinel|constraint|sqlstate|sqlerrm') 'Restore collision disclosed private diagnostics.'
  [ordered]@{sameOwnerSerialization=$true;contendedInitialRequests=[ordered]@{outcomes=@($r1.Envelope.outcome,$r2.Envelope.outcome);secondElapsedMs=[math]::Round($r2.ElapsedMs);reason='The second request retains its pre-lock empty-cloud checksum and safely conflicts after the winner commits.'};sameKeySourceRetry=[ordered]@{outcome=$retryOut.outcome;zeroMutations=$true};staleChecksum=[ordered]@{outcomes=@($r3.Envelope.outcome,$r4.Envelope.outcome);partialReconciliation=$false};migrationOwnerIsolation=$true;restoreOwnerIsolation=$true}|ConvertTo-Json -Depth 8
}
finally { try { Invoke-Psql "delete from auth.users where id in('$ownerA','$ownerB','$other');revoke tracker_api_owner from postgres;"|Out-Null } catch { Write-Warning $_ }; foreach ($p in $tempFiles) { Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue } }
