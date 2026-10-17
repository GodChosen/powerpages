Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Import-Module (Join-Path $root 'ArtifactCrypto.psm1') -Force
$work=Join-Path $root ('test-output/crypto-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
$key=[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$wrong=[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$input=Join-Path $work 'private-release.zip'
[IO.File]::WriteAllText($input,'private-principal-sentinel-'+[guid]::NewGuid())
$revision='a'*40
$encrypted=Join-Path $work 'release.enc.json'
$summary=Protect-ReleaseArtifact $input $encrypted $work $key $revision
$count=0
function Reject([scriptblock]$Body){try{&$Body;throw 'UNEXPECTED_SUCCESS'}catch{if($_.Exception.Message -eq 'UNEXPECTED_SUCCESS'){throw}}}
$clear=Join-Path $work 'roundtrip.zip'
$decoded=Unprotect-ReleaseArtifact $encrypted $summary.cipherSha256 $clear $work $key $revision
if([IO.File]::ReadAllText($clear) -cne [IO.File]::ReadAllText($input)){throw 'Roundtrip changed data.'};$count++
if((Get-Content $encrypted -Raw) -match 'private-principal-sentinel'){throw 'Plaintext appeared in envelope.'};$count++
$second=Join-Path $work 'second.enc.json';$secondSummary=Protect-ReleaseArtifact $input $second $work $key $revision
if($summary.cipherSha256 -ceq $secondSummary.cipherSha256){throw 'Repeated encryption reused randomness.'};$count++
$badOutput=Join-Path $work 'wrong-key.zip'
Reject {Unprotect-ReleaseArtifact $encrypted $summary.cipherSha256 $badOutput $work $wrong $revision}
if(Test-Path $badOutput){throw 'Wrong key wrote plaintext.'};$count++
$tampered=Join-Path $work 'tampered.enc.json';$data=Get-Content $encrypted -Raw|ConvertFrom-Json
$tag=[Convert]::FromBase64String($data.tag);$tag[0]=$tag[0] -bxor 1;$data.tag=[Convert]::ToBase64String($tag);$data|ConvertTo-Json|Set-Content $tampered
$tamperedHash=(Get-FileHash $tampered -Algorithm SHA256).Hash.ToLowerInvariant()
$badOutput=Join-Path $work 'tampered.zip'
Reject {Unprotect-ReleaseArtifact $tampered $tamperedHash $badOutput $work $key $revision}
if(Test-Path $badOutput){throw 'Tampered tag wrote plaintext.'};$count++
Reject {Unprotect-ReleaseArtifact $encrypted $summary.cipherSha256 (Join-Path $work 'wrong-repo.zip') $work $key $revision 'attacker/fork' 'northstar-training'};$count++
Reject {Unprotect-ReleaseArtifact $encrypted $summary.cipherSha256 (Join-Path $work 'wrong-source.zip') $work $key ('b'*40)};$count++
$rewritten=Join-Path $work 'source-rewritten.enc.json';$changed=Get-Content $encrypted -Raw|ConvertFrom-Json;$changed.sourceRevision='b'*40;$changed|ConvertTo-Json|Set-Content $rewritten
Reject {Unprotect-ReleaseArtifact $rewritten (Get-FileHash $rewritten -Algorithm SHA256).Hash.ToLowerInvariant() (Join-Path $work 'source-rewritten.zip') $work $key ('b'*40)};$count++
$outside=Join-Path (Split-Path $work -Parent) 'escape-plaintext.zip'
Reject {Unprotect-ReleaseArtifact $encrypted $summary.cipherSha256 $outside $work $key $revision}
if(Test-Path $outside){throw 'Plaintext escaped explicit working root.'};$count++
@{status='PASS';tests=$count;scope='AES-256-GCM roundtrip, independent randomness, wrong key, tampered authentication tag, wrong repository/AAD, wrong source revision, no plaintext on failed authentication, and explicit working-root confinement.'}|ConvertTo-Json|Tee-Object -FilePath (Join-Path $root 'crypto-test-results.json')
