Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Assert-TrainingGitHubProtection {
    param($Setting,$Branches,$Policy,[string]$Repository,[string]$Environment)
    if($Repository -cne 'GodChosen/powerpages' -or $Repository -cne $Policy.approvedRepository -or
        $Environment -cne 'northstar-training' -or $Environment -cne $Policy.githubEnvironment){throw 'Unapproved repository/environment.'}
    if($Policy.requiredReviewerLogin -cne 'GodChosen' -or $Policy.requiredReviewerId -ne 32401680){throw 'Only the explicitly approved Training reviewer policy is supported.'}
    if($Setting.name -cne $Environment){throw 'Unexpected protected environment response.'}
    $rules=@($Setting.protection_rules|Where-Object type -eq 'required_reviewers')
    if($rules.Count -ne 1 -or @($rules[0].reviewers).Count -ne 1){throw 'Exactly the approved Training reviewer is required.'}
    $reviewer=$rules[0].reviewers[0]
    if($reviewer.type -cne 'User' -or $reviewer.reviewer.login -cne $Policy.requiredReviewerLogin -or
        $reviewer.reviewer.id -ne $Policy.requiredReviewerId){throw 'Wrong required Training reviewer.'}
    if(-not $Policy.allowSelfReviewTraining -and -not $rules[0].prevent_self_review){throw 'Independent review is required by this policy.'}
    if($null -eq $Setting.deployment_branch_policy -or -not $Setting.deployment_branch_policy.custom_branch_policies){throw 'Explicit master-only deployment policy is required.'}
    if(@($Branches.branch_policies).Count -ne 1 -or $Branches.branch_policies[0].name -cne 'master'){
        throw 'Only master may deploy.'
    }
    return 'Verified explicit Training reviewer and master-only deployment policy; no automatic approval.'
}
Export-ModuleMember -Function Assert-TrainingGitHubProtection
