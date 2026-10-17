Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Import-Module (Join-Path $root 'ArtifactCrypto.psm1') -Force
# The preceding pipeline suite creates a harmless, public-key-only signed fixture.
$fixture=Get-ChildItem (Join-Path $root 'test-output') -Directory | Where-Object {Test-Path (Join-Path $_.FullName 'solution.zip')} | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if(-not $fixture){throw 'Run Test-Pipeline.ps1 before the hosted composition test.'}
$work=Join-Path ([IO.Path]::GetTempPath()) ('northstar-hosted-test-'+[guid]::NewGuid().ToString('N'))
$workspace=Join-Path $work 'workspace';$deployment=Join-Path $workspace 'nested/companion'
New-Item -ItemType Directory -Path $deployment -Force | Out-Null
foreach($name in @('Invoke-HostedTrainingExport.ps1','Invoke-TrainingPipeline.ps1','Pipeline.Core.psm1','ArtifactCrypto.psm1','Remove-PrivateWorkingDirectory.ps1','target.training.json')){
    Copy-Item -LiteralPath (Join-Path $root $name) -Destination (Join-Path $deployment $name)
}
Copy-Item -LiteralPath (Join-Path $root 'profiles') -Destination (Join-Path $deployment 'profiles') -Recurse
$fake=Join-Path $work 'fake-pac.ps1'
@'
$command=$args[0]+' '+$(if($args.Count -gt 1){$args[1]}else{''})
switch($command){
 'help ' {Write-Output 'Version: 2.9.3 test';exit 0}
 'auth who' {Write-Output 'ae98a065-3249-4ddf-8d8d-801177e90ba1 8b9855ed-8c02-e566-92db-7ab085f38da1';exit 0}
 'org who' {Write-Output '8b9855ed-8c02-e566-92db-7ab085f38da1 4d72579a-4ba0-f111-aaa0-6045bdcf39a2 https://powerpagestraining.crm11.dynamics.com/';exit 0}
 'org fetch' {Write-Output 'cd7e6bae-ae51-46f4-9027-542ca5afe292 Northstar Connect - northstar-connect-training 2.0 northstar-connect-training.powerappsportals.com Active';exit 0}
 'solution list' {Write-Output 'NorthstarHandbookValidation 1.0 False';exit 0}
 'auth delete' {if($env:NORTHSTAR_FAKE_MODE -eq 'AuthCleanupFailure'){Write-Output 'Synthetic cleanup failure';exit 8};exit 0}
 'solution export' {
   if($env:NORTHSTAR_FAKE_MODE -eq 'CaptureFailure'){New-Item -ItemType Directory -Path (Join-Path $env:RUNNER_TEMP 'northstar-private-export/evidence/pac-solution-export-failure.txt') | Out-Null}
   if($env:NORTHSTAR_FAKE_MODE -ne 'Success'){Write-Output 'Synthetic export timed out; Bearer FAKE_SECRET_TOKEN';exit 7}
   $path=$args[[array]::IndexOf($args,'--path')+1]
   Copy-Item -LiteralPath (Join-Path $env:NORTHSTAR_FIXTURE 'solution.zip') -Destination $path;exit 0
 }
 'pages download' {
   $path=$args[[array]::IndexOf($args,'--path')+1]
   New-Item -ItemType Directory -Path $path -Force | Out-Null
   Copy-Item -LiteralPath (Join-Path $env:NORTHSTAR_FIXTURE 'site') -Destination (Join-Path $path 'site') -Recurse;exit 0
 }
 default {if($args[0] -eq 'auth'){exit 0};throw 'Unexpected fake PAC command'}
}
'@ | Set-Content -LiteralPath $fake
$saved=@{};$variables=@('GITHUB_WORKSPACE','DEPLOY_ROOT','RUNNER_TEMP','GITHUB_ACTIONS','GITHUB_REPOSITORY','GITHUB_REF','GITHUB_EVENT_NAME','GITHUB_SHA','ACTIONS_ID_TOKEN_REQUEST_URL','CONFIRMATION','ARTIFACT_KEY','NORTHSTAR_FAKE_MODE','NORTHSTAR_FIXTURE')
foreach($name in $variables){$saved[$name]=[Environment]::GetEnvironmentVariable($name)}
$key=[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32));$revision='a'*40
$results=[Collections.Generic.List[object]]::new()
try {
    $env:GITHUB_WORKSPACE=$workspace;$env:DEPLOY_ROOT='nested/companion';$env:GITHUB_ACTIONS='true';$env:GITHUB_REPOSITORY='GodChosen/powerpages';$env:GITHUB_REF='refs/heads/master';$env:GITHUB_EVENT_NAME='workflow_dispatch';$env:GITHUB_SHA=$revision;$env:ACTIONS_ID_TOKEN_REQUEST_URL='https://synthetic.invalid/';$env:CONFIRMATION='TRAINING';$env:NORTHSTAR_FIXTURE=$fixture.FullName
    foreach($mode in @('Failure','EncryptionFailure','AuthCleanupFailure','CaptureFailure','PrivateCleanupFailure','SuccessCleanupFailure','Success')){
        $env:RUNNER_TEMP=Join-Path $work $mode;New-Item -ItemType Directory -Path $env:RUNNER_TEMP | Out-Null
        $lockedFile=$null
        if($mode -in @('PrivateCleanupFailure','SuccessCleanupFailure')){
            $lockDirectory=Join-Path $env:RUNNER_TEMP 'northstar-private-export'
            New-Item -ItemType Directory -Path $lockDirectory -Force | Out-Null
            # Real Windows deletion failure, using the actual cleanup helper.
            $lockedFile=[IO.File]::Open((Join-Path $lockDirectory 'locked-fixture.txt'),[IO.FileMode]::Create,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
        }
        $env:NORTHSTAR_FAKE_MODE=if($mode -eq 'SuccessCleanupFailure'){'Success'}else{$mode}
        $env:ARTIFACT_KEY=if($mode -eq 'EncryptionFailure'){'invalid'}else{$key}
        # This is exactly the workflow entry point, deliberately from another cwd.
        Push-Location $work
        try {$output=@(& pwsh -NoProfile -File (Join-Path (Join-Path $env:GITHUB_WORKSPACE $env:DEPLOY_ROOT) 'Invoke-HostedTrainingExport.ps1') -PacPath $fake 2>&1 | ForEach-Object {[string]$_});$code=$LASTEXITCODE} finally {Pop-Location;if($lockedFile){$lockedFile.Dispose()}}
        $privateSurvived=Test-Path (Join-Path $env:RUNNER_TEMP 'northstar-private-export')
        if($privateSurvived -and $mode -notin @('PrivateCleanupFailure','SuccessCleanupFailure')){throw 'Private export directory survived finally cleanup.'}
        if(-not $privateSurvived -and $mode -in @('PrivateCleanupFailure','SuccessCleanupFailure')){throw 'Actual helper deletion-failure fixture was ineffective.'}
        if(($output -join "`n") -match 'FAKE_SECRET_TOKEN'){throw 'Raw failure output reached public logs.'}
        if($mode -eq 'SuccessCleanupFailure'){
            if($code -eq 0 -or ($output -join "`n") -notmatch 'release is not successful'){throw 'Successful export ignored failed private cleanup.'}
            $results.Add(@{name=$mode;status='PASS'});continue
        }
        if($mode -eq 'Success'){
            if($code -ne 0){throw ('Hosted success composition failed: '+($output -join "`n"))}
            $encrypted=Join-Path $env:RUNNER_TEMP 'publish/release.enc.json'
            if(-not (Test-Path $encrypted)){throw 'Success did not produce encrypted release.'}
        }else{
            if($code -eq 0 -or ($output -join "`n") -notmatch 'TIMEOUT_OR_CANCELLATION'){throw ('Original safe PAC failure lost: '+($output -join "`n"))}
            $encrypted=Join-Path $env:RUNNER_TEMP 'export-diagnostics/pac-export.enc.json'
            if($mode -in @('Failure','AuthCleanupFailure','PrivateCleanupFailure')){
                if(-not (Test-Path $encrypted)){throw 'Encrypted failure diagnostic missing.'}
                $decoded=Join-Path $env:RUNNER_TEMP 'decoded.txt'
                $null=Unprotect-ReleaseArtifact -InputPath $encrypted -ExpectedCipherSha256 (Get-FileHash $encrypted -Algorithm SHA256).Hash.ToLowerInvariant() -OutputPath $decoded -WorkingRoot $env:RUNNER_TEMP -KeyBase64 $key -ExpectedSourceRevision $revision -Purpose PacExportDiagnostic
                $detail=Get-Content -LiteralPath $decoded -Raw
                if($detail -notmatch 'Synthetic export timed out' -or $detail -match 'FAKE_SECRET_TOKEN'){throw 'Private diagnostic content/redaction failed.'}
                Remove-Item -LiteralPath $decoded -Force
            }elseif(Test-Path $encrypted){throw 'Invalid key unexpectedly produced diagnostic ciphertext.'}
        }
        $results.Add(@{name=$mode;status='PASS'})
    }
    @{status='PASS';tests=$results.Count;results=$results;scope='Exact hosted entry point from different cwd; fake PAC only; success packaging/encryption, failed export diagnostic encryption, encryption-failure original-cause preservation, and finally cleanup.'} | ConvertTo-Json -Depth 5 | Tee-Object -FilePath (Join-Path $root 'hosted-export-test-results.json')
} finally {
    foreach($name in $variables){[Environment]::SetEnvironmentVariable($name,$saved[$name])}
    $full=[IO.Path]::GetFullPath($work)
    if(-not $full.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath())) -or (Split-Path $full -Leaf) -notlike 'northstar-hosted-test-*'){throw 'Unsafe test cleanup path.'}
    Remove-Item -LiteralPath $full -Recurse -Force
}
exit 0
