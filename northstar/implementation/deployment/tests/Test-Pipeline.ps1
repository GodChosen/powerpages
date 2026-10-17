Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Import-Module (Join-Path $root 'Pipeline.Core.psm1') -Force
$work=Join-Path $root ('test-output/'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
$results=[Collections.Generic.List[object]]::new()
function Check([string]$Name,[scriptblock]$Body){
    & $Body
    $results.Add(@{name=$Name;status='PASS'})
}
function Reject([scriptblock]$Body,[string]$Expected){
    try { & $Body; throw 'UNEXPECTED_SUCCESS' } catch {
        if($_.Exception.Message -eq 'UNEXPECTED_SUCCESS' -or $_.Exception.Message -notmatch $Expected){throw}
    }
}
$policyPath=Join-Path $root 'target.training.json'
$policy=Read-TrainingPolicy $policyPath
$profile=Join-Path $root 'profiles/training.deployment.yml'
$site=Join-Path $work 'site'
New-Item -ItemType Directory -Path (Join-Path $site '.portalconfig') -Force | Out-Null
"adx_name: Northstar Connect - northstar-connect-training`nadx_websiteid: $($policy.websiteId)" | Set-Content (Join-Path $site 'website.yml')
'{}' | Set-Content (Join-Path $site '.portalconfig/manifest.yml')
'<h1>Offline fixture</h1>' | Set-Content (Join-Path $site 'fixture.html')
$solutionFolder=Join-Path $work 'solution-source'
New-Item -ItemType Directory -Path (Join-Path $solutionFolder 'PluginAssemblies') -Force | Out-Null
"<ImportExportXml><SolutionManifest><UniqueName>$($policy.solutionUniqueName)</UniqueName><Managed>0</Managed></SolutionManifest></ImportExportXml>" | Set-Content (Join-Path $solutionFolder 'solution.xml')
'<ImportExportXml />' | Set-Content (Join-Path $solutionFolder 'customizations.xml')
'OFFLINE TEST FIXTURE, NOT AN ASSEMBLY' | Set-Content (Join-Path $solutionFolder 'PluginAssemblies/Northstar.Lifecycle.dll')
Add-Type -AssemblyName System.IO.Compression.FileSystem
$managed=Join-Path $work 'solution.zip'
[IO.Compression.ZipFile]::CreateFromDirectory($solutionFolder,$managed)
$artifact=Join-Path $work 'release.zip'
$revision='1'*40

Check 'Approved Training target accepted' { $null=Read-TrainingPolicy $policyPath }
Check 'Wrong environment is rejected before authentication' {
    $bad=$policy | ConvertTo-Json | ConvertFrom-Json
    $bad.environmentUrl='https://other.crm.dynamics.com/'
    $badPath=Join-Path $work 'bad-target.json';$bad | ConvertTo-Json | Set-Content $badPath
    Reject {Read-TrainingPolicy $badPath} 'Wrong target URL'
}
Check 'Standard data model is rejected' {
    $bad=$policy | ConvertTo-Json | ConvertFrom-Json;$bad.modelVersion=1
    $badPath=Join-Path $work 'bad-model.json';$bad | ConvertTo-Json | Set-Content $badPath
    Reject {Read-TrainingPolicy $badPath} 'Enhanced model'
}
Check 'Managed production package policy is rejected for Training' {
    $bad=$policy | ConvertTo-Json | ConvertFrom-Json;$bad.solutionPackageType='Managed'
    $badPath=Join-Path $work 'bad-package-type.json';$bad | ConvertTo-Json | Set-Content $badPath
    Reject {Read-TrainingPolicy $badPath} 'unmanaged authoring lab'
}
Check 'Changed deployment profile is rejected' {
    $changed=Join-Path $work 'changed.yml';'adx_sitesetting: []' | Set-Content $changed
    Reject {Assert-Profile $changed $policy} 'reviewed SHA'
}
Check 'Wrong site export is rejected' {
    $badSite=Join-Path $work 'bad-site';New-Item -ItemType Directory $badSite | Out-Null
    'adx_websiteid: 00000000-0000-0000-0000-000000000001' | Set-Content (Join-Path $badSite 'website.yml')
    Reject {Assert-SiteSource $badSite $policy} 'another website'
}
Check 'Managed solution ZIP is rejected even under approved Training policy' {
    $bad=Join-Path $work 'managed-wrong-type.zip';Copy-Item -LiteralPath $managed -Destination $bad
    $zip=[IO.Compression.ZipFile]::Open($bad,[IO.Compression.ZipArchiveMode]::Update)
    try {
        $entry=$zip.GetEntry('solution.xml');$entry.Delete();$entry=$zip.CreateEntry('solution.xml')
        $writer=[IO.StreamWriter]::new($entry.Open())
        try {$writer.Write("<ImportExportXml><SolutionManifest><UniqueName>$($policy.solutionUniqueName)</UniqueName><Managed>1</Managed></SolutionManifest></ImportExportXml>")} finally {$writer.Dispose()}
    } finally {$zip.Dispose()}
    Reject {Assert-TrainingSolution $bad $policy} 'only unmanaged'
}
Check 'Nonempty deletion manifest is rejected' {
    'deleted: [unsafe]' | Set-Content (Join-Path $site '.portalconfig/manifest.yml')
    Reject {Assert-SiteSource $site $policy} 'Deletion manifest'
    '{}' | Set-Content (Join-Path $site '.portalconfig/manifest.yml')
}
Check 'Release package records digests and round-trips' {
    $package=New-ReleasePackage -SitePath $site -SolutionPath $managed -PolicyPath $policyPath -ProfilePath $profile -OutputPath $artifact -SourceRevision $revision
    $expanded=Expand-VerifiedRelease $artifact $package.sha256 (Join-Path $work 'verified') $policyPath
    Assert-True ($expanded.sourceRevision -ceq $revision) 'Source revision changed.'
}
$hash=Get-Sha256 $artifact
Check 'Incorrect outer artifact digest is rejected' {
    Reject {Expand-VerifiedRelease $artifact ('0'*64) (Join-Path $work 'wrong-sha') $policyPath} 'SHA-256 mismatch'
}
Check 'Undeclared payload fails even when outer ZIP digest is recomputed' {
    $bad=Join-Path $work 'extra.zip';Copy-Item -LiteralPath $artifact -Destination $bad
    $zip=[IO.Compression.ZipFile]::Open($bad,[IO.Compression.ZipArchiveMode]::Update)
    try { $entry=$zip.CreateEntry('site/undeclared.txt');$writer=[IO.StreamWriter]::new($entry.Open());try{$writer.Write('extra')}finally{$writer.Dispose()} } finally {$zip.Dispose()}
    Reject {Expand-VerifiedRelease $bad (Get-Sha256 $bad) (Join-Path $work 'extra') $policyPath} 'undeclared'
}
Check 'Path traversal ZIP rejected before extraction' {
    $bad=Join-Path $work 'traversal.zip'
    $zip=[IO.Compression.ZipFile]::Open($bad,[IO.Compression.ZipArchiveMode]::Create)
    try {$null=$zip.CreateEntry('../escape.txt')}finally{$zip.Dispose()}
    Reject {Expand-VerifiedRelease $bad (Get-Sha256 $bad) (Join-Path $work 'escape') $policyPath} 'Unsafe archive path'
}
Check 'Plan uses explicit target profile model and verified rollback' {
    $text=& pwsh -NoProfile -File (Join-Path $root 'Invoke-TrainingPipeline.ps1') -Mode Plan -ArtifactPath $artifact -ExpectedSha256 $hash -RollbackArtifactPath $artifact -RollbackSha256 $hash
    Assert-True ($LASTEXITCODE -eq 0) 'Plan runner failed.'
    $plan=($text -join "`n") | ConvertFrom-Json
    Assert-True ($plan.commands.Count -eq 2) 'Expected sequential unmanaged lab import and site upload.'
    Assert-True ($plan.commands[1] -contains '--deploymentProfile' -and $plan.commands[1] -contains 'training' -and $plan.commands[1] -contains '--environment' -and $plan.commands[1] -contains $policy.environmentUrl -and $plan.commands[1] -contains '2') 'Missing explicit upload guard.'
}
Check 'Deploy refuses implicit authentication before any PAC call' {
    $output=& pwsh -NoProfile -File (Join-Path $root 'Invoke-TrainingPipeline.ps1') -Mode Deploy -ArtifactPath $artifact -ExpectedSha256 $hash -RollbackArtifactPath $artifact -RollbackSha256 $hash -Confirmation TRAINING 2>&1
    Assert-True ($LASTEXITCODE -ne 0 -and ($output -join "`n") -match 'explicit authentication mode') 'Implicit auth was not rejected.'
}
@{status='PASS';tests=$results.Count;results=$results;scope='Offline fixtures exercise policy, artifact integrity, path traversal, profile, site and command-plan guards. No live authentication or upload performed.'} | ConvertTo-Json -Depth 8 | Tee-Object -FilePath (Join-Path $root 'test-results.json')
exit 0
