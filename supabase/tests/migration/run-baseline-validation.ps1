[CmdletBinding()]
param(
  [string]$ProjectId = 'TVSeriesTracker',
  [string]$DockerPath = 'docker'
)

$ErrorActionPreference = 'Stop'
$container = "supabase_db_$ProjectId"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$tempFiles = [System.Collections.Generic.List[string]]::new()
$ownerId = '83000000-0000-0000-0000-000000000001'
$otherId = '83000000-0000-0000-0000-000000000002'
$migrationKey = 'localstorage-tvSeriesTrackerData.v1'

function Assert-True([bool]$Condition,[string]$Message) { if (-not $Condition) { throw $Message } }
function ConvertTo-B64([string]$Value) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Value)) }
function ConvertTo-CompactJson($Value) { $Value | ConvertTo-Json -Depth 30 -Compress }
function Invoke-LocalPsql {
  param([Parameter(Mandatory)][string]$Sql)
  $inputPath = [IO.Path]::GetTempFileName(); $outputPath = [IO.Path]::GetTempFileName(); $errorPath = [IO.Path]::GetTempFileName()
  $tempFiles.Add($inputPath); $tempFiles.Add($outputPath); $tempFiles.Add($errorPath)
  [IO.File]::WriteAllText($inputPath,$Sql,[Text.UTF8Encoding]::new($false))
  $process = Start-Process -FilePath $DockerPath -ArgumentList @('exec','-i',$container,'psql','-U','postgres','-d','postgres','-AtX','-v','ON_ERROR_STOP=1') -RedirectStandardInput $inputPath -RedirectStandardOutput $outputPath -RedirectStandardError $errorPath -NoNewWindow -PassThru -Wait
  $stdout=[IO.File]::ReadAllText($outputPath); $stderr=[IO.File]::ReadAllText($errorPath)
  if ($process.ExitCode -ne 0) { throw "Local psql failed: $stderr" }
  return ($stdout -split "`r?`n" | Where-Object { $_ -ne '' })
}
function Get-LastLine([string]$Sql) { $lines=@(Invoke-LocalPsql $Sql); return $lines[$lines.Count-1] }
function Invoke-Rpc([hashtable]$Request) {
  $encoded=ConvertTo-B64 (ConvertTo-CompactJson $Request)
  $line=Get-LastLine "select pg_catalog.set_config('request.jwt.claim.sub','$ownerId',false); select public.tracker_migrate_v1(pg_catalog.convert_from(pg_catalog.decode('$encoded','base64'),'UTF8')::jsonb);"
  return $line | ConvertFrom-Json
}
function Get-Checksum($Payload) {
  $encoded=ConvertTo-B64 (ConvertTo-CompactJson $Payload)
  return Get-LastLine "set role tracker_api_owner; select tracker_private.canonical_tracker_sha256(pg_catalog.convert_from(pg_catalog.decode('$encoded','base64'),'UTF8')::jsonb);"
}
function Get-CloudChecksum {
  return Get-LastLine "select pg_catalog.set_config('request.jwt.claim.sub','$ownerId',false); set role tracker_api_owner; select tracker_private.canonical_tracker_sha256(tracker_private.owner_tracker_payload('$ownerId'::uuid));"
}
function New-Request($Mode,$RawPayload,$Checksum,$Expected,$Decisions=@()) {
  return [ordered]@{ migrationKey=$migrationKey; mode=$Mode; sourceSchemaVersion=1; sourcePayload=$RawPayload; sourceChecksum=$Checksum; expectedCloudChecksum=$Expected; mergeDecisions=[ordered]@{decisions=$Decisions} }
}
function Normalize-Payload($RawPayload) {
  $statusMap=@{'Not Started'='not_started';'Watching'='watching';'Completed'='completed';'Purchase Only'='purchase_only';'Region Blocked'='region_blocked'}
  $shows=@($RawPayload.shows | ForEach-Object {
    $tmdbId=if ($null -ne $_.tmdb.id) { $_.tmdb.id } else { $_.tmdbId }
    $tmdbPath=if ($null -ne $_.tmdb.posterPath) { $_.tmdb.posterPath } else { $_.tmdbPosterPath }
    [ordered]@{identity="legacy:$($_.id)";legacyId=$_.id;platform=$_.platform;title=$_.title;firstAirDate=if ([string]::IsNullOrEmpty($_.firstAirDate)){$null}else{$_.firstAirDate};synopsis=if($null -eq $_.description){''}else{$_.description};posterUrl=if([string]::IsNullOrWhiteSpace($_.posterUrl)){$null}else{$_.posterUrl};tmdbId=$tmdbId;tmdbPosterPath=$tmdbPath;createdAt=([DateTimeOffset]::Parse($_.createdAt).UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ss.fffZ'));updatedAt=([DateTimeOffset]::Parse($_.updatedAt).UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ss.fffZ'));seasons=@($_.seasons|ForEach-Object{[ordered]@{number=[int]$_.number;status=$statusMap[$_.status]}})}
  })
  return [ordered]@{schemaVersion=2;shows=$shows}
}

