[CmdletBinding()]
param(
  [string]$ProjectId = 'TVSeriesTracker',
  [string]$DockerPath = 'docker'
)

$ErrorActionPreference = 'Stop'
$container = "supabase_db_$ProjectId"
$tempFiles = [System.Collections.Generic.List[string]]::new()

function New-TempFile {
  $path = [System.IO.Path]::GetTempFileName()
  $tempFiles.Add($path)
  return $path
}

function Invoke-LocalPsql {
  param([Parameter(Mandatory)][string]$Sql)
  $output = & $DockerPath exec $container psql -U postgres -d postgres -AtX -v ON_ERROR_STOP=1 -c $Sql 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($output -join [Environment]::NewLine) }
  return $output
}

function Start-PsqlSession {
  param([Parameter(Mandatory)][string]$Sql)
  $inputPath = New-TempFile
  $outputPath = New-TempFile
  $errorPath = New-TempFile
  [System.IO.File]::WriteAllText($inputPath, $Sql, [System.Text.UTF8Encoding]::new($false))
  $process = Start-Process -FilePath $DockerPath -ArgumentList @('exec','-i',$container,'psql','-U','postgres','-d','postgres','-AtX','-v','ON_ERROR_STOP=1') -RedirectStandardInput $inputPath -RedirectStandardOutput $outputPath -RedirectStandardError $errorPath -NoNewWindow -PassThru
  return [pscustomobject]@{ Process=$process; Output=$outputPath; Error=$errorPath }
}

function Complete-PsqlSession {
  param([Parameter(Mandatory)]$Session)
  $Session.Process.WaitForExit()
  $stdout = [System.IO.File]::ReadAllText($Session.Output)
  $stderr = [System.IO.File]::ReadAllText($Session.Error)
  if ($Session.Process.ExitCode -ne 0) { throw "Concurrent psql session failed: $stderr" }
  $jsonLine = ($stdout -split "`r?`n" | Where-Object { $_ -match '^\{.*\}$' } | Select-Object -First 1)
  if (-not $jsonLine) { throw "Concurrent psql session returned no JSON envelope. stdout: $stdout stderr: $stderr" }
  return $jsonLine | ConvertFrom-Json
}

function Assert-SafeEnvelope {
  param([Parameter(Mandatory)]$Envelope)
  $serialized = $Envelope | ConvertTo-Json -Depth 20 -Compress
  if ($serialized -match '(?i)(sqlstate|sqlerrm|constraint|index|detail|hint|query text|shows_user_tmdb_id_uidx|season_progress_show_id_season_number_key)') {
    throw "Unsafe database diagnostic escaped: $serialized"
  }
}

try {
  Invoke-LocalPsql "insert into auth.users(id,email) values ('e0000000-0000-0000-0000-00000000000e','tmdb-race@example.invalid'),('f0000000-0000-0000-0000-00000000000f','season-race@example.invalid'); insert into public.shows(id,user_id,platform,title) values('ff000000-0000-0000-0000-00000000000f','f0000000-0000-0000-0000-00000000000f','Test','Season race parent');" | Out-Null

  $tmdbA = @'
begin;
select pg_catalog.set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-00000000000e',true);
select public.tracker_create_show('{"platform":"Test","title":"TMDB race A","tmdbId":990001}'::jsonb);
select pg_catalog.pg_sleep(4);
commit;
'@
  $tmdbB = @'
select pg_catalog.set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-00000000000e',false);
select public.tracker_create_show('{"platform":"Test","title":"TMDB race B","tmdbId":990001}'::jsonb);
'@
  $sessionA = Start-PsqlSession $tmdbA
  Start-Sleep -Milliseconds 750
  $sessionB = Start-PsqlSession $tmdbB
  $resultA = Complete-PsqlSession $sessionA
  $resultB = Complete-PsqlSession $sessionB
  $tmdbOutcomes = @($resultA.outcome,$resultB.outcome) | Sort-Object
  if (($tmdbOutcomes -join ',') -ne 'success,validation_error') { throw "Unexpected TMDB race outcomes: $($tmdbOutcomes -join ',')" }
  $tmdbLoser = @($resultA,$resultB) | Where-Object outcome -eq 'validation_error'
  if ($tmdbLoser.error.code -ne 'duplicate_tmdb_id') { throw "TMDB loser was not normalized to duplicate_tmdb_id." }
  Assert-SafeEnvelope $tmdbLoser

  $seasonA = @'
begin;
select pg_catalog.set_config('request.jwt.claim.sub','f0000000-0000-0000-0000-00000000000f',true);
select public.tracker_upsert_season('{"showId":"ff000000-0000-0000-0000-00000000000f","seasonNumber":1,"expectedRevision":null,"status":"not_started"}'::jsonb);
select pg_catalog.pg_sleep(4);
commit;
'@
  $seasonB = @'
select pg_catalog.set_config('request.jwt.claim.sub','f0000000-0000-0000-0000-00000000000f',false);
select public.tracker_upsert_season('{"showId":"ff000000-0000-0000-0000-00000000000f","seasonNumber":1,"expectedRevision":null,"status":"watching"}'::jsonb);
'@
  $sessionA = Start-PsqlSession $seasonA
  Start-Sleep -Milliseconds 750
  $sessionB = Start-PsqlSession $seasonB
  $resultA = Complete-PsqlSession $sessionA
  $resultB = Complete-PsqlSession $sessionB
  $seasonOutcomes = @($resultA.outcome,$resultB.outcome) | Sort-Object
  if (($seasonOutcomes -join ',') -ne 'conflict,success') { throw "Unexpected season race outcomes: $($seasonOutcomes -join ',')" }
  Assert-SafeEnvelope (@($resultA,$resultB) | Where-Object outcome -eq 'conflict')

  [pscustomobject]@{
    tmdbRace = @{ outcomes=$tmdbOutcomes; loserCode=$tmdbLoser.error.code }
    seasonRace = @{ outcomes=$seasonOutcomes }
  } | ConvertTo-Json -Depth 5
}
finally {
  try { Invoke-LocalPsql "delete from auth.users where id in ('e0000000-0000-0000-0000-00000000000e','f0000000-0000-0000-0000-00000000000f');" | Out-Null } catch { Write-Warning $_ }
  foreach ($path in $tempFiles) { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue }
}
