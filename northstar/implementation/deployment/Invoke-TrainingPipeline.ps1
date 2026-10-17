[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Validate','Package','Plan','Deploy','Rollback','Export')][string]$Mode,
    [string]$SitePath,[string]$SolutionPath,[string]$OutputPath,
    [string]$SourceRevision,[string]$ArtifactPath,[string]$ExpectedSha256,
    [string]$RollbackArtifactPath,[string]$RollbackSha256,
    [string]$ExpectedSourceRevision,[string]$ExpectedRollbackRevision,
    [ValidateSet('None','ExistingProfile','GitHubFederated')][string]$Authentication='None',
    [string]$AuthProfileName,[string]$Confirmation,
    [string]$WorkingDirectory=(Join-Path $PSScriptRoot '.pipeline'),
    [string]$PolicyPath=(Join-Path $PSScriptRoot 'target.training.json'),
    [string]$PacPath='pac'
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'Pipeline.Core.psm1') -Force
$policy=Read-TrainingPolicy $PolicyPath
$profile=Join-Path $PSScriptRoot 'profiles/training.deployment.yml'
Assert-Profile $profile $policy
$evidence=[IO.Path]::GetFullPath($WorkingDirectory)
New-Item -ItemType Directory -Path $evidence -Force | Out-Null

if($Mode -eq 'Validate') {
    $null=Assert-SiteSource $SitePath $policy
    Assert-TrainingSolution $SolutionPath $policy
    @{status='PASS';target='Training';modelVersion=2;pacVersion='2.9.3'} | ConvertTo-Json
    exit 0
}
if($Mode -eq 'Package') {
    New-ReleasePackage -SitePath $SitePath -SolutionPath $SolutionPath -PolicyPath $PolicyPath -ProfilePath $profile -OutputPath $OutputPath -SourceRevision $SourceRevision | ConvertTo-Json
    exit 0
}

