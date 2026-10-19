[CmdletBinding()]
param([string]$PacPath)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$workspace=[IO.Path]::GetFullPath($env:GITHUB_WORKSPACE)
$deploymentRoot=(Resolve-Path -LiteralPath (Join-Path $workspace $env:DEPLOY_ROOT)).Path
$prefix=$workspace.TrimEnd([IO.Path]::DirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar
if(-not $deploymentRoot.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){throw 'Deployment root must remain inside the checked-out workspace.'}
# Load all helpers before authentication or tenant operations.
$pipeline=(Resolve-Path -LiteralPath (Join-Path $deploymentRoot 'Invoke-TrainingPipeline.ps1')).Path
$cleanup=(Resolve-Path -LiteralPath (Join-Path $deploymentRoot 'Remove-PrivateWorkingDirectory.ps1')).Path
Import-Module (Join-Path $deploymentRoot 'ArtifactCrypto.psm1') -Force
if(-not $PacPath){$PacPath=Join-Path $env:RUNNER_TEMP 'pac/pac.exe'}
$PacPath=(Resolve-Path -LiteralPath $PacPath).Path
$private = "$env:RUNNER_TEMP/northstar-private-deploy"
New-Item -ItemType Directory -Path $private -Force | Out-Null
$primaryFailure = $null
try {
  $candidate = Unprotect-ReleaseArtifact `
    -InputPath "$env:RUNNER_TEMP/candidate/release.enc.json" `
    -ExpectedCipherSha256 $env:CANDIDATE_SHA256 -OutputPath "$private/candidate/release.zip" `
    -WorkingRoot $private -KeyBase64 $env:ARTIFACT_KEY -ExpectedSourceRevision $env:CANDIDATE_COMMIT
  $baseline = Unprotect-ReleaseArtifact `
    -InputPath "$env:RUNNER_TEMP/rollback/release.enc.json" `
    -ExpectedCipherSha256 $env:ROLLBACK_SHA256 -OutputPath "$private/rollback/release.zip" `
    -WorkingRoot $private -KeyBase64 $env:ARTIFACT_KEY -ExpectedSourceRevision $env:BASELINE_COMMIT
  & $pipeline -Mode $env:OPERATION `
    -Authentication GitHubFederated -Confirmation $env:CONFIRMATION `
    -PacPath $PacPath -WorkingDirectory "$private/evidence" `
    -ArtifactPath $candidate.path -ExpectedSha256 $candidate.plaintextSha256 `
    -RollbackArtifactPath $baseline.path -RollbackSha256 $baseline.plaintextSha256 `
    -ExpectedSourceRevision $env:CANDIDATE_COMMIT -ExpectedRollbackRevision $env:BASELINE_COMMIT |
    Set-Content "$private/deployment-result.json"
  $public = "$env:RUNNER_TEMP/public-evidence"
  New-Item -ItemType Directory -Path $public -Force | Out-Null
  @{operation=$env:OPERATION;status='UPLOADED_PENDING_RUNTIME_ACCEPTANCE';
    sourceRevision=$env:CANDIDATE_COMMIT;candidateCipherSha256=$env:CANDIDATE_SHA256;
    rollbackCipherSha256=$env:ROLLBACK_SHA256} |
    ConvertTo-Json | Set-Content "$public/deployment-summary.json"
} catch {
  $originalFailure = $_
  $primaryFailure = $originalFailure
  $diagnostic = Join-Path $private 'evidence/pac-solution-import-failure.txt'
  if(Test-Path -LiteralPath $diagnostic){
    try {
      $encryptedRoot = Join-Path $env:RUNNER_TEMP 'import-diagnostics'
      $summary = Protect-ReleaseArtifact -InputPath $diagnostic `
        -OutputPath (Join-Path $encryptedRoot 'pac-import.enc.json') -WorkingRoot $encryptedRoot `
        -KeyBase64 $env:ARTIFACT_KEY -SourceRevision $env:GITHUB_SHA -Purpose PacImportDiagnostic
      $summary | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $encryptedRoot 'diagnostic-summary.json')
    } catch {
      Write-Warning 'Encrypted import diagnostic could not be retained; original safe PAC failure is preserved.'
    }
  }
  throw $originalFailure
} finally {
  try {
    & $cleanup -Path $private -RunnerTemporaryRoot $env:RUNNER_TEMP
  } catch {
    if (-not $primaryFailure) { throw 'Private deployment cleanup failed; release is not successful.' }
    Write-Warning 'Private deployment cleanup failed; original operation failure is preserved. Temporary files may remain on this runner.'
  }
}
