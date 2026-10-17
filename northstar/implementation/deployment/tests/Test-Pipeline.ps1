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
$assemblyRelative='PluginAssemblies/NorthstarLifecycle-00000000-0000-0000-0000-000000000001/NorthstarLifecycle.dll'
New-Item -ItemType Directory -Path (Split-Path (Join-Path $solutionFolder $assemblyRelative) -Parent) -Force | Out-Null
"<ImportExportXml><SolutionManifest><UniqueName>$($policy.solutionUniqueName)</UniqueName><Managed>0</Managed></SolutionManifest></ImportExportXml>" | Set-Content (Join-Path $solutionFolder 'solution.xml')
$identity='Northstar.Lifecycle, Version=1.0.0.0, Culture=neutral, PublicKeyToken=0e4ef9779f1fdb9d'
$customization="<ImportExportXml><SolutionPluginAssemblies><PluginAssembly FullName='$identity'><FileName>/$assemblyRelative</FileName></PluginAssembly></SolutionPluginAssemblies></ImportExportXml>"
$customization | Set-Content (Join-Path $solutionFolder 'customizations.xml')
# PUBLIC key only. This intentionally delay-signed, trivial fixture proves identity
# parsing, not signature verification or correspondence to registered source.
$publicKey='00240000048000001401000006020000002400005253413100080000010001006DECC3F7BDFE81B2FC44B43CFF5D3F03DC0892C4B007EFD3670237C8AEB72330B749202B1B4A6F7B77CB492298B62CDFCFC62137C62135662A718603A7435143F21F9501B3B518A6E3BE73D564A04FA35A06D7026C6B7B061465DFB481DDAB118BE9FB0603CA891D3817F39CF12F56A22BC726E2B16B7B330A278711A0E513D642F83FCAABEB2BF40CF9433AC858DA4610417FFB6776318004FED6FE93B47718DEC444EC03F7C4544630C412B53A80009C6EB9A66836BBFC85F973B17499877297F899A33BC344F8C0DDA43E9D6568E26A4986CDAC496CC4FCF274A2A360C234388690AE035B5364666788DCCF5503EDE52109DF553258D2AB3BAD1A9794F8A7'
$fixture=Join-Path $work 'assembly-fixture';New-Item -ItemType Directory -Path $fixture | Out-Null
[IO.File]::WriteAllBytes((Join-Path $fixture 'public-key.bin'),[Convert]::FromHexString($publicKey))
'<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework><AssemblyName>Northstar.Lifecycle</AssemblyName><AssemblyVersion>1.0.0.0</AssemblyVersion><SignAssembly>true</SignAssembly><DelaySign>true</DelaySign><AssemblyOriginatorKeyFile>public-key.bin</AssemblyOriginatorKeyFile></PropertyGroup></Project>' | Set-Content (Join-Path $fixture 'Fixture.csproj')
'public sealed class OfflineIdentityFixture {}' | Set-Content (Join-Path $fixture 'Fixture.cs')
& dotnet build (Join-Path $fixture 'Fixture.csproj') -o (Join-Path $fixture 'out') --nologo | Out-Null
Assert-True ($LASTEXITCODE -eq 0) 'Public-key-only fixture compilation failed.'
Copy-Item -LiteralPath (Join-Path $fixture 'out/Northstar.Lifecycle.dll') -Destination (Join-Path $solutionFolder $assemblyRelative)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$managed=Join-Path $work 'solution.zip'
[IO.Compression.ZipFile]::CreateFromDirectory($solutionFolder,$managed)
$artifact=Join-Path $work 'release.zip'
$revision='1'*40

