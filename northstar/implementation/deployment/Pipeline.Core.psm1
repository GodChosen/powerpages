Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Get-Sha256([string]$Path) {
    (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Read-TrainingPolicy([string]$Path) {
    $p = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    Assert-True ($p.schemaVersion -eq 1) 'Unsupported policy schema.'
    Assert-True ($p.name -ceq 'Training') 'Only Training is authorized.'
    Assert-True ($p.environmentUrl -ceq 'https://powerpagestraining.crm11.dynamics.com/') 'Wrong target URL.'
    Assert-True ($p.environmentId -ceq '8b9855ed-8c02-e566-92db-7ab085f38da1') 'Wrong environment ID.'
    Assert-True ($p.tenantId -ceq 'ae98a065-3249-4ddf-8d8d-801177e90ba1') 'Wrong tenant.'
    Assert-True ($p.websiteId -ceq 'cd7e6bae-ae51-46f4-9027-542ca5afe292') 'Wrong website ID.'
    Assert-True ($p.portalId -ceq 'ad793e7a-0aa6-4c28-80ec-5f4217424093') 'Wrong portal resource.'
    Assert-True ($p.organizationId -ceq '4d72579a-4ba0-f111-aaa0-6045bdcf39a2') 'Wrong organization.'
    Assert-True ($p.modelVersion -eq 2) 'Enhanced model 2 is required.'
    Assert-True ($p.pacVersion -ceq '2.9.3') 'PAC must remain pinned to 2.9.3.'
    Assert-True ($p.deploymentProfile -ceq 'training') 'Explicit training profile required.'
    Assert-True ($p.deploymentProfileSha256 -match '^[0-9a-f]{64}$') 'Review and pin the deployment-profile hash.'
    Assert-True ($p.solutionUniqueName -match '^[A-Za-z][A-Za-z0-9_]+$' -and $p.solutionUniqueName -notmatch '^CONFIRM_') 'Confirm the actual solution unique name.'
    Assert-True ($p.solutionPackageType -ceq 'Unmanaged') 'Training is an unmanaged authoring lab; managed import is forbidden.'
    return $p
}

function Assert-Profile([string]$Path, $Policy) {
    Assert-True (Test-Path -LiteralPath $Path -PathType Leaf) 'Deployment profile missing; default fallback is forbidden.'
    Assert-True ((Get-Sha256 $Path) -ceq $Policy.deploymentProfileSha256) 'Deployment profile differs from reviewed SHA-256.'
    # This release intentionally carries no environment field substitutions.
    $body = ((Get-Content -LiteralPath $Path) | Where-Object { $_ -notmatch '^\s*#' }) -join "`n"
    Assert-True ($body.Trim() -ceq '{}') 'Only the reviewed empty Training override profile is supported.'
}

function Read-SolutionAssemblyIdentity([byte[]]$Bytes) {
    $temporary=Join-Path ([IO.Path]::GetTempPath()) ('northstar-identity-'+[guid]::NewGuid().ToString('N')+'.dll')
    try {
        [IO.File]::WriteAllBytes($temporary,$Bytes)
        # Inspect metadata; never load or execute the exported plug-in.
        return [Reflection.AssemblyName]::GetAssemblyName($temporary).FullName
    } finally {if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary -Force}}
}

function Get-TrainingSolutionAssembly([string]$Path, $Policy) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Path).Path)
    try {
        $names=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach($item in $zip.Entries){
            $name=$item.FullName
            Assert-True ($name -notmatch '\\|(^|/)\.\.?(/|$)|:|^/' -and -not [IO.Path]::IsPathRooted($name)) 'Unsafe solution archive path.'
            Assert-True ($names.Add($name)) 'Duplicate solution archive entry.'
            Assert-True ((($item.ExternalAttributes -shr 16) -band 0xF000) -ne 0xA000) 'Solution archive symlink is forbidden.'
        }
        $entry = $zip.GetEntry('solution.xml')
        Assert-True ($null -ne $entry) 'Solution manifest missing.'
        $reader = [IO.StreamReader]::new($entry.Open())
        try { [xml]$xml = $reader.ReadToEnd() } finally { $reader.Dispose() }
        Assert-True ([string]$xml.ImportExportXml.SolutionManifest.Managed -ceq '0') 'Training accepts only unmanaged lab updates; managed promotion is not authorized.'
        Assert-True ([string]$xml.ImportExportXml.SolutionManifest.UniqueName -ceq $Policy.solutionUniqueName) 'Wrong solution unique name.'
        $entry=$zip.GetEntry('customizations.xml')
        Assert-True ($null -ne $entry -and $entry.Length -le 10485760) 'Solution customizations missing or oversized.'
        $settings=[Xml.XmlReaderSettings]::new();$settings.DtdProcessing=[Xml.DtdProcessing]::Prohibit;$settings.XmlResolver=$null
        $stream=$entry.Open();$reader=[Xml.XmlReader]::Create($stream,$settings)
        try {$customizations=[Xml.XmlDocument]::new();$customizations.XmlResolver=$null;$customizations.Load($reader)} finally {$reader.Dispose();$stream.Dispose()}
        $assemblies=@($customizations.SelectNodes('//SolutionPluginAssemblies/PluginAssembly') | Where-Object {$_.GetAttribute('FullName') -match '^Northstar\.Lifecycle(?:,|$)'})
        Assert-True ($assemblies.Count -eq 1) 'Exactly one Northstar.Lifecycle assembly declaration is required; schema-only ZIPs are rejected.'
        $expected='Northstar.Lifecycle, Version=1.0.0.0, Culture=neutral, PublicKeyToken=0e4ef9779f1fdb9d'
        Assert-True ($assemblies[0].GetAttribute('FullName') -ceq $expected) 'Unexpected lifecycle assembly manifest identity.'
        $files=@($assemblies[0].SelectNodes('FileName'))
        Assert-True ($files.Count -eq 1) 'Exactly one lifecycle assembly FileName is required.'
        $file=[string]$files[0].InnerText
        Assert-True ($file -cmatch '^/PluginAssemblies/[^/]+/[^/]+\.dll$' -and $file -notmatch '\\|(^|/)\.\.?(/|$)|:') 'Unsafe lifecycle assembly FileName.'
        $entry=$zip.GetEntry($file.Substring(1))
        Assert-True ($null -ne $entry -and $entry.Length -gt 0 -and $entry.Length -le 10485760) 'Declared lifecycle assembly entry missing or oversized.'
        $memory=[IO.MemoryStream]::new();$stream=$entry.Open()
        try {$stream.CopyTo($memory);$bytes=$memory.ToArray()} finally {$stream.Dispose();$memory.Dispose()}
        Assert-True ((Read-SolutionAssemblyIdentity $bytes) -ceq $expected) 'Exported lifecycle binary identity differs from reviewed name/version/public-key token.'
        return @{path=$entry.FullName;identity=$expected;sha256=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()}
    } finally { $zip.Dispose() }
}

