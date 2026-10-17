param([string]$OutputDirectory)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$package=Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version="$($package.version).0"
if (-not $OutputDirectory) { $OutputDirectory=Join-Path $projectRoot 'artifacts' }
[void][IO.Directory]::CreateDirectory($OutputDirectory)
$OutputDirectory=[IO.Path]::GetFullPath($OutputDirectory)
$artifactRoot=Join-Path $projectRoot 'artifacts'
[void][IO.Directory]::CreateDirectory($artifactRoot)
$stage=Join-Path $artifactRoot ('staging-'+[Guid]::NewGuid().ToString('N'))
Copy-Item -LiteralPath (Join-Path $projectRoot 'solution') -Destination $stage -Recurse
Get-ChildItem -LiteralPath (Join-Path $projectRoot 'src') -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $stage ('WebResources/dexp_/dependency/'+$_.Name)) }
foreach ($kind in @('Unmanaged','Managed')) {
 $manifestPath=Join-Path $stage 'Other/Solution.xml'
 [xml]$manifest=Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8
 $manifest.ImportExportXml.SolutionManifest.Version=$version
 $manifest.ImportExportXml.SolutionManifest.Managed=$(if($kind -eq 'Managed'){'1'}else{'0'})
 $manifest.Save($manifestPath)
 $target=Join-Path $OutputDirectory "DataverseRibbonAuditExplorer_$($package.version)_$($kind.ToLower()).zip"
 pac solution pack --folder $stage --zipfile $target --packagetype $kind --useUnmanagedFileForMissingManaged
 if ($LASTEXITCODE -ne 0) { throw "Packaging $kind failed" }
}
node (Join-Path $PSScriptRoot 'verify-release.mjs') --directory $OutputDirectory
if ($LASTEXITCODE -ne 0) { throw 'Package verification failed' }
Write-Output 'Build complete. No authentication, environment import or publishing was performed.'