$stage=Join-Path $evidence ([guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
$ownedProfile=$null
$operationFailed=$false
try {
    if($Mode -ne 'Export') {
        $release=Expand-VerifiedRelease -ArtifactPath $ArtifactPath -ExpectedSha256 $ExpectedSha256 -Destination (Join-Path $stage 'candidate') -PolicyPath $PolicyPath
        # A real, digest-verified predecessor is mandatory before any change.
        $rollback=Expand-VerifiedRelease -ArtifactPath $RollbackArtifactPath -ExpectedSha256 $RollbackSha256 -Destination (Join-Path $stage 'rollback') -PolicyPath $PolicyPath
        if($ExpectedSourceRevision) { Assert-True ($release.sourceRevision -ceq $ExpectedSourceRevision) 'Candidate artifact source commit differs from its producing run.' }
        if($ExpectedRollbackRevision) { Assert-True ($rollback.sourceRevision -ceq $ExpectedRollbackRevision) 'Rollback artifact source commit differs from its producing run.' }
        $selected=if($Mode -eq 'Rollback'){'rollback'}else{'candidate'}
        $selectedPath=Join-Path $stage $selected
        [object[]]$commands=,([string[]]@('pages','upload','--environment',$policy.environmentUrl,'--path',(Join-Path $selectedPath 'site'),'--deploymentProfile','training','--modelVersion','2','--forceUploadAll'))
        if($Mode -ne 'Rollback') {
            $commands=,([string[]]@('solution','import','--environment',$policy.environmentUrl,'--path',(Join-Path $selectedPath 'solution.zip'),'--activate-plugins','--publish-changes')) + $commands
        }
        $plan=@{
            mode=$Mode;target=$policy.environmentUrl;environmentId=$policy.environmentId;
            tenantId=$policy.tenantId;websiteId=$policy.websiteId;modelVersion=2;
            candidateSha256=$ExpectedSha256;rollbackSha256=$RollbackSha256;
            sourceRevision=$release.sourceRevision;
            commands=$commands;
            rollbackScope=$policy.rollbackScope
        }
        $plan | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $stage 'plan.json')
        if($Mode -eq 'Plan') { $plan | ConvertTo-Json -Depth 10; exit 0 }
    }
    Assert-True ($Confirmation -ceq 'TRAINING') 'Exact TRAINING confirmation is required for authenticated operations.'
    Assert-True ($Authentication -ne 'None') 'An explicit authentication mode is required.'
    if($Authentication -eq 'GitHubFederated') {
        Assert-True ($env:GITHUB_ACTIONS -ceq 'true') 'GitHub federation requires a GitHub Actions job.'
        Assert-True ($null -ne $policy.approvedRepository -and $env:GITHUB_REPOSITORY -ceq $policy.approvedRepository) 'Configure and match the approved repository before deployment.'
        Assert-True ($env:GITHUB_REF -ceq 'refs/heads/master' -and $env:GITHUB_EVENT_NAME -ceq 'workflow_dispatch') 'Only manual dispatch from master may deploy.'
        if($Mode -ne 'Export') { Assert-True ($ExpectedSourceRevision -match '^[0-9a-f]{40}$' -and $ExpectedRollbackRevision -match '^[0-9a-f]{40}$') 'Verified artifact producer commit SHAs are required.' }
        Assert-True ($policy.applicationId -match '^[0-9a-f-]{36}$' -and $policy.applicationId -ne '00000000-0000-0000-0000-000000000000') 'Configure the deployment application ID.'
        Assert-True (-not [string]::IsNullOrEmpty($env:ACTIONS_ID_TOKEN_REQUEST_URL)) 'OIDC permission/context is absent.'
        $ownedProfile='northstar-'+[guid]::NewGuid().ToString('N').Substring(0,12)
        $null=Invoke-PacChecked @('auth','create','--name',$ownedProfile,'--tenant',$policy.tenantId,'--applicationId',$policy.applicationId,'--environment',$policy.environmentUrl,'--githubFederated') $PacPath
        $AuthProfileName=$ownedProfile
    } else {
        Assert-True (-not [string]::IsNullOrWhiteSpace($AuthProfileName)) 'Explicit existing PAC profile name is required.'
    }
    $null=Invoke-PacChecked @('auth','select','--name',$AuthProfileName) $PacPath
    $identity=Assert-LiveTrainingTarget $policy $PacPath
    $identity | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'verified-target.json')
    if($Mode -eq 'Export') {
        Assert-True (-not [string]::IsNullOrWhiteSpace($OutputPath)) 'An explicit export output directory is required.'
        Assert-True (-not (Test-Path -LiteralPath $OutputPath)) 'Export destination must be new.'
        New-Item -ItemType Directory -Path $OutputPath | Out-Null
        $solution=Join-Path $OutputPath 'solution.zip'
        $null=Invoke-PacChecked (Get-TrainingSolutionExportArguments $policy $solution) $PacPath -FailureOutputPath (Join-Path $evidence 'pac-solution-export-failure.txt')
        $null=Invoke-PacChecked @('pages','download','--environment',$policy.environmentUrl,'--path',(Join-Path $OutputPath 'site-export'),'--webSiteId',$policy.websiteId,'--modelVersion','2') $PacPath
        Assert-TrainingSolution $solution $policy
        @{status='EXPORTED';path=$OutputPath;solutionSha256=Get-Sha256 $solution;target=$identity} | ConvertTo-Json -Depth 6
        exit 0
    }
    # Changes are intentionally sequential: import the reviewed unmanaged lab solution
    # before uploading its dependent site configuration. Never auto-rollback a
    # partial import or replay business writes on a network timeout.
    foreach($command in $plan.commands) {
        $null=Invoke-PacChecked $command $PacPath
    }
    $null=Assert-LiveTrainingTarget $policy $PacPath
    $post=Join-Path $stage 'post-upload-export'
    $null=Invoke-PacChecked @('pages','download','--environment',$policy.environmentUrl,'--path',$post,'--webSiteId',$policy.websiteId,'--modelVersion','2') $PacPath
    $result=@{status='UPLOADED_PENDING_RUNTIME_ACCEPTANCE';mode=$Mode;target=$identity;
        artifactSha256=$ExpectedSha256;rollbackSha256=$RollbackSha256;postExport=$post;
        note='Run the two-contact isolation, lifecycle, CSRF and anonymous tests. Deployment success is not runtime acceptance.'}
    $result | ConvertTo-Json -Depth 8 | Tee-Object -FilePath (Join-Path $stage 'result.json')
} catch {
    $operationFailed=$true
    throw
} finally {
    if($ownedProfile) {
        try {$null=Invoke-PacChecked @('auth','delete','--name',$ownedProfile) $PacPath}
        catch {
            if(-not $operationFailed){throw 'Owned PAC authentication profile cleanup failed.'}
            Write-Warning 'Owned PAC authentication profile cleanup failed; original safe operation failure is preserved.'
        }
    }
}
