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

function Assert-TrainingSolution([string]$Path, $Policy) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Path).Path)
    try {
        $entry = $zip.GetEntry('solution.xml')
        Assert-True ($null -ne $entry) 'Solution manifest missing.'
        $reader = [IO.StreamReader]::new($entry.Open())
        try { [xml]$xml = $reader.ReadToEnd() } finally { $reader.Dispose() }
        Assert-True ([string]$xml.ImportExportXml.SolutionManifest.Managed -ceq '0') 'Training accepts only unmanaged lab updates; managed promotion is not authorized.'
        Assert-True ([string]$xml.ImportExportXml.SolutionManifest.UniqueName -ceq $Policy.solutionUniqueName) 'Wrong solution unique name.'
        Assert-True ($null -ne $zip.GetEntry('customizations.xml')) 'Solution customizations missing.'
        $assemblies=@($zip.Entries | Where-Object { [IO.Path]::GetFileName($_.FullName) -ceq 'Northstar.Lifecycle.dll' })
        Assert-True ($assemblies.Count -eq 1) 'Unmanaged Training export must contain the actual Northstar.Lifecycle.dll; schema-only ZIPs are rejected.'
    } finally { $zip.Dispose() }
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
        $solutionArchive=[IO.Compression.ZipFile]::OpenRead((Join-Path $stage 'solution.zip'))
        try {
            $assemblyEntry=@($solutionArchive.Entries | Where-Object { [IO.Path]::GetFileName($_.FullName) -ceq 'Northstar.Lifecycle.dll' })[0]
            $stream=$assemblyEntry.Open()
            try { $sha=[Security.Cryptography.SHA256]::Create();try{$assemblyHash=[Convert]::ToHexString($sha.ComputeHash($stream)).ToLowerInvariant()}finally{$sha.Dispose()} } finally {$stream.Dispose()}
        } finally {$solutionArchive.Dispose()}
        $metadata = @{schemaVersion=1;sourceRevision=$SourceRevision;createdUtc=[DateTime]::UtcNow.ToString('o');
            tenantId=$policy.tenantId;environmentId=$policy.environmentId;websiteId=$policy.websiteId;
            modelVersion=2;pacVersion='2.9.3';solutionPackageType='Unmanaged';policySha256=Get-Sha256 $PolicyPath;files=$entries;
            exportedAssemblySha256=$assemblyHash;
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
    Assert-TrainingSolution (Join-Path $Destination 'solution.zip') $policy
    return $release
}

function Invoke-PacChecked([string[]]$Arguments,[string]$PacPath='pac') {
    $output = @(& $PacPath @Arguments 2>&1 | ForEach-Object { [string]$_ })
    Assert-True ($LASTEXITCODE -eq 0) ('PAC failed: '+($Arguments[0..([Math]::Min(1,$Arguments.Count-1))] -join ' '))
    return ($output -join "`n")
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
    $sites = Invoke-PacChecked @('pages','list','--environment',$Policy.environmentUrl,'--verbose') $PacPath
    $line = @($sites -split "`n" | Where-Object { $_ -match [regex]::Escape($Policy.websiteId) })
    Assert-True ($line.Count -eq 1) 'Approved website missing or ambiguous.'
    foreach ($expected in $Policy.portalId,$Policy.websiteName,'Enhanced') {
        Assert-True ($line[0] -match [regex]::Escape($expected)) 'Live website identity/model mismatch.'
    }
    $solutions=Invoke-PacChecked @('solution','list','--environment',$Policy.environmentUrl) $PacPath
    $solution=@($solutions -split "`n" | Where-Object { $_ -match ('^'+[regex]::Escape($Policy.solutionUniqueName)+'\s+') })
    Assert-True ($solution.Count -eq 1 -and $solution[0] -match '\sFalse\s*$') 'Existing Training solution must be unmanaged; no automatic conversion or migration is allowed.'
    return @{tenant=$Policy.tenantId;environment=$Policy.environmentId;website=$Policy.websiteId;model='Enhanced'}
}

Export-ModuleMember -Function *