function Assert-TrainingSolution([string]$Path,$Policy) {
    $null=Get-TrainingSolutionAssembly $Path $Policy
}

function Assert-SiteSource([string]$Path, $Policy) {
    $root = (Resolve-Path -LiteralPath $Path).Path
    $website = Join-Path $root 'website.yml'
    Assert-True (Test-Path -LiteralPath $website -PathType Leaf) 'PAC website.yml missing.'
    $text = Get-Content -LiteralPath $website -Raw
    $match = [regex]::Match($text, '(?m)^adx_websiteid:\s*([0-9a-f-]+)\s*$')
    Assert-True ($match.Success -and $match.Groups[1].Value -ceq $Policy.websiteId) 'Export belongs to another website.'
    $files = @(Get-ChildItem -LiteralPath $root -Recurse -File -Force)
    Assert-True ($files.Count -gt 1) 'Site export is incomplete.'
    foreach($entry in Get-ChildItem -LiteralPath $root -Recurse -Force) {
        Assert-True (-not ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) 'Site links/reparse points are forbidden.'
    }
    foreach ($f in $files) {
        Assert-True (-not ($f.Attributes -band [IO.FileAttributes]::ReparsePoint)) 'Site links/reparse points are forbidden.'
        Assert-True ($f.Extension -notin '.pfx','.p12','.pem','.key') 'Credential file in site source.'
    }
    foreach ($manifest in Get-ChildItem -LiteralPath $root -Recurse -File -Filter 'manifest.yml') {
        Assert-True ((Get-Content -LiteralPath $manifest.FullName -Raw).Trim() -ceq '{}') 'Deletion manifest is nonempty; this pipeline does not replay deletions.'
    }
    return $root
}

