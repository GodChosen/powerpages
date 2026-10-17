[CmdletBinding()]
param([string]$PacPath)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$workspace=[IO.Path]::GetFullPath($env:GITHUB_WORKSPACE)
$deploymentRoot=(Resolve-Path -LiteralPath (Join-Path $workspace $env:DEPLOY_ROOT)).Path
$prefix=$workspace.TrimEnd([IO.Path]::DirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar
if(-not $deploymentRoot.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){throw 'Deployment root must remain inside the checked-out workspace.'}
# Resolve every helper and load crypto before authentication/export starts.
$pipeline=(Resolve-Path -LiteralPath (Join-Path $deploymentRoot 'Invoke-TrainingPipeline.ps1')).Path
$cleanup=(Resolve-Path -LiteralPath (Join-Path $deploymentRoot 'Remove-PrivateWorkingDirectory.ps1')).Path
$crypto=(Resolve-Path -LiteralPath (Join-Path $deploymentRoot 'ArtifactCrypto.psm1')).Path
Import-Module $crypto -Force
if(-not $PacPath){$PacPath=Join-Path $env:RUNNER_TEMP 'pac/pac.exe'}
$PacPath=(Resolve-Path -LiteralPath $PacPath).Path
$private=Join-Path $env:RUNNER_TEMP 'northstar-private-export'
New-Item -ItemType Directory -Path $private -Force | Out-Null
$primaryFailure=$null
try {
    $export=Join-Path $private 'export'
    & $pipeline -Mode Export -Authentication GitHubFederated -Confirmation $env:CONFIRMATION `
        -PacPath $PacPath -OutputPath $export -WorkingDirectory (Join-Path $private 'evidence') |
        Set-Content -LiteralPath (Join-Path $private 'export-result.json')
    $site=@(Get-ChildItem (Join-Path $export 'site-export') -Filter website.yml -Recurse)
    if($site.Count -ne 1){throw 'Export contains ambiguous site roots.'}
    & $pipeline -Mode Package -SitePath $site[0].DirectoryName -SolutionPath (Join-Path $export 'solution.zip') `
        -OutputPath (Join-Path $private 'release.zip') -SourceRevision $env:GITHUB_SHA |
        Set-Content -LiteralPath (Join-Path $private 'package-result.json')
    $public=Join-Path $env:RUNNER_TEMP 'publish'
    $summary=Protect-ReleaseArtifact -InputPath (Join-Path $private 'release.zip') `
        -OutputPath (Join-Path $public 'release.enc.json') -WorkingRoot $public `
        -KeyBase64 $env:ARTIFACT_KEY -SourceRevision $env:GITHUB_SHA
    $summary | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $public 'release-summary.json')
} catch {
    $originalFailure=$_
    $primaryFailure=$originalFailure
    $diagnostic=Join-Path $private 'evidence/pac-solution-export-failure.txt'
    if(Test-Path -LiteralPath $diagnostic){
        try {
            $encryptedRoot=Join-Path $env:RUNNER_TEMP 'export-diagnostics'
            $summary=Protect-ReleaseArtifact -InputPath $diagnostic `
                -OutputPath (Join-Path $encryptedRoot 'pac-export.enc.json') -WorkingRoot $encryptedRoot `
                -KeyBase64 $env:ARTIFACT_KEY -SourceRevision $env:GITHUB_SHA -Purpose PacExportDiagnostic
            $summary | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $encryptedRoot 'diagnostic-summary.json')
        } catch {
            Write-Warning 'Encrypted export diagnostic could not be retained; original safe PAC failure is preserved.'
        }
    }
    throw $originalFailure
} finally {
    try {& $cleanup -Path $private -RunnerTemporaryRoot $env:RUNNER_TEMP}
    catch {
        if(-not $primaryFailure){throw 'Private export cleanup failed; release is not successful.'}
        Write-Warning 'Private export cleanup failed; original safe PAC failure is preserved. Temporary files may remain on this runner.'
    }
}