function New-ChangedSolution([string]$Name,[scriptblock]$Change){
    $path=Join-Path $work ('manifest-'+$Name+'.zip');Copy-Item -LiteralPath $managed -Destination $path
    $zip=[IO.Compression.ZipFile]::Open($path,[IO.Compression.ZipArchiveMode]::Update)
    try {& $Change $zip} finally {$zip.Dispose()}
    return $path
}
function Set-Customization($Zip,[string]$Text){
    $Zip.GetEntry('customizations.xml').Delete();$entry=$Zip.CreateEntry('customizations.xml')
    $writer=[IO.StreamWriter]::new($entry.Open());try{$writer.Write($Text)}finally{$writer.Dispose()}
}
Check 'Actual PAC manifest resolves renamed nested assembly and binary identity' {
    $assembly=Get-TrainingSolutionAssembly $managed $policy
    Assert-True ($assembly.path -ceq $assemblyRelative -and $assembly.identity -ceq $identity) 'Manifest resolution failed.'
}
foreach($case in @(
    @{name='traversal';text=$customization.Replace('/'+$assemblyRelative,'/PluginAssemblies/../NorthstarLifecycle.dll');error='Unsafe lifecycle'},
    @{name='backslash';text=$customization.Replace('/'+$assemblyRelative,'/PluginAssemblies/folder\NorthstarLifecycle.dll');error='Unsafe lifecycle'},
    @{name='missing';text=$customization.Replace('NorthstarLifecycle.dll','Missing.dll');error='entry missing'},
    @{name='wrong-token';text=$customization.Replace('0e4ef9779f1fdb9d','0000000000000000');error='manifest identity'},
    @{name='wrong-version';text=$customization.Replace('1.0.0.0','2.0.0.0');error='manifest identity'},
    @{name='duplicate-declaration';text=$customization.Replace('</SolutionPluginAssemblies>',"<PluginAssembly FullName='$identity'><FileName>/$assemblyRelative</FileName></PluginAssembly></SolutionPluginAssemblies>");error='Exactly one Northstar'},
    @{name='schema-only';text='<ImportExportXml />';error='Exactly one Northstar'}
)){
    Check ('Reject malformed solution '+$case.name) {
        $bad=New-ChangedSolution $case.name {param($zip) Set-Customization $zip $case.text}
        Reject {Assert-TrainingSolution $bad $policy} $case.error
    }
}
Check 'Duplicate ZIP path rejected before identity selection' {
    $bad=New-ChangedSolution 'duplicate-path' {param($zip) $null=$zip.CreateEntry($assemblyRelative)}
    Reject {Assert-TrainingSolution $bad $policy} 'Duplicate solution'
}
Check 'Manifest identity cannot disguise unrelated binary' {
    $bad=New-ChangedSolution 'wrong-binary' {param($zip)
        $zip.GetEntry($assemblyRelative).Delete();$entry=$zip.CreateEntry($assemblyRelative)
        $input=[IO.File]::OpenRead([Uri].Assembly.Location);$output=$entry.Open()
        try{$input.CopyTo($output)}finally{$input.Dispose();$output.Dispose()}
    }
    Reject {Assert-TrainingSolution $bad $policy} 'binary identity'
}