function New-ReleasePackage {
    param([string]$SitePath,[string]$SolutionPath,[string]$PolicyPath,
        [string]$ProfilePath,[string]$OutputPath,[string]$SourceRevision)
    $policy = Read-TrainingPolicy $PolicyPath
    Assert-Profile $ProfilePath $policy
    $site = Assert-SiteSource $SitePath $policy
    Assert-TrainingSolution $SolutionPath $policy
    Assert-True ($SourceRevision -match '^[0-9a-f]{40}$') 'A full source commit SHA is required.'
    Assert-True (-not (Test-Path -LiteralPath $OutputPath)) 'Release output already exists.'
    $temporaryRoot=if($env:RUNNER_TEMP){[IO.Path]::GetFullPath($env:RUNNER_TEMP)}else{[IO.Path]::GetTempPath()}
    $stage = Join-Path $temporaryRoot ('northstar-package-'+[guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path (Join-Path $stage 'site') -Force | Out-Null
    try {
        foreach ($child in Get-ChildItem -LiteralPath $site -Force) {
            Copy-Item -LiteralPath $child.FullName -Destination (Join-Path $stage 'site') -Recurse -Force
        }
        foreach ($f in Get-ChildItem -LiteralPath (Join-Path $stage 'site') -Recurse -File -Force) {
            if ($f.Name -like '*-manifest.yml') { Remove-Item -LiteralPath $f.FullName }
        }
        $profiles = Join-Path $stage 'site/deployment-profiles'
        New-Item -ItemType Directory -Path $profiles -Force | Out-Null
        Copy-Item -LiteralPath $ProfilePath -Destination (Join-Path $profiles 'training.deployment.yml') -Force
        Copy-Item -LiteralPath $SolutionPath -Destination (Join-Path $stage 'solution.zip')
        $entries = @(Get-ChildItem -LiteralPath $stage -Recurse -File -Force | Sort-Object FullName | ForEach-Object {
            @{ path=[IO.Path]::GetRelativePath($stage,$_.FullName).Replace('\','/'); sha256=Get-Sha256 $_.FullName; bytes=$_.Length }
        })
        $assembly=Get-TrainingSolutionAssembly (Join-Path $stage 'solution.zip') $policy
        $metadata = @{schemaVersion=1;sourceRevision=$SourceRevision;createdUtc=[DateTime]::UtcNow.ToString('o');
            tenantId=$policy.tenantId;environmentId=$policy.environmentId;websiteId=$policy.websiteId;
            modelVersion=2;pacVersion='2.9.3';solutionPackageType='Unmanaged';policySha256=Get-Sha256 $PolicyPath;files=$entries;
            exportedAssemblySha256=$assembly.sha256;exportedAssemblyPath=$assembly.path;exportedAssemblyIdentity=$assembly.identity;
            assemblyProvenance='Exported actual Training assembly; source commit identifies reviewed pipeline/source state, not proof that CI built the exported binary.'}
        $metadata | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $stage 'release.json') -Encoding utf8
        $parent = Split-Path -Parent ([IO.Path]::GetFullPath($OutputPath))
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
        [IO.Compression.ZipFile]::CreateFromDirectory($stage,[IO.Path]::GetFullPath($OutputPath))
        return @{path=[IO.Path]::GetFullPath($OutputPath);sha256=Get-Sha256 $OutputPath;sourceRevision=$SourceRevision}
    } finally {
        # The only recursive deletion is an independently generated temp folder.
        $resolved = [IO.Path]::GetFullPath($stage)
        Assert-True ($resolved.StartsWith([IO.Path]::GetFullPath($temporaryRoot)) -and (Split-Path $resolved -Leaf).StartsWith('northstar-package-')) 'Unsafe temporary cleanup path.'
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}

function Expand-VerifiedRelease {
    param([string]$ArtifactPath,[string]$ExpectedSha256,[string]$Destination,[string]$PolicyPath)
    $policy = Read-TrainingPolicy $PolicyPath
    Assert-True ($ExpectedSha256 -match '^[0-9a-f]{64}$') 'Expected SHA-256 must be explicit and lowercase.'
    Assert-True ((Get-Sha256 $ArtifactPath) -ceq $ExpectedSha256) 'Artifact SHA-256 mismatch.'
    Assert-True (-not (Test-Path -LiteralPath $Destination)) 'Extraction destination already exists.'
    $zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $ArtifactPath).Path)
    try {
        $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        [long]$size = 0
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName.Replace('\','/')
            Assert-True (-not [IO.Path]::IsPathRooted($name) -and $name -notmatch '(^|/)\.\.(/|$)|:') 'Unsafe archive path.'
            Assert-True ($names.Add($name)) 'Duplicate archive entry.'
            $size += $entry.Length
            Assert-True ($size -le 104857600) 'Release exceeds 100 MB expanded limit.'
            Assert-True ((($entry.ExternalAttributes -shr 16) -band 0xF000) -ne 0xA000) 'Archive symlink is forbidden.'
        }
    } finally { $zip.Dispose() }
    [IO.Compression.ZipFile]::ExtractToDirectory((Resolve-Path -LiteralPath $ArtifactPath).Path,$Destination)
    $release = Get-Content -LiteralPath (Join-Path $Destination 'release.json') -Raw | ConvertFrom-Json
    Assert-True ($release.schemaVersion -eq 1 -and $release.modelVersion -eq 2) 'Invalid artifact schema/model.'
    Assert-True ($release.solutionPackageType -ceq 'Unmanaged') 'Artifact is not an unmanaged Training update.'
    Assert-True ($release.sourceRevision -match '^[0-9a-f]{40}$') 'Artifact lacks a source commit SHA.'
    foreach ($key in 'tenantId','environmentId','websiteId') { Assert-True ($release.$key -ceq $policy.$key) "Artifact target mismatch: $key" }
    Assert-True ($release.policySha256 -ceq (Get-Sha256 $PolicyPath)) 'Artifact policy differs from reviewed target.'
    $declared = @($release.files | ForEach-Object { $_.path })
    $actual = @(Get-ChildItem -LiteralPath $Destination -Recurse -File -Force | ForEach-Object { [IO.Path]::GetRelativePath($Destination,$_.FullName).Replace('\','/') } | Where-Object { $_ -ne 'release.json' })
    Assert-True (@(Compare-Object $declared $actual).Count -eq 0) 'Artifact has missing or undeclared files.'
    foreach ($file in $release.files) {
        Assert-True ($file.path -notmatch '(^|/)\.\.(/|$)|:' -and -not [IO.Path]::IsPathRooted($file.path)) 'Unsafe metadata path.'
        $path = Join-Path $Destination $file.path
        Assert-True ((Get-Sha256 $path) -ceq $file.sha256 -and (Get-Item -LiteralPath $path).Length -eq $file.bytes) 'File digest or size mismatch.'
    }
    Assert-Profile (Join-Path $Destination 'site/deployment-profiles/training.deployment.yml') $policy
    $null = Assert-SiteSource (Join-Path $Destination 'site') $policy
    $assembly=Get-TrainingSolutionAssembly (Join-Path $Destination 'solution.zip') $policy
    Assert-True ($release.exportedAssemblySha256 -ceq $assembly.sha256 -and $release.exportedAssemblyPath -ceq $assembly.path -and $release.exportedAssemblyIdentity -ceq $assembly.identity) 'Release assembly provenance differs from verified solution.'
    return $release
}

function Get-PacFailureClassification([string]$Text,[int]$ExitCode,[double]$ElapsedSeconds) {
    $category='UNKNOWN'
    if($Text -match '(?i)missing.*prv|privilege.*(?:missing|not.*held)|access.*denied|insufficient.*permission|does not have.*privilege|403|forbidden'){$category='AUTHORIZATION'}
    elseif($Text -match '(?i)AADSTS|invalid_client|unauthorized_client|authentication.*fail|401|token.*(?:expired|invalid)'){$category='AUTHENTICATION'}
    elseif($Text -match '(?i)timed?\s*out|timeout|time limit.*exceeded|TaskCanceledException'){$category='TIMEOUT_OR_CANCELLATION'}
    elseif($Text -match '(?i)429|throttl|too many requests'){$category='THROTTLING'}
    elseif($Text -match '(?i)name resolution|no such host|connection.*(?:refused|reset)|network.*unreachable|SSL|TLS'){$category='NETWORK_OR_TLS'}
    elseif($Text -match '(?i)missing dependenc|dependency.*(?:missing|unresolved)|solution.*(?:not found|does not exist)'){$category='SOLUTION_OR_DEPENDENCY'}
    $codes=@([regex]::Matches($Text,'(?i)(?<![0-9a-z])0x[0-9a-f]{8}(?![0-9a-z])') | ForEach-Object {$_.Value.ToLowerInvariant()} | Sort-Object -Unique | Select-Object -First 4)
    # Never return raw text, identifiers, URLs, tokens, CLI arguments or paths.
    return [ordered]@{category=$category;exitCode=$ExitCode;elapsedSeconds=[Math]::Round($ElapsedSeconds,1);errorCodes=$codes}
}

function Get-TrainingSolutionExportArguments($Policy,[string]$Path) {
    return @('solution','export','--environment',$Policy.environmentUrl,'--name',$Policy.solutionUniqueName,'--path',$Path,'--async','--max-async-wait-time','10')
}

function Save-PacExportFailure([string[]]$Arguments,[string]$Text,[string]$Path) {
    Assert-True ($Arguments.Count -ge 2 -and $Arguments[0] -ceq 'solution' -and $Arguments[1] -ceq 'export') 'Failure capture is limited to solution export; authentication output is forbidden.'
    $temporaryRoot=if($env:RUNNER_TEMP){$env:RUNNER_TEMP}else{[IO.Path]::GetTempPath()}
    $root=[IO.Path]::GetFullPath($temporaryRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar
    $full=[IO.Path]::GetFullPath($Path)
    Assert-True ($full.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)) 'Failure capture must remain under the private temporary root.'
    Assert-True (-not (Test-Path -LiteralPath $full)) 'Failure capture already exists.'
    $redacted=[regex]::Replace($Text,'(?i)Bearer\s+\S+','Bearer [REDACTED]')
    $redacted=[regex]::Replace($redacted,'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+','[REDACTED JWT]')
    $redacted=[regex]::Replace($redacted,'(?i)((?:client[_-]?secret|access[_-]?token|refresh[_-]?token|password)\s*[:=]\s*)\S+','$1[REDACTED]')
    [IO.File]::WriteAllText($full,$redacted,[Text.UTF8Encoding]::new($false))
}

function Invoke-PacChecked([string[]]$Arguments,[string]$PacPath='pac',[string]$FailureOutputPath) {
    $watch=[Diagnostics.Stopwatch]::StartNew()
    $output = @(& $PacPath @Arguments 2>&1 | ForEach-Object { [string]$_ })
    $exitCode=$LASTEXITCODE;$watch.Stop()
    if($exitCode -ne 0){
        if($FailureOutputPath){
            try {Save-PacExportFailure $Arguments ($output -join "`n") $FailureOutputPath}
            catch {Write-Warning 'Private PAC export diagnostic capture failed; original safe PAC failure is preserved.'}
        }
        $safe=Get-PacFailureClassification ($output -join "`n") $exitCode $watch.Elapsed.TotalSeconds
        throw ('PAC failed: '+($Arguments[0..([Math]::Min(1,$Arguments.Count-1))] -join ' ')+' '+($safe | ConvertTo-Json -Compress))
    }
    return ($output -join "`n")
}

function Assert-PacWebsiteListing([string]$Text,$Policy) {
    # PAC 2.9.3 exposes a text table, not a JSON list option. Strip terminal
    # presentation and permit wrapped rows, while checking every identity field.
    $clean=[regex]::Replace($Text,'\x1B\[[0-?]*[ -/]*[@-~]','')
    $rows=@([regex]::Matches($clean,'(?ms)^\s*\[\d+\]\s+.*?(?=^\s*\[\d+\]\s+|\z)'))
    $selected=@($rows | Where-Object {$_.Value -match ('(?<![0-9a-f-])'+[regex]::Escape($Policy.websiteId)+'(?![0-9a-f-])')})
    Assert-True ($selected.Count -eq 1) 'Approved website missing or ambiguous.'
    $row=($selected[0].Value -replace '\s+',' ').Trim()
    $guid='[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}'
    $diagnostic=[ordered]@{check='PAC website preflight';websiteMatched=($row.Contains($Policy.websiteId));portalMatched=($row.Contains($Policy.portalId));nameMatched=($row.Contains($Policy.websiteName));runtimeUrlMatched=($row.Contains($Policy.runtimeUrl));enhancedMatched=($row -match '(?:^| )Enhanced(?: |$)');guidCount=[regex]::Matches($row,$guid).Count;rowLength=$row.Length}
    # Fixed booleans/counts only; never publish a raw PAC listing or tenant values.
    Write-Host ($diagnostic | ConvertTo-Json -Compress)
    $pattern='^\[\d+\] (?<website>'+ $guid +') (?<portal>'+ $guid +') (?<name>.+?) (?<url>https://\S+) (?<model>Enhanced|Standard) (?<spa>Yes|No) (?<active>Yes|No)$'
    $match=[regex]::Match($row,$pattern)
    Assert-True ($match.Success) 'PAC website row format is incomplete or unsupported; no target check was bypassed.'
    $expected=@{website=$Policy.websiteId;portal=$Policy.portalId;name=$Policy.websiteName;url=$Policy.runtimeUrl;model='Enhanced';active='Yes'}
    foreach($key in $expected.Keys){
        Assert-True ($match.Groups[$key].Value -ceq $expected[$key]) ('Live website identity/model mismatch: '+$key+'.')
    }
    return @{websiteMatched=$true;portalMatched=$true;nameMatched=$true;runtimeUrlMatched=$true;model='Enhanced';active=$true}
}

function New-SiteTargetFetchXml($Policy) {
    Assert-True ($Policy.websiteId -match '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$') 'Invalid reviewed website ID.'
    return ('<fetch count="2"><entity name="powerpagesite"><attribute name="powerpagesiteid"/><attribute name="name"/><attribute name="datamodelversion"/><attribute name="primarydomainname"/><attribute name="statecode"/><filter><condition attribute="powerpagesiteid" operator="eq" value="'+$Policy.websiteId+'"/></filter></entity></fetch>')
}

function Assert-DataverseSiteTarget([string]$Text,$Policy) {
    # PAC 2.9.3 org fetch has no JSON output switch. Parse only complete result
    # rows from this five-column bounded query, never a substring elsewhere.
    $clean=[regex]::Replace($Text,'\x1B\[[0-?]*[ -/]*[@-~]','')
    $guid='[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}'
    $rows=@($clean -split '\r?\n' | Where-Object {$_ -match ('^\s*'+$guid+'(?:\s|$)')})
    Assert-True ($rows.Count -eq 1) 'Dataverse website result missing or ambiguous.'
    $pattern='^\s*(?<id>'+ $guid +')\s+(?<name>.+?)\s+(?<model>\d+\.\d+)\s+(?<domain>\S+)\s+(?<state>Active|Inactive)\s*$'
    $match=[regex]::Match($rows[0],$pattern)
    Assert-True ($match.Success) 'Dataverse website result format is incomplete or unsupported.'
    $expected=@{id=$Policy.websiteId;name=$Policy.websiteName;model='2.0';domain=([uri]$Policy.runtimeUrl).DnsSafeHost;state='Active'}
    foreach($key in $expected.Keys){
        Assert-True ($match.Groups[$key].Value -ceq $expected[$key]) ('Dataverse website target mismatch: '+$key+'.')
    }
    return @{websiteMatched=$true;nameMatched=$true;model='Enhanced';domainMatched=$true;active=$true;source='Dataverse powerpagesite';hostingResourceEvidence='Reviewed policy binding only; not a live hosting-resource verification.'}
}

function Assert-LiveTrainingTarget($Policy,[string]$PacPath='pac') {
    $version = Invoke-PacChecked @('help') $PacPath
    Assert-True ($version -match 'Version:\s+2\.9\.3(?:\+|\s)') 'Wrong installed PAC version.'
    $who = Invoke-PacChecked @('auth','who') $PacPath
    Assert-True ($who -match [regex]::Escape($Policy.tenantId)) 'Authenticated tenant mismatch.'
    Assert-True ($who -match [regex]::Escape($Policy.environmentId)) 'Authentication profile is not explicitly bound to Training.'
    $org = Invoke-PacChecked @('org','who','--environment',$Policy.environmentUrl) $PacPath
    foreach ($expected in $Policy.environmentId,$Policy.organizationId,$Policy.environmentUrl) {
        Assert-True ($org -match [regex]::Escape($expected)) 'Live organization does not match approved Training target.'
    }
    $queryPath=Join-Path ([IO.Path]::GetTempPath()) ('northstar-site-target-'+[guid]::NewGuid().ToString('N')+'.xml')
    try {
        [IO.File]::WriteAllText($queryPath,(New-SiteTargetFetchXml $Policy))
        $siteResult=Invoke-PacChecked @('org','fetch','--environment',$Policy.environmentUrl,'--xmlFile',$queryPath) $PacPath
        $siteProof=Assert-DataverseSiteTarget $siteResult $Policy
        Write-Host (@{check='Dataverse website preflight';websiteMatched=$true;nameMatched=$true;modelMatched=$true;domainMatched=$true;active=$true} | ConvertTo-Json -Compress)
    } finally {if(Test-Path -LiteralPath $queryPath){Remove-Item -LiteralPath $queryPath -Force}}
    $solutions=Invoke-PacChecked @('solution','list','--environment',$Policy.environmentUrl) $PacPath
    $solution=@($solutions -split "`n" | Where-Object { $_ -match ('^'+[regex]::Escape($Policy.solutionUniqueName)+'\s+') })
    Assert-True ($solution.Count -eq 1 -and $solution[0] -match '\sFalse\s*$') 'Existing Training solution must be unmanaged; no automatic conversion or migration is allowed.'
    return @{tenant=$Policy.tenantId;environment=$Policy.environmentId;website=$Policy.websiteId;model='Enhanced';siteProof=$siteProof}
}

Export-ModuleMember -Function *
