param([Parameter(Mandatory)][string]$Repository,[string]$Environment='northstar-training',
    [string]$PolicyPath=(Join-Path $PSScriptRoot 'target.training.json'))
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'Pipeline.Core.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'GitHubProtection.Core.psm1') -Force
$policy=Read-TrainingPolicy $PolicyPath
if($Repository -cne 'GodChosen/powerpages' -or $Environment -cne 'northstar-training'){throw 'Unapproved repository/environment.'}
$raw=& gh api "repos/$Repository/environments/$Environment"
if($LASTEXITCODE -ne 0){throw 'Cannot verify protected GitHub environment.'}
$setting=$raw|ConvertFrom-Json
$raw=& gh api "repos/$Repository/environments/$Environment/deployment-branch-policies"
if($LASTEXITCODE -ne 0){throw 'Cannot verify master-only deployment branch policy.'}
$branches=$raw|ConvertFrom-Json
Assert-TrainingGitHubProtection $setting $branches $policy $Repository $Environment
