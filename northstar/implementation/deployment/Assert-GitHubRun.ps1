param([Parameter(Mandatory)][string]$RunId,[Parameter(Mandatory)][string]$Repository)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if($RunId -notmatch '^[1-9][0-9]*$'){throw 'Invalid run ID.'}
if($Repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'){throw 'Invalid repository.'}
$raw=& gh api "repos/$Repository/actions/runs/$RunId"
if($LASTEXITCODE -ne 0){throw 'Cannot inspect artifact-producing workflow run.'}
$run=$raw | ConvertFrom-Json
if($run.status -ne 'completed' -or $run.conclusion -ne 'success' -or
    $run.head_branch -ne 'master' -or $run.head_repository.full_name -cne $Repository -or
    $run.path -ne '.github/workflows/northstar-training.yml'){
    throw 'Artifact run must be a successful master-branch run of this approved workflow in this repository.'
}
$run.head_sha
