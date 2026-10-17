Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Import-Module (Join-Path $root 'GitHubProtection.Core.psm1') -Force
$policy=Get-Content (Join-Path $root 'target.training.json') -Raw|ConvertFrom-Json
$setting=@{name='northstar-training';protection_rules=@(@{type='required_reviewers';prevent_self_review=$false;reviewers=@(@{type='User';reviewer=@{login='GodChosen';id=32401680}})});deployment_branch_policy=@{custom_branch_policies=$true;protected_branches=$false}}
$branches=@{branch_policies=@(@{name='master';type='branch'})}
function Clone($Value){$Value|ConvertTo-Json -Depth 10|ConvertFrom-Json}
function Reject([scriptblock]$Body){try{&$Body;throw 'UNEXPECTED_SUCCESS'}catch{if($_.Exception.Message -eq 'UNEXPECTED_SUCCESS'){throw}}}
$null=Assert-TrainingGitHubProtection $setting $branches $policy 'GodChosen/powerpages' 'northstar-training'
$count=1
$bad=Clone $setting;$bad.protection_rules=@();Reject {Assert-TrainingGitHubProtection $bad $branches $policy 'GodChosen/powerpages' 'northstar-training'};$count++
$bad=Clone $setting;$bad.protection_rules[0].reviewers[0].reviewer.login='someone-else';Reject {Assert-TrainingGitHubProtection $bad $branches $policy 'GodChosen/powerpages' 'northstar-training'};$count++
$bad=Clone $setting;$bad.protection_rules[0].reviewers[0].reviewer.id=1;Reject {Assert-TrainingGitHubProtection $bad $branches $policy 'GodChosen/powerpages' 'northstar-training'};$count++
$bad=Clone $branches;$bad.branch_policies[0].name='feature';Reject {Assert-TrainingGitHubProtection $setting $bad $policy 'GodChosen/powerpages' 'northstar-training'};$count++
Reject {Assert-TrainingGitHubProtection $setting $branches $policy 'other/repo' 'northstar-training'};$count++
Reject {Assert-TrainingGitHubProtection $setting $branches $policy 'GodChosen/powerpages' 'production'};$count++
$strict=Clone $policy;$strict.allowSelfReviewTraining=$false;Reject {Assert-TrainingGitHubProtection $setting $branches $strict 'GodChosen/powerpages' 'northstar-training'};$count++
@{status='PASS';tests=$count;scope='Single-owner Training policy still requires explicit GodChosen manual review and master-only branch. Wrong/missing reviewer, wrong repo/env/branch and independent-review policy bypass fail closed; no GitHub settings changed.'}|ConvertTo-Json|Tee-Object -FilePath (Join-Path $root 'protection-test-results.json')
exit 0