try {
  $jsonPath=Join-Path $repoRoot 'data\shows.json'; $jsPath=Join-Path $repoRoot 'data\shows.js'
  $jsonText=[IO.File]::ReadAllText($jsonPath,[Text.Encoding]::UTF8); $catalog=$jsonText|ConvertFrom-Json -DateKind String
  $jsText=[IO.File]::ReadAllText($jsPath,[Text.Encoding]::UTF8)
  $wrapperJson=($jsText -replace '^\s*window\.TV_TRACKER_BASELINE\s*=\s*','' -replace ';\s*$','')|ConvertFrom-Json -DateKind String
  Assert-True ((ConvertTo-CompactJson $catalog) -ceq (ConvertTo-CompactJson $wrapperJson)) 'shows.json and shows.js wrapper differ semantically.'
  $seasonCount=@($catalog.shows.seasons).Count; $maxSeason=($catalog.shows.seasons.number|Measure-Object -Maximum).Maximum
  $statuses=@($catalog.shows.seasons.status|Sort-Object -Unique); $accepted=@('Completed','Not Started','Purchase Only','Region Blocked','Watching')
  $legacyIds=@($catalog.shows.id); $tmdbIds=@($catalog.shows|ForEach-Object{if($null-ne$_.tmdb.id){$_.tmdb.id}elseif($null-ne$_.tmdbId){$_.tmdbId}}|Where-Object{$null-ne$_})
  Assert-True ($catalog.shows.Count -eq 352) 'Expected 352 shows.'; Assert-True ($seasonCount -eq 1028) 'Expected 1,028 seasons.'; Assert-True ($maxSeason -eq 17) 'Expected maximum season 17.'
  Assert-True (($legacyIds|Sort-Object -Unique).Count -eq 352) 'Legacy IDs are not unique.'; Assert-True (($statuses -join ',') -ceq ($accepted -join ',')) 'Unexpected season status vocabulary.'; Assert-True (($tmdbIds|Sort-Object -Unique).Count -eq $tmdbIds.Count) 'Duplicate non-null TMDB ID.'

  Invoke-LocalPsql 'grant tracker_api_owner to postgres;'|Out-Null
  $raw=[ordered]@{schemaVersion=1;shows=@($catalog.shows)}; $normalized=Normalize-Payload $raw; $sourceChecksum=Get-Checksum $normalized
  $emptyChecksum=Get-Checksum ([ordered]@{schemaVersion=2;shows=@()})
  Invoke-LocalPsql "insert into auth.users(id,email) values('$ownerId','baseline-owner@example.invalid'),('$otherId','baseline-other@example.invalid'); insert into public.shows(user_id,platform,title) values('$otherId','Test','Other owner sentinel');"|Out-Null

  $first=Invoke-Rpc (New-Request 'replace_cloud' $raw $sourceChecksum $emptyChecksum)
  Assert-True ($first.outcome -eq 'success') 'First baseline replacement failed.'; Assert-True ($first.data.shows.inserted -eq 352 -and $first.data.seasons.inserted -eq 1028) 'First import counts differ.'; Assert-True ($first.data.finalTotals.shows -eq 352 -and $first.data.finalTotals.seasons -eq 1028) 'First import totals differ.'; Assert-True ($first.data.resultChecksum -eq $sourceChecksum) 'First import checksum differs.'; Assert-True ($null-ne$first.data.receipt) 'First import receipt missing.'
  $semantic=Get-LastLine "select pg_catalog.set_config('request.jwt.claim.sub','$ownerId',false); set role tracker_api_owner; select tracker_private.canonical_tracker_text(tracker_private.owner_tracker_payload('$ownerId'::uuid))=tracker_private.canonical_tracker_text(pg_catalog.convert_from(pg_catalog.decode('$(ConvertTo-B64 (ConvertTo-CompactJson $normalized))','base64'),'UTF8')::jsonb);"
  Assert-True ($semantic -eq 't') 'Requeried owner tracker is not semantically equal to normalized source.'
  $before=Get-LastLine "select revision::text||'|'||created_at::text||'|'||updated_at::text from public.shows where user_id='$ownerId' and legacy_id='tv-0001';"

  $retry=Invoke-Rpc (New-Request 'replace_cloud' $raw $sourceChecksum $sourceChecksum)
  Assert-True ($retry.outcome -eq 'success' -and $retry.data.shows.inserted -eq 0 -and $retry.data.shows.updated -eq 0 -and $retry.data.seasons.updated -eq 0) 'Idempotent retry mutated data.'
  Assert-True ($before -eq (Get-LastLine "select revision::text||'|'||created_at::text||'|'||updated_at::text from public.shows where user_id='$ownerId' and legacy_id='tv-0001';")) 'Idempotent retry churned metadata.'

  $changed=$jsonText|ConvertFrom-Json -DateKind String; $changed.shows[0].title+=' Closure'; $changed.shows[0].updatedAt='2026-08-20T10:00:00.000Z'
  $changedRaw=[ordered]@{schemaVersion=1;shows=@($changed.shows)}; $changedNormalized=Normalize-Payload $changedRaw; $changedChecksum=Get-Checksum $changedNormalized
  $changedResult=Invoke-Rpc (New-Request 'replace_cloud' $changedRaw $changedChecksum $sourceChecksum)
  Assert-True ($changedResult.outcome -eq 'success') 'Changed source was not accepted as explicit execution.'; Assert-True ((Get-LastLine "select revision from public.shows where user_id='$ownerId' and legacy_id='tv-0001';") -eq '2') 'Changed row did not increment once.'; Assert-True ((Get-LastLine "select revision from public.shows where user_id='$ownerId' and legacy_id='tv-0002';") -eq '1') 'Unchanged row revision changed.'

  $reduced=$jsonText|ConvertFrom-Json -DateKind String; $reduced.shows[0].seasons=@($reduced.shows[0].seasons|Select-Object -First 2); $reduced.shows=@($reduced.shows|Select-Object -First 351)
  $reducedRaw=[ordered]@{schemaVersion=1;shows=@($reduced.shows)}; $reducedChecksum=Get-Checksum (Normalize-Payload $reducedRaw)
  $reducedResult=Invoke-Rpc (New-Request 'replace_cloud' $reducedRaw $reducedChecksum $changedChecksum)
  Assert-True ($reducedResult.outcome -eq 'success' -and $reducedResult.data.finalTotals.shows -eq 351 -and $reducedResult.data.finalTotals.seasons -eq 1025) 'Replacement deletion totals differ.'; Assert-True ($reducedResult.data.shows.deleted -eq 1 -and $reducedResult.data.seasons.deleted -eq 3) 'Absent show/shortened season deletion counts differ.'

  $cloudBefore=Get-CloudChecksum; $receiptBefore=Get-LastLine "select completed_at::text from public.migration_receipts where user_id='$ownerId' and migration_key='$migrationKey';"
  $keep=Invoke-Rpc (New-Request 'keep_cloud' $raw $sourceChecksum ('f'*64))
  Assert-True ($keep.outcome -eq 'success' -and $null-eq$keep.data.receipt -and (Get-CloudChecksum) -eq $cloudBefore) 'Keep-cloud was not a true no-op.'; Assert-True ($receiptBefore -eq (Get-LastLine "select completed_at::text from public.migration_receipts where user_id='$ownerId' and migration_key='$migrationKey';")) 'Keep-cloud mutated receipt.'

  $mergeSource=$jsonText|ConvertFrom-Json -DateKind String; $mergeSource.shows[0].title='Explicit Reviewed Baseline'; $mergeSource.shows[0].updatedAt='2026-08-20T11:00:00.000Z'; $mergeRaw=[ordered]@{schemaVersion=1;shows=@($mergeSource.shows)}; $mergeChecksum=Get-Checksum (Normalize-Payload $mergeRaw)
  $target=(Get-LastLine "select id::text||'|'||revision::text from public.shows where user_id='$ownerId' and legacy_id='tv-0001';").Split('|')
  $decision=[ordered]@{entityType='show';sourceIdentity='legacy:tv-0001';cloudIdentity="show:$($target[0])";action='apply_local_record';expectedRevision=$target[1]}
  $merge=Invoke-Rpc (New-Request 'reviewed_merge' $mergeRaw $mergeChecksum $cloudBefore @($decision))
  Assert-True ($merge.outcome -eq 'success' -and (Get-LastLine "select title from public.shows where user_id='$ownerId' and legacy_id='tv-0001';") -eq 'Explicit Reviewed Baseline') 'Reviewed merge did not apply explicit decision.'; Assert-True ((Get-LastLine "select count(*) from public.shows where user_id='$ownerId';") -eq '351') 'Reviewed merge implicitly created ignored local record.'

  $rollbackBefore=Get-CloudChecksum
  Invoke-LocalPsql "create function public.baseline_fail_receipt_update() returns trigger language plpgsql as `$`$ begin raise exception 'forced late failure'; end `$`$; create trigger baseline_late_failure before update on public.migration_receipts for each row execute function public.baseline_fail_receipt_update();"|Out-Null
  $late=$jsonText|ConvertFrom-Json -DateKind String; $late.shows[1].title+=' Late'; $late.shows[1].updatedAt='2026-08-20T12:00:00.000Z'; $lateRaw=[ordered]@{schemaVersion=1;shows=@($late.shows)}; $lateChecksum=Get-Checksum (Normalize-Payload $lateRaw)
  $lateResult=Invoke-Rpc (New-Request 'replace_cloud' $lateRaw $lateChecksum $rollbackBefore)
  Assert-True ($lateResult.outcome -eq 'internal_error' -and (Get-CloudChecksum) -eq $rollbackBefore) 'Late failure did not roll back completely.'
  Invoke-LocalPsql 'drop trigger baseline_late_failure on public.migration_receipts; drop function public.baseline_fail_receipt_update();'|Out-Null
  Assert-True ((Get-LastLine "select count(*) from public.shows where user_id='$otherId' and title='Other owner sentinel';") -eq '1') 'Cross-owner sentinel was changed.'

  Invoke-LocalPsql "delete from auth.users where id='$ownerId';"|Out-Null
  $cleanup=Get-LastLine "select (select count(*) from public.shows where user_id='$ownerId')||'|'||(select count(*) from public.season_progress where user_id='$ownerId')||'|'||(select count(*) from public.migration_receipts where user_id='$ownerId');"
  Assert-True ($cleanup -eq '0|0|0') 'Synthetic identity cascade cleanup failed.'

  [ordered]@{catalog=[ordered]@{jsJsonEquivalent=$true;shows=352;seasons=1028;maximumSeason=17;statuses=$statuses;nonNullTmdbIds=$tmdbIds.Count;sourceChecksum=$sourceChecksum};firstImport=[ordered]@{shows=$first.data.finalTotals.shows;seasons=$first.data.finalTotals.seasons;receipt=$first.data.receipt.migrationKey;checksum=$first.data.resultChecksum};idempotentRetry=$true;replacement=[ordered]@{shows=$reducedResult.data.finalTotals.shows;seasons=$reducedResult.data.finalTotals.seasons;deletedShows=$reducedResult.data.shows.deleted;deletedSeasons=$reducedResult.data.seasons.deleted};keepCloudNoOp=$true;reviewedMergeExplicit=$true;rollback=$true;crossOwnerIsolation=$true;cleanup=$true}|ConvertTo-Json -Depth 8
}
finally {
  try { Invoke-LocalPsql "drop trigger if exists baseline_late_failure on public.migration_receipts; drop function if exists public.baseline_fail_receipt_update(); delete from auth.users where id in ('$ownerId','$otherId'); revoke tracker_api_owner from postgres;"|Out-Null } catch { Write-Warning $_ }
  foreach($path in $tempFiles){Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue}
}
