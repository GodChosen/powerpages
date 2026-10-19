Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Assert-CryptoPath([string]$Path,[string]$WorkingRoot) {
    $root=[IO.Path]::GetFullPath($WorkingRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar
    $full=[IO.Path]::GetFullPath($Path)
    if(-not $full.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){throw 'Artifact output must remain inside the explicit private working root.'}
    if(Test-Path -LiteralPath $full){throw 'Artifact output already exists.'}
    return $full
}
function Get-ArtifactKey([string]$KeyBase64) {
    try { $key=[Convert]::FromBase64String($KeyBase64) } catch {throw 'Artifact key must be base64 for 32 random bytes.'}
    if($key.Length -ne 32){throw 'Artifact key must contain exactly 32 bytes.'}
    return ,$key
}
function Get-ArtifactFormat([ValidateSet('Release','PacExportDiagnostic','PacImportDiagnostic')][string]$Purpose='Release') {
    if($Purpose -ceq 'Release'){return 'northstar-release-aes256gcm-v1'}
    if($Purpose -ceq 'PacImportDiagnostic'){return 'northstar-pac-import-diagnostic-aes256gcm-v1'}
    return 'northstar-pac-export-diagnostic-aes256gcm-v1'
}
function Get-ArtifactContext([string]$Repository,[string]$Environment,[string]$SourceRevision,[string]$Purpose='Release') {
    if($Repository -cne 'GodChosen/powerpages' -or $Environment -cne 'northstar-training'){throw 'Unapproved artifact repository/environment context.'}
    $format=Get-ArtifactFormat $Purpose
    return [Text.Encoding]::UTF8.GetBytes("$format`n$Repository`n$Environment`n$SourceRevision")
}
function Protect-ReleaseArtifact {
    param([string]$InputPath,[string]$OutputPath,[string]$WorkingRoot,
        [string]$KeyBase64,[string]$SourceRevision,
        [string]$Repository='GodChosen/powerpages',[string]$Environment='northstar-training',
        [ValidateSet('Release','PacExportDiagnostic','PacImportDiagnostic')][string]$Purpose='Release')
    $output=Assert-CryptoPath $OutputPath $WorkingRoot
    if($SourceRevision -notmatch '^[0-9a-f]{40}$'){throw 'Full source commit SHA required.'}
    $aad=Get-ArtifactContext $Repository $Environment $SourceRevision $Purpose
    $key=Get-ArtifactKey $KeyBase64
    $plain=[IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $InputPath).Path)
    $cipher=[byte[]]::new($plain.Length)
    $nonce=[Security.Cryptography.RandomNumberGenerator]::GetBytes(12)
    $tag=[byte[]]::new(16)
    $aes=[Security.Cryptography.AesGcm]::new($key,16)
    try {
        $aes.Encrypt($nonce,$plain,$cipher,$tag,$aad)
        $envelope=@{format=(Get-ArtifactFormat $Purpose);repository=$Repository;
            environment=$Environment;sourceRevision=$SourceRevision;
            nonce=[Convert]::ToBase64String($nonce);tag=[Convert]::ToBase64String($tag);
            ciphertext=[Convert]::ToBase64String($cipher)}
        New-Item -ItemType Directory -Path (Split-Path $output -Parent) -Force | Out-Null
        [IO.File]::WriteAllText($output,($envelope | ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
        return @{format=$envelope.format;sourceRevision=$SourceRevision;
            cipherSha256=(Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()}
    } finally {$aes.Dispose();[Array]::Clear($key,0,$key.Length);[Array]::Clear($plain,0,$plain.Length)}
}
function Unprotect-ReleaseArtifact {
    param([string]$InputPath,[string]$ExpectedCipherSha256,[string]$OutputPath,
        [string]$WorkingRoot,[string]$KeyBase64,[string]$ExpectedSourceRevision,
        [string]$Repository='GodChosen/powerpages',[string]$Environment='northstar-training',
        [ValidateSet('Release','PacExportDiagnostic','PacImportDiagnostic')][string]$Purpose='Release')
    if($ExpectedSourceRevision -notmatch '^[0-9a-f]{40}$'){throw 'Expected source revision must be a full lowercase 40-character hexadecimal commit SHA.'}
    $output=Assert-CryptoPath $OutputPath $WorkingRoot
    if($ExpectedCipherSha256 -notmatch '^[0-9a-f]{64}$' -or
        (Get-FileHash -LiteralPath $InputPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ExpectedCipherSha256){throw 'Encrypted artifact SHA-256 mismatch.'}
    $envelope=Get-Content -LiteralPath $InputPath -Raw | ConvertFrom-Json
    if($envelope.format -cne (Get-ArtifactFormat $Purpose) -or
        $envelope.repository -cne $Repository -or $envelope.environment -cne $Environment -or
        $envelope.sourceRevision -cne $ExpectedSourceRevision){throw 'Encrypted artifact context/source mismatch.'}
    $aad=Get-ArtifactContext $Repository $Environment $ExpectedSourceRevision $Purpose
    $key=Get-ArtifactKey $KeyBase64
    $nonce=[Convert]::FromBase64String($envelope.nonce)
    $tag=[Convert]::FromBase64String($envelope.tag)
    $cipher=[Convert]::FromBase64String($envelope.ciphertext)
    if($nonce.Length -ne 12 -or $tag.Length -ne 16){throw 'Invalid AES-GCM nonce/tag size.'}
    if($cipher.Length -gt 104857600){throw 'Encrypted release exceeds 100 MB limit.'}
    $plain=[byte[]]::new($cipher.Length)
    $aes=[Security.Cryptography.AesGcm]::new($key,16)
    try {
        try {$aes.Decrypt($nonce,$cipher,$tag,$plain,$aad)} catch {throw 'Encrypted release authentication failed; no plaintext was written.'}
        New-Item -ItemType Directory -Path (Split-Path $output -Parent) -Force | Out-Null
        [IO.File]::WriteAllBytes($output,$plain)
        return @{path=$output;sourceRevision=$envelope.sourceRevision;
            plaintextSha256=(Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()}
    } finally {$aes.Dispose();[Array]::Clear($key,0,$key.Length);[Array]::Clear($plain,0,$plain.Length)}
}
Export-ModuleMember -Function Protect-ReleaseArtifact,Unprotect-ReleaseArtifact
