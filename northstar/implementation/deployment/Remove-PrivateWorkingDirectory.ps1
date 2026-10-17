param([Parameter(Mandatory)][string]$Path,[Parameter(Mandatory)][string]$RunnerTemporaryRoot)
$target=[IO.Path]::GetFullPath($Path)
$root=[IO.Path]::GetFullPath($RunnerTemporaryRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar
if(-not $target.StartsWith($root,[StringComparison]::OrdinalIgnoreCase) -or
    -not (Split-Path $target -Leaf).StartsWith('northstar-private-')){
    throw 'Private cleanup target is outside the expected runner workspace.'
}
if(Test-Path -LiteralPath $target){
    try{Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop}
    catch{Write-Warning 'Best-effort private working-directory cleanup failed; ephemeral runner destruction remains required.'}
}