Check 'Approved Training target accepted' { $null=Read-TrainingPolicy $policyPath }
foreach($case in @(
    @{text='Request timed out';category='TIMEOUT_OR_CANCELLATION'},
    @{text='Missing prvExportCustomization privilege 0x80040220';category='AUTHORIZATION'},
    @{text='AADSTS invalid_client';category='AUTHENTICATION'},
    @{text='429 too many requests';category='THROTTLING'},
    @{text='TLS connection reset';category='NETWORK_OR_TLS'},
    @{text='Solution does not exist';category='SOLUTION_OR_DEPENDENCY'},
    @{text='Unexpected backend failure';category='UNKNOWN'}
)) {
    Check ('PAC error classification '+$case.category) {
        $safe=Get-PacFailureClassification ($case.text+' password=FAKE_SECRET https://private.invalid/ Bearer FAKE_TOKEN') 7 12.34
        Assert-True ($safe.category -ceq $case.category -and $safe.exitCode -eq 7 -and $safe.elapsedSeconds -eq 12.3) 'Wrong safe classification.'
        Assert-True (($safe | ConvertTo-Json -Compress) -notmatch 'FAKE_SECRET|FAKE_TOKEN|private.invalid') 'Raw diagnostic leaked.'
    }
}
Check 'Solution export uses bounded async with exact target and no retry flag' {
    $arguments=Get-TrainingSolutionExportArguments $policy 'private-output.zip'
    Assert-True ($arguments -contains '--async' -and $arguments[-2] -ceq '--max-async-wait-time' -and $arguments[-1] -ceq '10' -and $arguments[3] -ceq $policy.environmentUrl -and $arguments[5] -ceq $policy.solutionUniqueName) 'Incorrect export execution mode or target.'
}
Check 'Private failure capture redacts credentials and forbids auth commands' {
    $captureRoot=if($env:RUNNER_TEMP){$env:RUNNER_TEMP}else{[IO.Path]::GetTempPath()}
    $capture=Join-Path $captureRoot ('northstar-test-'+[guid]::NewGuid().ToString('N')+'.txt')
    try {
        Save-PacExportFailure @('solution','export') 'Backend detail Bearer FAKE_TOKEN password=FAKE_SECRET eyJtest.payload.signature' $capture
        $content=Get-Content -LiteralPath $capture -Raw
        Assert-True ($content -match 'Backend detail' -and $content -notmatch 'FAKE_TOKEN|FAKE_SECRET|eyJtest') 'Capture did not redact sensitive patterns.'
        Reject {Save-PacExportFailure @('auth','create') 'FORBIDDEN AUTH OUTPUT' ($capture+'.auth')} 'authentication output is forbidden'
        Assert-True (-not (Test-Path ($capture+'.auth'))) 'Authentication capture wrote a file.'
    } finally {if(Test-Path -LiteralPath $capture){Remove-Item -LiteralPath $capture -Force}}
}
Check 'Private failure capture rejects repository paths' {Reject {Save-PacExportFailure @('solution','export') 'private detail' (Join-Path $work 'forbidden.txt')} 'private temporary root'}
$siteRow="$($policy.websiteId) $($policy.websiteName) 2.0 $(([uri]$policy.runtimeUrl).DnsSafeHost) Active"
Check 'Bounded Dataverse query targets exact enhanced website' {
    [xml]$query=New-SiteTargetFetchXml $policy
    Assert-True ($query.fetch.count -ceq '2' -and -not $query.fetch.HasAttribute('top') -and $query.fetch.entity.name -ceq 'powerpagesite' -and $query.fetch.entity.filter.condition.value -ceq $policy.websiteId) 'Incorrect query bound or target.'
    Assert-True (@($query.fetch.entity.attribute).Count -eq 5) 'Query must request only target-proof columns.'
}
Check 'Actual Dataverse result shape verifies ID name model domain state' {$null=Assert-DataverseSiteTarget ("Connected`npowerpagesiteid name datamodelversion primarydomainname statecode`n"+$siteRow) $policy}
foreach($case in @(
    @{name='id';old=$policy.websiteId;new='00000000-0000-0000-0000-000000000001'},
    @{name='name';old=$policy.websiteName;new='Northstar Connect - other'},
    @{name='model';old=' 2.0 ';new=' 1.0 '},
    @{name='domain';old=([uri]$policy.runtimeUrl).DnsSafeHost;new='other.powerappsportals.com'},
    @{name='state';old=' Active';new=' Inactive'}
)) {
    Check ('Dataverse proof rejects changed '+$case.name) {Reject {Assert-DataverseSiteTarget ($siteRow.Replace($case.old,$case.new)) $policy} ('mismatch: '+$case.name)}
}
Check 'Dataverse proof rejects zero rows' {Reject {Assert-DataverseSiteTarget 'No results' $policy} 'missing or ambiguous'}
Check 'Dataverse proof rejects duplicate rows' {Reject {Assert-DataverseSiteTarget ($siteRow+"`n"+$siteRow) $policy} 'missing or ambiguous'}
Check 'Dataverse proof rejects incomplete model/domain result' {Reject {Assert-DataverseSiteTarget "$($policy.websiteId) $($policy.websiteName)" $policy} 'format is incomplete'}
$listing="Connected`n Index Website Id Portal Id Friendly Name Portal Url Data Model Version Single Page Application Is Site Active`n [1]  $($policy.websiteId)   $($policy.portalId)   $($policy.websiteName)   $($policy.runtimeUrl)   Enhanced   No   Yes`n"
Check 'PAC verbose table checks every identity column' {$null=Assert-PacWebsiteListing $listing $policy}
Check 'Wrapped PAC row and ANSI styling preserve exact identities' {
    $wrapped=$listing.Replace($policy.websiteName,"Northstar Connect -`n northstar-connect-training").Replace('Enhanced',"$([char]27)[32mEnhanced$([char]27)[0m")
    $null=Assert-PacWebsiteListing $wrapped $policy
}
foreach($case in @(
    @{name='portal';old=$policy.portalId;new='00000000-0000-0000-0000-000000000001';error='mismatch: portal'},
    @{name='friendly name';old=$policy.websiteName;new='Northstar Connect - other';error='mismatch: name'},
    @{name='URL';old=$policy.runtimeUrl;new='https://other.powerappsportals.com/';error='mismatch: url'},
    @{name='model';old='Enhanced';new='Standard';error='mismatch: model'},
    @{name='active';old='No   Yes';new='No   No';error='mismatch: active'},
    @{name='missing portal';old=$policy.portalId;new='';error='format is incomplete'}
)){
    Check ('PAC listing rejects changed '+$case.name) {Reject {Assert-PacWebsiteListing ($listing.Replace($case.old,$case.new)) $policy} $case.error}
}
Check 'Duplicate website rows are rejected' {Reject {Assert-PacWebsiteListing ($listing+$listing) $policy} 'missing or ambiguous'}
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
