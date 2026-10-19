Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Import-Module (Join-Path $root 'ArtifactCrypto.psm1') -Force
$fixture=Get-ChildItem (Join-Path $root 'test-output') -Directory | Where-Object {Test-Path (Join-Path $_.FullName 'release.zip')} | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if(-not $fixture){throw 'Run Test-Pipeline.ps1 first.'}
$workflow=Get-Content -LiteralPath (Join-Path $root '../../../.github/workflows/northstar-training.yml') -Raw
if($workflow -notmatch "Invoke-HostedTrainingDeploy.ps1" -or $workflow -notmatch 'northstar-import-diagnostic' -or $workflow -notmatch 'Assert-GitHubRun.ps1'){throw 'Hosted workflow no longer wires the tested composition/provenance/diagnostic artifact.'}
$work=Join-Path ([IO.Path]::GetTempPath()) ('northstar-hosted-deploy-test-'+[guid]::NewGuid().ToString('N'))
$workspace=Join-Path $work 'workspace';$deployment=Join-Path $workspace 'nested/companion'
New-Item -ItemType Directory -Path $deployment -Force|Out-Null
foreach($name in @('Invoke-HostedTrainingDeploy.ps1','Invoke-TrainingPipeline.ps1','Pipeline.Core.psm1','ArtifactCrypto.psm1','Remove-PrivateWorkingDirectory.ps1','target.training.json')){Copy-Item -LiteralPath (Join-Path $root $name) -Destination (Join-Path $deployment $name)}
Copy-Item -LiteralPath (Join-Path $root 'profiles') -Destination (Join-Path $deployment 'profiles') -Recurse
$fake=Join-Path $work 'fake-pac.ps1'
@'
($args | ConvertTo-Json -Compress) | Add-Content -LiteralPath $env:NORTHSTAR_CALLS
$command=$args[0]+' '+$(if($args.Count -gt 1){$args[1]}else{''})
switch($command){
 'help ' {Write-Output 'Version: 2.9.3 test';exit 0}
 'auth who' {Write-Output 'ae98a065-3249-4ddf-8d8d-801177e90ba1 8b9855ed-8c02-e566-92db-7ab085f38da1';exit 0}
 'org who' {Write-Output '8b9855ed-8c02-e566-92db-7ab085f38da1 4d72579a-4ba0-f111-aaa0-6045bdcf39a2 https://powerpagestraining.crm11.dynamics.com/';exit 0}
 'org fetch' {Write-Output 'cd7e6bae-ae51-46f4-9027-542ca5afe292 Northstar Connect - northstar-connect-training 2.0 northstar-connect-training.powerappsportals.com Active';exit 0}
 'solution list' {Write-Output 'NorthstarHandbookValidation 1.0 False';exit 0}
 'auth create' {if($env:NORTHSTAR_FAKE_MODE -eq 'AuthFailure'){Write-Output 'Auth Bearer FAKE_SECRET_TOKEN';exit 9};exit 0}
 'auth delete' {if($env:NORTHSTAR_FAKE_MODE -eq 'AuthCleanupFailure'){Write-Output 'Synthetic cleanup failure';exit 8};exit 0}
 'solution import' {
   if($args[2] -cne '--environment' -or $args[3].TrimEnd('/') -cne 'https://powerpagestraining.crm11.dynamics.com' -or $args[4] -cne '--path' -or $args[-3] -cne '--async' -or $args[-2] -cne '--max-async-wait-time' -or $args[-1] -cne '10' -or $args -notcontains '--activate-plugins' -or $args -notcontains '--publish-changes'){throw 'Import bounded arguments/target changed'}
   if($env:NORTHSTAR_FAKE_MODE -eq 'CaptureFailure'){New-Item -ItemType Directory -Path (Join-Path $env:RUNNER_TEMP 'northstar-private-deploy/evidence/pac-solution-import-failure.txt')|Out-Null}
   if($env:NORTHSTAR_FAKE_MODE -notin @('Success','UploadFailure')){Write-Output ('Synthetic import backend failure; Bearer FAKE_SECRET_TOKEN password=FAKE_PASSWORD '+('x'*70000));exit 7}
   exit 0
 }
 'pages upload' {if($env:NORTHSTAR_FAKE_MODE -eq 'UploadFailure'){Write-Output 'Synthetic upload failure Bearer FAKE_SECRET_TOKEN';exit 6};exit 0}
 'pages download' {
   $path=$args[[array]::IndexOf($args,'--path')+1]
   New-Item -ItemType Directory -Path $path -Force|Out-Null
   Copy-Item -LiteralPath (Join-Path $env:NORTHSTAR_FIXTURE 'site') -Destination (Join-Path $path 'site') -Recurse;exit 0
 }
 default {if($args[0] -eq 'auth'){exit 0};throw 'Unexpected fake PAC command'}
}
'@ | Set-Content -LiteralPath $fake
$saved=@{};$variables=@('GITHUB_WORKSPACE','DEPLOY_ROOT','RUNNER_TEMP','GITHUB_ACTIONS','GITHUB_REPOSITORY','GITHUB_REF','GITHUB_EVENT_NAME','GITHUB_SHA','ACTIONS_ID_TOKEN_REQUEST_URL','CONFIRMATION','ARTIFACT_KEY','NORTHSTAR_FAKE_MODE','NORTHSTAR_FIXTURE','NORTHSTAR_CALLS','OPERATION','CANDIDATE_SHA256','ROLLBACK_SHA256','CANDIDATE_COMMIT','BASELINE_COMMIT')
foreach($name in $variables){$saved[$name]=[Environment]::GetEnvironmentVariable($name)}
$key=[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32));$revision='1'*40
$results=[Collections.Generic.List[object]]::new()
try {
 $env:GITHUB_WORKSPACE=$workspace;$env:DEPLOY_ROOT='nested/companion';$env:GITHUB_ACTIONS='true';$env:GITHUB_REPOSITORY='GodChosen/powerpages';$env:GITHUB_REF='refs/heads/master';$env:GITHUB_EVENT_NAME='workflow_dispatch';$env:GITHUB_SHA=$revision;$env:ACTIONS_ID_TOKEN_REQUEST_URL='https://synthetic.invalid/';$env:NORTHSTAR_FIXTURE=$fixture.FullName
 foreach($mode in @('Failure','EncryptionFailure','AuthCleanupFailure','CaptureFailure','PrivateCleanupFailure','SuccessCleanupFailure','WrongHash','WrongProducer','WrongPolicy','AuthFailure','ConfirmationFailure','UploadFailure','Rollback','Success')){
  $env:RUNNER_TEMP=Join-Path $work $mode;New-Item -ItemType Directory -Path $env:RUNNER_TEMP|Out-Null
  $env:NORTHSTAR_CALLS=Join-Path $env:RUNNER_TEMP 'calls.jsonl'
  $env:ARTIFACT_KEY=$key;$env:CANDIDATE_COMMIT=$revision;$env:BASELINE_COMMIT=$revision;$env:OPERATION=if($mode -eq 'Rollback'){'Rollback'}else{'Deploy'};$env:CONFIRMATION=if($mode -eq 'ConfirmationFailure'){'NO'}else{'TRAINING'}
  foreach($kind in @('candidate','rollback')){
   $path=Join-Path $env:RUNNER_TEMP ($kind+'/release.enc.json')
   $summary=Protect-ReleaseArtifact -InputPath (Join-Path $fixture.FullName 'release.zip') -OutputPath $path -WorkingRoot $env:RUNNER_TEMP -KeyBase64 $key -SourceRevision $revision
   if($kind -eq 'candidate'){$env:CANDIDATE_SHA256=$summary.cipherSha256}else{$env:ROLLBACK_SHA256=$summary.cipherSha256}
  }
  if($mode -eq 'WrongHash'){$env:CANDIDATE_SHA256='0'*64}
  if($mode -eq 'WrongProducer'){$env:CANDIDATE_COMMIT='b'*40}
  $policyPath=Join-Path $deployment 'target.training.json';$originalPolicy=Get-Content $policyPath -Raw
  if($mode -eq 'WrongPolicy'){$changed=$originalPolicy|ConvertFrom-Json;$changed.websiteId='00000000-0000-0000-0000-000000000001';$changed|ConvertTo-Json -Depth 10|Set-Content $policyPath}
  if($mode -eq 'EncryptionFailure'){Set-Content -LiteralPath (Join-Path $env:RUNNER_TEMP 'import-diagnostics') -Value 'blocked'}
  $lockedFile=$null
  if($mode -in @('PrivateCleanupFailure','SuccessCleanupFailure')){
   $directory=Join-Path $env:RUNNER_TEMP 'northstar-private-deploy';New-Item -ItemType Directory -Path $directory -Force|Out-Null
   $lockedFile=[IO.File]::Open((Join-Path $directory 'locked.txt'),[IO.FileMode]::Create,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  }
  $env:NORTHSTAR_FAKE_MODE=if($mode -in @('SuccessCleanupFailure','Rollback')){'Success'}else{$mode}
  Push-Location $work
  try{$output=@(& pwsh -NoProfile -File (Join-Path $deployment 'Invoke-HostedTrainingDeploy.ps1') -PacPath $fake 2>&1|ForEach-Object {[string]$_});$code=$LASTEXITCODE}finally{Pop-Location;if($lockedFile){$lockedFile.Dispose()};[IO.File]::WriteAllText($policyPath,$originalPolicy)}
  $text=$output -join "`n"
  if($text -match 'FAKE_SECRET_TOKEN|FAKE_PASSWORD'){throw 'Raw output reached public log'}
  $calls=@(if(Test-Path $env:NORTHSTAR_CALLS){Get-Content $env:NORTHSTAR_CALLS|ForEach-Object {,@($_|ConvertFrom-Json)}})
  $imports=@($calls|Where-Object {$_[0] -eq 'solution' -and $_[1] -eq 'import'})
  $uploads=@($calls|Where-Object {$_[0] -eq 'pages' -and $_[1] -eq 'upload'})
  $preflightFailure=$mode -in @('WrongHash','WrongProducer','WrongPolicy','AuthFailure','ConfirmationFailure')
  if($preflightFailure -and ($imports.Count -or $uploads.Count)){throw ('Preflight failure reached mutation: '+$mode)}
  if($mode -in @('Success','SuccessCleanupFailure','Rollback')){
   if($uploads.Count -ne 1 -or ($mode -eq 'Rollback' -and $imports.Count) -or ($mode -ne 'Rollback' -and $imports.Count -ne 1)){throw 'Success/rollback sequence mismatch'}
   if($mode -eq 'SuccessCleanupFailure'){if($code -eq 0 -or $text -notmatch 'release is not successful'){throw 'Cleanup-only failure ignored'}}elseif($code -ne 0){throw ('Hosted success failed: '+$text)}
  }elseif($mode -eq 'UploadFailure'){
   if($code -eq 0 -or $text -notmatch 'UNKNOWN' -or $imports.Count -ne 1 -or $uploads.Count -ne 1){throw 'Upload failure sequencing lost'}
  }elseif(-not $preflightFailure){
   if($code -eq 0 -or $text -notmatch 'UNKNOWN' -or $imports.Count -ne 1 -or $uploads.Count){throw ('Original import failure/sequencing lost: '+$mode+' '+$text)}
  }elseif($code -eq 0){throw ('Expected guard failure: '+$mode)}
  $encrypted=Join-Path $env:RUNNER_TEMP 'import-diagnostics/pac-import.enc.json'
  if($mode -in @('Failure','AuthCleanupFailure','PrivateCleanupFailure')){
   if(-not(Test-Path $encrypted)){throw 'Import diagnostic missing'}
   $hash=(Get-FileHash $encrypted -Algorithm SHA256).Hash.ToLowerInvariant();$decoded=Join-Path $env:RUNNER_TEMP 'decoded.txt'
   $null=Unprotect-ReleaseArtifact -InputPath $encrypted -ExpectedCipherSha256 $hash -OutputPath $decoded -WorkingRoot $env:RUNNER_TEMP -KeyBase64 $key -ExpectedSourceRevision $revision -Purpose PacImportDiagnostic
   $detail=Get-Content $decoded -Raw
   if($detail -notmatch 'Synthetic import backend failure' -or $detail -match 'FAKE_SECRET_TOKEN|FAKE_PASSWORD' -or $detail.Length -gt 65560 -or $detail -notmatch 'TRUNCATED'){throw 'Diagnostic redaction/bound failed'}
   foreach($purpose in @('Release','PacExportDiagnostic')){
    try{$null=Unprotect-ReleaseArtifact -InputPath $encrypted -ExpectedCipherSha256 $hash -OutputPath (Join-Path $env:RUNNER_TEMP ($purpose+'.zip')) -WorkingRoot $env:RUNNER_TEMP -KeyBase64 $key -ExpectedSourceRevision $revision -Purpose $purpose;throw 'UNEXPECTED_SUCCESS'}catch{if($_.Exception.Message -eq 'UNEXPECTED_SUCCESS'){throw}}
   }
   Remove-Item -LiteralPath $decoded -Force
  }elseif(Test-Path $encrypted){throw ('Unexpected failure diagnostic: '+$mode)}
  $survived=Test-Path (Join-Path $env:RUNNER_TEMP 'northstar-private-deploy')
  if($survived -ne ($mode -in @('PrivateCleanupFailure','SuccessCleanupFailure'))){throw 'Actual private cleanup behavior mismatch'}
  $results.Add(@{name=$mode;status='PASS'})
 }
 @{status='PASS';tests=$results.Count;results=$results;scope='Exact hosted Deploy/Rollback entry point from another cwd; fake PAC only; no tenant calls'}|ConvertTo-Json -Depth 5|Tee-Object -FilePath (Join-Path $root 'hosted-deploy-test-results.json')
}finally{
 foreach($name in $variables){[Environment]::SetEnvironmentVariable($name,$saved[$name])}
 $full=[IO.Path]::GetFullPath($work)
 if(-not $full.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath())) -or (Split-Path $full -Leaf) -notlike 'northstar-hosted-deploy-test-*'){throw 'Unsafe test cleanup path'}
 Remove-Item -LiteralPath $full -Recurse -Force
}
exit 0
