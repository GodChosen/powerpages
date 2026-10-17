param([Parameter(Mandatory)][string]$Repository,[string]$Environment='northstar-training')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if($Repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'){throw 'Invalid repository.'}
if($Environment -cne 'northstar-training'){throw 'Unexpected deployment environment.'}
$raw=& gh api "repos/$Repository/environments/$Environment"
if($LASTEXITCODE -ne 0){throw 'Cannot verify protected GitHub environment.'}
$setting=$raw | ConvertFrom-Json
$review=@($setting.protection_rules | Where-Object type -eq 'required_reviewers')
if($review.Count -ne 1 -or $review[0].reviewers.Count -lt 1 -or -not $review[0].prevent_self_review){
    throw 'Required reviewers with prevent-self-review must protect the environment.'
}
if($null -eq $setting.deployment_branch_policy){throw 'Deployment branch policy is required.'}
if($setting.deployment_branch_policy.custom_branch_policies){
    $raw=& gh api "repos/$Repository/environments/$Environment/deployment-branch-policies"
    if($LASTEXITCODE -ne 0){throw 'Cannot verify master branch deployment policy.'}
    $branches=$raw | ConvertFrom-Json
    if(@($branches.branch_policies).Count -ne 1 -or $branches.branch_policies[0].name -cne 'master'){
        throw 'Only master must be allowed by custom deployment branch policy.'
    }
} elseif(-not $setting.deployment_branch_policy.protected_branches){throw 'Protected deployment branch is required.'}
Write-Output 'Verified deployment environment reviewers and branch policy.'
